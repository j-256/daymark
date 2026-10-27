import { canonical, type Operation } from "../shared/model";
import { LIMITS, validateOperation } from "../shared/validation";

export interface Backup {
  format: "daymark";
  version: 1;
  accountId: string;
  exportedAt: string;
  operations: Operation[];
  integrity?: { algorithm: "SHA-256"; sha256: string };
}

export function causalOrder(operations: Operation[], known?: Set<string>): Operation[] {
  const byId = new Map<string, Operation>();
  for (const op of operations) {
    const previous = byId.get(op.id);
    if (previous && canonical(previous) !== canonical(op))
      throw new Error("Conflicting operation ID in backup");
    byId.set(op.id, op);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: Operation[] = [];
  for (const root of byId.values()) {
    if (visited.has(root.id)) continue;
    const stack = [{ op: root, parent: 0 }];
    visiting.add(root.id);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.parent === frame.op.parents.length) {
        stack.pop();
        visiting.delete(frame.op.id);
        visited.add(frame.op.id);
        result.push(frame.op);
        continue;
      }
      const id = frame.op.parents[frame.parent++];
      const previous = byId.get(id);
      if (!previous) {
        if (known && !known.has(id)) throw new Error("Incomplete operation history");
        continue;
      }
      if (previous.kind !== frame.op.kind || previous.key !== frame.op.key)
        throw new Error("Parent belongs to a different record");
      if (visiting.has(id)) throw new Error("Cyclic operation history");
      if (!visited.has(id)) {
        visiting.add(id);
        stack.push({ op: previous, parent: 0 });
      }
    }
  }
  return result;
}

async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createBackup(accountId: string, operations: Operation[]): Promise<Backup> {
  const backup: Backup = {
    format: "daymark",
    version: 1,
    accountId,
    exportedAt: new Date().toISOString(),
    operations,
  };
  return { ...backup, integrity: { algorithm: "SHA-256", sha256: await checksum(backup) } };
}

export function backupDownload(backup: Backup): { text: string; restorable: boolean } {
  const text = JSON.stringify(backup);
  return {
    text,
    restorable:
      backup.operations.length <= LIMITS.backupOperations &&
      new TextEncoder().encode(text).length <= LIMITS.backup,
  };
}

export async function validateBackup(input: unknown): Promise<Backup> {
  if (
    !input ||
    typeof input !== "object" ||
    !("format" in input) ||
    input.format !== "daymark" ||
    !("version" in input) ||
    input.version !== 1 ||
    !("accountId" in input) ||
    typeof input.accountId !== "string" ||
    !input.accountId ||
    !("exportedAt" in input) ||
    typeof input.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(input.exportedAt))
  )
    throw new Error("This backup uses an unsupported format");
  if (
    !("operations" in input) ||
    !Array.isArray(input.operations) ||
    input.operations.length > LIMITS.backupOperations ||
    new TextEncoder().encode(JSON.stringify(input)).length > LIMITS.backup
  )
    throw new Error("Invalid or oversized backup");
  const operations = input.operations.map(validateOperation);
  causalOrder(operations, new Set(operations.map((op) => op.id)));
  if ("integrity" in input) {
    const integrity = input.integrity;
    if (
      !integrity ||
      typeof integrity !== "object" ||
      !("algorithm" in integrity) ||
      integrity.algorithm !== "SHA-256" ||
      !("sha256" in integrity) ||
      typeof integrity.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(integrity.sha256)
    )
      throw new Error("Invalid backup integrity metadata");
    const { integrity: _integrity, ...payload } = input;
    if ((await checksum(payload)) !== integrity.sha256)
      throw new Error("Backup integrity check failed. Choose an unchanged backup file.");
  }
  return { ...(input as Backup), operations };
}

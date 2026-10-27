import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { canonical, type Kind, type Operation, operation, type Value } from "../shared/model";
import { validateOperation } from "../shared/validation";
import { type Backup, causalOrder, createBackup, validateBackup } from "./backup";

export type { Backup } from "./backup";

export const LOCAL_WORKSPACE_ID = "local-workspace";
export const BACKUP_REMINDER_INTERVAL = 24 * 60 * 60 * 1000;
const RECOVERY_KEYS = Object.freeze({
  checkedAt: "backup-checked-at",
  operationCount: "backup-operation-count",
  remindAfter: "backup-remind-after",
});
export interface Recovery {
  checkedAt: number;
  operationCount: number;
  remindAfter: number;
  available: boolean;
}

interface Stored {
  id: string;
  operation: Operation;
  pending: boolean;
}
interface Schema extends DBSchema {
  operations: { key: string; value: Stored };
  meta: { key: string; value: number };
}
export interface LocalChange {
  kind: Kind;
  key: string;
  value: Value;
  parents: string[];
}
export interface RemoteOperation {
  seq: number;
  operation: Operation;
}
const STORAGE_PREFIX = "daymark-v2-";
const LEGACY_STORAGE_PREFIX = "daymark-v1-";

export class Store {
  private importingLegacy?: Promise<void>;
  private listeners = new Set<() => void>();
  private channel?: BroadcastChannel;
  constructor(
    readonly accountId: string,
    private db: IDBPDatabase<Schema>,
    private legacy?: IDBPDatabase<Schema>,
  ) {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`daymark-${accountId}`);
      this.channel.onmessage = () => this.notify(false);
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(broadcast = true) {
    for (const fn of this.listeners) fn();
    if (broadcast) this.channel?.postMessage({ changed: true });
  }
  private async importLegacy(): Promise<void> {
    if (!this.legacy) return;
    if (this.importingLegacy) return this.importingLegacy;
    this.importingLegacy = (async () => {
      const source = await this.legacy?.getAll("operations");
      if (!source?.length) return;
      const rows = source.map((row) => ({ ...row, operation: validateOperation(row.operation) }));
      const tx = this.db.transaction("operations", "readwrite");
      try {
        for (const row of rows) {
          const existing = await tx.store.get(row.id);
          if (existing && canonical(existing.operation) !== canonical(row.operation))
            throw new Error(
              "Operation ID collision in older browser storage. Export backups before clearing storage.",
            );
          if (!existing) await tx.store.put(row);
        }
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
      }
    })();
    try {
      await this.importingLegacy;
    } finally {
      this.importingLegacy = undefined;
    }
  }
  async list(): Promise<Operation[]> {
    await this.importLegacy();
    return (await this.db.getAll("operations")).map((row) => row.operation);
  }
  async pending(): Promise<Operation[]> {
    await this.importLegacy();
    return causalOrder(
      (await this.db.getAll("operations")).filter((row) => row.pending).map((row) => row.operation),
    );
  }
  async cursor(): Promise<number> {
    return (await this.db.get("meta", "cursor")) ?? 0;
  }
  async write(
    kind: Kind,
    key: string,
    value: Value,
    observedParents?: string[],
  ): Promise<Operation> {
    const tx = this.db.transaction("operations", "readwrite");
    const rows = await tx.store.getAll();
    const op = validateOperation({
      ...operation(
        rows.map((row) => row.operation),
        kind,
        key,
        value,
      ),
      ...(observedParents ? { parents: observedParents } : {}),
    });
    await tx.store.put({ id: op.id, operation: op, pending: true });
    await tx.done;
    this.notify();
    return op;
  }
  async writeBatch(changes: LocalChange[]): Promise<Operation[]> {
    const createdAt = new Date().toISOString();
    const operations = changes.map((change) =>
      validateOperation({
        id: crypto.randomUUID(),
        kind: change.kind,
        key: change.key,
        value: change.value,
        parents: change.parents,
        createdAt,
      }),
    );
    if (!operations.length) return [];
    const tx = this.db.transaction("operations", "readwrite");
    try {
      for (const op of operations) await tx.store.put({ id: op.id, operation: op, pending: true });
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw error;
    }
    this.notify();
    return operations;
  }
  async acknowledge(ids: string[]): Promise<void> {
    const tx = this.db.transaction("operations", "readwrite");
    for (const id of ids) {
      const row = await tx.store.get(id);
      if (row) await tx.store.put({ ...row, pending: false });
    }
    await tx.done;
    this.notify();
  }
  async mergeRemote(rows: RemoteOperation[], cursor: number): Promise<void> {
    const validated = rows.map((row) => ({
      seq: row.seq,
      operation: validateOperation(row.operation),
    }));
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      validated.some((row) => !Number.isSafeInteger(row.seq) || row.seq < 1 || row.seq > cursor)
    )
      throw new Error("Invalid sync page");
    const tx = this.db.transaction(["operations", "meta"], "readwrite");
    try {
      const previousCursor = (await tx.objectStore("meta").get("cursor")) ?? 0;
      if (cursor < previousCursor) throw new Error("Sync cursor moved backwards");
      for (const row of validated) {
        const old = await tx.objectStore("operations").get(row.operation.id);
        if (old && canonical(old.operation) !== canonical(row.operation))
          throw new Error("Operation ID collision");
        await tx
          .objectStore("operations")
          .put({ id: row.operation.id, operation: row.operation, pending: false });
      }
      await tx.objectStore("meta").put(cursor, "cursor");
      await tx.done;
    } catch (error) {
      tx.abort();
      await tx.done.catch(() => {});
      throw error;
    }
    this.notify();
  }
  async backup(): Promise<Backup> {
    return createBackup(this.accountId, await this.list());
  }
  async recovery(): Promise<Recovery> {
    let completion: Promise<void> | undefined;
    try {
      const tx = this.db.transaction("meta");
      completion = tx.done;
      const [checkedAt, operationCount, remindAfter] = await Promise.all(
        Object.values(RECOVERY_KEYS).map((key) => tx.store.get(key)),
      );
      await tx.done;
      return {
        checkedAt: checkedAt ?? 0,
        operationCount: operationCount ?? 0,
        remindAfter: remindAfter ?? 0,
        available: true,
      };
    } catch {
      await completion?.catch(() => {});
      return { checkedAt: 0, operationCount: 0, remindAfter: 0, available: false };
    }
  }
  async postponeBackup(now = Date.now()): Promise<void> {
    await this.db.put("meta", now + BACKUP_REMINDER_INTERVAL, RECOVERY_KEYS.remindAfter);
    this.notify();
  }
  async checkBackup(
    input: unknown,
  ): Promise<{ missing: number; total: number; recorded: boolean }> {
    const backup = await validateBackup(input);
    if (backup.accountId !== this.accountId)
      throw new Error("This backup belongs to another workspace. Open that workspace to check it.");
    await this.importLegacy();
    const byId = new Map(backup.operations.map((op) => [op.id, canonical(op)]));
    const tx = this.db.transaction(["operations", "meta"], "readwrite");
    let total = 0;
    let missing = 0;
    let recorded = false;
    try {
      const rows = await tx.objectStore("operations").getAll();
      total = rows.length;
      for (const row of rows) {
        const saved = byId.get(row.id);
        if (saved && saved !== canonical(row.operation))
          throw new Error("Conflicting operation ID in backup");
        if (!saved) missing++;
      }
      if (!missing && total) {
        const meta = tx.objectStore("meta");
        try {
          await meta.put(Date.now(), RECOVERY_KEYS.checkedAt);
          await meta.put(total, RECOVERY_KEYS.operationCount);
          await meta.put(0, RECOVERY_KEYS.remindAfter);
          recorded = true;
        } catch {
          try {
            tx.abort();
          } catch {}
          await tx.done.catch(() => {});
          return { missing, total, recorded: false };
        }
      }
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw error;
    }
    this.notify();
    return { missing, total, recorded };
  }
  async importBackup(
    input: unknown,
    options: { allowDifferentWorkspace?: boolean } = {},
  ): Promise<number> {
    const backup = await validateBackup(input);
    if (backup.accountId !== this.accountId && options.allowDifferentWorkspace !== true)
      throw new Error("This backup belongs to another workspace or uses an unsupported format");
    const imported = backup.operations;
    const tx = this.db.transaction("operations", "readwrite");
    let added = 0;
    try {
      const existing = await tx.store.getAll();
      const existingIds = new Set(existing.map((row) => row.id));
      const byId = new Map(existing.map((row) => [row.id, row]));
      for (const op of imported) {
        const previous = byId.get(op.id);
        if (previous && canonical(previous.operation) !== canonical(op))
          throw new Error("Conflicting operation ID in backup");
        if (!previous) {
          byId.set(op.id, { id: op.id, operation: op, pending: true });
          added++;
        }
      }
      causalOrder(
        [...byId.values()].map((row) => row.operation),
        new Set(byId.keys()),
      );
      for (const row of byId.values()) if (!existingIds.has(row.id)) await tx.store.put(row);
      await tx.done;
    } catch (error) {
      tx.abort();
      await tx.done.catch(() => {});
      throw error;
    }
    this.notify();
    return added;
  }
  close(): void {
    this.channel?.close();
    this.db.close();
    this.legacy?.close();
    this.listeners.clear();
  }
}

function openDatabase(name: string): Promise<IDBPDatabase<Schema>> {
  return openDB<Schema>(name, 1, {
    upgrade(database) {
      database.createObjectStore("operations", { keyPath: "id" });
      database.createObjectStore("meta");
    },
  });
}
export async function openStore(accountId: string): Promise<Store> {
  const legacy = await openDatabase(`${LEGACY_STORAGE_PREFIX}${accountId}`);
  try {
    const db = await openDatabase(`${STORAGE_PREFIX}${accountId}`);
    return new Store(accountId, db, legacy);
  } catch (error) {
    legacy.close();
    throw error;
  }
}

import { expect, it } from "vitest";
import { backupDownload, causalOrder, createBackup, validateBackup } from "../src/client/backup";
import type { Operation } from "../src/shared/model";
import { LIMITS } from "../src/shared/validation";

const edit = (parents: string[] = []): Operation => ({
  id: crypto.randomUUID(),
  kind: "entry",
  key: "tracker/2026-10-27/morning",
  parents,
  createdAt: "2026-10-27T08:00:00.000Z",
  value: { state: "confirmed", note: "", occurredAt: null },
});

it("signs complete backups and detects valid-looking edits and removed records", async () => {
  const first = edit();
  const second = { ...edit(), key: "other/2026-10-27/morning" };
  const backup = await createBackup("local-workspace", [first, second]);
  expect(backup.integrity?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await validateBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
  await expect(validateBackup({ ...backup, operations: [first] })).rejects.toThrow(/integrity/i);
  await expect(
    validateBackup({ ...backup, exportedAt: "2026-10-26T08:00:00.000Z" }),
  ).rejects.toThrow(/integrity/i);
});

it("accepts unsigned legacy backups and rejects malformed optional integrity", async () => {
  const backup = await createBackup("local-workspace", [edit()]);
  delete backup.integrity;
  expect((await validateBackup(backup)).operations).toEqual(backup.operations);
  for (const integrity of [null, {}, { algorithm: "MD5", sha256: "a".repeat(64) }])
    await expect(validateBackup({ ...backup, integrity })).rejects.toThrow(/integrity/i);
});

it("rejects missing and cross-record parents and conflicting duplicate IDs", async () => {
  const first = edit();
  const backup = await createBackup("workspace", [first]);
  delete backup.integrity;
  await expect(
    validateBackup({ ...backup, operations: [edit([crypto.randomUUID()])] }),
  ).rejects.toThrow(/incomplete/i);
  await expect(
    validateBackup({
      ...backup,
      operations: [first, { ...edit([first.id]), key: "different/2026-10-27/morning" }],
    }),
  ).rejects.toThrow(/different record/i);
  await expect(
    validateBackup({
      ...backup,
      operations: [first, { ...first, parents: [crypto.randomUUID()] }],
    }),
  ).rejects.toThrow(/conflicting/i);
});

it("validates a long history without exhausting the JavaScript call stack", () => {
  const operations: Operation[] = [];
  for (let index = 0; index < 18000; index++)
    operations.push(edit(index ? [operations[index - 1].id] : []));
  expect(causalOrder([...operations].reverse(), new Set(operations.map((op) => op.id)))).toEqual(
    operations,
  );
  operations[0].parents = [operations.at(-1)?.id as string];
  expect(() => causalOrder(operations)).toThrow(/cyclic/i);
});

it("preserves a raw export when normal restore limits are exceeded", async () => {
  const backup = await createBackup("workspace", [edit()]);
  expect(backupDownload(backup).restorable).toBe(true);
  const oversized = { ...backup, operations: Array(LIMITS.backupOperations + 1).fill(edit()) };
  const raw = backupDownload(oversized);
  expect(raw.restorable).toBe(false);
  expect(JSON.parse(raw.text).operations).toHaveLength(LIMITS.backupOperations + 1);
  await expect(validateBackup(oversized)).rejects.toThrow(/oversized/i);
  const largeNote = {
    ...edit(),
    value: { state: "confirmed", note: "x".repeat(2000), occurredAt: null },
  };
  expect(backupDownload({ ...backup, operations: Array(10000).fill(largeNote) }).restorable).toBe(
    false,
  );
});

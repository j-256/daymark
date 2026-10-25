import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openStore, type Store } from "../src/client/storage";
import { SyncEngine } from "../src/client/sync";
import { type Entry, materialize } from "../src/shared/model";

const stores: Store[] = [];
const empty: Entry = { state: "unknown", note: "", occurredAt: null };
const key = "test/2026-10-24/default";
const store = async (id: string = crypto.randomUUID()) => {
  const value = await openStore(id);
  stores.push(value);
  return value;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

describe("durable account storage", () => {
  it("imports another workspace only with explicit consent and preserves duplicate and collision guards", async () => {
    const source = await store();
    const target = await store();
    await source.write("entry", key, empty);
    const backup = await source.backup();
    await expect(target.importBackup(backup)).rejects.toThrow(/account|workspace/i);
    expect(await target.list()).toEqual([]);
    expect(await target.importBackup(backup, { allowDifferentWorkspace: true })).toBe(1);
    expect(await target.importBackup(backup, { allowDifferentWorkspace: true })).toBe(0);
    expect(await target.pending()).toHaveLength(1);
    await expect(
      target.importBackup(
        {
          ...backup,
          operations: [{ ...backup.operations[0], value: { ...empty, note: "Changed" } }],
        },
        { allowDifferentWorkspace: true },
      ),
    ).rejects.toThrow(/conflicting/i);
    expect(await target.list()).toEqual(backup.operations);
  });
  it("validates foreign backup identity and causal history even with import consent", async () => {
    const target = await store();
    const source = await store();
    const first = await source.write("entry", key, empty);
    const backup = await source.backup();
    for (const accountId of [undefined, null, "", 42])
      await expect(
        target.importBackup({ ...backup, accountId }, { allowDifferentWorkspace: true }),
      ).rejects.toThrow();
    await expect(
      target.importBackup(
        { ...backup, operations: [{ ...first, parents: [crypto.randomUUID()] }] },
        { allowDifferentWorkspace: true },
      ),
    ).rejects.toThrow(/incomplete/i);
    expect(await target.list()).toEqual([]);
  });
  it("preserves updates that arrived after an editor's observed snapshot", async () => {
    const s = await store();
    const a = await s.write("entry", key, empty);
    await s.write("entry", key, { ...empty, state: "skipped" });
    const c = await s.write("entry", key, { ...empty, state: "confirmed" }, [a.id]);
    expect(c.parents).toEqual([a.id]);
    expect(materialize(await s.list()).get(`entry/${key}`)?.conflict).toBe(true);
  });
  it("retains unacknowledged edits after closing and reopening", async () => {
    const first = await store();
    const edit = await first.write("entry", key, { ...empty, state: "confirmed" });
    first.close();
    const reopened = await store(first.accountId);
    expect(await reopened.pending()).toEqual([edit]);
    expect(await reopened.list()).toEqual([edit]);
  });
  it("isolates account namespaces", async () => {
    const alice = await store();
    const bob = await store();
    await alice.write("entry", key, empty);
    expect(await bob.list()).toEqual([]);
  });
  it("writes causally across multiple clients of the same local account", async () => {
    const first = await store();
    const other = await store(first.accountId);
    const a = await first.write("entry", key, { ...empty, state: "confirmed" });
    const b = await other.write("entry", key, { ...empty, state: "skipped" });
    expect(b.parents).toEqual([a.id]);
  });
  it("acknowledges only the uploaded snapshot", async () => {
    const s = await store();
    const first = await s.write("entry", key, empty);
    const second = await s.write("entry", key, { ...empty, state: "confirmed" });
    await s.acknowledge([first.id]);
    expect(await s.pending()).toEqual([second]);
  });
  it("merges remote edits and advances the cursor atomically", async () => {
    const s = await store();
    const remote = {
      id: crypto.randomUUID(),
      kind: "entry" as const,
      key,
      parents: [],
      value: { ...empty, state: "skipped" as const },
      createdAt: new Date().toISOString(),
    };
    await s.write("entry", key, { ...empty, state: "confirmed" });
    await s.mergeRemote([{ seq: 1, operation: remote }], 1);
    expect(materialize(await s.list()).get(`entry/${key}`)?.conflict).toBe(true);
    expect(await s.cursor()).toBe(1);
    const edited = { ...remote, value: empty };
    await expect(s.mergeRemote([{ seq: 2, operation: edited }], 2)).rejects.toThrow();
    expect(await s.cursor()).toBe(1);
  });
  it("exports and imports complete history without creating duplicate events", async () => {
    const s = await store();
    await s.write("entry", key, empty);
    const backup = await s.backup();
    await s.importBackup(backup);
    expect(await s.list()).toHaveLength(1);
    await expect((await store()).importBackup(backup)).rejects.toThrow(/workspace/i);
  });
  it("rejects malformed, cyclic, and colliding backups without partial writes", async () => {
    const s = await store();
    const first = await s.write("entry", key, empty);
    const second = { ...first, id: crypto.randomUUID(), parents: [first.id] };
    const backup = {
      format: "daymark",
      version: 1,
      accountId: s.accountId,
      exportedAt: new Date().toISOString(),
      operations: [{ ...first, parents: [second.id] }, second],
    };
    await expect(s.importBackup(backup)).rejects.toThrow();
    expect(await s.list()).toEqual([first]);
  });
});

describe("sync protocol", () => {
  it("resumes immediately when a local write arrives during a pull", async () => {
    const s = await store();
    let inserted = false;
    let uploads = 0;
    const engine = new SyncEngine(s, async (_input, init) => {
      if (init?.method === "POST") {
        uploads++;
        const body = JSON.parse(init.body as string);
        return Response.json({ acknowledged: body.operations.map((op: { id: string }) => op.id) });
      }
      if (!inserted) {
        inserted = true;
        await s.write("entry", key, empty);
        void engine.run();
      }
      return Response.json({ operations: [], cursor: 0, hasMore: false });
    });
    await engine.run();
    expect(await s.pending()).toEqual([]);
    expect(uploads).toBe(1);
  });
  it("keeps every pending edit when upload fails", async () => {
    const s = await store();
    const edit = await s.write("entry", key, empty);
    const engine = new SyncEngine(s, async () => {
      throw new TypeError("network unavailable");
    });
    await expect(engine.run()).rejects.toThrow();
    expect(await s.pending()).toEqual([edit]);
  });
  it("requires JSON authentication and preserves pending work through login redirects", async () => {
    const s = await store();
    const edit = await s.write("entry", key, empty);
    const engine = new SyncEngine(
      s,
      async () =>
        new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }),
    );
    await expect(engine.run()).rejects.toThrow();
    expect(engine.state.status).toBe("auth");
    expect(await s.pending()).toEqual([edit]);
  });
  it("does not acknowledge edits absent from the upload response", async () => {
    const s = await store();
    const edit = await s.write("entry", key, empty);
    const engine = new SyncEngine(s, async () =>
      Response.json({ acknowledged: [crypto.randomUUID()] }),
    );
    await expect(engine.run()).rejects.toThrow();
    expect(await s.pending()).toEqual([edit]);
  });
  it("uploads parents before their children and sends the bound account identity", async () => {
    const s = await store();
    const a = await s.write("entry", key, empty);
    const b = await s.write("entry", key, { ...empty, state: "confirmed" });
    const calls: string[] = [];
    const engine = new SyncEngine(s, async (_input, init) => {
      expect(new Headers(init?.headers).get("X-Daymark-Account")).toBe(s.accountId);
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        calls.push(...body.operations.map((op: { id: string }) => op.id));
        return Response.json({ acknowledged: body.operations.map((op: { id: string }) => op.id) });
      }
      return Response.json({ operations: [], cursor: 0, hasMore: false });
    });
    await engine.run();
    expect(calls).toEqual([a.id, b.id]);
    expect(await s.pending()).toEqual([]);
    expect(engine.state.status).toBe("synced");
  });
  it("rejects a non-advancing page instead of looping forever", async () => {
    const s = await store();
    const engine = new SyncEngine(s, async () =>
      Response.json({ operations: [], cursor: 0, hasMore: true }),
    );
    await expect(engine.run()).rejects.toThrow();
  });
});

it("persists an ordered group atomically and notifies once", async () => {
  const s = await store();
  let notifications = 0;
  s.subscribe(() => {
    notifications++;
  });
  const edits = await s.writeBatch([
    { kind: "entry", key, value: empty, parents: [] },
    { kind: "entry", key: "other/2026-10-24/default", value: empty, parents: [] },
  ]);
  expect(await s.pending()).toHaveLength(2);
  expect(await s.list()).toHaveLength(2);
  expect(notifications).toBe(1);
  expect(edits).toHaveLength(2);
});
it("rejects invalid grouped edits without persisting an earlier valid edit", async () => {
  const s = await store();
  await expect(
    s.writeBatch([
      { kind: "entry", key, value: empty, parents: [] },
      {
        kind: "entry",
        key: "other/2026-10-24/default",
        value: { ...empty, state: "invalid" } as unknown as Entry,
        parents: [],
      },
    ]),
  ).rejects.toThrow();
  expect(await s.list()).toEqual([]);
});
it("rolls back a grouped edit when browser storage fails midway", async () => {
  const s = await store();
  const original = IDBObjectStore.prototype.put;
  let writes = 0;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (++writes === 2) throw new DOMException("Storage full", "QuotaExceededError");
    return original.call(this, value, key);
  });
  try {
    await expect(
      s.writeBatch([
        { kind: "entry", key, value: empty, parents: [] },
        { kind: "entry", key: "other/2026-10-24/default", value: empty, parents: [] },
      ]),
    ).rejects.toThrow("Storage full");
  } finally {
    spy.mockRestore();
  }
  expect(await s.list()).toEqual([]);
});
it("preserves concurrent metadata through a group's observed parents", async () => {
  const s = await store();
  const first = await s.write("entry", key, empty);
  await s.write("entry", key, { ...empty, state: "skipped" });
  const [edit] = await s.writeBatch([
    { kind: "entry", key, value: { ...empty, state: "confirmed" }, parents: [first.id] },
  ]);
  expect(edit.parents).toEqual([first.id]);
  expect(materialize(await s.list()).get(`entry/${key}`)?.conflict).toBe(true);
});

it("preserves inventory and fractional consumption through offline backups", async () => {
  const source = await store();
  await source.write("inventory", "medication", {
    name: "Medication",
    unit: "tablets",
    lowStock: 5000,
    archived: false,
  });
  await source.write("stock", "refill", {
    itemId: "medication",
    quantity: 30500,
    reason: "refill",
    note: "",
    day: "2026-10-25",
    deleted: false,
  });
  await source.write("entry", key, {
    ...empty,
    state: "confirmed",
    inventory: { itemId: "medication", quantity: 500 },
  });
  const backup = await source.backup();
  source.close();
  const restored = await store(source.accountId);
  await restored.importBackup(backup);
  expect(await restored.list()).toHaveLength(3);
  expect(await restored.pending()).toHaveLength(3);
  const { stockBalances } = await import("../src/client/inventory");
  expect(stockBalances(await restored.list()).get("medication")?.quantity).toBe(30000);
});

it("isolates legacy tabs while importing later unsynced edits without losing consumption", async () => {
  const id = crypto.randomUUID();
  const legacy = await openDB(`daymark-v1-${id}`, 1, {
    upgrade(db) {
      db.createObjectStore("operations", { keyPath: "id" });
      db.createObjectStore("meta");
    },
  });
  const original = {
    id: crypto.randomUUID(),
    kind: "entry" as const,
    key,
    parents: [],
    createdAt: "2026-10-25T08:00:00.000Z",
    value: empty,
  };
  await legacy.put("operations", { id: original.id, operation: original, pending: true });
  const current = await store(id);
  expect(await current.pending()).toEqual([original]);
  await current.write("inventory", "medication", {
    name: "Medication",
    unit: "tablets",
    lowStock: 5000,
    archived: false,
  });
  await current.write("stock", "opening", {
    itemId: "medication",
    quantity: 10000,
    reason: "opening",
    day: "2026-10-25",
    note: "",
    deleted: false,
  });
  await current.write("entry", key, {
    ...empty,
    state: "confirmed",
    inventory: { itemId: "medication", quantity: 1000 },
  });
  expect(await legacy.getAll("operations")).toHaveLength(1);
  const { stockBalances } = await import("../src/client/inventory");
  expect(stockBalances(await current.list()).get("medication")).toMatchObject({
    quantity: 9000,
    uncertain: false,
  });
  const oldEdit = {
    ...original,
    id: crypto.randomUUID(),
    parents: [original.id],
    value: { ...empty, state: "confirmed" as const, note: "Edit from an old tab" },
  };
  await legacy.put("operations", { id: oldEdit.id, operation: oldEdit, pending: true });
  expect((await current.pending()).map((op) => op.id)).toContain(oldEdit.id);
  expect(stockBalances(await current.list()).get("medication")?.uncertain).toBe(true);
  await current.acknowledge([original.id, oldEdit.id]);
  expect((await current.pending()).map((op) => op.id)).not.toContain(oldEdit.id);
  expect((await legacy.get("operations", oldEdit.id)).pending).toBe(true);
  current.close();
  const reopened = await store(id);
  expect((await reopened.pending()).map((op) => op.id)).not.toContain(oldEdit.id);
  legacy.close();
});

import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../worker/auth";
import worker from "../worker/index";
import type { Env } from "../worker/types";

let runtime: Miniflare;
let env: Env;
let aliceCookie = "";
let bobCookie = "";
let ownerCookie = "";
const accountIds = new Map<string, string>();
const ORIGIN = "http://localhost:5184";
const password = "local-test-password-123!";
const testContext = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const ownerContext = {
  ...testContext,
  access: { aud: "test-admin", getIdentity: async () => ({ email: "owner@example.com" }) },
} as unknown as ExecutionContext;
const ownerRequest = (path: string, body?: unknown) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: ownerCookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ownerContext,
  );
const request = (path: string, cookie = "", body?: unknown, origin = ORIGIN) =>
  worker.fetch(
    new Request(ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Daymark-Account": accountIds.get(cookie) ?? "",
        "X-Daymark-Sync": "2",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    testContext,
  );
const op = (state = "confirmed", parents: string[] = []) => ({
  id: crypto.randomUUID(),
  kind: "entry",
  key: "test/2026-10-24/default",
  parents,
  value: { state, note: "", occurredAt: null },
  createdAt: "2026-10-24T08:00:00Z",
});

beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "api-tests",
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
      compatibilityDate: "2026-10-24",
    }),
  );
  const db = await runtime.getD1Database("DB");
  for (const file of ["migrations/0001_auth.sql", "migrations/0002_operations.sql"]) {
    const sql = await readFile(file, "utf8");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
  env = {
    DB: db as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    APP_ORIGIN: ORIGIN,
    AUTH_SECRET: "local-test-only-auth-secret-at-least-32-characters",
    OWNER_EMAIL: "owner@example.com",
    ACCESS_REQUIRED: "false",
    ACCESS_ISSUER: "https://example.cloudflareaccess.com",
    ACCESS_AUDIENCE: "test",
    ADMIN_ACCESS_AUDIENCE: "test-admin",
  };
  const auth = createAuth(env);
  for (const email of ["alice@example.com", "bob@example.com"])
    await auth.api.createUser({
      body: { email, name: email.split("@")[0], password, role: "user" },
    });
  for (const email of ["alice@example.com", "bob@example.com"]) {
    const result = await request("/api/auth/sign-in/email", "", { email, password });
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")?.split(";")[0] ?? "";
    const data = (await result.json()) as { user: { id: string } };
    accountIds.set(cookie, data.user.id);
    if (email.startsWith("alice")) aliceCookie = cookie;
    else bobCookie = cookie;
  }
});
afterAll(async () => {
  await runtime?.dispose();
});

describe("application accounts", () => {
  it("bounds authentication bodies before passing them to the auth library", async () => {
    expect(
      (
        await request("/api/auth/sign-in/email", "", {
          email: "alice@example.com",
          password: "x".repeat(262145),
        })
      ).status,
    ).toBe(413);
  });
  it("rejects unauthenticated operation reads", async () =>
    expect((await request("/api/sync")).status).toBe(401));
  it("exposes the account from the native application session", async () => {
    const result = await request("/api/session", aliceCookie);
    expect(((await result.json()) as { account: { email: string } }).account.email).toBe(
      "alice@example.com",
    );
  });
  it("keeps self-registration disabled", async () => {
    const result = await request("/api/auth/sign-up/email", "", {
      email: "outsider@example.com",
      name: "Outsider",
      password,
    });
    expect(result.status).toBe(403);
  });
  it("requires both owner authorization and Access for administration", async () =>
    expect((await request("/api/admin/accounts", aliceCookie)).status).toBe(403));
  it("rejects forged or absent Access identity when the outer gate is required", async () => {
    const protectedEnv = { ...env, ACCESS_REQUIRED: "true" };
    const result = await worker.fetch(
      new Request(`${ORIGIN}/api/session`, {
        headers: { Cookie: aliceCookie, "Cf-Access-Authenticated-User-Email": "owner@example.com" },
      }),
      protectedEnv,
      testContext,
    );
    expect(result.status).toBe(403);
  });
  it("rejects cross-origin writes", async () =>
    expect(
      (await request("/api/sync", aliceCookie, { operations: [op()] }, "https://evil.example"))
        .status,
    ).toBe(403));
});

describe("operation storage", () => {
  it("rejects a stale browser account after the session changes", async () => {
    const result = await worker.fetch(
      new Request(`${ORIGIN}/api/sync`, {
        headers: { Cookie: bobCookie, "X-Daymark-Account": accountIds.get(aliceCookie) ?? "" },
      }),
      env,
      testContext,
    );
    expect(result.status).toBe(409);
  });
  it("preserves independent records and idempotent retries", async () => {
    const first = op();
    expect((await request("/api/sync", aliceCookie, { operations: [first] })).status).toBe(200);
    expect((await request("/api/sync", aliceCookie, { operations: [first] })).status).toBe(200);
    const result = await request("/api/sync?cursor=0", aliceCookie);
    const data = (await result.json()) as { operations: { operation: { id: string } }[] };
    expect(data.operations.filter((row) => row.operation.id === first.id)).toHaveLength(1);
    const bob = (await (await request("/api/sync?cursor=0", bobCookie)).json()) as {
      operations: unknown[];
    };
    expect(bob.operations).toEqual([]);
  });
  it("rejects reused IDs with different content and rolls back the whole batch", async () => {
    const first = op();
    await request("/api/sync", aliceCookie, { operations: [first] });
    const sibling = op();
    expect(
      (
        await request("/api/sync", aliceCookie, {
          operations: [sibling, { ...first, value: { ...first.value, state: "skipped" } }],
        })
      ).status,
    ).toBe(409);
    const found = await env.DB.prepare("SELECT 1 FROM operations WHERE op_id = ?")
      .bind(sibling.id)
      .first();
    expect(found).toBeNull();
  });
  it("rejects missing parents and cross-record supersession", async () => {
    expect(
      (
        await request("/api/sync", aliceCookie, {
          operations: [op("confirmed", [crypto.randomUUID()])],
        })
      ).status,
    ).toBe(409);
    const parent = op();
    await request("/api/sync", aliceCookie, { operations: [parent] });
    const child = { ...op("skipped", [parent.id]), key: "other/2026-10-24/default" };
    expect((await request("/api/sync", aliceCookie, { operations: [child] })).status).toBe(409);
  });
  it("accepts causal batches and retains contradictory independent heads", async () => {
    const parent = op();
    const child = op("skipped", [parent.id]);
    const concurrent = op();
    expect(
      (await request("/api/sync", bobCookie, { operations: [parent, child, concurrent] })).status,
    ).toBe(200);
    const data = (await (await request("/api/sync?cursor=0&limit=2", bobCookie)).json()) as {
      operations: unknown[];
      hasMore: boolean;
      cursor: number;
    };
    expect(data.operations).toHaveLength(2);
    expect(data.hasMore).toBe(true);
    const rest = (await (
      await request(`/api/sync?cursor=${data.cursor}&limit=2`, bobCookie)
    ).json()) as { operations: unknown[] };
    expect(rest.operations).toHaveLength(1);
  });
  it("rejects malformed bounds and cursor values", async () => {
    expect((await request("/api/sync?cursor=-1", aliceCookie)).status).toBe(400);
    expect(
      (
        await request("/api/sync", aliceCookie, {
          operations: Array.from({ length: 41 }, () => op()),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/sync", aliceCookie, {
          operations: [{ ...op(), key: "x/2026-02-30/y" }],
        })
      ).status,
    ).toBe(400);
  });
});

describe("owner account management", () => {
  it("bootstraps only through verified owner Access and cannot be repeated", async () => {
    expect((await request("/api/admin/bootstrap")).status).toBe(403);
    const result = await ownerRequest("/api/admin/bootstrap", { name: "Owner", password });
    expect(result.status).toBe(200);
    ownerCookie = result.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await ownerRequest("/api/admin/bootstrap", { name: "Owner", password })).status).toBe(
      409,
    );
    const data = (await (await request("/api/session", ownerCookie)).json()) as {
      account: { role: string };
    };
    expect(data.account.role).toBe("admin");
  });
  it("manually creates an account and immediately deactivates its sessions", async () => {
    const created = await ownerRequest("/api/admin/accounts", {
      email: "carol@example.com",
      name: "Carol",
      password,
    });
    expect(created.status).toBe(201);
    const data = (await created.json()) as { account: { id: string } };
    const login = await request("/api/auth/sign-in/email", "", {
      email: "carol@example.com",
      password,
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await request("/api/session", cookie)).status).toBe(200);
    expect(
      (await ownerRequest("/api/admin/account-status", { id: data.account.id, active: false }))
        .status,
    ).toBe(200);
    expect([401, 403]).toContain((await request("/api/session", cookie)).status);
    expect(
      (await request("/api/auth/sign-in/email", "", { email: "carol@example.com", password }))
        .status,
    ).toBe(403);
  });
  it("keeps public signup closed even when a legacy setting is open", async () => {
    expect((await ownerRequest("/api/admin/registration", { open: true })).status).toBe(403);
    await env.DB.prepare("UPDATE app_settings SET value = 'open' WHERE key = 'registration'").run();
    expect(await (await request("/api/config")).json()).toMatchObject({ registrationOpen: false });
    expect(
      (
        await request("/api/auth/sign-up/email", "", {
          name: "Closed",
          email: "closed@example.com",
          password,
        })
      ).status,
    ).toBe(403);
    expect((await ownerRequest("/api/admin/registration", { open: false })).status).toBe(200);
  });
  it("cannot deactivate the owner or administer with a native session alone", async () => {
    const data = (await (await request("/api/session", ownerCookie)).json()) as {
      account: { id: string };
    };
    expect(
      (await ownerRequest("/api/admin/account-status", { id: data.account.id, active: false }))
        .status,
    ).toBe(400);
    expect((await request("/api/admin/accounts", ownerCookie)).status).toBe(403);
  });
});

it("correlates quota failures without recording sensitive exception text", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const broken = {
      ...env,
      DB: {
        prepare() {
          throw new Error(
            "D1_ERROR: account has exceeded D1 free tier daily row read limit. sensitive-note-123",
          );
        },
      } as unknown as D1Database,
    };
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/bootstrap`),
      broken,
      ownerContext,
    );
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { requestId: string };
    const record = log.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((record) => record.requestId === payload.requestId);
    expect(record.reason).toBe("database_limit");
    expect(JSON.stringify(record)).not.toContain("sensitive-note");
  } finally {
    log.mockRestore();
  }
});

it("requires a compatible sync client before accepting or exposing inventory fields", async () => {
  for (const method of ["GET", "POST"]) {
    const result = await worker.fetch(
      new Request(`${ORIGIN}/api/sync`, {
        method,
        headers: {
          Cookie: aliceCookie,
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "X-Daymark-Account": accountIds.get(aliceCookie) ?? "",
        },
        body: method === "POST" ? JSON.stringify({ operations: [op()] }) : undefined,
      }),
      env,
      testContext,
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: "client_update_required" });
  }
});

it("syncs independent stock movements without duplication or cross-account visibility", async () => {
  const itemId = crypto.randomUUID();
  const base = { parents: [], createdAt: "2026-10-25T08:00:00.000Z" };
  const operations = [
    {
      ...base,
      id: crypto.randomUUID(),
      kind: "inventory",
      key: itemId,
      value: { name: "Medication", unit: "tablets", lowStock: 5000, archived: false },
    },
    ...[30000, 60000].map((quantity) => ({
      ...base,
      id: crypto.randomUUID(),
      kind: "stock",
      key: crypto.randomUUID(),
      value: { itemId, quantity, reason: "refill", note: "", day: "2026-10-25", deleted: false },
    })),
  ];
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await request("/api/sync", aliceCookie, { operations })).status).toBe(200);
  const found = await env.DB.prepare(
    "SELECT owner, content FROM operations WHERE op_id IN (?1,?2,?3)",
  )
    .bind(...operations.map((op) => op.id))
    .all<{ owner: string; content: string }>();
  expect(found.results).toHaveLength(3);
  expect(found.results.every((row) => row.owner === accountIds.get(aliceCookie))).toBe(true);
});

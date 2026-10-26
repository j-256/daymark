import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, expect, it } from "vitest";
import { checkMigrationBase, loadMigrations, pendingMigrations } from "../scripts/lib/migrations";
import { applyMigrations } from "./helpers/migrations";

const roots: string[] = [];
const runtimes: Miniflare[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(
  files: Record<string, string> = { "0001_initial.sql": "CREATE TABLE items(id TEXT);" },
) {
  const root = mkdtempSync(join(tmpdir(), "daymark-migrations-"));
  roots.push(root);
  mkdirSync(join(root, "migrations"));
  for (const [name, sql] of Object.entries(files))
    writeFileSync(join(root, "migrations", name), sql);
  manifest(root, files);
  return root;
}

function manifest(root: string, files: Record<string, string>, manual: string[] = []) {
  writeFileSync(
    join(root, "migrations/manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      migrations: Object.entries(files).map(([name, sql]) => ({
        name,
        sha256: createHash("sha256").update(sql).digest("hex"),
        mode: manual.includes(name) ? "manual" : "automatic",
      })),
    }),
  );
}

function baseline(root: string) {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  git(["add", "migrations/0001_initial.sql", "migrations/manifest.json"]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "test: seed migration",
    "--",
    "migrations/0001_initial.sql",
    "migrations/manifest.json",
  ]);
  return git(["rev-parse", "HEAD"]);
}

it("discovers SQL in version order and preserves semicolons in values and triggers", () => {
  const root = fixture({
    "0002_trigger.sql":
      "CREATE TRIGGER stamp AFTER INSERT ON items BEGIN UPDATE items SET id='a;b'; END;",
    "0001_initial.sql": "CREATE TABLE items(id TEXT);",
  });
  expect(loadMigrations(root).map((migration) => migration.name)).toEqual([
    "0001_initial.sql",
    "0002_trigger.sql",
  ]);
});

it("rejects a SQL file absent from the reviewed manifest", () => {
  const root = fixture();
  writeFileSync(join(root, "migrations/0002_unreviewed.sql"), "DROP TABLE items;");
  expect(() => loadMigrations(root)).toThrow(/manifest/i);
});

it("rejects a changed SQL digest and an absent SQL file", () => {
  const root = fixture();
  writeFileSync(join(root, "migrations/0001_initial.sql"), "DROP TABLE items;");
  expect(() => loadMigrations(root)).toThrow(/digest/i);
  rmSync(join(root, "migrations/0001_initial.sql"));
  expect(() => loadMigrations(root)).toThrow(/manifest/i);
});

it("rejects duplicate version numbers and invalid policy values", () => {
  const root = fixture({ "0001_a.sql": "SELECT 1;", "0001_b.sql": "SELECT 2;" });
  expect(() => loadMigrations(root)).toThrow(/version/i);
  manifest(root, { "0001_a.sql": "SELECT 1;", "0001_b.sql": "SELECT 2;" });
  const data = JSON.parse(readFileSync(join(root, "migrations/manifest.json"), "utf8"));
  data.migrations[0].mode = "anything";
  writeFileSync(join(root, "migrations/manifest.json"), JSON.stringify(data));
  expect(() => loadMigrations(root)).toThrow(/policy/i);
});

it("rejects historical SQL mutation even when its manifest digest is updated", () => {
  const root = fixture();
  const base = baseline(root);
  const files = { "0001_initial.sql": "CREATE TABLE changed(id TEXT);" };
  writeFileSync(join(root, "migrations/0001_initial.sql"), files["0001_initial.sql"]);
  manifest(root, files);
  expect(() => checkMigrationBase(root, base)).toThrow(/immutable/i);
});

it("rejects historical deletion, changed policy, and inserted older versions", () => {
  const root = fixture();
  const base = baseline(root);
  const original = "CREATE TABLE items(id TEXT);";
  manifest(root, { "0001_initial.sql": original }, ["0001_initial.sql"]);
  expect(() => checkMigrationBase(root, base)).toThrow(/immutable/i);
  writeFileSync(join(root, "migrations/0000_earlier.sql"), "SELECT 1;");
  manifest(root, { "0000_earlier.sql": "SELECT 1;", "0001_initial.sql": original });
  expect(() => checkMigrationBase(root, base)).toThrow(/append/i);
  rmSync(join(root, "migrations/0001_initial.sql"));
  manifest(root, { "0000_earlier.sql": "SELECT 1;" });
  expect(() => checkMigrationBase(root, base)).toThrow(/immutable/i);
});

it("accepts a reviewed appended migration against Git history", () => {
  const root = fixture();
  const base = baseline(root);
  writeFileSync(join(root, "migrations/0002_add.sql"), "ALTER TABLE items ADD COLUMN note TEXT;");
  manifest(root, {
    "0001_initial.sql": "CREATE TABLE items(id TEXT);",
    "0002_add.sql": "ALTER TABLE items ADD COLUMN note TEXT;",
  });
  expect(() => checkMigrationBase(root, base)).not.toThrow();
});

it("rejects unknown, duplicate, gapped, and out-of-order applied history", () => {
  const migrations = loadMigrations(
    fixture({ "0001_a.sql": "SELECT 1;", "0002_b.sql": "SELECT 2;" }),
  );
  for (const history of [["unknown.sql"], ["0001_a.sql", "0001_a.sql"], ["0002_b.sql"]])
    expect(() => pendingMigrations(migrations, history)).toThrow(/history/i);
  expect(pendingMigrations(migrations, ["0001_a.sql"]).map((migration) => migration.name)).toEqual([
    "0002_b.sql",
  ]);
  expect(pendingMigrations(migrations, ["0001_a.sql", "0002_b.sql"])).toEqual([]);
});

it("blocks pending manual migrations while accepting already applied manual history", () => {
  const root = fixture();
  manifest(root, { "0001_initial.sql": "CREATE TABLE items(id TEXT);" }, ["0001_initial.sql"]);
  const migrations = loadMigrations(root);
  expect(() => pendingMigrations(migrations, [])).toThrow(/manual/i);
  expect(pendingMigrations(migrations, ["0001_initial.sql"])).toEqual([]);
});

async function database() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "migration-tests",
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
      compatibilityDate: "2026-10-24",
    }),
  );
  runtimes.push(runtime);
  return (await runtime.getD1Database("DB")) as unknown as D1Database;
}

it("installs the complete discovered application schema into a fresh database", async () => {
  const db = await database();
  await applyMigrations(db);
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('user','operations') ORDER BY name",
    )
    .all();
  expect(tables.results).toEqual([{ name: "operations" }, { name: "user" }]);
});

it("preserves existing account and operation records through the actual migration suffix", async () => {
  const db = await database();
  const migrations = loadMigrations(process.cwd());
  const baselineEnd = migrations.findIndex((migration) => migration.name === "0002_operations.sql");
  expect(baselineEnd).toBeGreaterThanOrEqual(0);
  await applyMigrations(db, migrations.slice(0, baselineEnd + 1));
  await db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
    )
    .bind("fixture", "Fixture", "fixture@example.com", 0, "2026-01-01", "2026-01-01")
    .run();
  await db
    .prepare(
      "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      "fixture-account",
      "fixture",
      "credential",
      "fixture",
      "fixture-hash",
      "2026-01-01",
      "2026-01-01",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
    )
    .bind("fixture-session", "2027-01-01", "fixture-token", "2026-01-01", "2026-01-01", "fixture")
    .run();
  await db
    .prepare("INSERT INTO operations(owner,op_id,content) VALUES(?,?,?)")
    .bind("fixture", "fixture-operation", '{"note":"semi;colon"}')
    .run();
  await applyMigrations(db, migrations.slice(baselineEnd + 1));
  expect(await db.prepare("SELECT name FROM user WHERE id='fixture'").first()).toEqual({
    name: "Fixture",
  });
  expect(
    await db.prepare("SELECT providerId, password FROM account WHERE id='fixture-account'").first(),
  ).toEqual({ providerId: "credential", password: "fixture-hash" });
  expect(await db.prepare("SELECT token FROM session WHERE id='fixture-session'").first()).toEqual({
    token: "fixture-token",
  });
  expect(await db.prepare("SELECT content FROM operations").first()).toEqual({
    content: '{"note":"semi;colon"}',
  });
});

it("rolls back the failing migration while retaining earlier successful migrations", async () => {
  const db = await database();
  const root = fixture({
    "0001_items.sql": "CREATE TABLE items(id TEXT); INSERT INTO items VALUES('semi;colon');",
    "0002_failure.sql": "CREATE TABLE incomplete(id TEXT); INSERT INTO absent VALUES(1);",
  });
  await expect(applyMigrations(db, loadMigrations(root))).rejects.toThrow();
  expect(await db.prepare("SELECT id FROM items").first()).toEqual({ id: "semi;colon" });
  expect(
    await db.prepare("SELECT name FROM sqlite_schema WHERE name='incomplete'").first(),
  ).toBeNull();
});

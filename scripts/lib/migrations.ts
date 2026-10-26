import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  name: string;
  sha256: string;
  mode: "automatic" | "manual";
  sql: string;
}

const SQL_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
export const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");

export function loadMigrations(root = process.cwd()): Migration[] {
  const directory = join(root, "migrations");
  const raw = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.ok(
    raw?.schemaVersion === 1 && Array.isArray(raw.migrations),
    "Invalid migration manifest",
  );
  const migrations: Migration[] = [];
  const versions = new Set<number>();
  const names = new Set<string>();
  for (const entry of raw.migrations) {
    assert.ok(entry && typeof entry.name === "string", "Invalid migration manifest entry");
    const match = SQL_NAME.exec(entry.name);
    assert.ok(match, `Invalid migration filename: ${entry.name}`);
    const version = Number(match[1]);
    assert.ok(!versions.has(version), `Duplicate migration version: ${version}`);
    assert.ok(!names.has(entry.name), `Duplicate migration manifest entry: ${entry.name}`);
    assert.ok(
      entry.mode === "automatic" || entry.mode === "manual",
      `Invalid migration policy: ${entry.name}`,
    );
    assert.match(entry.sha256 ?? "", /^[a-f0-9]{64}$/, `Invalid migration digest: ${entry.name}`);
    versions.add(version);
    names.add(entry.name);
    migrations.push({ ...entry, sql: "" });
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.name !== "manifest.json");
  assert.ok(
    files.every((entry) => entry.isFile() && SQL_NAME.test(entry.name)),
    "Unexpected migration file or symlink",
  );
  assert.deepEqual(
    files.map((entry) => entry.name).sort(),
    [...names].sort(),
    "Migration manifest must cover every SQL file",
  );
  for (const migration of migrations) {
    migration.sql = readFileSync(join(directory, migration.name), "utf8");
    assert.equal(
      digest(migration.sql),
      migration.sha256,
      `Migration digest mismatch: ${migration.name}`,
    );
  }
  return migrations.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function checkMigrationBase(root: string, base: string): void {
  const migrations = loadMigrations(root);
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const revision = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
  const files = git(["ls-tree", "-r", "--name-only", revision, "--", "migrations"])
    .split("\n")
    .filter(Boolean);
  const previous = files.filter((file) => file.endsWith(".sql"));
  const highest = Math.max(
    0,
    ...previous.map((file) => Number(file.slice("migrations/".length, "migrations/".length + 4))),
  );
  for (const file of previous) {
    const migration = migrations.find((entry) => `migrations/${entry.name}` === file);
    assert.ok(migration, `Historical migrations are immutable: ${file}`);
    const sql = execFileSync("git", ["show", `${revision}:${file}`], { cwd: root });
    assert.equal(migration.sha256, digest(sql), `Historical migrations are immutable: ${file}`);
  }
  if (files.includes("migrations/manifest.json")) {
    const manifest = JSON.parse(git(["show", `${revision}:migrations/manifest.json`]));
    for (const entry of manifest.migrations) {
      const current = migrations.find((migration) => migration.name === entry.name);
      assert.ok(
        current && current.sha256 === entry.sha256 && current.mode === entry.mode,
        `Historical migration policy is immutable: ${entry.name}`,
      );
    }
  }
  for (const migration of migrations)
    if (!previous.includes(`migrations/${migration.name}`))
      assert.ok(
        Number(migration.name.slice(0, 4)) > highest,
        "New migration versions must append after existing history",
      );
}

export function pendingMigrations(migrations: Migration[], applied: string[]): Migration[] {
  assert.ok(
    Array.isArray(applied) && applied.length <= migrations.length,
    "Unknown migration history",
  );
  applied.forEach((name, index) => {
    assert.equal(
      name,
      migrations[index]?.name,
      `Unknown, duplicate, or gapped migration history: ${name}`,
    );
  });
  const pending = migrations.slice(applied.length);
  for (const migration of pending)
    assert.equal(
      migration.mode,
      "automatic",
      `Pending manual migration requires an operator: ${migration.name}`,
    );
  return pending;
}

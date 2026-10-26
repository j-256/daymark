import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest } from "./migrations.ts";

const REVISION = /^[a-f0-9]{40}$/;
const RECEIPT = ".release/artifact.json";

function inputs(root: string): string[] {
  const files = ["wrangler.jsonc"];
  const walk = (relative: string) => {
    const path = join(root, relative);
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Artifact symlink rejected: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(`${relative}/${entry}`);
    } else {
      assert.ok(stat.isFile(), `Artifact special file rejected: ${relative}`);
      files.push(relative);
    }
  };
  for (const directory of ["dist", ".worker-dry-run", "migrations"]) walk(directory);
  assert.ok(
    lstatSync(join(root, "wrangler.jsonc")).isFile(),
    "Artifact configuration must be a file",
  );
  for (const required of [
    "dist/index.html",
    ".worker-dry-run/index.js",
    "migrations/manifest.json",
  ])
    assert.ok(files.includes(required), `Artifact input missing: ${required}`);
  return files.sort();
}

export function createArtifact(root: string, revision: string): void {
  assert.match(revision, REVISION, "Invalid source revision");
  const files = Object.fromEntries(
    inputs(root).map((path) => [path, digest(readFileSync(join(root, path)))]),
  );
  mkdirSync(join(root, ".release"), { recursive: true });
  writeFileSync(
    join(root, RECEIPT),
    `${JSON.stringify({ schemaVersion: 1, revision, files }, null, 2)}\n`,
  );
}

export function verifyArtifact(root: string, revision: string): void {
  assert.match(revision, REVISION, "Invalid source revision");
  const receipt = JSON.parse(readFileSync(join(root, RECEIPT), "utf8"));
  assert.equal(receipt.schemaVersion, 1, "Unknown artifact receipt version");
  assert.equal(receipt.revision, revision, "Artifact source revision mismatch");
  assert.deepEqual(Object.keys(receipt.files).sort(), inputs(root), "Artifact file set changed");
  for (const [path, expected] of Object.entries(receipt.files))
    assert.equal(
      digest(readFileSync(join(root, path))),
      expected,
      `Artifact digest mismatch: ${path}`,
    );
}

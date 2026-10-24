import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "daymark-release-"));
  directories.push(path);
  mkdirSync(join(path, "dist"));
  mkdirSync(join(path, "dist/assets"));
  writeFileSync(join(path, "wrangler.jsonc"), readFileSync("wrangler.jsonc"));
  writeFileSync(join(path, "dist/index.html"), "fixture");
  writeFileSync(
    join(path, "dist/sw.js"),
    'const CACHE="daymark-shell-fixture";const FILES = ["/"];',
  );
  writeFileSync(join(path, "dist/.assetsignore"), ".DS_Store\n**/.DS_Store\n");
  return path;
}
const check = (cwd: string) =>
  spawnSync(process.execPath, [resolve("scripts/check-config.mjs")], { cwd, encoding: "utf8" });
it("accepts the protected release configuration and known shell files", () => {
  expect(check(fixture()).status).toBe(0);
});
for (const name of [".DS_Store", "assets/.DS_Store", "private-backup.sql"]) {
  it(`rejects unexpected build artifact ${name}`, () => {
    const path = fixture();
    writeFileSync(join(path, "dist", name), "fixture");
    const result = check(path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unexpected build asset");
  });
}

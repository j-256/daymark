import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createArtifact,
  type ReleaseDependencies,
  release,
  verifyArtifact,
} from "../scripts/lib/release";

const REVISION = "a".repeat(40);
const VERSION = "11111111-2222-4333-8444-555555555555";
const BOOKMARK = "00000010-00000000-0000510f-62c5f550a9b6bea789a25358654ed8e5";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(manual = false) {
  const root = mkdtempSync(join(tmpdir(), "daymark-pipeline-"));
  roots.push(root);
  for (const dir of ["dist", ".worker-dry-run", "migrations"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, "dist/index.html"), '<html><div id="root"></div></html>');
  writeFileSync(join(root, "dist/.assetsignore"), ".DS_Store\n**/.DS_Store\n");
  writeFileSync(join(root, ".worker-dry-run/index.js"), "export default { fetch() {} }");
  copyFileSync("wrangler.jsonc", join(root, "wrangler.jsonc"));
  const files = {
    "0001_base.sql": "CREATE TABLE records(id TEXT);",
    "0002_add.sql": "ALTER TABLE records ADD COLUMN note TEXT;",
  };
  for (const [name, sql] of Object.entries(files))
    writeFileSync(join(root, "migrations", name), sql);
  writeFileSync(
    join(root, "migrations/manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      migrations: Object.entries(files).map(([name, sql]) => ({
        name,
        sha256: createHash("sha256").update(sql).digest("hex"),
        mode: manual && name.startsWith("0002") ? "manual" : "automatic",
      })),
    }),
  );
  createArtifact(root, REVISION);
  return root;
}

function provider(root: string) {
  const calls: string[][] = [];
  const events: unknown[] = [];
  const state = {
    history: ["0001_base.sql"],
    bookmark: BOOKMARK,
    failMigration: false,
    applyRecorded: true,
    uploads: 1,
    revision: REVISION,
    active: VERSION,
    badPath: "",
    staleAfterUpload: false,
  };
  const deps: ReleaseDependencies = {
    currentRevision: async () => state.revision,
    run: async (args, output) => {
      calls.push(args);
      if (args[0] === "d1" && args[1] === "execute")
        return JSON.stringify([
          {
            success: true,
            results: state.history.map((name) => ({ name })),
            meta: { rows_written: 0, changed_db: false },
          },
        ]);
      if (args[0] === "d1" && args[1] === "time-travel")
        return JSON.stringify({ bookmark: state.bookmark });
      if (args[0] === "d1" && args[1] === "migrations") {
        if (state.failMigration) throw new Error("Migration failed");
        if (state.applyRecorded) state.history.push("0002_add.sql");
        return "Applied";
      }
      if (args[0] === "versions" && args[1] === "upload") {
        if (!output) throw new Error("Structured upload output was not requested");
        writeFileSync(
          output,
          Array.from({ length: state.uploads }, () =>
            JSON.stringify({
              type: "version-upload",
              version: 1,
              worker_name: "daymark",
              version_id: VERSION,
            }),
          ).join("\n"),
        );
        if (state.staleAfterUpload) state.revision = "b".repeat(40);
        return "Uploaded";
      }
      if (args[0] === "versions" && args[1] === "deploy") return "Activated";
      if (args[0] === "deployments" && args[1] === "list")
        return JSON.stringify([
          { id: "deployment", versions: [{ version_id: state.active, percentage: 100 }] },
        ]);
      throw new Error(`Unexpected Wrangler command: ${args.join(" ")}`);
    },
    request: async (path) => {
      if (state.badPath === path) return new Response("unexpected", { status: 200 });
      if (path === "/")
        return new Response(readFileSync(join(root, "dist/index.html")), {
          headers: { "Content-Type": "text/html" },
        });
      if (path === "/api/config")
        return Response.json({ registrationOpen: false, build: REVISION });
      if (path.startsWith("/admin") || path.startsWith("/api/admin"))
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://j256.cloudflareaccess.com/cdn-cgi/access/login/daymark.lasers.app",
          },
        });
      return Response.json(
        {
          error: path === "/api/auth/sign-up/email" ? "invite_only" : "unauthorized",
          requestId: "fixture-request",
        },
        {
          status: path === "/api/auth/sign-up/email" ? 403 : 401,
          headers: { "X-Request-ID": "fixture-request" },
        },
      );
    },
    log: (event) => {
      events.push(event);
    },
  };
  return { state, calls, events, deps };
}

it("binds hidden assets, compiled code, configuration, and migration inputs to the verified revision", () => {
  const root = fixture();
  expect(() => verifyArtifact(root, REVISION)).not.toThrow();
  for (const path of [
    "dist/.assetsignore",
    ".worker-dry-run/index.js",
    "wrangler.jsonc",
    "migrations/0002_add.sql",
  ]) {
    const original = readFileSync(join(root, path));
    writeFileSync(join(root, path), "changed");
    expect(() => verifyArtifact(root, REVISION)).toThrow(/artifact/i);
    writeFileSync(join(root, path), original);
  }
  expect(() => verifyArtifact(root, "b".repeat(40))).toThrow(/revision/i);
  writeFileSync(join(root, "dist/private-backup.sql"), "private");
  expect(() => verifyArtifact(root, REVISION)).toThrow(/artifact/i);
});

it("rejects symlinks before reading artifact contents", () => {
  const root = fixture();
  symlinkSync(join(root, "wrangler.jsonc"), join(root, "dist/link"));
  expect(() => createArtifact(root, REVISION)).toThrow(/symlink/i);
});

it("records recovery, applies and verifies migrations, then activates the exact uploaded version", async () => {
  const root = fixture();
  const p = provider(root);
  const report = await release(root, REVISION, p.deps);
  expect(report.status).toBe("success");
  expect(report.bookmark).toBe(BOOKMARK);
  expect(report.migrations).toEqual(["0002_add.sql"]);
  expect(report.workerVersion).toBe(VERSION);
  expect(p.calls.map((args) => args.slice(0, 2))).toEqual([
    ["d1", "execute"],
    ["d1", "time-travel"],
    ["d1", "migrations"],
    ["d1", "execute"],
    ["versions", "upload"],
    ["versions", "deploy"],
    ["deployments", "list"],
  ]);
  const upload = p.calls.find((args) => args[1] === "upload") ?? [];
  expect(upload).toContain("--no-bundle");
  expect(upload).toContain(`BUILD_ID:${REVISION}`);
  expect(p.calls.find((args) => args[1] === "deploy")).toEqual([
    "versions",
    "deploy",
    `${VERSION}@100%`,
    "--yes",
  ]);
});

it("does not write to D1 or request a bookmark when no migrations are pending", async () => {
  const root = fixture();
  const p = provider(root);
  p.state.history.push("0002_add.sql");
  const report = await release(root, REVISION, p.deps);
  expect(report.migrations).toEqual([]);
  expect(p.calls.filter((args) => args[0] === "d1").map((args) => args[1])).toEqual(["execute"]);
});

for (const kind of [
  "stale",
  "manual",
  "unknown",
  "bookmark",
  "migration",
  "readback",
  "ambiguous",
  "stale-after-upload",
] as const) {
  it(`stops release stages after ${kind} failure without restoring or retrying writes`, async () => {
    const root = fixture(kind === "manual");
    const p = provider(root);
    if (kind === "stale") p.state.revision = "b".repeat(40);
    if (kind === "unknown") p.state.history = ["unknown.sql"];
    if (kind === "bookmark") p.state.bookmark = "";
    if (kind === "migration") p.state.failMigration = true;
    if (kind === "readback") p.state.applyRecorded = false;
    if (kind === "ambiguous") p.state.uploads = 2;
    if (kind === "stale-after-upload") p.state.staleAfterUpload = true;
    await expect(release(root, REVISION, p.deps)).rejects.toThrow();
    expect(p.calls.filter((args) => args[0] === "versions" && args[1] === "deploy")).toHaveLength(
      0,
    );
    expect(p.calls.some((args) => args.includes("restore"))).toBe(false);
    expect(p.calls.filter((args) => args[1] === "migrations").length).toBeLessThanOrEqual(1);
    const report = JSON.parse(readFileSync(join(root, ".release/report.json"), "utf8"));
    expect(report.status).toBe("failed");
    expect(report.revision).toBe(REVISION);
    expect(report.stage).toBeTruthy();
  });
}

for (const path of [
  "/api/config",
  "/api/health",
  "/api/sync",
  "/api/auth/sign-up/email",
  "/admin",
  "/api/admin/settings",
]) {
  it(`reports a failed live check for ${path} with the activated version retained`, async () => {
    const root = fixture();
    const p = provider(root);
    p.state.badPath = path;
    await expect(release(root, REVISION, p.deps)).rejects.toThrow();
    const report = JSON.parse(readFileSync(join(root, ".release/report.json"), "utf8"));
    expect(report.workerVersion).toBe(VERSION);
    expect(report.stage).toBe("smoke");
    expect(report.status).toBe("failed");
  });
}

it("fails when activation readback does not match the uploaded version", async () => {
  const root = fixture();
  const p = provider(root);
  p.state.active = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await expect(release(root, REVISION, p.deps)).rejects.toThrow(/active/i);
});

it("provides CLI help without credentials and rejects invalid invocation before any release", () => {
  for (const args of [
    ["-h"],
    ["--help"],
    ["artifact", "--help"],
    ["artifact", "-r", REVISION, "-h"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/release.ts", ...args], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  }
  for (const args of [
    [],
    ["unknown"],
    ["deploy", "--unknown"],
    ["deploy", "-r"],
    ["artifact", "--revision="],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/release.ts", ...args], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toBeTruthy();
  }
});

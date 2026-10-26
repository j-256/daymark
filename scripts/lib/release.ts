import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyArtifact } from "./artifact.ts";
import { loadMigrations, pendingMigrations } from "./migrations.ts";

export { createArtifact, verifyArtifact } from "./artifact.ts";

export interface ReleaseReport {
  revision: string;
  status: "running" | "success" | "failed";
  stage: string;
  startedAt: string;
  elapsedMs: number;
  migrations: string[];
  bookmark?: string;
  workerVersion?: string;
  error?: string;
}

export interface ReleaseDependencies {
  currentRevision: () => Promise<string>;
  run: (args: string[], outputFile?: string) => Promise<string>;
  request: (path: string) => Promise<Response>;
  log: (event: Record<string, unknown>) => void;
  wait?: (milliseconds: number) => Promise<void>;
}

const VERSION_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const READ_ATTEMPTS = 6;
const READ_DELAY_MS = 5000;
const HISTORY_SQL = "SELECT name FROM d1_migrations ORDER BY id;";

export async function release(
  root: string,
  revision: string,
  deps: ReleaseDependencies,
): Promise<ReleaseReport> {
  const started = performance.now();
  const report: ReleaseReport = {
    revision,
    status: "running",
    stage: "artifact",
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    migrations: [],
  };
  mkdirSync(join(root, ".release"), { recursive: true });
  const record = () => {
    report.elapsedMs = Math.round(performance.now() - started);
    writeFileSync(join(root, ".release/report.json"), `${JSON.stringify(report, null, 2)}\n`);
  };
  const stage = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    report.stage = name;
    record();
    const start = performance.now();
    deps.log({ event: "release_stage", stage: name, revision, status: "started" });
    const value = await operation();
    deps.log({
      event: "release_stage",
      stage: name,
      revision,
      status: "success",
      elapsedMs: Math.round(performance.now() - start),
    });
    return value;
  };
  const current = async () =>
    assert.equal(
      await deps.currentRevision(),
      revision,
      "Source revision is stale; release the verified current main",
    );
  const retryRead = async (operation: () => Promise<void>) => {
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
      try {
        await operation();
        return;
      } catch (error) {
        deps.log({
          event: "release_read",
          stage: report.stage,
          revision,
          attempt,
          status: "failed",
          reason: error instanceof Error ? error.message : "Read failed",
        });
        if (attempt === READ_ATTEMPTS) throw error;
        await deps.wait?.(READ_DELAY_MS);
      }
    }
  };
  try {
    verifyArtifact(root, revision);
    const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
    assert.equal(config.name, "daymark", "Unexpected release Worker");
    assert.equal(config.vars.APP_ORIGIN, "https://daymark.lasers.app", "Unexpected release origin");
    assert.equal(config.d1_databases[0].database_name, "daymark", "Unexpected release database");
    const migrations = loadMigrations(root);
    await stage("source", current);
    const history = async (): Promise<string[]> => {
      const result = JSON.parse(
        await deps.run([
          "d1",
          "execute",
          "daymark",
          "--remote",
          "--command",
          HISTORY_SQL,
          "--json",
        ]),
      );
      assert.ok(
        Array.isArray(result) &&
          result.length === 1 &&
          result[0].success &&
          Array.isArray(result[0].results),
        "Could not read migration history",
      );
      return result[0].results.map((row: { name: string }) => row.name);
    };
    const pending = await stage("migration-history", async () =>
      pendingMigrations(migrations, await history()),
    );
    report.migrations = pending.map((migration) => migration.name);
    if (pending.length) {
      await stage("recovery-bookmark", async () => {
        const recovery = JSON.parse(
          await deps.run(["d1", "time-travel", "info", "daymark", "--json"]),
        );
        assert.ok(
          typeof recovery.bookmark === "string" && recovery.bookmark.length > 0,
          "Recovery bookmark is missing",
        );
        report.bookmark = recovery.bookmark;
        record();
      });
      await stage("migrate", async () => {
        await current();
        await deps.run(["d1", "migrations", "apply", "daymark", "--remote"]);
      });
      await stage("migration-readback", async () =>
        assert.equal(
          pendingMigrations(migrations, await history()).length,
          0,
          "Migrations remain unapplied",
        ),
      );
    }
    await stage("upload", async () => {
      await current();
      verifyArtifact(root, revision);
      const output = join(root, ".release", `upload-${randomUUID()}.jsonl`);
      await deps.run(
        [
          "versions",
          "upload",
          ".worker-dry-run/index.js",
          "--no-bundle",
          "--var",
          `BUILD_ID:${revision}`,
          "--message",
          `Verified source ${revision}`,
        ],
        output,
      );
      const records = readFileSync(output, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const uploads = records.filter((record) => record.type === "version-upload");
      assert.ok(
        uploads.length === 1 &&
          uploads[0].version === 1 &&
          uploads[0].worker_name === "daymark" &&
          VERSION_ID.test(uploads[0].version_id),
        "Missing, ambiguous, or unexpected Worker upload record",
      );
      report.workerVersion = uploads[0].version_id;
      record();
    });
    await stage("activate", async () => {
      await current();
      await deps.run(["versions", "deploy", `${report.workerVersion}@100%`, "--yes"]);
    });
    await stage("activation-readback", async () =>
      retryRead(async () => {
        const deployments = JSON.parse(await deps.run(["deployments", "list", "--json"]));
        assert.ok(
          Array.isArray(deployments) && deployments.length > 0,
          "Active deployment is missing",
        );
        deployments.sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)));
        const versions = deployments[0].versions;
        assert.ok(
          versions?.length === 1 &&
            versions[0].version_id === report.workerVersion &&
            versions[0].percentage === 100,
          "Active version does not match uploaded version",
        );
      }),
    );
    await stage("smoke", async () =>
      retryRead(async () => {
        const paths = [
          "/",
          "/api/config",
          "/api/health",
          "/api/sync",
          "/api/auth/sign-up/email",
          "/admin",
          "/api/admin/settings",
        ];
        for (const path of paths) {
          const response = await deps.request(path);
          deps.log({
            event: "release_smoke",
            revision,
            path,
            status: response.status,
            requestId: response.headers.get("X-Request-ID"),
          });
          if (path === "/") {
            assert.equal(response.status, 200, "Public shell failed");
            assert.ok(
              response.headers.get("Content-Type")?.includes("text/html") &&
                (await response.text()).includes('id="root"'),
              "Public shell is not the application",
            );
          } else if (path === "/api/config") {
            assert.equal(response.status, 200, "Public configuration failed");
            const body = (await response.json()) as { build?: string; registrationOpen?: boolean };
            assert.equal(body.build, revision, "Live build revision does not match release");
            assert.equal(body.registrationOpen, false, "Registration must remain closed");
          } else if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
            assert.ok(
              [302, 303, 307, 308].includes(response.status),
              `Admin Access redirect missing: ${path}`,
            );
            const destination = new URL(response.headers.get("Location") ?? "");
            assert.equal(
              destination.origin,
              config.vars.ACCESS_ISSUER,
              "Admin Access issuer mismatch",
            );
            assert.ok(
              destination.pathname.startsWith("/cdn-cgi/access/login/"),
              "Admin Access login redirect missing",
            );
          } else {
            const signup = path === "/api/auth/sign-up/email";
            assert.equal(
              response.status,
              signup ? 403 : 401,
              `Authorization boundary failed: ${path}`,
            );
            const body = (await response.json()) as { error?: string };
            assert.ok(
              typeof body.error === "string",
              `Native authorization response missing: ${path}`,
            );
            if (signup) assert.equal(body.error, "invite_only", "Public signup was not rejected");
          }
          if (!response.bodyUsed) await response.body?.cancel();
        }
      }),
    );
    report.status = "success";
    record();
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    record();
    deps.log({ event: "release_failed", ...report });
    throw error;
  }
}

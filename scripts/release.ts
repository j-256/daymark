import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import { createArtifact, release } from "./lib/release.ts";

const HELP =
  "Usage: node scripts/release.ts <artifact|deploy> [-r REVISION | --revision REVISION]\nartifact: Bind the verified dist/, compiled .worker-dry-run/, configuration, and migration inputs to a source revision in .release/artifact.json. Run npm run verify first.\ndeploy: Release only from GitHub Actions on protected main in j-256/daymark. Requires the verified artifact, CLOUDFLARE_API_TOKEN secret, CLOUDFLARE_ACCOUNT_ID variable, and GITHUB_TOKEN for source checks. Revision defaults to GITHUB_SHA or the checked-out Git HEAD. Requires Node 24, Git, and npm ci; deploy uses the pinned local Wrangler. Reports safe release stages to stderr and .release/report.json. Never automatically restores D1. Exit: 0 success, 1 runtime failure, 2 usage/precondition error, 3 missing dependency.";
const execute = promisify(execFile);
let executingCommand = false;
const redact = (message: string) => {
  for (const secret of [process.env.CLOUDFLARE_API_TOKEN, process.env.GITHUB_TOKEN])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  return message;
};

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      revision: { type: "string", short: "r" },
    },
  });
  if (values.help) console.log(HELP);
  else {
    if (positionals.length !== 1 || !["artifact", "deploy"].includes(positionals[0]))
      throw new TypeError("Choose artifact or deploy; use --help");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const revision = values.revision ?? process.env.GITHUB_SHA ?? head;
    if (!/^[a-f0-9]{40}$/.test(revision) || revision !== head)
      throw new TypeError("Revision must match the checked-out Git commit");
    if (positionals[0] === "artifact") {
      executingCommand = true;
      createArtifact(process.cwd(), revision);
      console.log(`Verified artifact receipt created for ${revision}`);
    } else {
      if (
        process.env.GITHUB_ACTIONS !== "true" ||
        process.env.GITHUB_REPOSITORY !== "j-256/daymark" ||
        process.env.GITHUB_REF !== "refs/heads/main" ||
        process.env.GITHUB_REF_PROTECTED !== "true" ||
        !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? "")
      )
        throw new TypeError(
          "Deployment requires GitHub Actions on the owning repository's protected main",
        );
      for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GITHUB_TOKEN"])
        if (!process.env[name]) throw new TypeError(`Missing ${name}`);
      const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
      if (!existsSync(wrangler)) {
        console.error("Missing local Wrangler; run npm ci");
        process.exit(3);
      }
      try {
        executingCommand = true;
        const report = await release(process.cwd(), revision, {
          currentRevision: async () => {
            const response = await fetch(
              "https://api.github.com/repos/j-256/daymark/branches/main",
              {
                headers: {
                  Accept: "application/vnd.github+json",
                  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                },
                signal: AbortSignal.timeout(20000),
              },
            );
            assert.equal(response.status, 200, "Could not inspect protected main");
            const branch = (await response.json()) as {
              protected: boolean;
              commit: { sha: string };
            };
            assert.equal(branch.protected, true, "Main branch protection is required");
            return branch.commit.sha;
          },
          run: async (args, outputFile) => {
            const env: NodeJS.ProcessEnv = {
              ...process.env,
              CI: "true",
              WRANGLER_SEND_METRICS: "false",
            };
            delete env.WRANGLER_OUTPUT_FILE_PATH;
            if (outputFile) env.WRANGLER_OUTPUT_FILE_PATH = outputFile;
            try {
              const result = await execute(process.execPath, [wrangler, ...args], {
                env,
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
              });
              if (result.stderr) console.error(redact(result.stderr));
              return result.stdout;
            } catch (error) {
              const failure = error as Error & { stderr?: string; code?: string | number };
              if (failure.stderr) console.error(redact(failure.stderr).slice(-4000));
              throw new Error(
                `Wrangler ${args.slice(0, 2).join(" ")} failed (${failure.code ?? "unknown"}); inspect provider state before retrying`,
              );
            }
          },
          request: async (path) =>
            fetch(`https://daymark.lasers.app${path}`, {
              redirect: "manual",
              cache: "no-store",
              signal: AbortSignal.timeout(20000),
            }),
          log: (event) => console.error(redact(JSON.stringify(event))),
          wait: async (milliseconds) => {
            await setTimeout(milliseconds);
          },
        });
        console.log(`Released ${report.revision} as Worker version ${report.workerVersion}`);
      } finally {
        if (process.env.GITHUB_STEP_SUMMARY && existsSync(".release/report.json"))
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `\n### Daymark release\n\n\`\`\`json\n${redact(readFileSync(".release/report.json", "utf8"))}\`\`\`\n\nPublic smoke checks do not establish authenticated account health.\n`,
          );
      }
    }
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode =
    error instanceof TypeError && !executingCommand
      ? 2
      : (error as NodeJS.ErrnoException).code === "ENOENT" &&
          (error as NodeJS.ErrnoException).syscall?.startsWith("spawn")
        ? 3
        : 1;
}

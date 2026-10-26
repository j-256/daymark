import { parseArgs } from "node:util";
import { checkMigrationBase } from "./lib/migrations.ts";

try {
  const { values } = parseArgs({
    options: { help: { type: "boolean", short: "h" }, base: { type: "string", short: "b" } },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/check-migrations.ts [-b BASE | --base BASE]\nValidate reviewed migration digests, ordering, and immutability against Git BASE (default MIGRATION_BASE or origin/main). Requires Node 24 and Git. Exit: 0 valid, 1 invalid, 2 usage error, 3 missing dependency.",
    );
  } else {
    const base = values.base ?? process.env.MIGRATION_BASE ?? "origin/main";
    if (!base) throw new TypeError("Migration base cannot be empty");
    checkMigrationBase(process.cwd(), base);
    console.log("Migration manifest and immutable history passed");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode =
    error instanceof TypeError
      ? 2
      : (error as NodeJS.ErrnoException).code === "ENOENT" &&
          (error as NodeJS.ErrnoException).syscall?.startsWith("spawn")
        ? 3
        : 1;
}

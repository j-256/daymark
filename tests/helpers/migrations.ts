import { unstable_splitSqlQuery } from "wrangler";
import { loadMigrations, type Migration } from "../../scripts/lib/migrations";

export async function applyMigrations(db: D1Database, migrations: Migration[] = loadMigrations()) {
  for (const migration of migrations)
    await db.batch(unstable_splitSqlQuery(migration.sql).map((sql) => db.prepare(sql)));
}

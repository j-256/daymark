import { canonical } from "../src/shared/model";
import { LIMITS, validateOperation } from "../src/shared/validation";
import { HttpError, json, readJson } from "./http";
import type { Env } from "./types";

const PAGE_SIZE = 500;
export async function sync(
  request: Request,
  env: Env,
  owner: string,
  requestId: string,
): Promise<Response> {
  if (request.method === "POST") {
    const body = await readJson(request);
    if (
      Object.keys(body).some((k) => k !== "operations") ||
      !Array.isArray(body.operations) ||
      !body.operations.length ||
      body.operations.length > LIMITS.batch
    )
      throw new HttpError(400, "invalid_batch", "Invalid sync batch");
    const operations = body.operations.map(validateOperation);
    const statements = operations.map((op) =>
      env.DB.prepare(`
      INSERT INTO operations(owner, op_id, content) VALUES (?1, ?2,
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM json_each(?3) parent_id WHERE NOT EXISTS (
            SELECT 1 FROM operations parent WHERE parent.owner = ?1 AND parent.op_id = parent_id.value
            AND json_extract(parent.content, '$.kind') = ?4 AND json_extract(parent.content, '$.key') = ?5
          )
        ) THEN ?6 ELSE '$invalid_parent' END)
      ON CONFLICT(owner, op_id) DO UPDATE SET content =
        CASE WHEN operations.content = excluded.content THEN operations.content ELSE '$id_collision' END
    `).bind(owner, op.id, JSON.stringify(op.parents), op.kind, op.key, canonical(op)),
    );
    try {
      const result = await env.DB.batch(statements);
      console.info(
        JSON.stringify({
          event: "sync_push",
          requestId,
          operations: operations.length,
          rowsRead: result.reduce((n, r) => n + r.meta.rows_read, 0),
          rowsWritten: result.reduce((n, r) => n + r.meta.rows_written, 0),
        }),
      );
      return json({ acknowledged: operations.map((op) => op.id) });
    } catch (error) {
      if (error instanceof Error && /constraint|malformed JSON/i.test(error.message))
        throw new HttpError(
          409,
          "operation_conflict",
          "An operation ID or parent was rejected. Your local changes are preserved.",
        );
      throw error;
    }
  }
  if (request.method !== "GET")
    throw new HttpError(405, "method_not_allowed", "Method not allowed");
  const url = new URL(request.url);
  const cursorText = url.searchParams.get("cursor") ?? "0";
  const limitText = url.searchParams.get("limit") ?? String(PAGE_SIZE);
  const cursor = Number(cursorText);
  const limit = Number(limitText);
  if (
    !/^\d+$/.test(cursorText) ||
    !Number.isSafeInteger(cursor) ||
    !/^\d+$/.test(limitText) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > PAGE_SIZE
  )
    throw new HttpError(400, "invalid_cursor", "Invalid sync cursor");
  const result = await env.DB.prepare(
    "SELECT seq, content FROM operations WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?",
  )
    .bind(owner, cursor, limit + 1)
    .all<{ seq: number; content: string }>();
  const rows = result.results.slice(0, limit);
  return json({
    operations: rows.map((row) => ({ seq: row.seq, operation: JSON.parse(row.content) })),
    cursor: rows.at(-1)?.seq ?? cursor,
    hasMore: result.results.length > limit,
  });
}

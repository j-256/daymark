import { accessEmail, createAuth, requireOwner } from "./auth";
import { HttpError, json, readJson } from "./http";
import type { Env } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function adminRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/admin/bootstrap") {
    const email = await accessEmail(request, env, ctx, true);
    if (email !== env.OWNER_EMAIL.toLowerCase())
      throw new HttpError(403, "owner_required", "Owner access required");
    const existing = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?')
      .bind(env.OWNER_EMAIL.toLowerCase())
      .first();
    if (request.method === "GET") return json({ setupRequired: !existing });
    if (request.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Method not allowed");
    if (existing) throw new HttpError(409, "owner_exists", "The owner account already exists");
    const body = await readJson(request);
    const response = await createAuth(env, true).handler(
      new Request(`${env.APP_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.APP_ORIGIN },
        body: JSON.stringify({
          email,
          name: typeof body.name === "string" ? body.name.slice(0, 80) : "Owner",
          password: body.password,
        }),
      }),
    );
    if (response.ok)
      await env.DB.prepare('UPDATE "user" SET role = ? WHERE email = ?').bind("admin", email).run();
    return response;
  }
  await requireOwner(request, env, ctx);
  if (path === "/api/admin/accounts" && request.method === "GET") {
    const result = await env.DB.prepare(
      'SELECT id, name, email, role, banned FROM "user" ORDER BY "createdAt" LIMIT 1001',
    ).all();
    if (result.results.length > 1000)
      throw new HttpError(413, "account_limit", "Account listing limit reached");
    return json({ accounts: result.results });
  }
  if (path === "/api/admin/accounts" && request.method === "POST") {
    const body = await readJson(request);
    if (
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !EMAIL.test(body.email) ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 80 ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128
    )
      throw new HttpError(
        400,
        "invalid_account",
        "Use an email, name, and password of 12-128 characters",
      );
    const result = await createAuth(env).api.createUser({
      body: {
        email: body.email.toLowerCase(),
        name: body.name.trim(),
        password: body.password,
        role: "user",
      },
    });
    return json({ account: result.user }, 201);
  }
  if (path === "/api/admin/account-status" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.id !== "string" || body.id.length > 100 || typeof body.active !== "boolean")
      throw new HttpError(400, "invalid_account", "Invalid account status");
    const target = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?')
      .bind(body.id)
      .first<{ email: string }>();
    if (!target) throw new HttpError(404, "not_found", "Account not found");
    if (target.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase())
      throw new HttpError(400, "owner_protected", "The owner account cannot be deactivated");
    await env.DB.batch([
      env.DB.prepare('UPDATE "user" SET banned = ?, "updatedAt" = ? WHERE id = ?').bind(
        body.active ? 0 : 1,
        Date.now(),
        body.id,
      ),
      env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(body.id),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/admin/registration" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.open !== "boolean")
      throw new HttpError(400, "invalid_setting", "Invalid registration setting");
    await env.DB.prepare("UPDATE app_settings SET value = ? WHERE key = 'registration'")
      .bind(body.open ? "open" : "invite-only")
      .run();
    return json({ open: body.open });
  }
  if (path === "/api/admin/reset-password" && request.method === "POST") {
    const body = await readJson(request);
    if (
      typeof body.id !== "string" ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128
    )
      throw new HttpError(400, "invalid_password", "Use a password of 12-128 characters");
    await createAuth(env).api.setUserPassword({
      body: { userId: body.id, newPassword: body.password },
      headers: request.headers,
    });
    await env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(body.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "not_found", "Not found");
}

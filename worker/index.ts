import { ValidationError } from "../src/shared/validation";
import { adminRoute } from "./accounts";
import { accessEmail, account, createAuth, registrationOpen } from "./auth";
import { HttpError, json, readJson } from "./http";
import { sync } from "./sync";
import type { Env } from "./types";

const AUTH_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
  "/api/auth/change-password",
]);
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const path = new URL(request.url).pathname;
    let response: Response;
    try {
      if (env.ACCESS_REQUIRED === "true") await accessEmail(request, env, ctx);
      if (!["GET", "HEAD", "POST"].includes(request.method))
        throw new HttpError(405, "method_not_allowed", "Method not allowed");
      if (request.method === "POST" && request.headers.get("origin") !== env.APP_ORIGIN)
        throw new HttpError(403, "origin_rejected", "Request origin was rejected");
      if (request.method === "POST") {
        const body = await readJson(request);
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        request = new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) });
      }
      if (path.startsWith("/api/admin/")) response = await adminRoute(request, env, ctx);
      else if (path.startsWith("/api/auth/")) {
        if (!AUTH_PATHS.has(path)) throw new HttpError(404, "not_found", "Not found");
        const open = await registrationOpen(env);
        if (path.endsWith("/sign-up/email") && !open)
          throw new HttpError(403, "invite_only", "Accounts are created by the administrator");
        response = await createAuth(env, open).handler(request);
      } else if (path === "/api/config")
        response = json({
          registrationOpen: await registrationOpen(env),
          build: env.BUILD_ID ?? "development",
        });
      else if (path === "/api/session")
        response = json({
          account: await account(request, env),
          registrationOpen: await registrationOpen(env),
          build: env.BUILD_ID ?? "development",
        });
      else if (path === "/api/sync") {
        const user = await account(request, env);
        if (request.headers.get("X-Daymark-Account") !== user.id)
          throw new HttpError(
            409,
            "account_changed",
            "The signed-in account changed. Reopen Daymark before syncing.",
          );
        response = await sync(request, env, user.id, requestId);
      } else if (path === "/api/health") {
        await account(request, env);
        await env.DB.prepare("SELECT 1").first();
        response = json({ ok: true, build: env.BUILD_ID ?? "development" });
      } else if (path.startsWith("/api/")) throw new HttpError(404, "not_found", "Not found");
      else {
        if (path === "/admin" || path.startsWith("/admin/")) {
          const email = await accessEmail(request, env, ctx, true);
          if (email !== env.OWNER_EMAIL.toLowerCase())
            throw new HttpError(403, "owner_required", "Owner access required");
        }
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : error instanceof ValidationError ? 400 : 503;
      const code =
        error instanceof HttpError
          ? error.code
          : error instanceof ValidationError
            ? "invalid_operation"
            : "service_unavailable";
      response = json(
        {
          error: code,
          message:
            error instanceof HttpError
              ? error.message
              : status === 400
                ? "Invalid operation data"
                : "The server could not complete this request. Local changes are preserved.",
          requestId,
        },
        status,
      );
    }
    const headers = new Headers(response.headers);
    headers.set("X-Request-ID", requestId);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (path.startsWith("/api/")) {
      headers.set("Cache-Control", "no-store");
      console.info(
        JSON.stringify({
          event: "api_request",
          requestId,
          route: path.startsWith("/api/admin/")
            ? "admin"
            : path.startsWith("/api/auth/")
              ? "auth"
              : path,
          status: response.status,
          elapsedMs: Math.round(performance.now() - started),
        }),
      );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

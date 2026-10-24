import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./http";
import type { Account, Env } from "./types";

const SESSION_SECONDS = 60 * 60 * 24 * 30;
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function createAuth(env: Env, registration = false) {
  return betterAuth({
    appName: "Daymark",
    baseURL: env.APP_ORIGIN,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !registration,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: { useSecureCookies: env.APP_ORIGIN.startsWith("https:"), cookiePrefix: "daymark" },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    plugins: [admin()],
    logger: { disabled: true },
  });
}

export async function accessEmail(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  adminOnly = false,
): Promise<string> {
  const audiences = adminOnly
    ? [env.ADMIN_ACCESS_AUDIENCE]
    : [env.ACCESS_AUDIENCE, env.ADMIN_ACCESS_AUDIENCE];
  const platform = (
    ctx as unknown as { access?: { aud: string; getIdentity: () => Promise<{ email?: string }> } }
  ).access;
  if (platform && audiences.includes(platform.aud)) {
    const identity = await platform.getIdentity();
    if (identity?.email) return identity.email.toLowerCase();
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_ISSUER || !audiences.filter(Boolean).length)
    throw new HttpError(403, "access_required", "Sign in through Cloudflare Access");
  try {
    let jwks = keys.get(env.ACCESS_ISSUER);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", env.ACCESS_ISSUER));
      keys.set(env.ACCESS_ISSUER, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_ISSUER,
      audience: audiences.filter(Boolean),
      algorithms: ["RS256"],
    });
    if (typeof payload.email !== "string") throw new Error();
    return payload.email.toLowerCase();
  } catch {
    throw new HttpError(403, "access_required", "Sign in through Cloudflare Access");
  }
}

export async function account(request: Request, env: Env): Promise<Account> {
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "sign_in_required", "Sign in to continue syncing");
  const user = await env.DB.prepare('SELECT id, name, email, role, banned FROM "user" WHERE id = ?')
    .bind(session.user.id)
    .first<Account & { banned: number }>();
  if (!user || user.banned)
    throw new HttpError(403, "account_inactive", "This account is inactive");
  return { id: user.id, email: user.email, name: user.name, role: user.role || "user" };
}

export async function requireOwner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Account> {
  const edgeEmail = await accessEmail(request, env, ctx, true);
  const user = await account(request, env);
  if (
    edgeEmail !== env.OWNER_EMAIL.toLowerCase() ||
    user.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase() ||
    user.role !== "admin"
  )
    throw new HttpError(403, "owner_required", "Owner access required");
  return user;
}

export async function registrationOpen(env: Env): Promise<boolean> {
  const setting = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key = 'registration'",
  ).first<{ value: string }>();
  return setting?.value === "open";
}

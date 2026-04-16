import type { Context, MiddlewareHandler } from "hono";
import { getApplicationByPublishableKey, isOriginAllowed } from "../applications";

// ── Static origin allowlist ────────────────────────────────────────────────────
//
// SDK consumer apps use the dynamic path: X-Publishable-Key triggers a D1
// lookup for the app's allowed_origins list. This static set is the fallback
// for the dashboard, admin tooling, and internal services.
//
// ⚠️  PRODUCTION NOTE: Before deploying, add the production dashboard Pages URL
//     to this set AND to trustedOrigins in auth.ts.
//     Auth server URLs: https://auth.115jon.site, https://ralph-auth.jontitor.workers.dev
export const STATIC_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5180",   // SDK demo app
  "http://localhost:8787",
  "http://localhost:8888",
  "https://meet.115jon.site",
  "https://ralph-meet.jontitor.workers.dev",
  "https://ralph-auth-dashboard.jontitor.workers.dev",
  "https://cdn.115jon.site",
]);

/**
 * Resolves the allowed CORS origin for a given request.
 *  1. X-Publishable-Key present → look up app in D1, check its origin list.
 *  2. Fallback to STATIC_ORIGINS.
 */
export async function resolveOrigin(request: Request, db: D1Database): Promise<string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!origin) return "";
  const pk = request.headers.get("X-Publishable-Key");
  if (pk) {
    const app = await getApplicationByPublishableKey(db, pk).catch(() => null);
    if (app && isOriginAllowed(app, origin)) return origin;
    if (app) return ""; // key found but origin not in app list
  }
  return STATIC_ORIGINS.has(origin) ? origin : "";
}

export async function buildCorsHeaders(
  request: Request,
  db: D1Database
): Promise<Record<string, string>> {
  const origin = await resolveOrigin(request, db);
  return {
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Publishable-Key",
    "Access-Control-Allow-Credentials": origin ? "true" : "false",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Applies CORS + security headers to the given Response, preserving all
 * existing headers from the response (e.g. Set-Cookie, Retry-After).
 */
export async function withHeaders(
  response: Response,
  request: Request,
  db: D1Database
): Promise<Response> {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({
    ...(await buildCorsHeaders(request, db)),
    ...SECURITY_HEADERS,
  })) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Hono middleware that adds CORS + security headers to every response.
 * Also handles OPTIONS preflight short-circuit.
 */
export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next) => {
    const db = c.env.DB;

    // Preflight
    if (c.req.method === "OPTIONS") {
      const headers = await buildCorsHeaders(c.req.raw, db);
      return new Response(null, { status: 204, headers });
    }

    await next();

    // Patch response headers — this preserves existing headers
    const res = c.res;
    const patched = await withHeaders(res, c.req.raw, db);
    c.res = patched;
  };
}

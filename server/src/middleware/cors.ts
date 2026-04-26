/**
 * cors.ts — CORS + security header middleware for the ralph-auth worker.
 *
 * ## Origin resolution — three-tier waterfall
 *
 * Tier 0  KV cache (O(1), ~1 ms)
 *         Key: `cors:origin:<origin>` → "1" (allowed) | "0" (denied)
 *         TTL: ORIGIN_CACHE_TTL_SECONDS (60 s).  Written on every D1 miss.
 *         Eliminates repeated D1 reads for the same origin across requests
 *         within the TTL window — critical for CORS preflight performance.
 *
 * Tier 1  Publishable-key D1 lookup (actual requests only)
 *         X-Publishable-Key header is present on the real fetch but NOT on
 *         the browser OPTIONS preflight (browsers only advertise the header
 *         name in Access-Control-Request-Headers, never its value).
 *         When the key is present we can narrow the lookup to one app row.
 *
 * Tier 2  STATIC_ORIGINS (in-process Set, zero I/O)
 *         First-party services: the auth dashboard, CDN, whitelist for dev
 *         servers.  New external SDK consumers are NOT added here — they go
 *         through the Applications table (Tier 1 / Tier 3).
 *
 * Tier 3  Full application-table D1 scan (preflight fallback)
 *         When no publishable key is present (the preflight case) we must
 *         check whether the requesting origin is registered in any app's
 *         allowed_origins column.  Origins are stored as newline-delimited
 *         strings; we use SQLite's char(10) + instr() rather than a '\n'
 *         string literal to guarantee correct newline matching regardless of
 *         how the JavaScript template literal is processed.
 *
 * ## Security guarantees
 *
 * - A denied origin always receives `Access-Control-Allow-Origin: null` and
 *   `Access-Control-Allow-Credentials: false`.
 * - The Vary: Origin header is always set so Cloudflare's edge cache stores
 *   separate copies per origin.
 * - KV caches only the allowed/denied decision — the raw allowed_origins
 *   data is never written to KV.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  getApplicationByPublishableKey,
  isOriginAllowed,
} from "../applications";
import { setAppId } from "../lib/app-context";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * KV cache TTL for the per-origin allowed decision.
 * 60 seconds is deliberately short: new apps propagate quickly, and revoked
 * apps are locked out within one minute.
 */
const ORIGIN_CACHE_TTL_SECONDS = 60;

/**
 * KV cache key prefix for the per-origin CORS decision.
 * Format: `cors:origin:<origin>` → `"1"` (allowed) | `"0"` (denied).
 */
const CACHE_KEY_PREFIX = "cors:origin:";

// ── Static origin allowlist ────────────────────────────────────────────────────
//
// This set is for FIRST-PARTY services only: the auth server's own dashboard,
// internal tooling, and hardcoded dev servers.
//
// External SDK consumers (e.g. cdn.115jon.site, meet.115jon.site) must be
// registered as Applications in the Admin Dashboard.  Do not add arbitrary
// third-party origins here.
export const STATIC_ORIGINS = new Set<string>([
  // Dev — combined Vite + Miniflare dev server (direct port, no Caddy)
  "http://localhost:5174",
  // Dev — other local services
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://localhost:5180", // SDK demo app
  "http://localhost:8888", // ralph-meet dev port
  // Dev — Caddy reverse proxy (auth.lvh.me → 127.0.0.1, Google OAuth-compatible)
  "https://auth.lvh.me",
  // Dev — Caddy reverse proxy (auth.localhost fallback for non-OAuth testing)
  "https://auth.localhost",
  // Production — combined auth+dashboard worker
  "https://auth.115jon.site",
  "https://ralph-auth-server.jontitor.workers.dev",
]);

// ── Security headers (non-CORS) ───────────────────────────────────────────────

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// ── KV cache helpers ──────────────────────────────────────────────────────────

/**
 * Read the cached CORS decision for `origin` from KV.
 * Returns `true` if cached-allowed, `false` if cached-denied, `null` on miss.
 */
async function kvGetOrigin(
  kv: KVNamespace,
  origin: string
): Promise<boolean | null> {
  const value = await kv.get(`${CACHE_KEY_PREFIX}${origin}`).catch(() => null);
  if (value === "1") return true;
  if (value === "0") return false;
  return null; // cache miss
}

/**
 * Write the CORS decision for `origin` to KV with a 60-second TTL.
 * Fire-and-forget: CORS headers must not be blocked on a KV write.
 */
function kvPutOrigin(kv: KVNamespace, origin: string, allowed: boolean): void {
  kv
    .put(`${CACHE_KEY_PREFIX}${origin}`, allowed ? "1" : "0", {
      expirationTtl: ORIGIN_CACHE_TTL_SECONDS,
    })
    .catch(() => {
      /* non-fatal — best-effort cache warm */
    });
}

// ── Core origin resolution ────────────────────────────────────────────────────

/**
 * Resolves the canonical `Access-Control-Allow-Origin` value for a request.
 *
 * Returns the origin string if it should be reflected, or `""` if it must be
 * denied.  Never returns `"*"` — we always use credentialed, per-origin CORS.
 *
 * The three-tier waterfall is described in the module-level JSDoc.
 */
export async function resolveOrigin(
  request: Request,
  db: D1Database,
  kv: KVNamespace
): Promise<string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!origin) return "";

  // ── Tier 0: KV cache ─────────────────────────────────────────────────────
  const cached = await kvGetOrigin(kv, origin);
  if (cached === true) return origin;
  if (cached === false) return "";

  // ── Tier 1: publishable-key D1 lookup ────────────────────────────────────
  //
  // X-Publishable-Key is present on actual API requests but NOT on OPTIONS
  // preflight (browsers only list the header name in
  // Access-Control-Request-Headers; the value is withheld until preflight
  // succeeds).  When present we can short-circuit to a single-row D1 read.
  const pk = request.headers.get("X-Publishable-Key");
  if (pk) {
    const app = await getApplicationByPublishableKey(db, pk).catch(() => null);
    if (app) {
      // Key resolved — apply per-app policy; cache the decision either way.
      const allowed = isOriginAllowed(app, origin);
      kvPutOrigin(kv, origin, allowed);
      // Store app_id on the Request so databaseHooks in auth.ts can access it.
      if (allowed) setAppId(request, app.id);
      return allowed ? origin : "";
    }
    // Key not found in DB — fall through to static + global checks.
  }

  // ── Tier 2: static first-party origins ───────────────────────────────────
  if (STATIC_ORIGINS.has(origin)) {
    kvPutOrigin(kv, origin, true);
    return origin;
  }

  // ── Tier 3: full application-table scan (the preflight path) ─────────────
  //
  // Origins are stored as a newline-delimited (char(10)) text column.
  // We use SQLite's `char(10)` function — NOT the string literal `'\n'` —
  // to produce the actual newline byte (0x0A).  Using `'\n'` in a SQLite
  // string literal yields the two-character sequence backslash + n, which
  // will NOT match the stored newline byte and causes silent false-negatives.
  //
  // The `instr(haystack, needle)` function returns the 1-based index of the
  // first occurrence of needle in haystack, or 0 if not found.  Wrapping
  // both sides in char(10) ensures we match whole tokens, not substrings
  // (e.g., `https://example.com` cannot match `https://evil-example.com`).
  const row = await db
    .prepare(
      `SELECT id
         FROM application
        WHERE instr(
                char(10) || allowed_origins || char(10),
                char(10) || ?1        || char(10)
              ) > 0
        LIMIT 1`
    )
    .bind(origin)
    .first<{ id: string }>()
    .catch(() => null);

  const allowed = row !== null;
  kvPutOrigin(kv, origin, allowed);
  return allowed ? origin : "";
}

// ── Header builders ───────────────────────────────────────────────────────────

/**
 * Builds the complete set of CORS response headers for a request.
 * Always sets `Vary: Origin` so Cloudflare's edge cache stores distinct
 * responses per origin.
 */
export async function buildCorsHeaders(
  request: Request,
  db: D1Database,
  kv: KVNamespace
): Promise<Record<string, string>> {
  const origin = await resolveOrigin(request, db, kv);
  return {
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Publishable-Key, X-Ralph-Auth-SDK",
    "Access-Control-Allow-Credentials": origin ? "true" : "false",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Clones `response`, overlaying CORS + security headers while preserving
 * every existing header (Set-Cookie, Retry-After, etc.).
 */
export async function withHeaders(
  response: Response,
  request: Request,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  const headers = new Headers(response.headers);
  const overlay: Record<string, string> = {
    ...(await buildCorsHeaders(request, db, kv)),
    ...SECURITY_HEADERS,
  };
  for (const [key, value] of Object.entries(overlay)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Hono middleware ───────────────────────────────────────────────────────────

/**
 * Hono middleware that:
 *  1. Short-circuits OPTIONS preflight requests with a minimal 204 response
 *     carrying correct CORS headers (no worker business logic runs).
 *  2. Adds CORS + security headers to every subsequent response without
 *     discarding existing response headers.
 */
export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next) => {
    const { DB: db, KV: kv } = c.env;

    // Fast-path: OPTIONS preflight — resolve origin, respond, done.
    if (c.req.method === "OPTIONS") {
      const headers = await buildCorsHeaders(c.req.raw, db, kv);
      return new Response(null, { status: 204, headers });
    }

    await next();

    // Overlay CORS + security headers on the worker response.
    c.res = await withHeaders(c.res, c.req.raw, db, kv);
  };
}

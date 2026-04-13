import { hashPassword } from "better-auth/crypto";
import { createAuth } from "./auth";
import { validatePassword } from "./password";

// ── Allowed CORS origins ──────────────────────────────────────────────────────
//
// In development: Vite proxy (5174) and wrangler dev (8787) both count as origins.
// In production: add your deployed dashboard URL (Cloudflare Pages) here too.
//   e.g. "https://ralph-auth-dashboard.pages.dev" or "https://dash.115jon.site"
//
// ⚠️  PRODUCTION NOTE: Before deploying, add the production dashboard Pages URL
//     to this set AND to trustedOrigins in auth.ts.
//     Auth server URLs: https://auth.115jon.site, https://ralph-auth.jontitor.workers.dev
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  // Dev
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8787",
  "http://localhost:8888",
  // Production — third-party consumers
  "https://meet.115jon.site",
  "https://ralph-meet.jontitor.workers.dev",
  // Dashboard deployed as a Worker
  "https://ralph-auth-dashboard.jontitor.workers.dev",
  // "https://dash.115jon.site",  // uncomment if you add a custom domain
]);

/**
 * Returns a validated `Access-Control-Allow-Origin` value.
 * Only echoes the origin if it's in the allowlist — never wildcards credentials.
 */
function allowedOrigin(request: Request): string {
  const origin = request.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "";
}

/**
 * CORS headers for preflight + actual responses.
 * Sets Vary: Origin so CDN caches don't serve wrong-origin responses.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request);
  return {
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": origin ? "true" : "false",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/**
 * Minimal security headers applied to every non-auth response.
 * Better Auth manages its own headers for /api/auth/* routes.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Merge CORS + security headers onto a Response. */
function withHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...corsHeaders(request), ...SECURITY_HEADERS })) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────
    // Validate Origin against allowlist — never reflect arbitrary origins.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // ── Auth routes — delegate entirely to Better Auth ────────
    // Better Auth uses trustedOrigins from auth.ts for its own CORS.
    if (url.pathname.startsWith("/api/auth")) {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
      return auth.handler(request);
    }

    // ── Set initial password (OAuth-only users adding a password) ─
    //
    // Better Auth's admin.setUserPassword doesn't create a credential
    // account entry — it only updates an existing one. For OAuth-only
    // users we need to INSERT a new account row ourselves using the
    // same hashPassword function that Better Auth uses for sign-in.
    //
    // POST /api/user/set-initial-password  { newPassword: string }
    if (url.pathname === "/api/user/set-initial-password" && request.method === "POST") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

      // 1. Require a valid session
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return withHeaders(Response.json({ error: "Not authenticated" }, { status: 401 }), request);
      }

      // 2. Parse + validate password (same rules enforced client-side too)
      let rawPassword: string | undefined;
      try {
        const body = await request.json() as { newPassword?: string };
        rawPassword = body.newPassword;
      } catch {
        return withHeaders(Response.json({ error: "Invalid request body" }, { status: 400 }), request);
      }
      const newPassword = rawPassword ?? "";
      const { valid, errors } = validatePassword(newPassword);
      if (!valid) {
        return withHeaders(
          Response.json({ error: errors[0] ?? "Password does not meet requirements" }, { status: 400 }),
          request
        );
      }

      // 3. Reject if credential account already exists — use changePassword instead
      const existing = await env.DB
        .prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'")
        .bind(session.user.id)
        .first<{ id: string }>();
      if (existing) {
        return withHeaders(
          Response.json(
            { error: "You already have a password. Use 'Change Password' to update it." },
            { status: 409 }
          ),
          request
        );
      }

      // 4. Hash with Better Auth's own algorithm so sign-in works out of the box
      const hashed = await hashPassword(newPassword);


      // 5. Create the credential account row
      const accountId = crypto.randomUUID();
      const now = Date.now();
      await env.DB
        .prepare(
          `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
           VALUES (?, ?, 'credential', ?, ?, ?, ?)`
        )
        .bind(accountId, session.user.email, session.user.id, hashed, now, now)
        .run();

      return withHeaders(Response.json({ success: true }), request);
    }

    // ── Health check ──────────────────────────────────────────
    // Minimal response — no service name or timestamp to avoid info leakage.
    if (url.pathname === "/health") {
      return withHeaders(Response.json({ status: "ok" }), request);
    }

    return withHeaders(new Response("Not found", { status: 404 }), request);
  },
} satisfies ExportedHandler<Env>;

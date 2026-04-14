import { hashPassword } from "better-auth/crypto";
import { logAudit, queryAuditLogs } from "./audit";
import { createAuth } from "./auth";
import { parseDevice, parseGeo } from "./device";
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

      // 6. Audit: user set their initial password
      await logAudit(env.DB, {
        userId: session.user.id,
        actor: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email,
        action: "user.passwordSet",
        ipAddress: request.headers.get("CF-Connecting-IP"),
        userAgent: request.headers.get("User-Agent"),
      });

      return withHeaders(Response.json({ success: true }), request);
    }

    // ── Health check ──────────────────────────────────────────
    // Minimal response — no service name or timestamp to avoid info leakage.
    if (url.pathname === "/health") {
      return withHeaders(Response.json({ status: "ok" }), request);
    }

    // ── Audit log query ───────────────────────────────────────
    //
    // GET /api/audit/logs
    //   ?userId=   filter by subject user
    //   ?orgId=    filter by organization
    //   ?action=   exact action or prefix (e.g. "user.*")
    //   ?limit=    max rows (1-200, defaults to 50)
    //   ?before=   opaque cursor from previous response for next-page
    //
    // Admin-only — 403 if caller is not role:admin.
    if (url.pathname === "/api/audit/logs" && request.method === "GET") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return withHeaders(Response.json({ error: "Not authenticated" }, { status: 401 }), request);
      }
      const role = (session.user as { role?: string }).role ?? "";
      if (!role.split(",").map(r => r.trim()).includes("admin")) {
        return withHeaders(Response.json({ error: "Admin access required" }, { status: 403 }), request);
      }

      const params = url.searchParams;
      const { logs, nextCursor } = await queryAuditLogs(env.DB, {
        userId: params.get("userId") ?? undefined,
        orgId: params.get("orgId") ?? undefined,
        action: params.get("action") ?? undefined,
        before: params.get("before") ?? null,
        limit: params.get("limit") ? Number(params.get("limit")) : 50,
      });

      // Parse metadata back from JSON string before sending to client
      const parsed = logs.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }));

      return withHeaders(
        Response.json({ logs: parsed, nextCursor }),
        request
      );
    }

    // ── User detail (aggregate) ───────────────────────────────
    //
    // GET /api/admin/users/:userId
    //   Returns full user identity: user record, linked provider accounts,
    //   active session count, API key count, last 10 audit entries.
    //
    // Admin-only.
    const userDetailMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userDetailMatch && request.method === "GET") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return withHeaders(Response.json({ error: "Not authenticated" }, { status: 401 }), request);
      }
      const role = (session.user as { role?: string }).role ?? "";
      if (!role.split(",").map((r: string) => r.trim()).includes("admin")) {
        return withHeaders(Response.json({ error: "Admin access required" }, { status: 403 }), request);
      }

      const targetId = userDetailMatch[1];

      // 1. User record
      const user = await env.DB
        .prepare(`SELECT id, name, email, emailVerified, image, role, banned, banReason, banExpires, createdAt, updatedAt, username FROM "user" WHERE id = ? LIMIT 1`)
        .bind(targetId)
        .first<{
          id: string; name: string; email: string; emailVerified: number;
          image: string | null; role: string | null; banned: number;
          banReason: string | null; banExpires: number | null;
          createdAt: number; updatedAt: number; username: string | null;
        }>();
      if (!user) {
        return withHeaders(Response.json({ error: "User not found" }, { status: 404 }), request);
      }

      // 2. Linked accounts (OAuth providers + credential)
      const accounts = await env.DB
        .prepare(`SELECT id, providerId, accountId, createdAt FROM account WHERE userId = ? ORDER BY createdAt ASC`)
        .bind(targetId)
        .all<{ id: string; providerId: string; accountId: string; createdAt: number }>();

      // 3. Active session count (non-expired)
      const sessionsRow = await env.DB
        .prepare(`SELECT COUNT(*) as count FROM session WHERE userId = ? AND expiresAt > ?`)
        .bind(targetId, Date.now())
        .first<{ count: number }>();

      // 4. API key count (personal keys for this user)
      const apiKeyRow = await env.DB
        .prepare(`SELECT COUNT(*) as count FROM "apikey" WHERE userId = ? AND enabled = 1`)
        .bind(targetId)
        .first<{ count: number }>()
        .catch(() => ({ count: 0 })); // table may not exist yet

      // 5. Recent audit log entries for this user
      const { logs } = await queryAuditLogs(env.DB, { userId: targetId, limit: 10 });
      const recentActivity = logs.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }));

      return withHeaders(Response.json({
        user: {
          ...user,
          emailVerified: Boolean(user.emailVerified),
          banned: Boolean(user.banned),
        },
        accounts: accounts.results ?? [],
        sessionCount: sessionsRow?.count ?? 0,
        apiKeyCount: apiKeyRow?.count ?? 0,
        recentActivity,
      }), request);
    }

    // ── Enriched sessions list ────────────────────────────────
    //
    // GET /api/admin/sessions
    //   ?userId=   optional — filter to a single user's sessions
    //
    // Returns all non-expired sessions, each enriched with:
    //   - Parsed UA → deviceType, browser, os, label
    //   - Cloudflare geo → city, country, flag, location string
    //   - User name, email, image (joined from `user` table)
    //
    // Admin-only.
    if (url.pathname === "/api/admin/sessions" && request.method === "GET") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return withHeaders(Response.json({ error: "Not authenticated" }, { status: 401 }), request);
      }
      const role = (session.user as { role?: string }).role ?? "";
      if (!role.split(",").map(r => r.trim()).includes("admin")) {
        return withHeaders(Response.json({ error: "Admin access required" }, { status: 403 }), request);
      }

      const filterUserId = url.searchParams.get("userId");
      const nowMs = Date.now();

      // Pull all non-expired sessions (or single user's) with user info
      type RawSession = {
        id: string;
        userId: string;
        token: string;
        userAgent: string | null;
        ipAddress: string | null;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
        userName: string;
        userEmail: string;
        userImage: string | null;
      };

      let sessionsResult: D1Result<RawSession>;
      if (filterUserId) {
        sessionsResult = await env.DB
          .prepare(
            `SELECT s.id, s.userId, s.token, s.userAgent, s.ipAddress,
                    s.createdAt, s.updatedAt, s.expiresAt,
                    u.name as userName, u.email as userEmail, u.image as userImage
             FROM session s
             JOIN "user" u ON u.id = s.userId
             WHERE s.expiresAt > ? AND s.userId = ?
             ORDER BY s.updatedAt DESC`
          )
          .bind(nowMs, filterUserId)
          .all<RawSession>();
      } else {
        sessionsResult = await env.DB
          .prepare(
            `SELECT s.id, s.userId, s.token, s.userAgent, s.ipAddress,
                    s.createdAt, s.updatedAt, s.expiresAt,
                    u.name as userName, u.email as userEmail, u.image as userImage
             FROM session s
             JOIN "user" u ON u.id = s.userId
             WHERE s.expiresAt > ?
             ORDER BY s.updatedAt DESC
             LIMIT 500`
          )
          .bind(nowMs)
          .all<RawSession>();
      }

      const rawSessions = sessionsResult.results ?? [];

      // Current caller's session token — used for "This session" badge
      const callerToken = session.session.token;

      // Enrich each session row with UA parsing + CF geo
      // NOTE: CF properties are from the admin's own request — this gives us the
      // admin user's geo. Real per-session geo would require storing it at login time.
      // We store ipAddress already, so we use the stored IP display + live CF for admin.
      const geo = parseGeo(request.cf as IncomingRequestCfProperties | undefined);

      const enriched = rawSessions.map(s => {
        const device = parseDevice(s.userAgent);
        const isCurrent = s.token === callerToken;
        return {
          id: s.id,
          userId: s.userId,
          token: s.token,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          expiresAt: s.expiresAt,
          userName: s.userName,
          userEmail: s.userEmail,
          userImage: s.userImage,
          isCurrent,
          // Device info from UA parsing
          deviceType: device.deviceType,
          browser: device.browser,
          browserVersion: device.browserVersion,
          os: device.os,
          osVersion: device.osVersion,
          deviceLabel: device.label,
          // Geo from CF (live request geo — best effort)
          geoCity: geo.city,
          geoCountry: geo.country,
          geoLocation: geo.location,
          geoFlag: geo.flag,
        };
      });

      return withHeaders(Response.json({
        sessions: enriched,
        currentSessionToken: callerToken,
      }), request);
    }

    // ── Bulk revoke other sessions ──────────────────────────────
    //
    // POST /api/admin/sessions/revoke-all-others
    // Body: { exceptToken: string }
    //
    // Deletes all non-expired sessions whose token ≠ exceptToken.
    // Admin-only.
    if (url.pathname === "/api/admin/sessions/revoke-all-others" && request.method === "POST") {
      const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) {
        return withHeaders(Response.json({ error: "Not authenticated" }, { status: 401 }), request);
      }
      const role = (session.user as { role?: string }).role ?? "";
      if (!role.split(",").map(r => r.trim()).includes("admin")) {
        return withHeaders(Response.json({ error: "Admin access required" }, { status: 403 }), request);
      }

      let exceptToken: string;
      try {
        const body = await request.json() as { exceptToken?: string };
        exceptToken = body.exceptToken ?? session.session.token;
      } catch {
        exceptToken = session.session.token;
      }

      const nowMs = Date.now();
      const result = await env.DB
        .prepare(`DELETE FROM session WHERE token != ? AND expiresAt > ?`)
        .bind(exceptToken, nowMs)
        .run();

      // Audit log
      await logAudit(env.DB, {
        userId: session.user.id,
        actor: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email,
        action: "session.revokeAll",
        ipAddress: request.headers.get("CF-Connecting-IP"),
        userAgent: request.headers.get("User-Agent"),
        metadata: { revokedCount: result.meta?.changes ?? 0 },
      }).catch(() => { });

      return withHeaders(Response.json({
        success: true,
        revokedCount: result.meta?.changes ?? 0,
      }), request);
    }

    return withHeaders(new Response("Not found", { status: 404 }), request);

  },
} satisfies ExportedHandler<Env>;

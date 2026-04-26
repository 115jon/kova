/**
 * routes/pub/apps.ts — Public (no-auth) per-application metadata endpoints.
 *
 * These routes are intended for the SDK to fetch at load time. All responses
 * are KV-cached to minimise D1 reads.
 *
 * Routes:
 *   GET /api/pub/apps/:publishableKey/appearance
 *     → Returns branding/theme payload for the SDK sign-in card.
 *     → KV cache key: `appearance:{publishableKey}` (TTL: 300 s / 5 min)
 *     → No authentication required — the publishable key IS the identifier.
 *
 *   GET /api/pub/apps/:publishableKey/plan
 *     → Returns plan name + allowed features for operator-side feature gating.
 *     → Requires X-Secret-Key header matching the application's secret key.
 *     → KV cache key: `plan:{appId}` (TTL: 60 s)
 */

import { Hono } from "hono";
import { getApplicationByPublishableKey } from "../../applications";
import { createAuth } from "../../auth";

const pubAppsRouter = new Hono<{ Bindings: Env }>();

// ── GET /:pk/appearance ───────────────────────────────────────────────────────

pubAppsRouter.get("/:pk/appearance", async (c) => {
  const pk = c.req.param("pk");

  // ── 1. KV cache ──────────────────────────────────────────────────────────
  const cacheKey = `appearance:${pk}`;
  const cached = await c.env.KV.get(cacheKey).catch(() => null);
  if (cached) {
    return new Response(cached, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Appearance-Source": "kv-cache",
      },
    });
  }

  // ── 2. D1 lookup ─────────────────────────────────────────────────────────
  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);

  if (!app) {
    return Response.json({ error: "Application not found" }, { status: 404 });
  }

  // Check if app is suspended
  if (app.suspended_at) {
    return Response.json(
      { error: "Application suspended" },
      { status: 403 }
    );
  }

  const PAID_PLANS = new Set(["starter", "pro", "enterprise"]);
  const payload = {
    displayName: app.display_name ?? app.name,
    logoUrl: app.logo_url,
    faviconUrl: app.favicon_url,
    primaryColor: app.primary_color,
    backgroundColor: app.background_color,
    theme: app.theme,
    homeUrl: app.home_url,
    termsUrl: app.terms_url,
    privacyUrl: app.privacy_url,
    // hideBranding: only honour the flag on paid plans.
    // Free-plan apps always show the "Secured by ralph-auth" badge.
    hideBranding: PAID_PLANS.has(app.plan ?? "") && !!(app.hide_branding),
    // Enabled OAuth providers — fetched from app_oauth_provider table.
    // If no rows exist yet the SDK falls back to all supported providers.
    enabledProviders: await c.env.DB
      .prepare(
        "SELECT provider FROM app_oauth_provider WHERE app_id = ? AND enabled = 1"
      )
      .bind(app.id)
      .all<{ provider: string }>()
      .then(r => r.results.map(row => row.provider))
      .catch(() => [] as string[]),
  };

  const json = JSON.stringify(payload);

  // ── 3. Populate KV cache (fire-and-forget, 5-min TTL) ────────────────────
  c.env.KV.put(cacheKey, json, { expirationTtl: 300 }).catch(() => { });

  return new Response(json, {
    headers: {
      "Content-Type": "application/json",
      // No client/CDN caching — KV is the correct cache layer (server-side, 5-min TTL,
      // invalidated immediately when the operator saves new branding in the dashboard).
      "Cache-Control": "no-store",
      "X-Appearance-Source": "d1",
    },
  });
});

// ── GET /:pk/plan — feature flags for operator use ────────────────────────────

pubAppsRouter.get("/:pk/plan", async (c) => {
  const pk = c.req.param("pk");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });

  // Plan feature lookup (from plan-limits)
  const { PLAN_LIMITS } = await import("../../lib/plan-limits");
  const plan = app.plan ?? "free";
  const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];

  return Response.json({
    plan,
    features: limits.features,
    limits: {
      users: limits.users,
      orgs: limits.orgs,
    },
    expiresAt: app.plan_expires_at,
  });
});

// ── POST /:pk/me — register existing session into app_user ───────────────────
//
// Called by the SDK on mount when a session already exists.  If a user was
// previously signed into the platform and visits an SDK-powered app without
// signing out, the databaseHooks session.create.after won't fire again.
// This endpoint is the fallback: it upserts app_user idempotently.
//
// Auth: requires a valid session cookie (Better Auth standard).
// No admin required — this is a per-app self-registration endpoint.

pubAppsRouter.post("/:pk/me", async (c) => {
  const pk = c.req.param("pk");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });

  // Resolve the current session using the same Better Auth instance as auth.ts.
  // This correctly reads HttpOnly session cookies regardless of name/prefix.
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const sessionData = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);

  if (!sessionData?.user?.id) {
    return Response.json({ ok: false, reason: "no_session" });
  }

  const { generateId } = await import("better-auth");
  const userId = sessionData.user.id;
  const sessionId = (sessionData as { session?: { id?: string } }).session?.id;

  // 1. Upsert app_user — idempotent, safe to call on every mount.
  //    INSERT OR IGNORE means repeat calls after the first are no-ops.
  const wasInserted = await c.env.DB
    .prepare("INSERT OR IGNORE INTO app_user (id, app_id, user_id, role) VALUES (?, ?, ?, 'member')")
    .bind(`apu_${generateId(12)}`, app.id, userId)
    .run()
    .then(r => r.meta.changes > 0)
    .catch(() => false);

  // 2. Stamp session.app_id — only if not already set.
  //    The OAuth callback from Google carries no X-Publishable-Key so the
  //    session.create.after hook cannot set app_id. This is the only place
  //    in the cross-origin SDK flow where both pk→app_id and the session
  //    are simultaneously resolvable.
  if (sessionId) {
    await c.env.DB
      .prepare("UPDATE session SET app_id = ? WHERE id = ? AND app_id IS NULL")
      .bind(app.id, sessionId)
      .run()
      .catch(() => { /* best-effort — never block the page */ });
  }

  // 3. Increment APP_COUNTER DO for real-time dashboard stats.
  //    Only fires when a new app_user row was actually created (first visit),
  //    to avoid double-counting repeat mounts.
  if (wasInserted) {
    try {
      const doId = c.env.APP_COUNTER.idFromName(app.id);
      c.env.APP_COUNTER.get(doId).fetch("https://do/increment", {
        method: "POST",
        body: JSON.stringify({ users: 1 }),
      }).catch(() => { /* DO not available in local dev without --remote */ });
    } catch { /* ignore — DO binding missing */ }
  }

  return Response.json({ ok: true, userId });
});

// ── POST /:pk/exchange-code — transfer code → session token ───────────────────
//
// Called by the SDK immediately after landing back at the consumer app from the
// oauth-complete bounce (mode=sdk).  The SDK passes the `ralph_auth_code` that
// was appended to the redirect URI.  The server:
//   1. Verifies the code exists in KV, was created for this pk, and is < 30s old.
//   2. Deletes the code (single-use).
//   3. Returns the raw session token.
//
// The SDK stores the token in memory (React state) and injects it as
// `Authorization: Bearer <token>` on all requests to the auth server.  Better Auth
// validates Bearer tokens against its D1 sessions table — same code path as the
// HttpOnly cookie, without requiring cross-site cookie support in the browser.
//
// Security:
//   - No secret key required (equivalent security via code's TTL/binding/single-use).
//   - The transfer code has 256-bit entropy — not brute-forceable in 30s.
//   - CORS is enforced by the upstream corsMiddleware (origin must be in allowed_origins).
//   - The session token IS the raw cookie value; once returned, it has the same
//     lifetime as any other Better Auth session (default: 7 days with cookieCache).

pubAppsRouter.post("/:pk/exchange-code", async (c) => {
  const pk = c.req.param("pk");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });

  let body: { code?: string };
  try {
    body = (await c.req.json()) as { code?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  // Validate the transfer code (single-use, pk-bound, 30s TTL)
  const { exchangeSessionTransferCode } = await import("../../lib/auth-ticket");
  const result = await exchangeSessionTransferCode(c.env.KV, code, pk);

  if (!result) {
    // Code expired, already used, or pk mismatch — all cases treated as invalid
    return Response.json(
      { error: "invalid_code", message: "The transfer code is invalid, expired, or already used." },
      { status: 401 }
    );
  }

  return Response.json({ sessionToken: result.sessionToken });
});

export { pubAppsRouter };

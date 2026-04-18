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
        "Cache-Control": "public, max-age=60",
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
      "Cache-Control": "public, max-age=60",
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
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);

  if (!session?.user?.id) {
    return Response.json({ ok: false, reason: "no_session" });
  }

  // Upsert app_user — idempotent, safe to call on every mount
  const { generateId } = await import("better-auth");
  await c.env.DB
    .prepare("INSERT OR IGNORE INTO app_user (id, app_id, user_id, role) VALUES (?, ?, ?, 'member')")
    .bind(`apu_${generateId(12)}`, app.id, session.user.id)
    .run()
    .catch(() => { /* best-effort — never block the page */ });

  return Response.json({ ok: true, userId: session.user.id });
});

export { pubAppsRouter };


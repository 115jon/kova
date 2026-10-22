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
 *   GET /api/pub/apps/:publishableKey/redirect-check?redirect_uri=…
 *     → { allowed } for the sign-in page's up-front redirect check. Uncached.
 *
 *   POST /api/pub/apps/:publishableKey/device/{start,poll,cancel}
 *     → Device-code sign-in for desktop/CLI clients (see the section below).
 *
 *   POST /api/pub/apps/:publishableKey/device/{lookup,approve,deny,release}
 *     → Approval from the app's own page with an app-scoped bearer session.
 *
 *   GET /api/pub/apps/:publishableKey/plan
 *     → Returns plan name + allowed features for operator-side feature gating.
 *     → Requires X-Secret-Key header matching the application's secret key.
 *     → KV cache key: `plan:{appId}` (TTL: 60 s)
 */

import { Hono } from "hono";
import type { KVNamespace } from "@cloudflare/workers-types";
import { deviceVerificationUris, getApplicationByPublishableKey, isRedirectUriAllowed, publishableKeysOf } from "../../applications";
import { createAuth } from "../../auth";
import { rejectDisallowedOrigin } from "../../lib/app-origin";
import { resolveAppScopedSession, sessionMayActForApp } from "../../lib/app-session";
import { deviceErrorCode } from "../../lib/device-authorization";
import { DEVICE_CODE_INTERVAL_SECONDS, formatUserCode, hostedVerificationUri } from "../../lib/device-code";
import { consumeRateLimit, requestIp } from "../../lib/rate-limit";
import { hostedProviders } from "../../lib/hosted-providers";
import { jsonForHtmlScript } from "../../lib/html";
import { approveDeviceRequest, denyDeviceRequest, lookupDeviceRequest, releaseDeviceRequest } from "./device-approval";

const pubAppsRouter = new Hono<{ Bindings: Env }>();
const DEFAULT_ENABLED_PROVIDERS = ["google", "github", "discord", "microsoft"] as const;

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

  const enabledProviderRows = await c.env.DB
    .prepare("SELECT provider, enabled FROM app_oauth_provider WHERE app_id = ?")
    .bind(app.id)
    .all<{ provider: string; enabled: number }>()
    .then(r => r.results)
    .catch(() => [] as { provider: string; enabled: number }[]);
  const enabledProviders = enabledProviderRows.length > 0
    ? enabledProviderRows.filter(row => row.enabled).map(row => row.provider)
    : [...DEFAULT_ENABLED_PROVIDERS];

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
    // The admin dashboard enforces plan/admin policy before persisting this flag.
    // Public consumers should reflect the saved application setting exactly.
    hideBranding: !!(app.hide_branding),
    // Enabled OAuth providers, matching the admin dashboard's no-rows default.
    // Apple/Facebook stay off until explicitly enabled after credentials exist.
    enabledProviders,
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

// ── GET /:pk/redirect-check — validate a sign-in return URL up front ─────────
//
// The main-domain /sign-in?pk=… page calls this before showing the form, so a
// bad redirect_url fails on the first screen instead of after the user signs
// in. handleSdkBounce still re-validates; this is not the security boundary.

pubAppsRouter.get("/:pk/redirect-check", async (c) => {
  const app = await getApplicationByPublishableKey(c.env.DB, c.req.param("pk")).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });
  const redirectUri = c.req.query("redirect_uri") ?? "";
  return Response.json(
    { allowed: !!redirectUri && isRedirectUriAllowed(app, redirectUri) },
    { headers: { "Cache-Control": "no-store" } },
  );
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

pubAppsRouter.get("/:pk/oauth/start", async (c) => {
  const pk = c.req.param("pk");
  const provider = c.req.query("provider") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const errorCallbackURL = c.req.query("error_callback_url") || redirectUri;
  const state = c.req.query("state") ?? "";
  if (state && !/^[A-Za-z0-9._~-]{1,256}$/.test(state)) {
    return Response.json({ error: "invalid_state" }, { status: 400 });
  }

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });
  if (!provider) return Response.json({ error: "provider is required" }, { status: 400 });
  if (!redirectUri || !isRedirectUriAllowed(app, redirectUri)) {
    return Response.json({ error: "redirect_uri_not_allowed" }, { status: 400 });
  }
  if (!isRedirectUriAllowed(app, errorCallbackURL)) {
    return Response.json({ error: "error_callback_url_not_allowed" }, { status: 400 });
  }
  // The sign-in UI hides disabled providers, but this URL is directly callable.
  try {
    const providers = await hostedProviders(c.env, app.id);
    if (!providers.some(available => available === provider)) {
      return Response.json({ error: "provider_unavailable" }, { status: 403 });
    }
  } catch {
    return Response.json({ error: "providers_unavailable" }, { status: 503 });
  }

  const authOrigin = new URL(c.req.url).origin;
  const bounceUrl = new URL(`${authOrigin}/api/hosted/oauth-complete`);
  bounceUrl.searchParams.set("mode", "sdk");
  bounceUrl.searchParams.set("pk", pk);
  bounceUrl.searchParams.set("redirect_uri", redirectUri);
  if (state) bounceUrl.searchParams.set("state", state);

  const body = JSON.stringify({
    provider,
    callbackURL: bounceUrl.toString(),
  });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Redirecting...</title>
</head>
<body>
  <script>
    (async () => {
      try {
        const response = await fetch("/api/auth/sign-in/social", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-publishable-key": ${jsonForHtmlScript(pk)},
            "x-kova-auth-sdk": "kova-react"
          },
          body: ${jsonForHtmlScript(body)}
        });
        const data = await response.json();
        if (!response.ok || !data?.url) throw new Error(data?.message || data?.error || "OAuth start failed");
        window.location.replace(data.url);
      } catch (error) {
        const target = new URL(${jsonForHtmlScript(errorCallbackURL)});
        target.searchParams.set("kova_auth_error", "OAUTH_START_FAILED");
        const state = ${jsonForHtmlScript(state)};
        if (state) target.searchParams.set("state", state);
        window.location.replace(target.toString());
      }
    })();
  </script>
</body>
</html>`;

  return c.html(html);
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
  const disallowed = rejectDisallowedOrigin(c.env, app, c.req.header("Origin"));
  if (disallowed) return disallowed;

  // Resolve the current session using the same Better Auth instance as auth.ts.
  // This correctly reads HttpOnly session cookies regardless of name/prefix.
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const sessionData = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);

  if (!sessionData?.user?.id) {
    return Response.json({ ok: false, reason: "no_session" });
  }
  const meSessionId = sessionData.session?.id;
  if (!meSessionId || !(await sessionMayActForApp(c.env.DB, meSessionId, app.id))) {
    return Response.json({ ok: false, reason: "no_session" });
  }

  const { generateId } = await import("better-auth");
  const userId = sessionData.user.id;

  // 1. Upsert app_user — idempotent, safe to call on every mount.
  //    INSERT OR IGNORE means repeat calls after the first are no-ops.
  //    Do not stamp app_id onto the auth-domain cookie session. That cookie
  //    is SSO; apps mint a sibling bearer row in /session-token instead.
  const wasInserted = await c.env.DB
    .prepare("INSERT OR IGNORE INTO app_user (id, app_id, user_id, role) VALUES (?, ?, ?, 'member')")
    .bind(`apu_${generateId(12)}`, app.id, userId)
    .run()
    .then(r => r.meta.changes > 0)
    .catch(() => false);

  // Increment APP_COUNTER DO for real-time dashboard stats.
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

// ── POST /:pk/session-token — mint bearer bootstrap for an existing session ──
//
// Direct visits to an SDK-powered app may arrive with only the auth-domain
// SSO cookie. Mint a sibling app-scoped session and return its raw token.
// Never stamp app_id onto the cookie row — that locks the dashboard out.
//
// Auth: requires a valid Better Auth session cookie or bearer token.
// CORS: enforced by upstream cors middleware against the app's allowed origins.

pubAppsRouter.post("/:pk/session-token", async (c) => {
  const pk = c.req.param("pk");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });
  const disallowed = rejectDisallowedOrigin(c.env, app, c.req.header("Origin"));
  if (disallowed) return disallowed;

  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const sessionData = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  if (!sessionData?.user?.id || !sessionData?.session) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await sessionMayActForApp(c.env.DB, sessionData.session.id, app.id))) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { generateId } = await import("better-auth");
  await c.env.DB
    .prepare("INSERT OR IGNORE INTO app_user (id, app_id, user_id, role) VALUES (?, ?, ?, 'member')")
    .bind(`apu_${generateId(12)}`, app.id, sessionData.user.id)
    .run()
    .catch(() => { /* best-effort */ });

  const appSession = await resolveAppScopedSession(c.env.DB, {
    userId: sessionData.user.id,
    appId: app.id,
    ipAddress: c.req.header("CF-Connecting-IP") ?? null,
    userAgent: c.req.header("User-Agent") ?? null,
  });

  return Response.json({ sessionToken: appSession.token });
});

// ── POST /:pk/revoke-session — revoke the current app-scoped bearer session ──
//
// SDK apps use bearer sessions so sign-out can be isolated from the platform
// dashboard session. Better Auth's multi-session revoke endpoint only revokes
// signed multi-session cookies, so bearer sessions need this app-scoped path.
pubAppsRouter.post("/:pk/revoke-session", async (c) => {
  const pk = c.req.param("pk");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });
  if (app.suspended_at) return Response.json({ error: "Application suspended" }, { status: 403 });

  const bearerToken = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) {
    await c.env.DB
      .prepare("DELETE FROM session WHERE token = ? AND app_id = ?")
      .bind(bearerToken, app.id)
      .run()
      .catch(() => { });

    return Response.json({ ok: true });
  }

  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const sessionData = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const sessionId = (sessionData?.session as unknown as Record<string, unknown> | undefined)?.["id"];
  const sessionToken = (sessionData?.session as unknown as Record<string, unknown> | undefined)?.["token"];

  if (typeof sessionId !== "string" || typeof sessionToken !== "string") {
    return Response.json({ ok: true });
  }

  const row = await c.env.DB
    .prepare("SELECT app_id FROM session WHERE id = ? LIMIT 1")
    .bind(sessionId)
    .first<{ app_id: string | null }>()
    .catch(() => null);

  if (row?.app_id !== app.id) {
    return Response.json({ ok: true });
  }

  await c.env.DB
    .prepare("DELETE FROM session WHERE id = ? AND token = ? AND app_id = ?")
    .bind(sessionId, sessionToken, app.id)
    .run()
    .catch(() => { });

  return Response.json({ ok: true });
});

// ── POST /:pk/exchange-code — transfer code → session token ───────────────────
//
// Called by the SDK immediately after landing back at the consumer app from the
// oauth-complete bounce (mode=sdk).  The SDK passes the `kova_auth_code` that
// was appended to the redirect URI.  The server:
//   1. Verifies the code exists in KV, was created for this pk, and is < 60s old.
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
//   - The transfer code has 256-bit entropy — not brute-forceable in 60s.
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

  // Validate the transfer code (single-use, pk-bound, 60s TTL)
  const { exchangeSessionTransferCode } = await import("../../lib/auth-ticket");
  const result = await exchangeSessionTransferCode(
    c.env.KV,
    code,
    // Either key of the app: the code may have been minted under the other one.
    publishableKeysOf(app),
    c.req.header("Origin") ?? null,
  );

  if (!result) {
    // Code expired, already used, or pk mismatch — all cases treated as invalid
    return Response.json(
      { error: "invalid_code", message: "The transfer code is invalid, expired, or already used." },
      { status: 401 }
    );
  }

  return Response.json({ sessionToken: result.sessionToken });
});

// ── Device-code sign-in (public client) ───────────────────────────────────────
//
// Thin wrappers over Better Auth's device-authorization plugin that keep the
// camelCase contract the Ralph Meet desktop client and Zeron already speak.
// The device polls with the high-entropy device code; the user code is only
// for the hosted approval page, so it is never accepted as a poll secret.
//
//   POST /:pk/device/start   {hostname?, platform?, label?}
//     201 {deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn}
//   POST /:pk/device/poll    {deviceCode}
//     200 {status:"pending", interval} | 429 {error:"slow_down", interval}
//     200 {status:"denied"} | 200 {status:"approved", sessionToken}
//     400 {error:"expired_token" | "invalid_device_code"} | 403 {error:"mfa_required"}
//   POST /:pk/device/cancel  {deviceCode}  → 204, best effort
//
// The session is minted at the approved poll and nowhere else.

const DEVICE_START_LIMIT = { windowSeconds: 600, max: 20 };

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cfText(cf: unknown, key: "country" | "city"): string | undefined {
  const value = (cf as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value ? value : undefined;
}

pubAppsRouter.post("/:pk/device/start", async (c) => {
  const pk = c.req.param("pk");
  c.header("Cache-Control", "no-store");
  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return c.json({ error: "Application not found" }, 404);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);
  // The app's own approval page when it has one, else the hosted /device page.
  const verificationUri = app.device_verification_uri ?? hostedVerificationUri(c.env.AUTH_URL, app.auth_slug);
  if (!verificationUri) return c.json({ error: "device_flow_unavailable" }, 409);

  const ip = requestIp(c.req.raw);
  // Fails closed: issuing codes unthrottled is worse than a brief outage.
  const limit = await consumeRateLimit(c.env.DB, `device-start:${ip ?? "unknown"}:${app.publishable_key}`, DEVICE_START_LIMIT)
    .catch(() => null);
  if (!limit) return c.json({ error: "temporarily_unavailable" }, 503);
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json({ error: "rate_limited" }, 429);
  }

  const body = jsonObject(await c.req.json().catch(() => ({}))) ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const cf = c.req.raw.cf;
  const auth = createAuth(c.env, cf as IncomingRequestCfProperties | undefined);

  // Codes nobody polled to the end are never claimed or deleted by the
  // plugin. Sweep expired ones here, off the response path.
  const sweep = (async () => {
    const context = await auth.$context;
    await context.adapter.deleteMany({ model: "deviceCode", where: [{ field: "expiresAt", operator: "lt", value: new Date() }] });
  })().catch((error) => console.error("[kova-auth] expired device code sweep failed", error));
  try {
    c.executionCtx.waitUntil(sweep);
  } catch {
    // No execution context (tests, local tools): the sweep still runs.
  }

  try {
    // No `request` here: the grant refuses issuance from an HTTP request,
    // which is what keeps /api/auth/device/code closed to direct callers.
    const issued = await auth.api.deviceCode({
      body: {
        client_id: app.publishable_key,
        hostname: text(body.hostname),
        platform: text(body.platform),
        label: text(body.label),
        requester_ip: ip ?? undefined,
        requester_country: cfText(cf, "country"),
        requester_city: cfText(cf, "city"),
      },
    });
    const userCode = formatUserCode(issued.user_code);
    return c.json({
      deviceCode: issued.device_code,
      userCode,
      ...deviceVerificationUris(verificationUri, userCode),
      interval: issued.interval,
      expiresIn: issued.expires_in,
    }, 201);
  } catch (error) {
    if (deviceErrorCode(error) === "invalid_client") return c.json({ error: "device_flow_unavailable" }, 409);
    if (deviceErrorCode(error) === "invalid_request") return c.json({ error: "invalid_request" }, 400);
    console.error("[kova-auth] device start failed", error);
    return c.json({ error: "server_error" }, 500);
  }
});

pubAppsRouter.post("/:pk/device/poll", async (c) => {
  const pk = c.req.param("pk");
  c.header("Cache-Control", "no-store");

  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app || app.suspended_at) return c.json({ error: "invalid_device_code" }, 400);

  const body = jsonObject(await c.req.json().catch(() => null));
  if (!body || typeof body.deviceCode !== "string" || !body.deviceCode.trim() || "userCode" in body) {
    return c.json({ error: "invalid_device_code" }, 400);
  }

  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  try {
    const { sessionToken } = await auth.api.kovaRedeemDeviceCode({
      body: {
        deviceCode: body.deviceCode.trim(),
        // By app, not key: a code started under a promoted app's legacy key
        // still redeems with the new key, and the reverse.
        appId: app.id,
        ipAddress: requestIp(c.req.raw),
        userAgent: c.req.header("User-Agent") ?? null,
      },
    });
    return c.json({ status: "approved", sessionToken });
  } catch (error) {
    switch (deviceErrorCode(error)) {
      case "authorization_pending":
        return c.json({ status: "pending", interval: DEVICE_CODE_INTERVAL_SECONDS });
      case "slow_down":
        return c.json({ error: "slow_down", interval: DEVICE_CODE_INTERVAL_SECONDS }, 429);
      case "access_denied":
        return c.json({ status: "denied" });
      case "expired_token":
        return c.json({ error: "expired_token" }, 400);
      case "invalid_grant":
        // Unknown, another app's, or already redeemed: never a second success.
        return c.json({ error: "invalid_device_code" }, 400);
      case "mfa_required":
        return c.json({ error: "mfa_required" }, 403);
      default:
        console.error("[kova-auth] device poll failed", error);
        return c.json({ error: "server_error" }, 500);
    }
  }
});

pubAppsRouter.post("/:pk/device/cancel", async (c) => {
  const pk = c.req.param("pk");
  c.header("Cache-Control", "no-store");
  const body = jsonObject(await c.req.json().catch(() => null));
  const deviceCode = typeof body?.deviceCode === "string" ? body.deviceCode.trim() : "";
  const app = deviceCode ? await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null) : null;
  if (deviceCode && app) {
    // Only this app's codes that nobody redeemed yet; a redeemed code is
    // already gone. Denied/expired rows go too, they are dead either way.
    // Matched by app id so either of a promoted app's keys can cancel.
    await c.env.DB
      .prepare(`DELETE FROM "deviceCode" WHERE "deviceCode" = ? AND "appId" = ?`)
      .bind(deviceCode, app.id)
      .run()
      .catch(() => { /* best effort */ });
  }
  return c.body(null, 204);
});

// ── Device approval from the app's own page (device_verification_uri) ─────────
// App-scoped bearer session, the app's own web origin; see ./device-approval.ts.

pubAppsRouter.post("/:pk/device/lookup", lookupDeviceRequest);
pubAppsRouter.post("/:pk/device/approve", approveDeviceRequest);
pubAppsRouter.post("/:pk/device/deny", denyDeviceRequest);
pubAppsRouter.post("/:pk/device/release", releaseDeviceRequest);

export { pubAppsRouter };

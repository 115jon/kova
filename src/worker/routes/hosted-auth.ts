/**
 * hosted-auth.ts — Hono router for per-app isolated auth subdomains.
 *
 * Handles all requests arriving on {slug}.auth.115jon.site (and custom domains).
 * The HostedAppContext is pre-populated by the subdomain dispatch middleware in index.ts
 * and passed through by forwarding the raw request — the `hostedApp` value is accessed
 * from the Hono context variable at the handler level.
 *
 * ## Route overview
 *
 *   GET  / , /sign-in, /sign-up            → 302 to {AUTH_URL}/sign-in (or /sign-up)?pk=…&redirect_url=…
 *                                            (device_return sign-in still renders here)
 *   ALL  /api/auth/*                       → Proxied to Better Auth (subdomain-scoped session)
 *   POST /api/hosted/create-ticket         → Issues short-lived auth code after sign-in
 *   POST /api/hosted/exchange-ticket       → Exchanges code for userId (requires sk_*)
 *   GET  /device                           → Device-code approval (manual entry or ?code=)
 *   ALL  /api/auth/device*                 → Better Auth verify/approve/deny, behind device-host-guard
 *   POST /api/hosted/device/release        → Drop this account's claim on a pending code
 *   *    (catch-all)                       → Branded 404
 *
 * ## Session isolation
 *
 * We call createAuth() with baseURL = `https://{host}` for every auth API request.
 * Because Better Auth does NOT set a Domain= attribute by default, cookies are scoped
 * to the exact subdomain hostname (RFC 6265 §5.2). No bleeding to parent or siblings.
 *
 * IMPORTANT: Never set advanced.crossSubDomainCookies on hosted-auth Auth instances.
 */

import { Context, Hono } from "hono";
import { generateCookie, generateSignedCookie } from "hono/cookie";
import { parseCookies } from "better-auth/cookies";
import type { KVNamespace } from "@cloudflare/workers-types";
import { type Application, isRedirectUriAllowed, validateSecretKey } from "../applications";
import { createAuth } from "../auth";
import { rejectDisallowedOrigin } from "../lib/app-origin";
import { APP_SESSION_TTL_MS, insertAppScopedSession, sessionMayActForApp } from "../lib/app-session";
import { createAuthTicket, createSessionTransferCode, exchangeAuthTicket } from "../lib/auth-ticket";
import { isSafeDeviceReturnPath } from "../lib/device-code";
import { guardHostedDeviceRequest, isDeviceAuthPath } from "../lib/device-host-guard";
import { escapeHtml, jsonForHtmlScript } from "../lib/html";
import { hostedProviders } from "../lib/hosted-providers";
import { isPlatformOnlyAuthPath, rejectAppScopedSession } from "../lib/platform-session";
import { appSignInUrl } from "../lib/sign-in-url";
import { RALPH_RADIO_SVG, resolveHostedAppearance, type HostedProvider } from "../../shared/hosted-brand";
import { findMFAEnforcedOrgBlockingUser } from "../org-settings";
import { devicePageApp, devicePageResponse, loadDevicePage, NO_FRAMING_HEADERS, releaseDeviceClaim } from "./hosted-device";
import { encodeOAuthCtx, oauthStartUsesSdkBounce } from "./oauth-bounce";

// ── Router ─────────────────────────────────────────────────────────────────────

type HEnv = { Bindings: Env & { ASSETS: Fetcher } };
type HC = Context<HEnv>;
export const hostedAuthRouter = new Hono<HEnv>();

// ── Context helpers ────────────────────────────────────────────────────────────

/** Retrieves the Application set by the subdomain middleware in index.ts.
 * The middleware stashes the resolved app on `c.env.__hostedApp` (env is the
 * same object reference passed to both the parent and the child router).
 */
function getApp(c: HC): Application {
  const raw = (c.env as unknown as Record<string, unknown>)["__hostedApp"] as
    | { app: Application }
    | undefined;
  if (!raw) throw new Error("[hosted-auth] __hostedApp not set — subdomain middleware did not run");
  return raw.app;
}

function getHost(c: HC): string {
  return c.req.header("Host") ?? "";
}

const esc = escapeHtml;

// ── HTML template ──────────────────────────────────────────────────────────────

type HostedPageMode = "sign-in" | "sign-up";

/**
 * Generates the branded hosted auth page HTML shell.
 *
 * The page relies on `window.__KOVA_AUTH_HOSTED__` being consumed by the
 * JS bundle served from Workers Assets (`/assets/hosted-auth.js`, built by
 * vite.hosted.config.ts from src/web/hosted/hosted-auth.ts).
 */
async function buildHostedPage(opts: {
  app: Application;
  mode: HostedPageMode;
  redirectUri: string;
  state: string;
  authUrl: string;       // subdomain URL — used for non-OAuth auth endpoints
  mainAuthUrl: string;   // main platform URL — used for OAuth provider initiation
  signingSecret: string;
  returnPath?: string;
  enabledProviders: HostedProvider[];
}): Promise<string> {
  const { app, mode, redirectUri, state, authUrl, mainAuthUrl } = opts;
  const title = mode === "sign-in"
    ? `Sign in to ${esc(app.display_name ?? app.name)}`
    : `Create account — ${esc(app.display_name ?? app.name)}`;

  const appearance = resolveHostedAppearance(app.publishable_key, {
    primaryColor: app.primary_color ?? "#3b82f6",
    backgroundColor: app.background_color ?? "#0a0a0a",
    theme: app.theme ?? "dark",
    logoUrl: app.logo_url ?? null,
    faviconUrl: app.favicon_url ?? null,
  });
  const bootstrap = jsonForHtmlScript({
    publishableKey: app.publishable_key,
    // authUrl: subdomain — for session reading, sign-out, etc.
    authUrl,
    // mainAuthUrl: main platform domain — OAuth provider flows ONLY go through
    // this URL. Only ONE callback URL per provider needs to be registered in
    // Google/Discord/GitHub Console, regardless of how many apps exist.
    mainAuthUrl,
    redirectUri,
    state,
    ...(isSafeDeviceReturnPath(opts.returnPath) ? { returnPath: opts.returnPath } : {}),
    mode: app.environment === "production" ? "live" : "test",
    page: mode,
    appearance,
    enabledProviders: opts.enabledProviders,
    app: {
      id: app.id,
      name: app.display_name ?? app.name,
      // Device sign-in has no ticket redirect. The current hosted bundle sends
      // an empty redirectUri to homeUrl, so that value is the same-origin
      // /device return. A rebuilt bundle prefers returnPath and skips the ticket.
      homeUrl: isSafeDeviceReturnPath(opts.returnPath) ? opts.returnPath : (app.home_url ?? null),
      termsUrl: app.terms_url ?? null,
      privacyUrl: app.privacy_url ?? null,
    },
    hideBranding: app.hide_branding ?? false,
    // oauthCtx: pre-encoded bounce context to embed in the OAuth callbackURL.
    // The hosted UI appends this to the mainAuthUrl sign-in link so the
    // central OAuth bounce handler knows which app to redirect back to.
    oauthCtx: await encodeOAuthCtx({
      slug: app.auth_slug ?? "",
      appId: app.id,
      redirect_uri: redirectUri,
      state,
      ...(isSafeDeviceReturnPath(opts.returnPath) ? { returnPath: opts.returnPath } : {}),
    }, opts.signingSecret),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="robots" content="noindex" />
  ${app.favicon_url ? `<link rel="icon" href="${esc(app.favicon_url)}" />` : ""}
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&display=swap" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      display: flex; min-height: 100svh;
      align-items: center; justify-content: center;
      background: ${esc(appearance.backgroundColor)};
      font-family: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    #root { width: 100%; max-width: 400px; padding: 24px 16px; }
    .ra-skeleton {
      background: rgba(255,255,255,0.05); border-radius: 20px; min-height: 420px;
      border: 1px solid rgba(255,255,255,0.10);
      display: flex; align-items: center; justify-content: center;
      text-align: center; color: #8a9090; font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="root"><div class="ra-skeleton">Loading&hellip;</div></div>
  <script>window.__KOVA_AUTH_HOSTED__ = ${bootstrap};</script>
  <script type="module" src="/assets/hosted-auth.js" onerror="
    document.getElementById('root').innerHTML =
      '<div class=ra-skeleton style=color:#ff6b6b>Couldn\u2019t load sign-in. Refresh to try again.</div>';
  "></script>
</body>
</html>`;
}

// ── GET / , /sign-in, /sign-up ─────────────────────────────────────────────────
//
// The per-app host is a short alias for the app's branded sign-in page on the
// main auth domain, so there is one sign-in UI to brand and maintain. It accepts
// `redirect_uri` (the original hosted name) or `redirect_url`, and forwards
// `state`. Device approval is the exception: its session cookie must be scoped
// to this host, so a `device_return` sign-in still renders here.

async function hostedSignIn(c: HC, mode: HostedPageMode): Promise<Response> {
  const app = getApp(c);
  if (app.suspended_at) return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);

  const deviceReturn = c.req.query("device_return");
  if (isSafeDeviceReturnPath(deviceReturn)) {
    const enabledProviders = await hostedProviders(c.env, app.id).catch(() => null);
    if (!enabledProviders) return c.html(hostedMessagePage(app, "Sign-in providers could not be loaded. Please try again."), 503);
    const host = getHost(c);
    for (const [name, value] of Object.entries(NO_FRAMING_HEADERS)) c.header(name, value);
    return c.html(await buildHostedPage({
      app, mode, redirectUri: "", state: "", returnPath: deviceReturn,
      enabledProviders,
      authUrl: `https://${host}`,
      mainAuthUrl: c.env.AUTH_URL,
      signingSecret: c.env.BETTER_AUTH_SECRET,
    }));
  }

  const redirectUri = c.req.query("redirect_uri") ?? c.req.query("redirect_url") ?? "";
  if (redirectUri && !isRedirectUriAllowed(app, redirectUri)) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">Invalid redirect_uri — not in allowlist.</p>`,
      403
    );
  }

  return c.redirect(
    appSignInUrl(c.env.AUTH_URL, app.publishable_key, redirectUri || undefined, c.req.query("state") || undefined, mode),
    302,
  );
}

hostedAuthRouter.get("/", (c) => hostedSignIn(c, "sign-in"));
hostedAuthRouter.get("/sign-in", (c) => hostedSignIn(c, "sign-in"));
hostedAuthRouter.get("/sign-up", (c) => hostedSignIn(c, "sign-up"));

// ── ALL /api/auth/* — Better Auth proxy ────────────────────────────────────────
//
// Creates a Better Auth instance scoped to this subdomain (baseURL = subdomain URL).
// Session cookies will be issued without a Domain= attribute and thus bound to the
// exact subdomain hostname by the browser (RFC 6265 §5.2).

hostedAuthRouter.all("/api/auth/*", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);
  if (isPlatformOnlyAuthPath(new URL(c.req.url).pathname)) {
    const rejection = await rejectAppScopedSession(c.env.DB, c.req.raw.headers);
    if (rejection) return rejection;
  }
  const host = getHost(c);
  const subdomainUrl = `https://${host}`;
  if (isDeviceAuthPath(new URL(c.req.url).pathname)) {
    const refused = await guardHostedDeviceRequest({ request: c.req.raw, db: c.env.DB, appId: app.id, hostOrigin: subdomainUrl });
    if (refused) return refused;
  }
  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw,
    subdomainUrl
  );
  return auth.handler(c.req.raw);
});

// ── POST /api/hosted/create-ticket ────────────────────────────────────────────
//
// Called by the hosted page JS after a successful sign-in to initiate the redirect
// flow. Requires a valid subdomain session cookie.

hostedAuthRouter.post("/api/hosted/create-ticket", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);
  const host = getHost(c);
  const subdomainUrl = `https://${host}`;

  // The hosted page posts from this host. Another app's origin must not be able
  // to mint a ticket for this one from a session it can reach.
  const disallowed = rejectDisallowedOrigin(c.env, app, c.req.header("Origin"), subdomainUrl);
  if (disallowed) return disallowed;

  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw,
    subdomainUrl
  );

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !session?.session) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  if (!(await sessionMayActForApp(c.env.DB, session.session.id, app.id))) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const rawBody = await c.req.json().catch(() => null);
  const redirectUri: string = (rawBody as Record<string, unknown>)?.redirect_uri as string ?? "";
  const state: string = (rawBody as Record<string, unknown>)?.state as string ?? "";

  if (redirectUri && !isRedirectUriAllowed(app, redirectUri)) {
    return c.json({ error: "redirect_uri not in allowlist" }, 403);
  }

  // Custom-scheme clients (mira://auth) exchange an xfr_ session-transfer code
  // at the public API, same as the Google SDK bounce. HTTP(S) apps keep the
  // ticket_ hop, which their backend redeems with a secret key. The app-level
  // state nonce is echoed back; it is not Better Auth's OAuth state.
  if (oauthStartUsesSdkBounce(redirectUri)) {
    const { generateId } = await import("better-auth");
    const appSessionToken = generateId(32);
    const appSessionId = generateId();
    await insertAppScopedSession(c.env.DB, {
      sessionId: appSessionId,
      userId: session.user.id,
      token: appSessionToken,
      appId: app.id,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null,
      userAgent: c.req.header("User-Agent") ?? null,
    });
    const code = await createSessionTransferCode(
      c.env.KV,
      appSessionToken,
      app.publishable_key,
      new URL(redirectUri).origin,
    );
    return c.json({ code, kova_auth_code: code, state });
  }

  const code = await createAuthTicket(c.env.KV, {
    userId: session.user.id,
    sessionId: session.session.id,
    appId: app.id,
    redirectUri,
  });

  return c.json({ code, state });
});

// ── POST /api/hosted/exchange-ticket ──────────────────────────────────────────
//
// Server-to-server: app backend exchanges a ticket code for the user's ID.
// Requires Bearer {sk_dev_*} authentication.

hostedAuthRouter.post("/api/hosted/exchange-ticket", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);

  const authHeader = c.req.header("Authorization") ?? "";
  const secretKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!secretKey) return c.json({ error: "Missing Authorization header" }, 401);

  const isValid = await validateSecretKey(c.env.DB, app.id, secretKey, c.env.BETTER_AUTH_SECRET);
  if (!isValid) return c.json({ error: "Invalid secret key" }, 403);

  const rawBody = await c.req.json().catch(() => null);
  const code: string = (rawBody as Record<string, unknown>)?.code as string ?? "";
  const redirectUri: string = (rawBody as Record<string, unknown>)?.redirect_uri as string ?? "";

  if (!code) return c.json({ error: "Missing code" }, 400);

  const result = await exchangeAuthTicket(c.env.KV, code, app.id, redirectUri);
  if (!result) return c.json({ error: "Invalid or expired ticket" }, 400);

  return c.json({
    userId: result.userId,
    sessionId: result.sessionId,
  });
});

// ── GET /oauth-complete — Central OAuth bounce receiver ───────────────────────
//
// The browser lands here after winning the central OAuth bounce from the main
// auth domain (see routes/oauth-bounce.ts). Steps:
//
//   1. Exchange the ticket → get userId + sessionId (from main-domain OAuth)
//   2. Mint an app session and sign the exact-host cookie using auth.$context.
//   3. Return to the ticket-bound device path, allowed redirect, or app home.

hostedAuthRouter.get("/oauth-complete", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);
  const host = getHost(c);
  const subdomainUrl = `https://${host}`;

  const ticket = c.req.query("ticket") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const state = c.req.query("state") ?? "";
  const returnPath = c.req.query("returnPath");

  if ((returnPath !== undefined && (!isSafeDeviceReturnPath(returnPath) || redirectUri !== ""))
    || (redirectUri && !isRedirectUriAllowed(app, redirectUri))) {
    return c.html(hostedMessagePage(app, "OAuth complete failed: invalid destination."), 400);
  }

  if (!ticket) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth complete failed: missing ticket.</p>`,
      400
    );
  }

  // Exchange the bounce ticket (issued by oauth-bounce.ts on the main domain)
  const ticketResult = await exchangeAuthTicket(c.env.KV, ticket, app.id, returnPath ?? redirectUri);
  if (!ticketResult) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth complete failed: ticket expired or invalid. Please sign in again.</p>`,
      400
    );
  }

  const blockingOrgId = await findMFAEnforcedOrgBlockingUser(c.env.DB, ticketResult.userId).catch(() => null);
  if (blockingOrgId) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">Your organization requires two-factor authentication. Enable 2FA before signing in.</p>`,
      403
    );
  }

  // Create a Better Auth instance scoped to this subdomain so the session
  // cookie is set on exactly this hostname (no Domain= attribute → RFC 6265 §5.2).
  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw,
    subdomainUrl
  );

  const responseHeaders = new Headers();
  try {
    const context = await auth.$context;
    const attributes = {
      ...context.authCookies.sessionToken.attributes,
      domain: undefined,
      httpOnly: true,
      secure: true,
      maxAge: Math.floor(APP_SESSION_TTL_MS / 1000),
    };
    const { generateId } = await import("better-auth");
    const sessionId = generateId();
    const sessionToken = generateId(32);
    await insertAppScopedSession(c.env.DB, {
      sessionId,
      userId: ticketResult.userId,
      token: sessionToken,
      appId: app.id,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null,
      userAgent: c.req.header("User-Agent") ?? null,
    });

    // Better Auth (1.6 and 1.7) uses token.base64(HMAC-SHA256(token)). Hono's signed
    // serializer uses the same format; the name/attributes come from Better Auth.
    responseHeaders.append("Set-Cookie", await generateSignedCookie(
      context.authCookies.sessionToken.name, sessionToken, context.secret, attributes,
    ));
    // A previous cached session may describe another user. Expire it and its
    // chunks so getSession reads the newly minted session from storage.
    const cache = context.authCookies.sessionData;
    const cacheNames = new Set([cache.name]);
    for (const name of parseCookies(c.req.header("cookie") ?? "").keys()) {
      if (name.startsWith(`${cache.name}.`)) cacheNames.add(name);
    }
    for (const name of cacheNames) responseHeaders.append("Set-Cookie", generateCookie(name, "", {
      ...cache.attributes, domain: undefined, httpOnly: true, secure: true, maxAge: 0,
    }));
  } catch {
    return c.html(hostedMessagePage(app, "Sign-in could not be completed. Please sign in again."), 503);
  }

  if (returnPath) {
    responseHeaders.set("Location", new URL(returnPath, subdomainUrl).toString());
    return new Response(null, { status: 302, headers: responseHeaders });
  }

  // If the app has a redirect_uri, issue a new ticket and send the user there
  // (this completes the hosted redirect flow for SDK apps).
  if (redirectUri && isRedirectUriAllowed(app, redirectUri)) {
    const sdkTicket = await createAuthTicket(c.env.KV, {
      userId: ticketResult.userId,
      sessionId: ticketResult.sessionId,
      appId: app.id,
      redirectUri,
    });
    const dest = new URL(redirectUri);
    dest.searchParams.set("code", sdkTicket);
    if (state) dest.searchParams.set("state", state);
    responseHeaders.set("Location", dest.toString());
    return new Response(null, { status: 302, headers: responseHeaders });
  }

  // No redirect_uri — just show a success page (user is signed in on subdomain)
  const homeUrl = app.home_url ?? "/";
  responseHeaders.set("Location", new URL(homeUrl, subdomainUrl).toString());
  return new Response(null, { status: 302, headers: responseHeaders });
});

// ── Plain message page ─────────────────────────────────────────────────────────

function messageShell(app: Application, body: string): string {
  const name = esc(app.display_name ?? app.name);
  const bg = esc(app.background_color ?? "#0a0a0a");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${name}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" />
  <style>
    body { margin: 0; min-height: 100svh; display: flex; align-items: center; justify-content: center;
      background: ${bg}; color: #ffffff; -webkit-font-smoothing: antialiased;
      font-family: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; }
    main { width: 100%; max-width: 400px; padding: 24px 16px; }
    section { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10);
      border-radius: 20px; box-shadow: 0 8px 20px rgba(0,0,0,0.35); padding: 32px 28px 28px; text-align: center; }
    h1 { font-size: 20px; font-weight: 600; line-height: 1.25; letter-spacing: -0.015em; color: #ffffff; margin: 0; }
    p { color: #b8b8b8; font-size: 15px; margin: 6px 0 0; }
  </style>
</head>
<body>
  <main><section>
    ${body}
  </section></main>
</body>
</html>`;
}

function hostedMessagePage(app: Application, message: string): string {
  return messageShell(app, `<h1>${esc(app.display_name ?? app.name)}</h1><p>${esc(message)}</p>`);
}

// ── Device-code approval ───────────────────────────────────────────────────────
//
// The session cookie is scoped to this app host, so approval lives here and
// not on the dashboard. The page never receives the device code or a session
// token. Page data and states: hosted-device.ts; markup: hosted-device-view.ts.

hostedAuthRouter.get("/device", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) {
    return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);
  }
  const host = getHost(c);
  const hostOrigin = `https://${host}`;
  const page = await loadDevicePage({ request: c.req.raw, env: c.env, app, hostOrigin });
  if (!("signIn" in page)) return devicePageResponse(page);

  const enabledProviders = await hostedProviders(c.env, app.id).catch(() => null);
  if (!enabledProviders) return devicePageResponse({ state: "unavailable", app: devicePageApp(app) });
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  for (const [name, value] of Object.entries(NO_FRAMING_HEADERS)) c.header(name, value);
  return c.html(await buildHostedPage({
    app,
    mode: "sign-in",
    redirectUri: "",
    state: "",
    returnPath: page.signIn,
    enabledProviders,
    authUrl: hostOrigin,
    mainAuthUrl: c.env.AUTH_URL,
    signingSecret: c.env.BETTER_AUTH_SECRET,
  }));
});

hostedAuthRouter.post("/api/hosted/device/release", (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);
  return releaseDeviceClaim(c, { env: c.env, app, hostOrigin: `https://${getHost(c)}` });
});

// ── Catch-all 404 ──────────────────────────────────────────────────────────────

hostedAuthRouter.notFound((c) => {
  let app: Application | null = null;
  try { app = getApp(c as HC); } catch { /* ok */ }

  const bg = app?.background_color ?? "#0a0a0a";
  const primary = app?.primary_color ?? "#3b82f6";
  const name = app ? esc(app.display_name ?? app.name) : "kova-auth";

  return c.html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>${name} — Not Found</title>
    <style>body{font-family:monospace;display:flex;align-items:center;justify-content:center;
    min-height:100svh;margin:0;background:${esc(bg)};color:#a0a0a0;}</style></head>
    <body><div style="text-align:center">
    <p style="font-size:2rem;color:${esc(primary)};margin:0">404</p>
    <p style="margin:10px 0 0">Page not found.</p>
    <p style="margin:16px 0 0;font-size:0.72rem;color:#606060">Secured by <strong style="color:#a0a0a0">kova-auth</strong></p>
    </div></body></html>`,
    404
  );
});

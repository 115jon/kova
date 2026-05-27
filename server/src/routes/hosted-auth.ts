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
 *   GET  /sign-in                          → Renders branded sign-in HTML page
 *   GET  /sign-up                          → Renders branded sign-up HTML page
 *   ALL  /api/auth/*                       → Proxied to Better Auth (subdomain-scoped session)
 *   POST /api/hosted/create-ticket         → Issues short-lived auth code after sign-in
 *   POST /api/hosted/exchange-ticket       → Exchanges code for userId (requires sk_*)
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
import { type Application, isRedirectUriAllowed, validateSecretKey } from "../applications";
import { createAuth } from "../auth";
import { createAuthTicket, exchangeAuthTicket } from "../lib/auth-ticket";
import { encodeOAuthCtx } from "./oauth-bounce";

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

/** Minimal HTML escape for runtime string injection into HTML. */
function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── HTML template ──────────────────────────────────────────────────────────────

type HostedPageMode = "sign-in" | "sign-up";

/**
 * Generates the branded hosted auth page HTML shell.
 *
 * The page relies on `window.__KOVA_AUTH_HOSTED__` being consumed by the
 * JS bundle served from Workers Assets. Phase 1 uses the shared bundle;
 * a standalone hosted-auth build target is deferred to Tier 3 (see TASKS.md).
 */
async function buildHostedPage(opts: {
  app: Application;
  mode: HostedPageMode;
  redirectUri: string;
  state: string;
  authUrl: string;       // subdomain URL — used for non-OAuth auth endpoints
  mainAuthUrl: string;   // main platform URL — used for OAuth provider initiation
  signingSecret: string;
}): Promise<string> {
  const { app, mode, redirectUri, state, authUrl, mainAuthUrl } = opts;
  const title = mode === "sign-in"
    ? `Sign in to ${esc(app.display_name ?? app.name)}`
    : `Create account — ${esc(app.display_name ?? app.name)}`;

  const bootstrap = JSON.stringify({
    publishableKey: app.publishable_key,
    // authUrl: subdomain — for session reading, sign-out, etc.
    authUrl,
    // mainAuthUrl: main platform domain — OAuth provider flows ONLY go through
    // this URL. Only ONE callback URL per provider needs to be registered in
    // Google/Discord/GitHub Console, regardless of how many apps exist.
    mainAuthUrl,
    redirectUri,
    state,
    mode: app.environment === "production" ? "live" : "test",
    page: mode,
    appearance: {
      primaryColor: app.primary_color ?? "#3b82f6",
      backgroundColor: app.background_color ?? "#0a0a0a",
      theme: app.theme ?? "dark",
      logoUrl: app.logo_url ?? null,
      faviconUrl: app.favicon_url ?? null,
    },
    app: {
      id: app.id,
      name: app.display_name ?? app.name,
      homeUrl: app.home_url ?? null,
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
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      display: flex; min-height: 100svh;
      align-items: center; justify-content: center;
      background: ${esc(app.background_color ?? "#0a0a0a")};
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    #root { width: 100%; max-width: 420px; padding: 24px; }
    .ra-skeleton {
      background: rgba(255,255,255,0.04); border-radius: 10px;
      padding: 32px 28px; border: 1px solid rgba(255,255,255,0.07);
      text-align: center; color: rgba(255,255,255,0.3); font-size: 0.8rem;
      animation: ra-pulse 1.5s ease-in-out infinite;
    }
    @keyframes ra-pulse { 0%,100% { opacity:0.5 } 50% { opacity:1 } }
  </style>
</head>
<body>
  <div id="root"><div class="ra-skeleton">Loading&hellip;</div></div>
  <script>window.__KOVA_AUTH_HOSTED__ = ${bootstrap};</script>
  <script type="module" src="/assets/hosted-auth.js" onerror="
    document.getElementById('root').innerHTML =
      '<div class=ra-skeleton style=color:rgba(248,113,113,0.8)>Failed to load. Please try again.</div>';
  "></script>
</body>
</html>`;
}

// ── GET /sign-in ───────────────────────────────────────────────────────────────

hostedAuthRouter.get("/sign-in", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);
  const host = getHost(c);
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const state = c.req.query("state") ?? "";

  if (redirectUri && !isRedirectUriAllowed(app, redirectUri)) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">Invalid redirect_uri — not in allowlist.</p>`,
      403
    );
  }

  return c.html(await buildHostedPage({
    app, mode: "sign-in", redirectUri, state,
    authUrl: `https://${host}`,
    mainAuthUrl: c.env.AUTH_URL,
    signingSecret: c.env.BETTER_AUTH_SECRET,
  }));
});

// ── GET /sign-up ───────────────────────────────────────────────────────────────

hostedAuthRouter.get("/sign-up", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);
  const host = getHost(c);
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const state = c.req.query("state") ?? "";

  if (redirectUri && !isRedirectUriAllowed(app, redirectUri)) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">Invalid redirect_uri — not in allowlist.</p>`,
      403
    );
  }

  return c.html(await buildHostedPage({
    app, mode: "sign-up", redirectUri, state,
    authUrl: `https://${host}`,
    mainAuthUrl: c.env.AUTH_URL,
    signingSecret: c.env.BETTER_AUTH_SECRET,
  }));
});

// ── ALL /api/auth/* — Better Auth proxy ────────────────────────────────────────
//
// Creates a Better Auth instance scoped to this subdomain (baseURL = subdomain URL).
// Session cookies will be issued without a Domain= attribute and thus bound to the
// exact subdomain hostname by the browser (RFC 6265 §5.2).

hostedAuthRouter.all("/api/auth/*", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.json({ error: "Application suspended" }, 403);
  const host = getHost(c);
  const subdomainUrl = `https://${host}`;
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

  const rawBody = await c.req.json().catch(() => null);
  const redirectUri: string = (rawBody as Record<string, unknown>)?.redirect_uri as string ?? "";
  const state: string = (rawBody as Record<string, unknown>)?.state as string ?? "";

  if (redirectUri && !isRedirectUriAllowed(app, redirectUri)) {
    return c.json({ error: "redirect_uri not in allowlist" }, 403);
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
//   2. Sign the user into the SUBDOMAIN using signInWithCookie helper:
//      Better Auth doesn't expose a direct "create session for userId" server
//      API, so we call signIn.anonymous() then link — OR we use the bearer
//      token approach: treat the sessionId from the main domain as a token
//      and have Better Auth set a subdomain cookie via the email magic-link
//      style setSession call.
//      Simplest correct approach: use createSession from Better Auth's admin API.
//   3. Redirect to redirect_uri (if set and allowed) or to the app home_url.

hostedAuthRouter.get("/oauth-complete", async (c) => {
  const app = getApp(c);
  if (app.suspended_at) return c.html(`<p style="font-family:monospace;color:#f87171;padding:32px">Application suspended.</p>`, 403);
  const host = getHost(c);
  const subdomainUrl = `https://${host}`;

  const ticket = c.req.query("ticket") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const state = c.req.query("state") ?? "";

  if (!ticket) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth complete failed: missing ticket.</p>`,
      400
    );
  }

  // Exchange the bounce ticket (issued by oauth-bounce.ts on the main domain)
  const ticketResult = await exchangeAuthTicket(c.env.KV, ticket, app.id, redirectUri);
  if (!ticketResult) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth complete failed: ticket expired or invalid. Please sign in again.</p>`,
      400
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

  // Mint a new subdomain-scoped session via Better Auth's admin API.
  // Better Auth's session endpoint is /api/auth/admin/create-session.
  // We call it server-side via auth.api (admin plugin registers this route).
  let setCookieHeader = "";
  try {
    const { generateId } = await import("better-auth");
    const sessionId = generateId();
    const sessionToken = generateId(32);
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days — matches auth.ts session.expiresIn

    // Insert session row directly — same schema Better Auth uses
    await c.env.DB.prepare(
      `INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, app_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        ticketResult.userId,
        sessionToken,
        new Date(expiresAt).toISOString(),
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        c.req.header("CF-Connecting-IP") ?? null,
        c.req.header("User-Agent") ?? null,
        app.id
      )
      .run();

    // Better Auth session cookies are named "better-auth.session_token" and contain session.token.
    // SameSite=None; Secure; HttpOnly — matches the advanced.defaultCookieAttributes in auth.ts.
    // No Domain= attribute → cookie scoped to this exact subdomain hostname (RFC 6265 §5.2).
    setCookieHeader = `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${7 * 24 * 60 * 60}`;
  } catch {
    // Non-fatal — user can still complete the redirect flow; they just won't
    // have a local subdomain session cookie (OAuth session on main domain is still valid).
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
    const res = Response.redirect(dest.toString(), 302);
    if (setCookieHeader) {
      const headers = new Headers(res.headers);
      headers.append("Set-Cookie", setCookieHeader);
      return new Response(res.body, { status: res.status, headers });
    }
    return res;
  }

  // No redirect_uri — just show a success page (user is signed in on subdomain)
  const homeUrl = app.home_url ?? "/";
  const res = Response.redirect(homeUrl, 302);
  if (setCookieHeader) {
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", setCookieHeader);
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
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

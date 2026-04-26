/**
 * oauth-bounce.ts — Central OAuth bounce handler.
 *
 * ## Why this exists
 *
 * Google (and all OAuth providers) require explicit registration of every
 * callback URL in their developer console. This doesn't scale to per-app
 * subdomains — you'd need to add {slug}.auth.115jon.site/api/auth/callback/google
 * for every application ever created.
 *
 * ## How it works (mirrors Clerk's Central OAuth Proxy pattern)
 *
 *   1. Hosted sign-in page on {slug}.auth.lvh.me initiates OAuth via the MAIN
 *      auth domain (auth.lvh.me), NOT the subdomain. The subdomain is just a
 *      UI shell — the OAuth handshake always flows through the main domain.
 *
 *   2. The main domain's Better Auth instance handles the OAuth callback.
 *      Only ONE callback URL needs to be in Google Console (ever):
 *        Production:  https://auth.115jon.site/api/auth/callback/google
 *        Dev:         https://auth.lvh.me/api/auth/callback/google
 *
 *   3. Better Auth redirects to /api/hosted/oauth-complete?ctx=<b64> after
 *      a successful social sign-in, where ctx encodes:
 *        { slug, appId, redirect_uri, state }
 *
 *   4. This handler (on the MAIN domain):
 *        a. Reads the session from the main domain cookie (OAuth just set it)
 *        b. Creates a short-lived auth ticket (60s, single-use) in KV
 *        c. Redirects the browser to:
 *             https://{slug}.auth.lvh.me/oauth-complete?ticket=xxx&redirect_uri=yyy&state=zzz
 *
 *   5. The subdomain's /oauth-complete handler (in hosted-auth.ts):
 *        a. Exchanges the ticket for userId + sessionId
 *        b. Creates a new session scoped to the subdomain
 *        c. Completes the original auth ticket flow (for SDK redirect_uri)
 *           or just redirects the user to redirect_uri directly
 *
 * ## Security properties
 *
 * - ctx is URL-safe base64 only — no sensitive credentials
 * - The auth ticket is 256-bit opaque code, single-use, 60s TTL
 * - redirect_uri is validated against the app's allowlist in step 5
 * - The main domain session cookie (set by Better Auth) is HttpOnly + Secure;
 *   it is never forwarded to the subdomain — only the scoped subdomain session is
 * - The subdomain session is scoped to its exact hostname (no Domain= attribute)
 */

import type { Context } from "hono";
import { getApplicationByPublishableKey, isRedirectUriAllowed } from "../applications";
import { createAuth } from "../auth";
import { createAuthTicket, createSessionTransferCode } from "../lib/auth-ticket";

export interface OAuthBounceCtx {
  slug: string;
  appId: string;
  redirect_uri: string;
  state: string;
}

/**
 * Parameters passed in OAuth callbackURL for the embedded SDK cross-origin flow
 * (mode=sdk). These are plain query params (not base64-encoded) because they
 * contain no sensitive data and the URL is validated by the auth server itself.
 */
export interface OAuthBounceSDKParams {
  mode: "sdk";
  /** Publishable key identifying the consumer app */
  pk: string;
  /** Where to redirect after issuing the transfer code — must be in app's redirect_uris */
  redirect_uri: string;
}

/**
 * Encodes the bounce context into a URL-safe base64 string.
 * This is passed as the `callbackURL` query param when initiating OAuth,
 * so Better Auth appends it to the post-OAuth redirect automatically.
 */
export function encodeOAuthCtx(ctx: OAuthBounceCtx): string {
  return btoa(JSON.stringify(ctx)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes a bounce context from a URL-safe base64 string.
 * Returns null if the ctx param is missing or malformed.
 */
export function decodeOAuthCtx(raw: string | null): OAuthBounceCtx | null {
  if (!raw) return null;
  try {
    // Re-pad base64url → standard base64
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return JSON.parse(atob(padded)) as OAuthBounceCtx;
  } catch {
    return null;
  }
}

/**
 * GET /api/hosted/oauth-complete
 *
 * Called by Better Auth (via callbackURL redirect) after a successful
 * social sign-in on the MAIN auth domain. Reads the main-domain session,
 * creates an auth ticket, and bounces the browser to the target subdomain.
 *
 * Must be mounted on the MAIN Hono app (index.ts), not on hostedAuthRouter.
 */
export async function handleOAuthBounce(
  c: Context<{ Bindings: Env & { ASSETS: Fetcher } }>
): Promise<Response> {
  // ── SDK embedded flow (mode=sdk) ────────────────────────────────────────────
  //
  // When an embedded SDK consumer (e.g. a cross-origin SPA at workers.dev)
  // initiates OAuth, it sets callbackURL = auth.115jon.site/api/hosted/oauth-complete?mode=sdk&pk=...&redirect_uri=...
  //
  // After Google → Better Auth callback creates a session on auth.115jon.site, the
  // browser navigates here.  Because we are ON auth.115jon.site, the session
  // cookie IS available — no cross-domain cookie restriction.
  //
  // We create a 30s single-use transfer code and redirect to the consumer app
  // with ?ralph_auth_code=xxx.  The SDK reads this on mount and exchanges it
  // for the raw session token via POST /api/pub/apps/:pk/exchange-code.
  const mode = c.req.query("mode");
  if (mode === "sdk") {
    return handleSdkBounce(c);
  }

  // ── Hosted subdomain flow (ctx=<b64>) ───────────────────────────────────────
  const rawCtx = c.req.query("ctx");
  const ctx = decodeOAuthCtx(rawCtx ?? null);

  if (!ctx?.slug || !ctx?.appId) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">
        OAuth bounce failed: missing or invalid context.<br>
        <a href="javascript:history.back()">Go back</a>
      </p>`,
      400
    );
  }

  // Read the session that Better Auth just created on the main domain
  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw
    // No baseURLOverride — this runs on the main domain
  );

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !session?.session) {
    // OAuth completed but no session — shouldn't happen; bounce back to sign-in
    const baseHost = new URL(c.env.AUTH_URL).hostname.replace(/^auth\./, "");
    const subdomainHost = `${ctx.slug}.auth.${baseHost}`;
    return Response.redirect(`https://${subdomainHost}/sign-in`, 302);
  }

  // Issue a short-lived ticket the subdomain will exchange for its own session
  const ticket = await createAuthTicket(c.env.KV, {
    userId: session.user.id,
    sessionId: session.session.id,
    appId: ctx.appId,
    redirectUri: ctx.redirect_uri,
  });

  // Build subdomain URL — derive from AUTH_URL
  // auth.115jon.site  →  {slug}.auth.115jon.site
  const authUrl = new URL(c.env.AUTH_URL);
  const subdomainOrigin = `${authUrl.protocol}//${ctx.slug}.${authUrl.hostname}`;

  const bounceUrl = new URL(`${subdomainOrigin}/oauth-complete`);
  bounceUrl.searchParams.set("ticket", ticket);
  if (ctx.redirect_uri) bounceUrl.searchParams.set("redirect_uri", ctx.redirect_uri);
  if (ctx.state) bounceUrl.searchParams.set("state", ctx.state);

  return Response.redirect(bounceUrl.toString(), 302);
}

// ── SDK bounce helper ─────────────────────────────────────────────────────────

async function handleSdkBounce(
  c: Context<{ Bindings: Env & { ASSETS: Fetcher } }>
): Promise<Response> {
  const pk = c.req.query("pk") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";

  const errorHtml = (msg: string) =>
    c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">${msg}</p>`,
      400
    );

  if (!pk || !redirectUri) {
    return errorHtml("OAuth SDK bounce failed: missing pk or redirect_uri.");
  }

  // Validate the app exists and redirect_uri is allowed
  const app = await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null);
  if (!app) return errorHtml("OAuth SDK bounce failed: unknown publishable key.");
  if (app.suspended_at) return errorHtml("Application suspended.");

  // Validate redirect_uri against allowlist (open-redirect protection)
  if (!isRedirectUriAllowed(app, redirectUri)) {
    return errorHtml(
      `redirect_uri '${redirectUri}' is not in the application's allowed redirect URIs.`
    );
  }

  // Read the session that Better Auth just created (we are ON the main auth domain)
  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw
  );
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.session) {
    // OAuth completed but no session — send back to app so SDK shows sign-in form
    return Response.redirect(redirectUri, 302);
  }

  // Extract the raw session token.
  // Better Auth's session object has `session.token` — the raw value stored as cookie.
  // We cast via unknown because the Better Auth types don't expose `token` on the
  // base Session shape, but it IS present at runtime (it's the primary session identifier).
  const rawTokenField = (session.session as unknown as Record<string, unknown>)["token"];
  const sessionToken = typeof rawTokenField === "string" ? rawTokenField : null;

  if (!sessionToken) {
    // Could not extract session token (should never happen with BA 1.x+)
    console.error("[oauth-bounce] SDK bounce: session.token is missing on session object");
    return Response.redirect(redirectUri, 302);
  }

  // Create a 60-second single-use transfer code bound to this pk
  const code = await createSessionTransferCode(c.env.KV, sessionToken, pk);

  // ── Build redirect URL ────────────────────────────────────────────────────
  const dest = new URL(redirectUri);
  dest.searchParams.set("ralph_auth_code", code);

  // ── Restore previous platform session (Bug 2 mitigation) ─────────────────
  //
  // The OAuth callback made the SDK-user's session the "active" cookie on
  // auth.115jon.site. This would switch the admin dashboard to the SDK user.
  //
  // Fix: call Better Auth's listDeviceSessions → setActive via auth.handler()
  // so we receive the full Response including Set-Cookie headers, then forward
  // those headers in our own 302. The browser processes Set-Cookie BEFORE
  // following Location, so the admin session is restored transparently.
  //
  // Falls through to a plain redirect if anything goes wrong — the SDK user
  // is still authenticated via Bearer token regardless.
  try {
    // 1. List all sessions currently tracked on this device
    const listReq = new Request(`${c.env.AUTH_URL}/api/auth/multi-session/list-device-sessions`, {
      method: "GET",
      headers: c.req.raw.headers,
    });
    const listRes = await auth.handler(listReq);

    if (listRes.ok) {
      const deviceSessions = (await listRes.json()) as Array<{
        session: Record<string, unknown>;
        user: Record<string, unknown>;
      }>;
      console.log("[oauth-bounce] Found device sessions:", JSON.stringify(deviceSessions.map(s => s.user.email)));

      // Find any session that is NOT the one just created by OAuth
      const prevSession = Array.isArray(deviceSessions)
        ? deviceSessions.find(s => s.session["id"] !== session.session.id)
        : null;

      const prevToken = prevSession
        ? (prevSession.session["token"] as string | undefined) ?? null
        : null;

      if (prevToken) {
        // 2. Call Better Auth's multi-session/set-active endpoint via auth.handler()
        //    so we obtain the perfectly serialized Set-Cookie strings exactly matching
        //    the framework's configuration (Path, Domain, SameSite, Secure).
        const setActiveReq = new Request(`${c.env.AUTH_URL}/api/auth/multi-session/set-active`, {
          method: "POST",
          headers: new Headers({
            cookie: c.req.raw.headers.get("cookie") ?? "",
            "content-type": "application/json",
            "origin": c.env.AUTH_URL, // Bypass CSRF origin check
            "referer": c.env.AUTH_URL,
            "sec-fetch-site": "same-origin"
          }),
          body: JSON.stringify({ sessionToken: prevToken }),
        });

        const setActiveRes = await auth.handler(setActiveReq);

        if (setActiveRes.ok) {
          const responseHeaders = new Headers({ Location: dest.toString() });

          // Use getSetCookie() to handle multiple Set-Cookie headers correctly without commas
          const cookies = (setActiveRes.headers as any).getSetCookie() as string[];
          cookies.forEach((cookieStr: string) => {
            responseHeaders.append("set-cookie", cookieStr);
          });

          return new Response(null, { status: 302, headers: responseHeaders });
        } else {
          console.warn("[oauth-bounce] set-active returned", setActiveRes.status, await setActiveRes.text());
        }
      }
    }
  } catch (e) {
    console.warn("[oauth-bounce] Session restore failed (non-critical):", e);
  }

  // Plain redirect — first sign-in, restore failed, or no prior session
  return Response.redirect(dest.toString(), 302);
}

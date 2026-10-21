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
import type { KVNamespace } from "@cloudflare/workers-types";
import { getApplicationById, getApplicationByPublishableKey, isRedirectUriAllowed } from "../applications";
import { createAuth } from "../auth";
import { insertAppScopedSession } from "../lib/app-session";
import { createAuthTicket, createSessionTransferCode } from "../lib/auth-ticket";
import { escapeHtml, jsonForHtmlScript } from "../lib/html";
import { isSafeDeviceReturnPath } from "../lib/device-login";
import { isFreshSignInSession, timestampMs } from "../lib/fresh-sign-in";
import { hostedProviders } from "../lib/hosted-providers";

export interface OAuthBounceCtx {
  slug: string;
  appId: string;
  redirect_uri: string;
  state: string;
  returnPath?: string;
  exp?: number;
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
function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return atob(padded);
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `mira://auth` and other custom schemes cannot finish the hosted ticket hop:
 * the edge exchanges an `xfr_` session-transfer code from the SDK bounce, not
 * the `ticket_` code `/oauth-complete` appends. HTTP(S) apps stay on the
 * signed-ctx hosted hop.
 */
export function oauthStartUsesSdkBounce(redirectUri: string): boolean {
  try {
    const protocol = new URL(redirectUri).protocol;
    return protocol !== "http:" && protocol !== "https:";
  } catch {
    return false;
  }
}

export async function encodeOAuthCtx(ctx: OAuthBounceCtx, secret: string): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({
    ...ctx,
    exp: ctx.exp ?? Date.now() + 10 * 60 * 1000,
  }));
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

/**
 * Decodes a bounce context from a URL-safe base64 string.
 * Returns null if the ctx param is missing or malformed.
 */
export async function decodeOAuthCtx(raw: string | null, secret: string): Promise<OAuthBounceCtx | null> {
  if (!raw) return null;
  try {
    const [payload, sig, extra] = raw.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    const expected = await hmacSha256Hex(secret, payload);
    if (!constantTimeEqual(expected, sig)) return null;
    const parsed = JSON.parse(base64UrlDecode(payload)) as OAuthBounceCtx;
    if (!parsed || typeof parsed !== "object"
      || typeof parsed.slug !== "string" || !/^[a-z0-9-]+$/.test(parsed.slug)
      || typeof parsed.appId !== "string" || !parsed.appId
      || typeof parsed.redirect_uri !== "string" || typeof parsed.state !== "string"
      || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    if (parsed.returnPath !== undefined && (!isSafeDeviceReturnPath(parsed.returnPath) || parsed.redirect_uri !== "")) return null;
    return parsed;
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
/**
 * GET /api/hosted/oauth-start?pk=&provider=&ctx=
 *
 * Same-origin bootstrap for the hosted sign-in page's social buttons.
 * The page lives on `{slug}.auth.…` but Google's callback is registered on
 * the main auth domain, so the OAuth state cookie must be set HERE. A
 * cross-origin POST from the subdomain would store it on the wrong host and
 * the callback would fail with `state_mismatch`.
 *
 * `ctx` is the signed bounce context the hosted page already holds.
 * HTTP(S) redirects keep that ctx on the callbackURL so the hosted hop can
 * finish. Custom-scheme redirects (mira://auth) switch the callback to the
 * SDK bounce, which mints the xfr_ code the app edge exchanges, and carry
 * the app-level state nonce separately from Better Auth's OAuth state.
 * Mounted on the main app, next to oauth-complete.
 */
export async function handleOAuthStart(
  c: Context<{ Bindings: Env & { ASSETS: Fetcher } }>
): Promise<Response> {
  const pk = c.req.query("pk") ?? "";
  const provider = c.req.query("provider") ?? "";
  const ctx = c.req.query("ctx") ?? "";

  const app = pk ? await getApplicationByPublishableKey(c.env.DB, pk).catch(() => null) : null;
  if (!app || app.suspended_at || !provider || !ctx) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth start failed: invalid request.</p>`,
      400
    );
  }

  const bounce = await decodeOAuthCtx(ctx, c.env.BETTER_AUTH_SECRET);
  if (!bounce || bounce.appId !== app.id || bounce.slug !== (app.auth_slug ?? "")) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth start failed: invalid request.</p>`,
      400
    );
  }
  if (bounce.redirect_uri && !isRedirectUriAllowed(app, bounce.redirect_uri)) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth start failed: redirect not allowed.</p>`,
      400
    );
  }

  try {
    const providers = await hostedProviders(c.env, app.id);
    if (!providers.some(available => available === provider)) {
      return c.html("<p>That sign-in provider is unavailable for this application.</p>", 403);
    }
  } catch {
    return c.html("<p>Sign-in providers could not be loaded. Please try again.</p>", 503);
  }

  const callbackURL = new URL("/api/hosted/oauth-complete", c.env.AUTH_URL);
  if (oauthStartUsesSdkBounce(bounce.redirect_uri)) {
    // Native clients (mira://auth) need the xfr_ code the SDK bounce mints.
    // The app-level CSRF nonce still rides along; the client checks it.
    callbackURL.searchParams.set("mode", "sdk");
    callbackURL.searchParams.set("pk", pk);
    callbackURL.searchParams.set("redirect_uri", bounce.redirect_uri);
    if (bounce.state) callbackURL.searchParams.set("state", bounce.state);
  } else {
    callbackURL.searchParams.set("ctx", ctx);
  }

  const body = JSON.stringify({ provider, callbackURL: callbackURL.toString() });

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Redirecting...</title></head>
<body><script>
  (async () => {
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-publishable-key": ${jsonForHtmlScript(pk)}
        },
        body: ${jsonForHtmlScript(body)}
      });
      const data = await response.json();
      if (!response.ok || !data?.url) throw new Error(data?.message || data?.error || "OAuth start failed");
      window.location.replace(data.url);
    } catch (e) {
      document.body.textContent = "Sign-in could not start. Please go back and try again.";
    }
  })();
</script></body></html>`;

  return c.html(html);
}

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
  // We create a 60s single-use transfer code and redirect to the consumer app
  // with ?kova_auth_code=xxx.  The SDK reads this on mount and exchanges it
  // for the raw session token via POST /api/pub/apps/:pk/exchange-code.
  const mode = c.req.query("mode");
  if (mode === "sdk") {
    return handleSdkBounce(c);
  }

  // ── Hosted subdomain flow (ctx=<b64>) ───────────────────────────────────────
  const rawCtx = c.req.query("ctx");
  const ctx = await decodeOAuthCtx(rawCtx ?? null, c.env.BETTER_AUTH_SECRET);

  if (!ctx?.slug || !ctx?.appId) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">
        OAuth bounce failed: missing or invalid context.<br>
        <a href="javascript:history.back()">Go back</a>
      </p>`,
      400
    );
  }

  const app = await getApplicationById(c.env.DB, ctx.appId).catch(() => null);
  if (!app || app.suspended_at || app.auth_slug !== ctx.slug || (ctx.redirect_uri && !isRedirectUriAllowed(app, ctx.redirect_uri))) {
    return c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">OAuth bounce failed: invalid application context.</p>`,
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
    appId: app.id,
    redirectUri: ctx.returnPath ?? ctx.redirect_uri,
  });

  // Build subdomain URL — derive from AUTH_URL
  // auth.115jon.site  →  {slug}.auth.115jon.site
  const authUrl = new URL(c.env.AUTH_URL);
  const subdomainOrigin = `${authUrl.protocol}//${ctx.slug}.${authUrl.hostname}`;

  const bounceUrl = new URL(`${subdomainOrigin}/oauth-complete`);
  bounceUrl.searchParams.set("ticket", ticket);
  if (ctx.redirect_uri) bounceUrl.searchParams.set("redirect_uri", ctx.redirect_uri);
  if (ctx.returnPath) bounceUrl.searchParams.set("returnPath", ctx.returnPath);
  if (ctx.state) bounceUrl.searchParams.set("state", ctx.state);

  return Response.redirect(bounceUrl.toString(), 302);
}

// ── SDK bounce helper ─────────────────────────────────────────────────────────

type DeviceSessionEntry = { session: Record<string, unknown> };

/** Token of the most recently updated saved session other than the current one. */
export function pickSessionToRestore(
  deviceSessions: DeviceSessionEntry[] | null,
  currentSessionId: string,
): string | null {
  if (!Array.isArray(deviceSessions)) return null;
  let best: { token: string; updated: number } | null = null;
  for (const { session } of deviceSessions) {
    const token = session["token"];
    if (session["id"] === currentSessionId || typeof token !== "string" || !token) continue;
    const updated = timestampMs(session["updatedAt"] ?? session["createdAt"]);
    const rank = Number.isFinite(updated) ? updated : 0;
    if (!best || rank > best.updated) best = { token, updated: rank };
  }
  return best?.token ?? null;
}

async function handleSdkBounce(
  c: Context<{ Bindings: Env & { ASSETS: Fetcher } }>
): Promise<Response> {
  const pk = c.req.query("pk") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";

  const errorHtml = (msg: string) =>
    c.html(
      `<p style="font-family:monospace;color:#f87171;padding:32px">${escapeHtml(msg)}</p>`,
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
    return errorHtml("OAuth SDK bounce failed: redirect_uri is not allowlisted.");
  }

  // A failed email link (expired or invalid token, wrong user) is sent here by
  // Better Auth with `error`. No sign-in happened, so any session cookie in
  // this browser belongs to someone else: minting for it would hand the app
  // the wrong account. Report the failure to the app instead.
  const rawState = c.req.query("state") ?? "";
  const appState = /^[A-Za-z0-9._~-]{1,256}$/.test(rawState) ? rawState : "";
  const failTo = (code: string) => {
    const failed = new URL(redirectUri);
    failed.searchParams.set("kova_auth_error", code);
    if (appState) failed.searchParams.set("state", appState);
    return Response.redirect(failed.toString(), 302);
  };
  const failure = c.req.query("error");
  if (failure) {
    return failTo(/^[A-Za-z0-9_.-]{1,64}$/.test(failure) ? failure : "auth_failed");
  }

  // Read the session that Better Auth just created (we are ON the main auth domain)
  const auth = createAuth(
    c.env,
    c.req.raw.cf as IncomingRequestCfProperties | undefined,
    c.req.raw
  );
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.session) {
    return failTo("NO_SESSION");
  }

  // An emailed link sets fresh=1. A verify-email link that was already consumed
  // (double click, mail scanner) redirects here without signing anyone in, so
  // the cookie in this browser may be another account. Only a session this link
  // just created may be handed off.
  if (c.req.query("fresh") === "1" && !isFreshSignInSession(session.session.createdAt)) {
    return failTo("ALREADY_USED");
  }

  // Extract the raw session token.
  // Better Auth's session object has `session.token` — the raw value stored as cookie.
  // We cast via unknown because the Better Auth types don't expose `token` on the
  // base Session shape, but it IS present at runtime (it's the primary session identifier).
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

  // Create a 60-second single-use transfer code bound to this pk
  const expectedOrigin = new URL(redirectUri).origin;
  const code = await createSessionTransferCode(c.env.KV, appSessionToken, pk, expectedOrigin);

  // ── Build redirect URL ────────────────────────────────────────────────────
  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  dest.searchParams.set("kova_auth_code", code);
  if (appState) dest.searchParams.set("state", appState);

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
  // Only a session this round trip created displaced the previous one. A user
  // who arrives already signed in changed nothing, and restoring then would
  // flip the dashboard to an arbitrary saved account.
  //
  // Falls through to a plain redirect if anything goes wrong — the SDK user
  // is still authenticated via Bearer token regardless.
  try {
    // 1. List all sessions currently tracked on this device
    const listReq = new Request(`${c.env.AUTH_URL}/api/auth/multi-session/list-device-sessions`, {
      method: "GET",
      headers: c.req.raw.headers,
    });
    const listRes = isFreshSignInSession(session.session.createdAt) ? await auth.handler(listReq) : null;

    if (listRes?.ok) {
      const deviceSessions = (await listRes.json()) as DeviceSessionEntry[];
      const prevToken = pickSessionToRestore(deviceSessions, session.session.id);

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

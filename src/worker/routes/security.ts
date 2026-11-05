/**
 * "This wasn't me" from a sign-in alert email (lib/sign-in-alert.ts).
 *
 *   GET  /api/security/not-me?token=…  → confirmation page; changes nothing
 *   POST /api/security/not-me          → signs the user out everywhere
 *
 * Mail scanners and link previews fetch every GET in an email, so only the
 * POST (a same-origin form on the GET page) acts. The token is single use, and
 * a bad, expired or used one gets the same generic page.
 */
import { Hono } from "hono";
import { logAudit } from "../audit";
import { formatUtc } from "../email";
import { describeClient, geoFromCf, requestMeta } from "../lib/audit-context";
import { escapeHtml } from "../lib/html";
import { notMeUsedKey, type NotMePayload, verifyNotMeToken } from "../lib/not-me-token";
import { consumeRateLimit, requestIp } from "../lib/rate-limit";
import { revokeUserSessions } from "../lib/session-revoke";

const securityRouter = new Hono<{ Bindings: Env }>();

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100svh; display:flex; align-items:center; justify-content:center; background:#f4f5f5; color:#131515;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:420px; margin:24px; padding:32px; background:#fff; border:1px solid #e3e5e5; border-radius:14px; }
  h1 { margin:0 0 12px; font-size:22px; line-height:1.3; }
  p { margin:0 0 16px; font-size:15px; line-height:1.6; color:#494d4d; }
  button, .button { display:inline-block; padding:12px 20px; border:0; border-radius:10px; background:#b42318; color:#fff;
    font:inherit; font-weight:600; text-decoration:none; cursor:pointer; }
  .button { background:#0283a7; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f1111; color:#f2f3f3; }
    main { background:#181a1a; border-color:#2a2d2d; }
    p { color:#b8bdbd; }
  }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...PAGE_HEADERS } });
}

function invalidLink(): Response {
  return page(
    "Link expired",
    `<h1>This link has expired</h1>
<p>It may have been used already, or it is more than 7 days old.</p>
<p>If you think someone else is using your account, sign in and change your password.</p>`,
    400,
  );
}

/** A valid token whose alert has not been acted on yet; else null. */
async function usableToken(env: Env, token: string | undefined): Promise<NotMePayload | null> {
  if (!token) return null;
  const payload = await verifyNotMeToken(env.BETTER_AUTH_SECRET, token);
  if (!payload) return null;
  if (await env.KV.get(notMeUsedKey(payload.a))) return null;
  return payload;
}

async function appName(db: D1Database, appId: string | null): Promise<string | null> {
  if (!appId) return null;
  const row = await db
    .prepare("SELECT COALESCE(display_name, name) AS name FROM application WHERE id = ? LIMIT 1")
    .bind(appId)
    .first<{ name: string }>()
    .catch(() => null);
  return row?.name ?? null;
}

/**
 * Where to reset the password: straight to the forgot-password page. For an
 * app it is the app-branded one (the same link its hosted sign-in shows under
 * "Forgot password?"); otherwise Kova's.
 */
async function resetLink(env: Env, appId: string | null): Promise<{ href: string; label: string }> {
  const label = "Reset your password";
  const kova = { href: `${(env.DASHBOARD_URL || env.AUTH_URL).replace(/\/+$/, "")}/reset-password`, label };
  if (!appId) return kova;
  const row = await env.DB
    .prepare("SELECT publishable_key FROM application WHERE id = ? LIMIT 1")
    .bind(appId)
    .first<{ publishable_key: string | null }>()
    .catch(() => null);
  if (!row?.publishable_key) return kova;
  return {
    href: `${env.AUTH_URL.replace(/\/+$/, "")}/reset-password?pk=${encodeURIComponent(row.publishable_key)}`,
    label,
  };
}

securityRouter.get("/not-me", async (c) => {
  const token = c.req.query("token");
  const payload = await usableToken(c.env, token);
  if (!payload || !token) return invalidLink();

  const product = (await appName(c.env.DB, payload.app)) ?? "Kova";
  return page(
    "Secure your account",
    `<h1>Wasn&#39;t you?</h1>
<p>Someone signed in to your account on ${escapeHtml(product)} at ${escapeHtml(formatUtc(payload.t))}.</p>
<p>Sign out everywhere to end every session on every device, including this one. Then reset your password.</p>
<form method="post" action="/api/security/not-me">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <button type="submit">Sign out everywhere</button>
</form>`,
  );
});

securityRouter.post("/not-me", async (c) => {
  const ip = requestIp(c.req.raw) ?? "unknown";
  const limit = await consumeRateLimit(c.env.DB, `not-me:${ip}`, { windowSeconds: 60, max: 10 }).catch(() => null);
  if (limit && !limit.allowed) {
    return page("Too many attempts", "<h1>Too many attempts</h1><p>Wait a minute and try again.</p>", 429);
  }

  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const token = typeof form.token === "string" ? form.token : undefined;
  const payload = await usableToken(c.env, token);
  if (!payload) return invalidLink();

  const user = await c.env.DB
    .prepare('SELECT id, name, email FROM "user" WHERE id = ? LIMIT 1')
    .bind(payload.u)
    .first<{ id: string; name: string | null; email: string | null }>();
  if (!user) return invalidLink();

  // Revoke first, then burn the link: a failure leaves it usable for a retry,
  // and a second submit racing this one only revokes nothing twice.
  let revoked: number;
  try {
    revoked = await revokeUserSessions(c.env, user.id);
  } catch (error) {
    console.error("[kova-auth] not-me revoke failed", error);
    return page(
      "Something went wrong",
      "<h1>Something went wrong</h1><p>Your sessions could not be ended. Use the link in the email again in a minute.</p>",
      503,
    );
  }
  await c.env.KV.put(notMeUsedKey(payload.a), "1", {
    expirationTtl: Math.max(60, Math.ceil((payload.e - Date.now()) / 1000)),
  }).catch((error: unknown) => console.error("[kova-auth] not-me marker write failed", error));

  try {
    const { ipAddress, userAgent } = requestMeta(c.req.raw);
    const geo = geoFromCf(c.req.raw.cf as IncomingRequestCfProperties | undefined);
    await logAudit(c.env.DB, {
      userId: user.id,
      actor: user.id,
      actorName: user.name,
      actorEmail: user.email,
      action: "security.signOutEverywhere",
      appId: payload.app,
      ipAddress,
      userAgent,
      country: geo.country ?? null,
      city: geo.city ?? null,
      metadata: { via: "alert_email", alertId: payload.a, revoked, client: describeClient(userAgent) },
    });
  } catch {
    // Audit is best-effort; the sessions are already revoked.
  }

  const reset = await resetLink(c.env, payload.app);
  return page(
    "Signed out everywhere",
    `<h1>Signed out everywhere</h1>
<p>Every session on your account has ended. Anyone using it has to sign in again.</p>
<p>Reset your password now so they can&#39;t.</p>
<p><a class="button" href="${escapeHtml(reset.href)}">${escapeHtml(reset.label)}</a></p>`,
  );
});

export { securityRouter };

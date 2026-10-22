/**
 * Device approval from the app's own site (Discord-style /activate).
 *
 * An app with a `device_verification_uri` (e.g. https://meet.example.com/activate)
 * sends users there instead of the hosted /device page. That page signs the
 * user in with the embedded SDK, which holds an app-scoped bearer session, and
 * approves the code here:
 *
 *   POST /api/pub/apps/:pk/device/lookup  {userCode}
 *     200 {userCode, status, device:{label,platform,hostname},
 *          requester:{city,country,ip}, expiresAt}
 *   POST /api/pub/apps/:pk/device/approve {userCode} → 200 {status:"approved"}
 *   POST /api/pub/apps/:pk/device/deny    {userCode} → 200 {status:"denied"}
 *
 * Every response is `Cache-Control: no-store`; CORS comes from the global
 * middleware (the app's allowed origins, preflight included). Errors are
 * `{error, message}`; see DeviceApprovalError below for the codes.
 *
 * Who may call (checked in this order):
 *
 *  1. A known, unsuspended app (either publishable key, including a legacy alias).
 *  2. A web page on one of the app's allowed origins: `Origin` present and an
 *     exact match. The desktop shell's origin (tauri.localhost) is never
 *     accepted; see isApprovalOrigin. `Sec-Fetch-Site` is deliberately not
 *     checked: an app's site is usually a different site from Kova's auth host
 *     (another domain, or mid-migration between domains), so a legitimate
 *     approval is often `cross-site`. The exact Origin allowlist already pins
 *     the calling page, and the bearer token is the credential.
 *  3. `Authorization: Bearer <token>` for an app-scoped session of THIS app:
 *     session.app_id = the app's id, unexpired, user not banned. Platform
 *     sessions (app_id NULL) and other apps' sessions are refused. Cookies are
 *     ignored entirely: they are never read and never forwarded to Better
 *     Auth, so a browser's auth-domain cookie cannot stand in for the bearer.
 *  4. A per user+IP+app limit shared by all three endpoints (30 per 10 min,
 *     the hosted verify budget), so codes cannot be probed through approve or
 *     deny either. Fails closed.
 *  5. The code belongs to this app (deviceCode.appId). Another app's code
 *     answers exactly like an unknown one.
 *
 * Claim semantics are the plugin's own: lookup runs Better Auth's
 * deviceVerify, which claims an unclaimed pending code for this user (an
 * atomic conditional update); approve/deny run deviceApprove/deviceDeny,
 * which require the code to be claimed by this same user. All three are
 * called in-process with only the bearer header, which the bearer plugin turns
 * into the session; nothing about the claim is reimplemented here. In-process
 * calls skip the plugin's HTTP limit on /device, hence the limit in (4).
 *
 * Org 2FA: approve refuses a user an MFA-enforcing org would block from
 * signing in (the check the session-create hook and device redemption apply).
 * Approval does not mint a session (the device's poll does, and redemption
 * re-checks), so this is not the security boundary; it fails early so the
 * person on the web page sees why, instead of the device getting an
 * "approved" code that then fails with mfa_required. Lookup and deny are not
 * gated: looking and refusing grant nothing.
 *
 * The Origin check only binds browsers. A non-browser
 * client can send any headers; the bearer token is the credential. The header
 * checks stop the token being used from a page the app did not register, and
 * from the desktop shell.
 */
import type { Context } from "hono";
import { getApplicationByPublishableKey, isDesktopShellOrigin, type Application } from "../../applications";
import { createAuth } from "../../auth";
import { isSessionUnexpired } from "../../lib/app-session";
import { deviceErrorCode, type KovaDeviceVerificationContext } from "../../lib/device-authorization";
import { formatUserCode, normalizeUserCode } from "../../lib/device-code";
import { consumeRateLimit, requestIp } from "../../lib/rate-limit";
import { findMFAEnforcedOrgBlockingUser } from "../../org-settings";

/** Same budget as the hosted /device verify, per user + IP (+ app). */
export const DEVICE_APPROVAL_LIMIT = { windowSeconds: 600, max: 30 };

export type DeviceApprovalError =
  | "app_not_found"        // 404 unknown publishable key
  | "app_suspended"        // 403
  | "origin_not_allowed"   // 403 missing, unlisted, or desktop-shell Origin
  | "invalid_session"      // 401 no bearer, or not a live session of this app's, or banned user
  | "invalid_request"      // 400 body is not {userCode: "XXXX-XXXX"}
  | "rate_limited"         // 429 with Retry-After
  | "invalid_code"         // 400 unknown code, or another app's
  | "expired_token"        // 410
  | "access_denied"        // 403 claimed by another account
  | "not_claimed"          // 409 approve/deny before lookup
  | "already_processed"    // 409 approved or denied already
  | "mfa_required"         // 403 an org of this user requires 2FA (approve only)
  | "temporarily_unavailable" // 503 a check could not run
  | "server_error";        // 500

const MESSAGES: Record<DeviceApprovalError, string> = {
  app_not_found: "Application not found",
  app_suspended: "Application suspended",
  origin_not_allowed: "Device approval is only accepted from this application's own web pages",
  invalid_session: "Sign in again to approve this device",
  invalid_request: "Send {\"userCode\": \"XXXX-XXXX\"}",
  rate_limited: "Too many attempts. Try again later",
  invalid_code: "That code is not valid",
  expired_token: "That code has expired. Start sign-in on the device again",
  access_denied: "Another account is already reviewing this code",
  not_claimed: "Look the code up before approving or denying it",
  already_processed: "That code was already approved or denied",
  mfa_required: "Two-factor authentication is required",
  temporarily_unavailable: "Try again",
  server_error: "Something went wrong",
};

const STATUS: Record<DeviceApprovalError, number> = {
  app_not_found: 404,
  app_suspended: 403,
  origin_not_allowed: 403,
  invalid_session: 401,
  invalid_request: 400,
  rate_limited: 429,
  invalid_code: 400,
  expired_token: 410,
  access_denied: 403,
  not_claimed: 409,
  already_processed: 409,
  mfa_required: 403,
  temporarily_unavailable: 503,
  server_error: 500,
};

function fail(error: DeviceApprovalError, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error, message: MESSAGES[error] },
    { status: STATUS[error], headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function ok(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Approval must come from a web page the app registered, never from the
 * desktop shell, even though the shell's origin (http://tauri.localhost, or
 * https://tauri.localhost with useHttpsScheme) is a legitimate allowed origin
 * for the app's other SDK calls.
 *
 * Device sign-in exists so a person confirms, on a separate trusted surface,
 * that the device asking may sign in. The shell is the device asking. If it
 * could approve, anything running in it (a compromised build, an injected
 * script, a leaked app token replayed from that origin) could start a code
 * and approve it itself, minting a fresh session with nobody looking. And
 * tauri.localhost is a loopback name with no certificate behind it: any local
 * process can serve pages under it in a browser, so it proves nothing about
 * who is asking.
 */
export function isApprovalOrigin(app: Pick<Application, "allowed_origins">, origin: string | null): origin is string {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (isDesktopShellOrigin(origin)) return false;
  return app.allowed_origins.includes(origin);
}

type Caller = { app: Application; userId: string; bearer: string };

/** Steps 1–3 of the module comment. */
async function authorizeCaller(c: Context<{ Bindings: Env }>): Promise<Caller | Response> {
  const app = await getApplicationByPublishableKey(c.env.DB, c.req.param("pk") ?? "").catch(() => null);
  if (!app) return fail("app_not_found");
  if (app.suspended_at) return fail("app_suspended");

  const request = c.req.raw;
  if (!isApprovalOrigin(app, request.headers.get("origin"))) return fail("origin_not_allowed");

  const match = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i);
  const token = match?.[1];
  if (!token) return fail("invalid_session");

  let row: { userId: string; expiresAt: unknown; banned: unknown } | null;
  try {
    row = await c.env.DB
      .prepare(
        `SELECT s.userId AS userId, s.expiresAt AS expiresAt, u.banned AS banned
           FROM session s JOIN "user" u ON u.id = s.userId
          WHERE s.token = ? AND s.app_id = ?
          LIMIT 1`,
      )
      .bind(token, app.id)
      .first<{ userId: string; expiresAt: unknown; banned: unknown }>();
  } catch {
    return fail("temporarily_unavailable");
  }
  // Unknown token, a platform session, and another app's session all land here.
  if (!row?.userId || !isSessionUnexpired(row.expiresAt)) return fail("invalid_session");
  if (row.banned === 1 || row.banned === true || row.banned === "1" || row.banned === "true") return fail("invalid_session");

  return { app, userId: row.userId, bearer: token };
}

type CodeRow = { appId: string | null; status: string; userId: string | null; expiresAt: unknown };

/** Steps 4–5: rate limit, body, and app ownership. */
async function readOwnedCode(c: Context<{ Bindings: Env }>, caller: Caller): Promise<{ userCode: string; row: CodeRow } | Response> {
  const ip = requestIp(c.req.raw) ?? "unknown";
  const limit = await consumeRateLimit(c.env.DB, `device-app-approval:${caller.app.id}:${caller.userId}:${ip}`, DEVICE_APPROVAL_LIMIT)
    .catch(() => null);
  if (!limit) return fail("temporarily_unavailable");
  if (!limit.allowed) return fail("rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });

  const body = (await c.req.json().catch(() => null)) as { userCode?: unknown } | null;
  const userCode = normalizeUserCode(body && typeof body === "object" ? body.userCode : undefined);
  if (!userCode) return fail("invalid_request");

  const row = await c.env.DB
    .prepare(`SELECT "appId", "status", "userId", "expiresAt" FROM "deviceCode" WHERE "userCode" = ? LIMIT 1`)
    .bind(userCode)
    .first<CodeRow>()
    .catch(() => undefined);
  if (row === undefined) return fail("temporarily_unavailable");
  // Another app's code is indistinguishable from an unknown one.
  if (!row || row.appId !== caller.app.id) return fail("invalid_code");
  return { userCode, row };
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Only the bearer: the plugin resolves the session from it and from nothing else. */
function sessionHeaders(caller: Caller): Headers {
  return new Headers({ authorization: `Bearer ${caller.bearer}` });
}

type VerifyResponse = { status: string; client_id?: string } & Partial<KovaDeviceVerificationContext>;

export async function lookupDeviceRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const caller = await authorizeCaller(c);
  if (caller instanceof Response) return caller;
  const owned = await readOwnedCode(c, caller);
  if (owned instanceof Response) return owned;

  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  let verified: VerifyResponse;
  try {
    // Claims the code for this user when it is pending and unclaimed.
    verified = (await auth.api.deviceVerify({ query: { user_code: owned.userCode }, headers: sessionHeaders(caller) })) as VerifyResponse;
  } catch (error) {
    const code = deviceErrorCode(error);
    if (code === "expired_token") return fail("expired_token");
    if (code === "invalid_request") return fail("invalid_code");
    console.error("[kova-auth] app device lookup failed", error);
    return fail("server_error");
  }
  // The plugin returns the owner-only fields only to the account that holds the claim.
  if (!verified.client_id || verified.app_id !== caller.app.id) return fail("access_denied");

  return ok({
    userCode: formatUserCode(owned.userCode),
    status: verified.status,
    device: {
      label: verified.device_label ?? null,
      platform: verified.device_platform ?? null,
      hostname: verified.device_hostname ?? null,
    },
    requester: {
      city: verified.requester_city ?? null,
      country: verified.requester_country ?? null,
      ip: verified.requester_ip ?? null,
    },
    expiresAt: isoDate(owned.row.expiresAt),
  });
}

async function decide(c: Context<{ Bindings: Env }>, action: "approve" | "deny"): Promise<Response> {
  const caller = await authorizeCaller(c);
  if (caller instanceof Response) return caller;
  const owned = await readOwnedCode(c, caller);
  if (owned instanceof Response) return owned;

  if (action === "approve") {
    const blocked = await findMFAEnforcedOrgBlockingUser(c.env.DB, caller.userId).catch(() => null);
    if (blocked) return fail("mfa_required");
  }

  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const input = { body: { userCode: owned.userCode }, headers: sessionHeaders(caller) };
  try {
    if (action === "approve") await auth.api.deviceApprove(input);
    else await auth.api.deviceDeny(input);
  } catch (error) {
    switch (deviceErrorCode(error)) {
      case "expired_token":
        return fail("expired_token");
      case "access_denied":
        return fail("access_denied");
      case "invalid_request":
        // The plugin folds these into one code; the row read above tells them apart.
        if (owned.row.status !== "pending") return fail("already_processed");
        if (!owned.row.userId) return fail("not_claimed");
        return fail("invalid_code");
      default:
        console.error(`[kova-auth] app device ${action} failed`, error);
        return fail("server_error");
    }
  }
  return ok({ status: action === "approve" ? "approved" : "denied" });
}

export const approveDeviceRequest = (c: Context<{ Bindings: Env }>) => decide(c, "approve");
export const denyDeviceRequest = (c: Context<{ Bindings: Env }>) => decide(c, "deny");

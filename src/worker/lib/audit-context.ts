/**
 * Pure helpers that turn a request into the context stored on audit rows:
 * who (ip, client), where (geo), how (sign-in method), and what ended a session.
 * No I/O, so each is unit-testable.
 */
import Bowser from "bowser";
import InAppSpy from "inapp-spy";

// ── Client ────────────────────────────────────────────────────────────────────

export interface ClientDescription {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  /** bowser platform type: "mobile" | "tablet" | "desktop" | "tv" | ... */
  platform?: string;
  /** In-app browser key ("instagram", "facebook", "tiktok", ...) or null for a normal browser. */
  inApp?: string | null;
}

/**
 * Browser, OS, platform and in-app-browser detection from a User-Agent string.
 * inapp-spy is called with an explicit `ua`, so it never reads `window`.
 */
export function describeClient(userAgent: string | null | undefined): ClientDescription {
  if (!userAgent) return {};
  const parsed = Bowser.parse(userAgent);
  const inApp = InAppSpy({ ua: userAgent });
  return {
    browser: parsed.browser.name,
    browserVersion: parsed.browser.version,
    os: parsed.os.name,
    osVersion: parsed.os.version,
    platform: parsed.platform.type,
    inApp: inApp.isInApp ? (inApp.appKey ?? inApp.appName?.toLowerCase() ?? "unknown") : null,
  };
}

// ── Geo ───────────────────────────────────────────────────────────────────────

export interface AuditGeo {
  country?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  colo?: string;
  timezone?: string;
  latitude?: string;
  longitude?: string;
}

/** Geo fields from Cloudflare's `request.cf`. Absent fields are omitted. */
export function geoFromCf(cf: IncomingRequestCfProperties | undefined): AuditGeo {
  if (!cf) return {};
  const geo: AuditGeo = {};
  const set = (key: keyof AuditGeo, value: unknown) => {
    if (typeof value === "string" && value) geo[key] = value;
    else if (typeof value === "number") geo[key] = String(value);
  };
  set("country", cf.country);
  set("region", cf.region);
  set("regionCode", cf.regionCode);
  set("city", cf.city);
  set("colo", cf.colo);
  set("timezone", cf.timezone);
  set("latitude", cf.latitude);
  set("longitude", cf.longitude);
  return geo;
}

// ── Request ───────────────────────────────────────────────────────────────────

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Client IP and User-Agent from a Request or Headers. */
export function requestMeta(source: Request | Headers | null | undefined): RequestMeta {
  const headers = source instanceof Headers ? source : source?.headers;
  if (!headers) return { ipAddress: null, userAgent: null };
  return {
    ipAddress: headers.get("CF-Connecting-IP") ?? headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? null,
    userAgent: headers.get("User-Agent"),
  };
}

// ── Disposable email ──────────────────────────────────────────────────────────

/**
 * Whether the address uses a known disposable-mail domain. The list is a ~170 KB
 * JSON, so it is imported on first use (sign-up only) and never on the hot path.
 */
export async function isDisposableEmailAddress(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const mod: {
      isDisposableEmail?: (email: string) => boolean;
      default?: { isDisposableEmail?: (email: string) => boolean };
    } = await import("disposable-email-domains-js");
    const check = mod.isDisposableEmail ?? mod.default?.isDisposableEmail;
    return check ? check(email) : false;
  } catch {
    return false;
  }
}

// ── Sign-in method ────────────────────────────────────────────────────────────

export type SignInMethod =
  | "oauth"
  | "password"
  | "magic_link"
  | "passkey"
  | "email_verification"
  | "email_otp"
  | "two_factor"
  | "device_code"
  | "impersonation"
  | "unknown";

export interface SignInMethodInfo {
  method: SignInMethod;
  /** OAuth provider id ("google", "github", ...) when known. */
  provider?: string;
}

/**
 * Which Better Auth endpoint created a session. `path` is the matched route
 * (`/callback/:id`, with the real provider in `params.id`) but a concrete path
 * (`/callback/google`) is accepted too.
 */
export function signInMethodFromPath(
  path: string | undefined,
  params?: Record<string, string | undefined>,
): SignInMethodInfo {
  if (!path) return { method: "unknown" };

  const callback = /^\/(?:oauth2\/)?callback\/([^/]+)/.exec(path);
  if (callback) {
    const segment = callback[1]!;
    const provider = segment.startsWith(":") ? params?.id ?? params?.providerId : segment;
    return provider ? { method: "oauth", provider } : { method: "oauth" };
  }
  if (path === "/sign-in/social") return { method: "oauth" };
  if (path === "/one-tap/callback") return { method: "oauth", provider: "google" };
  if (path === "/sign-in/email" || path === "/sign-in/username" || path === "/sign-up/email") return { method: "password" };
  if (path === "/magic-link/verify" || path === "/sign-in/magic-link") return { method: "magic_link" };
  if (path === "/passkey/verify-authentication") return { method: "passkey" };
  if (path === "/verify-email") return { method: "email_verification" };
  if (path === "/sign-in/email-otp" || path === "/email-otp/verify-email") return { method: "email_otp" };
  if (path.startsWith("/two-factor/")) return { method: "two_factor" };
  if (path.startsWith("/device/") || path.startsWith("/kova/device/")) return { method: "device_code" };
  if (path === "/admin/impersonate-user") return { method: "impersonation" };
  return { method: "unknown" };
}

// ── Session end ───────────────────────────────────────────────────────────────

export type SessionEndReason = "expired" | "revoked" | "replaced" | "unknown";

export interface SessionEnd {
  /** `user.signOut` only when the user asked to leave; everything else is `session.ended`. */
  action: "user.signOut" | "session.ended";
  reason: SessionEndReason | "signed_out";
}

/**
 * Better Auth deletes session rows from many endpoints, not just sign-out:
 * expired-session cleanup in get-session, multi-session replacement after a
 * same-user sign-in, 2FA discarding the provisional session, revoke-*, admin
 * actions, password changes. Only these two are the user choosing to sign out:
 *
 * - `/sign-out`: the sign-out button (also drops the other multi-session cookies).
 * - `/multi-session/revoke`: the user removing one of their signed-in accounts.
 *
 * `/revoke-session(s)` and `/revoke-other-sessions` are the user managing
 * sessions, not leaving this one, so they are `session.ended` with reason "revoked".
 */
export function classifySessionEnd(
  path: string | null | undefined,
  /** The deleted row's expiry (epoch ms), when known: a past expiry means cleanup, not a decision. */
  expiresAtMs?: number | null,
  now = Date.now(),
): SessionEnd {
  if (path === "/sign-out" || path === "/multi-session/revoke") {
    return { action: "user.signOut", reason: "signed_out" };
  }
  if (path === "/get-session" || (expiresAtMs != null && expiresAtMs <= now)) {
    return { action: "session.ended", reason: "expired" };
  }
  if (!path) return { action: "session.ended", reason: "unknown" };
  if (
    path === "/revoke-session" ||
    path === "/revoke-sessions" ||
    path === "/revoke-other-sessions" ||
    path === "/change-password" ||
    path === "/reset-password" ||
    path.startsWith("/admin/") ||
    path.startsWith("/delete-user")
  ) {
    return { action: "session.ended", reason: "revoked" };
  }
  // A session created and immediately swapped out: sign-in cleanup of the same
  // user's older sessions (multi-session), or 2FA discarding the provisional row.
  if (signInMethodFromPath(path).method !== "unknown" || path.startsWith("/sign-in/")) {
    return { action: "session.ended", reason: "replaced" };
  }
  return { action: "session.ended", reason: "unknown" };
}

// ── Auth failure ──────────────────────────────────────────────────────────────

/**
 * The error code of a failed Better Auth endpoint result, or null if it
 * succeeded. Reads `ctx.context.returned`, which is an APIError (or Response)
 * on failure. Redirect endpoints (magic link) report failure as an `?error=`
 * on the Location. Only the code is returned: never the message or body, which
 * can echo user input.
 */
export function authFailureCode(returned: unknown): string | null {
  if (typeof returned !== "object" || returned === null) return null;
  const result = returned as { statusCode?: unknown; status?: unknown; body?: unknown; headers?: unknown };
  const httpStatus =
    typeof result.statusCode === "number" ? result.statusCode : typeof result.status === "number" ? result.status : null;
  if (httpStatus === null) return null;

  if (httpStatus >= 400) {
    const code = (result.body as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string") return code;
    return typeof result.status === "string" ? result.status : String(httpStatus);
  }
  if (httpStatus >= 300) {
    try {
      const location = new Headers(result.headers as HeadersInit | undefined).get("location");
      return location ? new URL(location, "http://localhost").searchParams.get("error") : null;
    } catch {
      return null;
    }
  }
  return null;
}

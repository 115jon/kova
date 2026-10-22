/**
 * Approving a device code from your own site (Discord-style /activate).
 * No React. Use it from the page your app's "Device activation URL" points at.
 *
 * ```ts
 * const code = new URLSearchParams(location.search).get("code") ?? "";
 * const opts = { authUrl, publishableKey, sessionToken, userCode: code };
 *
 * const found = await getDeviceRequest(opts);       // claims the code for this user
 * if (found.ok) show(found.request.device, found.request.requester);
 * const result = await approveDeviceRequest(opts);  // or denyDeviceRequest(opts)
 *
 * // "Not you?": give the code up BEFORE signing out, so the next account can claim it.
 * await releaseDeviceRequest(opts);
 * ```
 *
 * `sessionToken` is the signed-in user's app-scoped session token (the
 * provider's `useKovaAuth().sessionToken`). The server only accepts these
 * calls from a web page on one of the app's allowed origins (not a desktop
 * webview), and only for the account that looked the code up first.
 *
 * Nothing here throws: every call resolves to `{ ok: true, … }` or
 * `{ ok: false, error, status, message }`.
 */

export interface DeviceApprovalOptions {
  /** Kova base URL, e.g. your provider's `authUrl`. */
  authUrl: string;
  publishableKey: string;
  /** App-scoped session token of the signed-in user (sent as a Bearer). */
  sessionToken: string;
  /** As shown on the device, XXXX-XXXX (case and dashes do not matter). */
  userCode: string;
  fetch?: typeof fetch;
}

export interface DeviceRequest {
  /** Display form, XXXX-XXXX. */
  userCode: string;
  status: "pending" | "approved" | "denied";
  /** What the device said about itself. Display only; it is not verified. */
  device: { label: string | null; platform: string | null; hostname: string | null };
  /** Where the device's request came from, as Kova saw it. */
  requester: { city: string | null; country: string | null; ip: string | null };
  /** ISO 8601. */
  expiresAt: string | null;
}

/** Server error codes, plus `network_error` and `unexpected_response` from this client. */
export type DeviceApprovalErrorCode =
  | "app_not_found"
  | "app_suspended"
  | "origin_not_allowed"
  | "invalid_session"
  | "invalid_request"
  | "rate_limited"
  | "invalid_code"
  | "expired_token"
  | "access_denied"
  | "not_claimed"
  | "already_processed"
  | "mfa_required"
  | "temporarily_unavailable"
  | "server_error"
  | "network_error"
  | "unexpected_response";

export interface DeviceApprovalError {
  ok: false;
  error: DeviceApprovalErrorCode;
  /** HTTP status; 0 for network_error. */
  status: number;
  message: string;
  /** Seconds, on rate_limited. */
  retryAfterSeconds?: number;
}

export type DeviceRequestResult = { ok: true; request: DeviceRequest } | DeviceApprovalError;
export type DeviceDecisionResult = { ok: true; status: "approved" | "denied" } | DeviceApprovalError;
export type DeviceReleaseResult = { ok: true; status: "released" } | DeviceApprovalError;

const SERVER_CODES = new Set<DeviceApprovalErrorCode>([
  "app_not_found", "app_suspended", "origin_not_allowed", "invalid_session", "invalid_request",
  "rate_limited", "invalid_code", "expired_token", "access_denied", "not_claimed",
  "already_processed", "mfa_required", "temporarily_unavailable", "server_error",
]);

async function post(
  step: "lookup" | "approve" | "deny" | "release",
  options: DeviceApprovalOptions,
): Promise<{ ok: true; body: Record<string, unknown> } | DeviceApprovalError> {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const url = `${options.authUrl.replace(/\/+$/, "")}/api/pub/apps/${encodeURIComponent(options.publishableKey)}/device/${step}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      // Bearer only: the server ignores cookies on these routes.
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.sessionToken}`,
      },
      body: JSON.stringify({ userCode: options.userCode }),
    });
  } catch (error) {
    return { ok: false, error: "network_error", status: 0, message: error instanceof Error ? error.message : "Network error" };
  }

  const parsed = await response.json().catch(() => null);
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (response.ok && body) return { ok: true, body };

  const code = typeof body?.error === "string" && SERVER_CODES.has(body.error as DeviceApprovalErrorCode)
    ? (body.error as DeviceApprovalErrorCode)
    : "unexpected_response";
  const failure: DeviceApprovalError = {
    ok: false,
    error: code,
    status: response.status,
    message: typeof body?.message === "string" ? body.message : `HTTP ${response.status}`,
  };
  const retryAfter = Number(response.headers.get("retry-after"));
  if (code === "rate_limited" && Number.isFinite(retryAfter) && retryAfter > 0) failure.retryAfterSeconds = retryAfter;
  return failure;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readRequest(body: Record<string, unknown>): DeviceRequest | null {
  const status = body.status;
  if (typeof body.userCode !== "string" || (status !== "pending" && status !== "approved" && status !== "denied")) return null;
  const device = (body.device ?? {}) as Record<string, unknown>;
  const requester = (body.requester ?? {}) as Record<string, unknown>;
  return {
    userCode: body.userCode,
    status,
    device: { label: text(device.label), platform: text(device.platform), hostname: text(device.hostname) },
    requester: { city: text(requester.city), country: text(requester.country), ip: text(requester.ip) },
    expiresAt: text(body.expiresAt),
  };
}

const unexpected = (status: number): DeviceApprovalError => ({ ok: false, error: "unexpected_response", status, message: "Unexpected response from Kova" });

/**
 * Looks the code up and claims it for this user (the first signed-in account
 * to look a pending code up holds it until it is decided or expires). Call it
 * before approve or deny; they answer `not_claimed` otherwise.
 */
export async function getDeviceRequest(options: DeviceApprovalOptions): Promise<DeviceRequestResult> {
  const result = await post("lookup", options);
  if (!result.ok) return result;
  const request = readRequest(result.body);
  return request ? { ok: true, request } : unexpected(200);
}

async function decide(step: "approve" | "deny", options: DeviceApprovalOptions): Promise<DeviceDecisionResult> {
  const result = await post(step, options);
  if (!result.ok) return result;
  const status = result.body.status;
  return status === "approved" || status === "denied" ? { ok: true, status } : unexpected(200);
}

/** Signs the device in as this user. The device picks the session up on its next poll. */
export function approveDeviceRequest(options: DeviceApprovalOptions): Promise<DeviceDecisionResult> {
  return decide("approve", options);
}

/** Refuses the device. It stops polling with `denied`. */
export function denyDeviceRequest(options: DeviceApprovalOptions): Promise<DeviceDecisionResult> {
  return decide("deny", options);
}

/**
 * Gives up this account's claim on a pending code, so another account can
 * look it up. Call it on "Not you?" BEFORE signing out: once signed out there
 * is no session to release with, and the code stays held until it expires.
 * Fails with `access_denied` (someone else holds it), `not_claimed`,
 * `already_processed`, or `expired_token`, like approve/deny.
 */
export async function releaseDeviceRequest(options: DeviceApprovalOptions): Promise<DeviceReleaseResult> {
  const result = await post("release", options);
  if (!result.ok) return result;
  return result.body.status === "released" ? { ok: true, status: "released" } : unexpected(200);
}

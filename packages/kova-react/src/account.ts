/**
 * Signed-in user's own account data: active sessions and recent activity.
 * No React. `<UserSecurity />` is built on these.
 *
 * ```ts
 * const opts = { authUrl, publishableKey, sessionToken };
 * const { sessions } = await getAccountSessions(opts);
 * await revokeAccountSession(opts, sessions[1].id);
 * ```
 *
 * Every call sends the app-scoped session token as a Bearer and throws an
 * `AccountApiError` on a network failure or a non-2xx response.
 */

export interface AccountRequestOptions {
  /** Kova base URL, e.g. your provider's `authUrl`. */
  authUrl: string;
  publishableKey: string;
  /** App-scoped session token of the signed-in user (sent as a Bearer). */
  sessionToken: string;
  fetch?: typeof fetch;
}

/** What Kova parsed from the user agent. Display only. */
export interface AccountClientInfo {
  browser?: string | null;
  os?: string | null;
  platform?: string | null;
  /** Name of the app whose in-app browser was used, e.g. "Instagram". */
  inApp?: string | null;
}

export interface AccountActivityEvent {
  id: string;
  /** Audit action, e.g. "user.signIn" or "user.signInFailed". */
  action: string;
  /** Epoch milliseconds. */
  createdAt: number;
  appName: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  city: string | null;
  client: AccountClientInfo | null;
}

export interface AccountActivityPage {
  events: AccountActivityEvent[];
  /** Pass as `before` to load the next page; null on the last page. */
  nextCursor: string | null;
}

export interface AccountSession {
  id: string;
  /** Null for a session on Kova itself rather than an app. */
  appName: string | null;
  /** True for the session making this request. */
  current: boolean;
  createdAt: number;
  lastActiveAt: number;
  country: string | null;
  city: string | null;
  client: AccountClientInfo | null;
}

export class AccountApiError extends Error {
  /** HTTP status; 0 for a network failure. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

export function accountBaseUrl(options: Pick<AccountRequestOptions, "authUrl" | "publishableKey">): string {
  return `${options.authUrl.replace(/\/+$/, "")}/api/pub/apps/${encodeURIComponent(options.publishableKey)}/account`;
}

async function request<T>(
  options: AccountRequestOptions,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(input, i));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.sessionToken}`,
    "X-Publishable-Key": options.publishableKey,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetchImpl(`${accountBaseUrl(options)}${path}`, {
      method: init.method,
      // Bearer only: cookies are not part of this contract.
      credentials: "omit",
      cache: "no-store",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    throw new AccountApiError(error instanceof Error ? error.message : "Network error", 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${response.status}`;
    throw new AccountApiError(message, response.status);
  }
  if (!body || typeof body !== "object") {
    throw new AccountApiError("Unexpected response", response.status);
  }
  return body as T;
}

/** One page of the user's recent activity, newest first. */
export async function getAccountActivity(
  options: AccountRequestOptions,
  page: { before?: string | null; limit?: number } = {},
): Promise<AccountActivityPage> {
  const params = new URLSearchParams();
  if (page.before) params.set("before", page.before);
  if (page.limit !== undefined) params.set("limit", String(Math.min(50, Math.max(1, Math.trunc(page.limit)))));
  const query = params.toString();
  const body = await request<Partial<AccountActivityPage>>(options, `/activity${query ? `?${query}` : ""}`);
  return { events: body.events ?? [], nextCursor: body.nextCursor ?? null };
}

/** The user's active sessions across Kova and its apps. */
export async function getAccountSessions(options: AccountRequestOptions): Promise<AccountSession[]> {
  const body = await request<{ sessions?: AccountSession[] }>(options, "/sessions");
  return body.sessions ?? [];
}

/** Sign one session out. */
export async function revokeAccountSession(options: AccountRequestOptions, sessionId: string): Promise<void> {
  await request(options, "/sessions/revoke", { method: "POST", body: { sessionId } });
}

/** Sign out every session except the current one. Resolves to how many ended. */
export async function revokeOtherAccountSessions(options: AccountRequestOptions): Promise<number> {
  const body = await request<{ revoked?: number }>(options, "/sessions/revoke-others", { method: "POST", body: {} });
  return typeof body.revoked === "number" ? body.revoked : 0;
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** "Safari on iOS", "Safari", or "Unknown device". */
export function deviceLabel(client: AccountClientInfo | null): string {
  const browser = client?.browser?.trim();
  const os = client?.os?.trim();
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}

function countryName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Lisbon, Portugal", either part alone, or null when neither is known. */
export function locationLabel(city: string | null, country: string | null, locale?: string): string | null {
  const parts = [city?.trim(), country ? countryName(country, locale) : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}

const ACTION_LABELS: Record<string, string> = {
  "user.signInFailed": "Failed sign-in",
  "user.signOut": "Signed out",
  "user.signUp": "Account created",
  "app.signIn": "Signed in to app",
  "app.signOut": "Signed out of app",
  "session.ended": "Session ended",
  "twoFactor.challengeFailed": "Failed 2FA",
  "twoFactor.enabled": "Two-factor turned on",
  "twoFactor.disabled": "Two-factor turned off",
  "user.passwordChanged": "Password changed",
  "security.signInAlertSent": "Sign-in alert sent",
  "security.signOutEverywhere": "Signed out everywhere",
};

/** Human label for an audit action; unknown ones are humanized. */
export function activityLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  if (action.startsWith("user.signIn")) return "Signed in";
  const words = action
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : action;
}

/** Failed attempts get a quieter warning treatment in the activity list. */
export function isFailedActivity(action: string): boolean {
  return action.includes("Failed");
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["minute", 60],
  ["hour", 60],
  ["day", 24],
  ["week", 7],
];

/** "Just now", "5 minutes ago", "yesterday"; a date after about a month. */
export function relativeTime(ms: number, now: number = Date.now(), locale?: string): string {
  let value = Math.round((now - ms) / 1000);
  if (value < 60) return "Just now";
  value = Math.floor(value / 60);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  for (let i = 1; i < RELATIVE_UNITS.length; i++) {
    const [next, size] = RELATIVE_UNITS[i]!;
    if (value < size) break;
    value = Math.floor(value / size);
    unit = next;
  }
  if (unit === "week" && value > 4) {
    return new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" });
  }
  return rtf.format(-value, unit);
}

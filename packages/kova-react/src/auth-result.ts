/**
 * Helpers for Better Auth client calls. Those resolve with `{ data, error }`
 * instead of throwing, so a hook that only awaits them reports success for a
 * wrong password, a bad code, or a rate limit.
 */

interface AuthErrorBody {
  message?: string;
  code?: string;
  status?: number;
  statusText?: string;
}

/** Thrown by `unwrapAuthResult`; `status` and `response` feed the 429 countdown. */
export interface AuthCallError extends Error {
  status?: number;
  code?: string;
  response?: Response;
}

type FetchHooks = { onError: (ctx: { response?: Response }) => void };

/**
 * Runs a client call and throws when it came back with an `error`. The call
 * receives fetch hooks so the failing `Response` (and its `Retry-After`) is
 * kept on the thrown error.
 */
export async function unwrapAuthResult<T>(call: (hooks: FetchHooks) => Promise<T>): Promise<T> {
  let response: Response | undefined;
  const result = await call({
    onError(ctx) {
      response = ctx.response;
    },
  });
  const error = (result as { error?: AuthErrorBody | null } | null | undefined)?.error;
  if (error) {
    throw Object.assign(new Error(error.message || error.statusText || "Something went wrong. Try again."), {
      status: error.status,
      code: error.code,
      response,
    }) as AuthCallError;
  }
  return result;
}

/** The user closed or dismissed the browser's passkey prompt. Not worth an error. */
export function isPasskeyCancel(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "ERROR_CEREMONY_ABORTED" || error?.code === "AUTH_CANCELLED";
}

/**
 * With `requireEmailVerification` the server answers a sign-up with a user and
 * no session token; the account is usable only after the emailed link.
 */
export function signUpNeedsVerification(data: { token?: string | null } | null | undefined): boolean {
  return !!data && !data.token;
}

/**
 * Passkeys are bound to the auth server's origin. A page on another origin
 * (the SDK embedded in an app) cannot create or use one, so the option is
 * hidden there instead of failing after the user picks it.
 */
export function passkeyUsableHere(authUrl: string, page: { origin: string } | undefined, hasWebAuthn: boolean): boolean {
  if (!hasWebAuthn || !page) return false;
  try {
    return new URL(authUrl).origin === page.origin;
  } catch {
    return false;
  }
}

/**
 * Resolves a potentially-relative path to an absolute URL rooted at the
 * client app's origin. Better Auth would otherwise resolve it against its own
 * baseURL and send the browser to the auth server instead of back to the app.
 * An already-absolute URL is returned unchanged.
 */
export function resolveAbsoluteUrl(authUrl: string, path?: string): string {
  const input = path ?? "/";
  try {
    new URL(input);
    return input;
  } catch {
    const appOrigin = typeof window !== "undefined" ? window.location.origin : authUrl.replace(/\/$/, "");
    const segment = input.startsWith("/") ? input : `/${input}`;
    return `${appOrigin}${segment}`;
  }
}

/**
 * Where the auth server sends the browser after an app's SDK sign-in finishes:
 * the bounce endpoint mints an app session and returns to `redirectUri` with a
 * `kova_auth_code` the provider exchanges. `state` is echoed back so the
 * provider can tell the flow was started in this browser; `fresh` makes the
 * bounce refuse a session it did not just create (an already-used email link).
 */
export function buildSdkBounceUrl(
  authUrl: string,
  publishableKey: string,
  redirectUri: string,
  opts: { state?: string; fresh?: boolean } = {},
): string {
  const bounce = new URL(`${authUrl.replace(/\/+$/, "")}/api/hosted/oauth-complete`);
  bounce.searchParams.set("mode", "sdk");
  bounce.searchParams.set("pk", publishableKey);
  bounce.searchParams.set("redirect_uri", redirectUri);
  if (opts.state) bounce.searchParams.set("state", opts.state);
  if (opts.fresh) bounce.searchParams.set("fresh", "1");
  return bounce.toString();
}

/**
 * Starts a provider sign-in for an app. The auth server sets its OAuth state
 * cookie here, sends the browser to the provider, then through the bounce to
 * `redirectUri` with a `kova_auth_code` and this `state`.
 */
export function buildSdkOAuthStartUrl(
  authUrl: string,
  publishableKey: string,
  provider: string,
  redirectUri: string,
  errorCallbackURL: string,
  state?: string,
): string {
  const start = new URL(`${authUrl}/api/pub/apps/${publishableKey}/oauth/start`);
  start.searchParams.set("provider", provider);
  start.searchParams.set("redirect_uri", redirectUri);
  start.searchParams.set("error_callback_url", errorCallbackURL);
  if (state) start.searchParams.set("state", state);
  return start.toString();
}

/**
 * callbackURL for links sent by email (magic link, verification). The link is
 * opened in a fresh navigation with no Origin or publishable key, so the auth
 * server can only vouch for its own URLs; an app's own URL is refused with a
 * 403. Apps therefore return through the bounce, which checks the app's
 * redirect allowlist itself.
 */
export function emailLinkCallbackUrl(
  authUrl: string,
  publishableKey: string | undefined,
  appCallback: string,
  state?: string,
): string {
  return publishableKey ? buildSdkBounceUrl(authUrl, publishableKey, appCallback, { state, fresh: true }) : appCallback;
}

/**
 * What to tell the user when an emailed link or a provider sign-in came back
 * with an error code (`kova_auth_error` on an app page, `error` on the hosted
 * pages). Codes are Better Auth's.
 */
export function authErrorMessage(code: string): string {
  switch (code.toUpperCase()) {
    case "INVALID_TOKEN":
      return "That link isn't valid. Request a new one.";
    case "TOKEN_EXPIRED":
    case "EXPIRED_TOKEN":
      return "That link has expired. Request a new one.";
    case "ATTEMPTS_EXCEEDED":
      return "That link was already used. Request a new one.";
    case "INVALID_USER":
      return "That link is for a different account. Sign out, then open it again.";
    case "STATE_MISMATCH":
      return "This link was opened in a different browser from the one that started signing in. Go back to that browser, or sign in again here.";
    case "MISSING_STATE":
      return "That sign-in link wasn't started from this app. Sign in again here.";
    case "ALREADY_USED":
      return "That link was already used. Sign in again.";
    case "OAUTH":
      return "Sign-in with that provider didn't finish. Try again.";
    default:
      return "Sign-in didn't finish. Try again.";
  }
}

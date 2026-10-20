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
 * Where the auth server sends the browser after an app's SDK sign-in finishes:
 * the bounce endpoint mints an app session and returns to `redirectUri` with a
 * `kova_auth_code` the provider exchanges.
 */
export function buildSdkBounceUrl(authUrl: string, publishableKey: string, redirectUri: string): string {
  const bounce = new URL(`${authUrl.replace(/\/+$/, "")}/api/hosted/oauth-complete`);
  bounce.searchParams.set("mode", "sdk");
  bounce.searchParams.set("pk", publishableKey);
  bounce.searchParams.set("redirect_uri", redirectUri);
  return bounce.toString();
}

/**
 * callbackURL for links sent by email (magic link, verification). The link is
 * opened in a fresh navigation with no Origin or publishable key, so the auth
 * server can only vouch for its own URLs; an app's own URL is refused with a
 * 403. Apps therefore return through the bounce, which checks the app's
 * redirect allowlist itself.
 */
export function emailLinkCallbackUrl(authUrl: string, publishableKey: string | undefined, appCallback: string): string {
  return publishableKey ? buildSdkBounceUrl(authUrl, publishableKey, appCallback) : appCallback;
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
    case "OAUTH":
      return "Sign-in with that provider didn't finish. Try again.";
    default:
      return "Sign-in didn't finish. Try again.";
  }
}

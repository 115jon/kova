import { getAppId, setAppId } from "./app-context";

/**
 * An SDK app on a sibling host (yap.115jon.com next to auth.115jon.com) sends
 * its app bearer token with `credentials: "include"`, so the browser also
 * attaches the auth-domain cookies, including `session_token_multi-<parent>`.
 *
 * Better Auth must never see both. The bearer plugin swaps the session cookie
 * for the app token but keeps the multi-session cookies; when it then refreshes
 * the app session, the multi-session plugin treats that as a new sign-in of the
 * same user and deletes every other session in those cookies, which is this
 * browser's own SSO session. Sign-out with a bearer deletes them all outright.
 *
 * A bearer request identifies itself by the token alone, so drop the session
 * cookies (session_token, session_token_multi-*, session_data). Keep the rest:
 * mid-sign-in steps (two_factor, passkey challenge, dont_remember) read their
 * own signed cookies even when a stale bearer is attached.
 */
export function bearerToken(headers: Headers): string | null {
  return headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function isSessionCookie(name: string): boolean {
  return /(^|[._-])session_(token|data)($|_multi-)/.test(name);
}

export function withoutCookiesForBearer(headers: Headers): Headers {
  const cookie = headers.get("cookie");
  if (!bearerToken(headers) || !cookie) return headers;
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !isSessionCookie(part.split("=", 1)[0]!.trim()));
  const next = new Headers(headers);
  if (kept.length) next.set("cookie", kept.join("; "));
  else next.delete("cookie");
  return next;
}

/** Rebuilds the request only when cookies change; carries the app id over. */
export function requestWithoutCookiesForBearer(request: Request): Request {
  const headers = withoutCookiesForBearer(request.headers);
  if (headers === request.headers) return request;
  const next = new Request(request, { headers });
  const appId = getAppId(request);
  if (appId) setAppId(next, appId);
  return next;
}

/**
 * App-scoped sessions (`session.app_id` set) are bearer tokens minted for one
 * SDK application. Better Auth's bearer plugin accepts any session token, so
 * anything that manages the platform or a user's credentials has to refuse
 * them explicitly. `get-session` already scopes them; this is the shared guard
 * for everything else.
 *
 * What an app-scoped token may still reach under /api/auth, because the SDK and
 * the hosted pages use it: get-session, sign-out, update-user, revoke-session,
 * list-accounts, multi-session/*, and the organization reads and
 * set-active that OrgSwitcher and useOrganization call. link-social is not
 * among them: linking an account changes the platform identity, so it needs the
 * platform session, and SDK apps send users to Kova settings instead.
 * OAuth client and consent management under /oauth2/ is platform-only too;
 * the OIDC protocol endpoints themselves stay open.
 */
import { parseCookies } from "better-auth/cookies";
import type { MiddlewareHandler } from "hono";

const SESSION_COOKIE_NAMES = new Set(["better-auth.session_token", "__Secure-better-auth.session_token"]);
const AUTH_BASE = "/api/auth/";

/** Organization endpoints the SDK components call with an app-scoped token. */
const ORGANIZATION_ALLOWED = new Set([
  "list",
  "set-active",
  "get-full-organization",
  "get-active-member",
  "get-active-member-role",
]);

/**
 * Credential and account management. list-sessions is here because it returns
 * every session of the user, including the platform sessions' tokens.
 */
const PLATFORM_ONLY_AUTH_PATHS = new Set([
  "delete-user",
  "delete-user/callback",
  "change-email",
  "change-password",
  "unlink-account",
  "link-social",
  "list-sessions",
  "revoke-sessions",
  "revoke-other-sessions",
  "two-factor/enable",
  "two-factor/disable",
  "two-factor/generate-backup-codes",
  "two-factor/get-totp-uri",
  "passkey/generate-register-options",
  "passkey/verify-registration",
  "passkey/list-user-passkeys",
  "passkey/delete-passkey",
  "passkey/update-passkey",
]);

/**
 * oauth-provider endpoints that implement the OAuth/OIDC protocol itself.
 * Everything else under /oauth2/ manages clients or consents: platform only.
 */
const OAUTH2_PROTOCOL_PATHS = new Set([
  "authorize",
  "token",
  "userinfo",
  "consent",
  "continue",
  "end-session",
  "endsession",
  "introspect",
  "revoke",
  "register",
  "public-client",
  "public-client-prelogin",
]);

/** True for Better Auth endpoints an app-scoped session must not reach. Over-matches rather than under-matches. */
export function isPlatformOnlyAuthPath(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  path = path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!path.startsWith(AUTH_BASE)) return false;

  const rest = path.slice(AUTH_BASE.length);
  const [first = "", ...tail] = rest.split("/");
  if (first === "admin" || first === "api-key") return true;
  if (first === "organization") return !ORGANIZATION_ALLOWED.has(tail.join("/"));
  if (first === "oauth2") return !OAUTH2_PROTOCOL_PATHS.has(tail.join("/"));
  return PLATFORM_ONLY_AUTH_PATHS.has(rest);
}

/**
 * Every session token the request could authenticate with: the bearer and the
 * session cookie. Cookies go through Better Auth's own parser and the bearer is
 * read both literally and decoded, so this cannot disagree with what the
 * handlers later accept. Extra candidates only widen what gets refused.
 */
export function requestSessionTokens(headers: Headers): string[] {
  const tokens = new Set<string>();
  // Cookies and signed bearers are `token.signature`; the table stores the token.
  const add = (value: string) => {
    tokens.add(value);
    const signed = value.lastIndexOf(".");
    if (signed > 0) {
      tokens.add(value.slice(0, signed));
      tokens.add(value.split(".")[0]!);
    }
  };

  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    add(bearer);
    try {
      add(decodeURIComponent(bearer));
    } catch {
      // Not percent-encoded.
    }
  }
  const cookies = parseCookies(headers.get("cookie") ?? "");
  for (const name of SESSION_COOKIE_NAMES) {
    const value = cookies.get(name);
    if (value) add(value);
  }
  return [...tokens];
}

/**
 * Checks every credential the request carries, not the one Better Auth ends up
 * preferring, so the two cannot disagree. Throws if the lookup fails.
 */
export async function carriesAppScopedSession(db: D1Database, headers: Headers): Promise<boolean> {
  const tokens = requestSessionTokens(headers);
  if (tokens.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS scoped FROM session
       WHERE token IN (${tokens.map(() => "?").join(", ")}) AND app_id IS NOT NULL AND app_id != ''
       LIMIT 1`,
    )
    .bind(...tokens)
    .first();
  return !!row;
}

/** A response to return when the request must not proceed, or null when it may. */
export async function rejectAppScopedSession(db: D1Database, headers: Headers): Promise<Response | null> {
  let scoped: boolean;
  try {
    scoped = await carriesAppScopedSession(db, headers);
  } catch {
    return Response.json({ error: "session_check_failed" }, { status: 503 });
  }
  if (!scoped) return null;
  return Response.json(
    {
      error: "platform_session_required",
      message: "This endpoint cannot be used with an app session token.",
    },
    { status: 403 },
  );
}

export const platformSessionOnly: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const rejection = await rejectAppScopedSession(c.env.DB, c.req.raw.headers);
  if (rejection) return rejection;
  await next();
};

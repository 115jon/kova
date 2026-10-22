/**
 * Kova as an OIDC issuer for first-party tools (1:15 Forgejo, LiteLLM SSO),
 * on Better Auth's oauth-provider plugin.
 *
 * Better Auth 1.7 removed the old `oidcProvider` plugin. Its replacement keeps
 * clients in the database instead of in config, emits standard claims only at
 * UserInfo, and accepts exactly one registered client-auth method. Forgejo
 * links accounts by `sub` and LiteLLM is configured with fixed endpoint URLs,
 * so everything here exists to keep what those two already see unchanged:
 *
 *   - the same client ids, secrets (from env) and redirect URIs, seeded into
 *     `oauthClient` on first use (`ensureTrustedOidcClients`);
 *   - `sub` = user id, and the exact claim set the old plugin put in the ID
 *     token and UserInfo (`legacyIdTokenClaims`, `legacyUserInfoClaims`);
 *   - client_secret_post and client_secret_basic both accepted at the token
 *     endpoint (`legacyTokenRequest`);
 *   - offline_access without PKCE still signing in (`legacyAuthorizeUrl`).
 */
import type { Auth } from "../auth";

// Preview door. A stable hostname should replace this before the door is closed.
export const FORGEJO_OIDC_REDIRECTS = [
  "https://git.115jon.com/user/oauth2/kova/callback",
  "https://oci-a1.tail91a4f4.ts.net/git/user/oauth2/kova/callback",
] as const;

export const LITELLM_OIDC_REDIRECTS = [
  "https://lite.115jon.com/sso/callback",
  "https://bright-fern-soob.115jon.com/sso/callback",
] as const;

/** The scopes the old plugin accepted. Order is what discovery advertises. */
export const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/** Old plugin lifetimes: 1h access + ID token, 7d refresh, 10m code. */
export const OIDC_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OIDC_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OIDC_CODE_TTL_SECONDS = 10 * 60;

export type TrustedOidcClient = {
  clientId: string;
  clientSecret: string;
  name: string;
  redirectUris: string[];
  product: string;
};

function trustedOidcClient(
  clientId: string | undefined,
  clientSecret: string | undefined,
  name: string,
  redirectUris: readonly string[],
  product: string,
): TrustedOidcClient | null {
  const id = clientId?.trim();
  const secret = clientSecret?.trim();
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret, name, redirectUris: [...redirectUris], product };
}

// Public registration stays off. A client is trusted only when both secrets exist.
export function trustedOidcClients(
  env: Pick<Env, "FORGEJO_OIDC_CLIENT_ID" | "FORGEJO_OIDC_CLIENT_SECRET" | "LITELLM_OIDC_CLIENT_ID" | "LITELLM_OIDC_CLIENT_SECRET">,
): TrustedOidcClient[] {
  return [
    trustedOidcClient(env.FORGEJO_OIDC_CLIENT_ID, env.FORGEJO_OIDC_CLIENT_SECRET, "1:15", FORGEJO_OIDC_REDIRECTS, "forgejo"),
    trustedOidcClient(env.LITELLM_OIDC_CLIENT_ID, env.LITELLM_OIDC_CLIENT_SECRET, "LiteLLM", LITELLM_OIDC_REDIRECTS, "litellm"),
  ].filter((client): client is TrustedOidcClient => client !== null);
}

// ── Claims ────────────────────────────────────────────────────────────────────

type ClaimUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  updatedAt: Date | string | number;
  [key: string]: unknown;
};

export function preferredUsername(user: ClaimUser): string {
  return typeof user.username === "string" && user.username.trim()
    ? user.username.trim()
    : user.email.split("@")[0] ?? user.id;
}

/** The old plugin's split: first word and second word, nothing smarter. */
function legacyNameParts(name: string): { given_name: string; family_name: string | undefined } {
  const parts = name.split(" ");
  return { given_name: parts[0] ?? "", family_name: parts[1] };
}

/**
 * Claims the old plugin signed into the ID token beyond the protocol ones:
 * profile and email scope claims, plus preferred_username always. `profile`
 * carried the avatar URL there (not `picture`); kept as it was.
 */
export function legacyIdTokenClaims(user: ClaimUser, scopes: readonly string[]): Record<string, unknown> {
  return {
    ...(scopes.includes("profile")
      ? {
          ...legacyNameParts(user.name),
          name: user.name,
          profile: user.image ?? null,
          updated_at: new Date(user.updatedAt).toISOString(),
        }
      : {}),
    ...(scopes.includes("email") ? { email: user.email, email_verified: !!user.emailVerified } : {}),
    preferred_username: preferredUsername(user),
  };
}

/**
 * UserInfo extras over the plugin's standard claims: the old first/second
 * word name split, a null `picture` rather than none, and preferred_username
 * (LiteLLM's default user-id attribute) regardless of scope.
 */
export function legacyUserInfoClaims(user: ClaimUser, scopes: readonly string[]): Record<string, unknown> {
  return {
    ...(scopes.includes("profile")
      ? { ...legacyNameParts(user.name), name: user.name, picture: user.image ?? null }
      : {}),
    ...(scopes.includes("email") ? { email: user.email, email_verified: !!user.emailVerified } : {}),
    preferred_username: preferredUsername(user),
  };
}

/** What discovery advertises: the old list plus everything we actually emit. */
export const OIDC_CLAIMS_SUPPORTED = [
  "sub", "iss", "aud", "exp", "nbf", "iat", "jti", "sid", "scope", "azp", "auth_time", "acr",
  "email", "email_verified", "name", "given_name", "family_name", "picture", "profile",
  "updated_at", "preferred_username",
];

// ── Client seeding ────────────────────────────────────────────────────────────

/** oauth-provider's default `storeClientSecret: "hashed"`: base64url(SHA-256), unpadded. */
export async function hashOidcClientSecret(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type SeededClientRow = {
  clientId: string;
  clientSecret?: string | null;
  name?: string | null;
  redirectUris?: string[] | null;
  tokenEndpointAuthMethod?: string | null;
  grantTypes?: string[] | null;
  skipConsent?: boolean | null;
  requirePKCE?: boolean | null;
  disabled?: boolean | null;
};

async function desiredRow(client: TrustedOidcClient) {
  return {
    clientId: client.clientId,
    clientSecret: await hashOidcClientSecret(client.clientSecret),
    name: client.name,
    redirectUris: client.redirectUris,
    // Requests arrive as either; legacyTokenRequest folds post into basic.
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    applicationType: "web",
    // First-party: no consent screen, and no PKCE (neither client sends it).
    skipConsent: true,
    requirePKCE: false,
    disabled: false,
    metadata: { product: client.product, seededBy: "kova-env" },
  };
}

function sameStrings(a: readonly string[] | null | undefined, b: readonly string[]): boolean {
  return !!a && a.length === b.length && a.every((value, index) => value === b[index]);
}

function rowMatches(row: SeededClientRow, want: Awaited<ReturnType<typeof desiredRow>>): boolean {
  return row.clientSecret === want.clientSecret
    && row.name === want.name
    && sameStrings(row.redirectUris, want.redirectUris)
    && row.tokenEndpointAuthMethod === want.tokenEndpointAuthMethod
    && sameStrings(row.grantTypes, want.grantTypes)
    && !!row.skipConsent
    && row.requirePKCE === false
    && !row.disabled;
}

/** Seeds already confirmed in this isolate, by client id + secret hash + redirects. */
const confirmedSeeds = new Set<string>();

/**
 * Upserts the env-configured trusted clients into `oauthClient`. Idempotent:
 * reads once per isolate per (client, secret, redirects), writes only when the
 * row is missing or differs, so a rotated env secret takes effect on the next
 * request. Secrets are stored the way the plugin verifies them (hashed).
 */
export async function ensureTrustedOidcClients(auth: Pick<Auth, "$context">, clients: TrustedOidcClient[]): Promise<void> {
  if (clients.length === 0) return;
  const context = await auth.$context;
  for (const client of clients) {
    const want = await desiredRow(client);
    const key = `${want.clientId}\n${want.clientSecret}\n${want.redirectUris.join(" ")}`;
    if (confirmedSeeds.has(key)) continue;

    const row = await context.adapter.findOne<SeededClientRow>({
      model: "oauthClient",
      where: [{ field: "clientId", value: client.clientId }],
    });
    const now = new Date();
    if (!row) {
      await context.adapter.create({
        model: "oauthClient",
        data: { ...want, createdAt: now, updatedAt: now },
      });
    } else if (!rowMatches(row, want)) {
      await context.adapter.update({
        model: "oauthClient",
        where: [{ field: "clientId", value: client.clientId }],
        update: { ...want, updatedAt: now },
      });
    }
    confirmedSeeds.add(key);
  }
}

/** Test hook: forget which seeds this isolate has confirmed. */
export function resetConfirmedOidcSeeds(): void {
  confirmedSeeds.clear();
}

// ── Request compatibility ─────────────────────────────────────────────────────

/**
 * The old token endpoint took client credentials in the body or in a Basic
 * header (body won when both were sent), as JSON or a form. The new one takes
 * a form and only the registered method. For the trusted clients, fold body
 * credentials into the Basic header the seeded rows are registered for.
 * Returns null when the request needs no change.
 */
export async function legacyTokenRequest(request: Request, trustedClientIds: ReadonlySet<string>): Promise<Request | null> {
  if (request.method !== "POST" || trustedClientIds.size === 0) return null;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const isJson = contentType.includes("application/json");
  if (!isJson && !contentType.includes("application/x-www-form-urlencoded")) return null;

  let params: URLSearchParams;
  try {
    if (isJson) {
      const body = (await request.clone().json()) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) return null;
      params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") params.set(key, String(value));
      }
    } else {
      params = new URLSearchParams(await request.clone().text());
    }
  } catch {
    return null;
  }

  const clientId = params.get("client_id") ?? "";
  const clientSecret = params.get("client_secret");
  if (!trustedClientIds.has(clientId)) return null;
  if (!clientSecret && !isJson) return null;

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/x-www-form-urlencoded");
  headers.delete("content-length");
  if (clientSecret) {
    params.delete("client_secret");
    headers.set("authorization", `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)}`);
  }
  return new Request(request.url, { method: "POST", headers, body: params.toString() });
}

/**
 * The new plugin refuses offline_access without PKCE unless the request also
 * carries an OIDC nonce. The old one issued a refresh token anyway. For the
 * trusted clients, drop offline_access in that one case so sign-in still
 * works (without a refresh token) instead of failing at the authorize step.
 * Returns null when the URL needs no change.
 */
export function legacyAuthorizeUrl(url: URL, trustedClientIds: ReadonlySet<string>): URL | null {
  if (!trustedClientIds.has(url.searchParams.get("client_id") ?? "")) return null;
  const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  if (!scopes.includes("offline_access")) return null;
  if (url.searchParams.get("code_challenge")) return null;
  if (scopes.includes("openid") && url.searchParams.get("nonce")) return null;
  const next = new URL(url);
  next.searchParams.set("scope", scopes.filter((scope) => scope !== "offline_access").join(" "));
  return next;
}

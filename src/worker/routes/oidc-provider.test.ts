/**
 * The OIDC issuer end to end, on Better Auth 1.7's oauth-provider: what
 * 1:15 Forgejo and LiteLLM see must match what the pre-1.7 oidcProvider gave
 * them (issuer, endpoints, sub, claims, client credentials, signing keys).
 */
import { symmetricEncrypt } from "better-auth/crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetConfirmedOidcSeeds } from "../lib/oidc-provider";
import { createHarness, TEST_AUTH_URL, TEST_SECRET, verifyRs256, type Harness } from "../test-support/auth-harness";

const ISSUER = `${TEST_AUTH_URL}/api/auth`;
const FORGEJO = { id: "forgejo-115", secret: "forgejo-secret-value", redirect: "https://git.115jon.com/user/oauth2/kova/callback" };
const LITELLM = { id: "litellm-115", secret: "litellm-secret-value", redirect: "https://lite.115jon.com/sso/callback" };

const oidcEnv = {
  FORGEJO_OIDC_CLIENT_ID: FORGEJO.id,
  FORGEJO_OIDC_CLIENT_SECRET: FORGEJO.secret,
  LITELLM_OIDC_CLIENT_ID: LITELLM.id,
  LITELLM_OIDC_CLIENT_SECRET: LITELLM.secret,
} as Partial<Env>;

/** An RS256 key stored the way the jwt plugin stores one (private JWK encrypted). */
async function generateRsaJwksRow() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: JSON.stringify(publicJwk),
    privateKey: JSON.stringify(await symmetricEncrypt({ key: TEST_SECRET, data: JSON.stringify(privateJwk) })),
  };
}

// Generated once per test file (one worker): RSA key generation runs on the
// shared crypto thread pool, and doing it per test slowed unrelated files
// enough to time them out under a full parallel run.
let cachedKey: ReturnType<typeof generateRsaJwksRow> | undefined;
async function rsaJwksRow(id: string) {
  cachedKey ??= generateRsaJwksRow();
  return { id, ...(await cachedKey) };
}

function authorizeUrl(client: { id: string; redirect: string }, params: Record<string, string> = {}) {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", client.redirect);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", "st4te");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function authorize(h: Harness, cookie: string, url: string) {
  const response = await h.fetch(url, { headers: { cookie }, redirect: "manual" });
  return { response, location: new URL(response.headers.get("location") ?? "about:blank", TEST_AUTH_URL) };
}

function form(fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  };
}

function basic(id: string, secret: string) {
  return `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;
}

async function codeFor(h: Harness, cookie: string, client: typeof LITELLM, params: Record<string, string> = {}) {
  const { response, location } = await authorize(h, cookie, authorizeUrl(client, { account_selected: "1", ...params }));
  expect(response.status, await response.clone().text()).toBe(302);
  expect(location.origin + location.pathname).toBe(client.redirect);
  return location.searchParams.get("code")!;
}

async function jwks(h: Harness) {
  return (await (await h.fetch(`${ISSUER}/jwks`)).json()) as { keys: Array<JsonWebKey & { kid?: string }> };
}

describe("OIDC issuer (oauth-provider)", () => {
  let h: Harness;
  let user: { id: string; updatedAt: string };
  let cookie: string;

  let signingKey: Awaited<ReturnType<typeof rsaJwksRow>>;
  beforeAll(async () => {
    signingKey = await rsaJwksRow("suite-key");
  });

  beforeEach(async () => {
    resetConfirmedOidcSeeds();
    h = createHarness({ env: oidcEnv });
    h.sqlite.prepare(`INSERT INTO jwks (id, publicKey, privateKey, createdAt, alg) VALUES (?, ?, ?, ?, 'RS256')`)
      .run(signingKey.id, signingKey.publicKey, signingKey.privateKey, new Date().toISOString());
    user = h.createUser({ name: "Ada King Lovelace", email: "ada@example.com", username: "ada", image: "https://cdn.example/ada.png" });
    cookie = (await h.createSession(user.id)).cookie;
  });

  it("serves discovery with the old issuer and endpoint paths, at both discovery URLs", async () => {
    for (const path of ["/.well-known/openid-configuration", "/api/auth/.well-known/openid-configuration"]) {
      const response = await h.fetch(path);
      expect(response.status, path).toBe(200);
      const doc = (await response.json()) as Record<string, unknown>;
      expect(doc).toMatchObject({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
      });
      expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
      expect(doc.scopes_supported).toEqual(["openid", "profile", "email", "offline_access"]);
      expect(doc.token_endpoint_auth_methods_supported).toEqual(expect.arrayContaining(["client_secret_basic", "client_secret_post"]));
      expect(doc.claims_supported).toEqual(expect.arrayContaining(["sub", "email", "email_verified", "name", "preferred_username"]));
      expect(doc.registration_endpoint).toBeUndefined();
    }
  });

  it("seeds the env clients once, hashed, with the same ids and redirect URIs", async () => {
    await h.fetch(authorizeUrl(LITELLM), { headers: { cookie }, redirect: "manual" });
    await h.fetch(authorizeUrl(LITELLM), { headers: { cookie }, redirect: "manual" });
    const rows = h.sqlite.prepare(`SELECT clientId, clientSecret, redirectUris, skipConsent, requirePKCE, tokenEndpointAuthMethod FROM oauthClient ORDER BY clientId`).all() as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.clientId)).toEqual([FORGEJO.id, LITELLM.id]);
    for (const row of rows) {
      expect(row.clientSecret).not.toContain("secret-value");
      expect(row.skipConsent).toBe(1);
      expect(row.requirePKCE).toBe(0);
      expect(row.tokenEndpointAuthMethod).toBe("client_secret_basic");
    }
    expect(JSON.parse(String(rows[0]!.redirectUris))).toEqual([
      "https://git.115jon.com/user/oauth2/kova/callback",
      "https://oci-a1.tail91a4f4.ts.net/git/user/oauth2/kova/callback",
    ]);
  });

  it("re-seeds when the env secret rotates", async () => {
    await codeFor(h, cookie, LITELLM);
    const rotated = { ...LITELLM, secret: "rotated-secret" };
    h.env.LITELLM_OIDC_CLIENT_SECRET = rotated.secret;
    const code = await codeFor(h, cookie, rotated);
    const ok = await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: rotated.secret }));
    expect(ok.status).toBe(200);
  });

  it("skips consent and runs authorize → token → userinfo with the old claims and sub = user id", async () => {
    const code = await codeFor(h, cookie, LITELLM);

    const tokenResponse = await h.fetch(`${ISSUER}/oauth2/token`, form({
      grant_type: "authorization_code",
      code,
      redirect_uri: LITELLM.redirect,
      client_id: LITELLM.id,
      client_secret: LITELLM.secret,
    }));
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "openid email profile" });
    expect(tokens.refresh_token).toBeUndefined();

    const { header, payload } = await verifyRs256(String(tokens.id_token), await jwks(h));
    expect(header.alg).toBe("RS256");
    expect(payload).toMatchObject({
      iss: ISSUER,
      aud: LITELLM.id,
      sub: user.id,
      // The pre-1.7 oidcProvider's ID token claims for scope "openid email profile":
      given_name: "Ada",
      family_name: "King",
      name: "Ada King Lovelace",
      profile: "https://cdn.example/ada.png",
      updated_at: user.updatedAt,
      email: "ada@example.com",
      email_verified: true,
      preferred_username: "ada",
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);

    const userinfo = await h.fetch(`${ISSUER}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(userinfo.status).toBe(200);
    expect(await userinfo.json()).toEqual({
      sub: user.id,
      email: "ada@example.com",
      email_verified: true,
      name: "Ada King Lovelace",
      picture: "https://cdn.example/ada.png",
      given_name: "Ada",
      family_name: "King",
      preferred_username: "ada",
    });
  });

  it("keeps sub stable per user across clients and sign-ins (Forgejo links by it)", async () => {
    const subs: unknown[] = [];
    for (const client of [LITELLM, FORGEJO, LITELLM]) {
      const fresh = (await h.createSession(user.id)).cookie;
      const code = await codeFor(h, fresh, client);
      const tokens = (await (await h.fetch(`${ISSUER}/oauth2/token`, form(
        { grant_type: "authorization_code", code, redirect_uri: client.redirect },
        { authorization: basic(client.id, client.secret) },
      ))).json()) as { id_token: string };
      subs.push((await verifyRs256(tokens.id_token, await jwks(h))).payload.sub);
    }
    expect(subs).toEqual([user.id, user.id, user.id]);
  });

  it("falls back to the email local part for preferred_username, like before", async () => {
    const other = h.createUser({ name: "Solo", email: "solo.user@example.com" });
    const otherCookie = (await h.createSession(other.id)).cookie;
    const code = await codeFor(h, otherCookie, LITELLM);
    const tokens = (await (await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret }))).json()) as Record<string, string>;
    const userinfo = (await (await h.fetch(`${ISSUER}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).json()) as Record<string, unknown>;
    expect(userinfo).toMatchObject({ sub: other.id, preferred_username: "solo.user", given_name: "Solo", picture: null });
    expect(userinfo).not.toHaveProperty("family_name");
  });

  it("accepts client_secret_post, client_secret_basic, and both at once (body wins), and rejects a wrong secret", async () => {
    const post = await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code: await codeFor(h, cookie, LITELLM), redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret }));
    expect(post.status).toBe(200);

    const viaBasic = await h.fetch(`${ISSUER}/oauth2/token`, form(
      { grant_type: "authorization_code", code: await codeFor(h, cookie, LITELLM), redirect_uri: LITELLM.redirect },
      { authorization: basic(LITELLM.id, LITELLM.secret) },
    ));
    expect(viaBasic.status).toBe(200);

    const both = await h.fetch(`${ISSUER}/oauth2/token`, form(
      { grant_type: "authorization_code", code: await codeFor(h, cookie, LITELLM), redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret },
      { authorization: basic(LITELLM.id, "stale") },
    ));
    expect(both.status).toBe(200);

    const wrong = await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code: await codeFor(h, cookie, LITELLM), redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: "nope" }));
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_client");
  });

  it("issues and rotates refresh tokens for offline_access", async () => {
    const code = await codeFor(h, cookie, LITELLM, { scope: "openid email offline_access", nonce: "n0nce" });
    const first = (await (await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret }))).json()) as Record<string, string>;
    expect(first.refresh_token).toBeTruthy();
    expect((await verifyRs256(first.id_token!, await jwks(h))).payload.nonce).toBe("n0nce");

    const refreshed = await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: first.refresh_token!, client_id: LITELLM.id, client_secret: LITELLM.secret }));
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const second = (await refreshed.json()) as Record<string, string>;
    expect(second.access_token).toBeTruthy();
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
  });

  it("still signs in when offline_access arrives without PKCE or nonce (drops it, like a client without refresh)", async () => {
    const code = await codeFor(h, cookie, LITELLM, { scope: "openid email offline_access" });
    const tokens = (await (await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret }))).json()) as Record<string, string>;
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.scope).toBe("openid email");
  });

  it("sends Forgejo through the /oauth/continue account picker first, then issues a code", async () => {
    const picker = await authorize(h, cookie, authorizeUrl(FORGEJO));
    expect(picker.response.status).toBe(302);
    expect(picker.location.pathname).toBe("/oauth/continue");
    expect(picker.location.searchParams.get("client_id")).toBe(FORGEJO.id);

    const chosen = await authorize(h, cookie, authorizeUrl(FORGEJO, { account_selected: "1" }));
    expect(chosen.location.origin + chosen.location.pathname).toBe(FORGEJO.redirect);
    expect(chosen.location.searchParams.get("state")).toBe("st4te");
    expect(chosen.location.searchParams.get("code")).toBeTruthy();
  });

  it("sends a signed-out browser to the /oauth/continue login page", async () => {
    const { response, location } = await authorize(h, "", authorizeUrl(LITELLM));
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/oauth/continue");
    expect(location.searchParams.get("client_id")).toBe(LITELLM.id);
    expect(location.searchParams.get("sig")).toBeTruthy();
  });

  it("rejects an unregistered redirect URI without redirecting to it", async () => {
    const { location } = await authorize(h, cookie, authorizeUrl({ ...LITELLM, redirect: "https://evil.example/cb" }, { account_selected: "1" }));
    expect(location.origin).not.toBe("https://evil.example");
  });

  it("keeps OAuth client management platform-only and admin-only", async () => {
    const app = h.createApp();
    const appSession = await h.createSession(user.id, { appId: app.id });
    const scoped = await h.fetch(`${ISSUER}/oauth2/get-clients`, { headers: { cookie: appSession.cookie } });
    expect(scoped.status).toBe(403);

    const create = await h.fetch(`${ISSUER}/oauth2/create-client`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: TEST_AUTH_URL },
      body: JSON.stringify({ redirect_uris: ["https://x.example/cb"] }),
    });
    expect(create.status).toBe(401);
  });

  it("aliases the old /oauth2/endsession path", async () => {
    const response = await h.fetch(`${ISSUER}/oauth2/endsession`, { redirect: "manual" });
    expect(response.status).not.toBe(404);
  });
});

describe("JWKS signing keys across the upgrade", () => {
  it("keeps signing with the RS256 key created before 0026", async () => {
    const legacy = await rsaJwksRow("legacy-key-1");
    const keyId = legacy.id;
    const publicJwk = JSON.parse(legacy.publicKey) as JsonWebKey;
    const privateKey = legacy.privateKey;

    resetConfirmedOidcSeeds();
    const h = createHarness({
      env: oidcEnv,
      beforeMigration: {
        "0026_oauth_provider.sql": (sqlite) => {
          sqlite.prepare(`INSERT INTO jwks (id, publicKey, privateKey, createdAt) VALUES (?, ?, ?, ?)`)
            .run(keyId, JSON.stringify(publicJwk), privateKey, Date.now() - 86_400_000);
        },
      },
    });
    expect(h.sqlite.prepare(`SELECT alg, crv FROM jwks WHERE id = ?`).get(keyId)).toEqual({ alg: "RS256", crv: null });

    const user = h.createUser({ name: "Grace Hopper", email: "grace@example.com" });
    const { cookie } = await h.createSession(user.id);
    const code = await codeFor(h, cookie, LITELLM);
    const tokens = (await (await h.fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: LITELLM.redirect, client_id: LITELLM.id, client_secret: LITELLM.secret }))).json()) as { id_token: string };

    const published = await jwks(h);
    expect(published.keys.map((key) => key.kid)).toEqual([keyId]);
    const { header, payload } = await verifyRs256(tokens.id_token, published);
    expect(header.kid).toBe(keyId);
    expect(payload.sub).toBe(user.id);
  });
});

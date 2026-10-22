import { describe, expect, it } from "vitest";
import {
  hashOidcClientSecret,
  legacyAuthorizeUrl,
  legacyIdTokenClaims,
  legacyTokenRequest,
  legacyUserInfoClaims,
  trustedOidcClients,
} from "./oidc-provider";

const user = {
  id: "u1",
  name: "Ada King Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  updatedAt: "2026-09-01T12:00:00.000Z",
};
const trusted = new Set(["litellm"]);

describe("trusted OIDC clients", () => {
  it("needs both the id and the secret", () => {
    expect(trustedOidcClients({ FORGEJO_OIDC_CLIENT_ID: "f", LITELLM_OIDC_CLIENT_ID: "l", LITELLM_OIDC_CLIENT_SECRET: " s " }))
      .toEqual([expect.objectContaining({ clientId: "l", clientSecret: "s", product: "litellm" })]);
  });

  it("hashes secrets the way oauth-provider verifies them (base64url SHA-256, unpadded)", async () => {
    // printf %s secret | openssl dgst -sha256 -binary | basenc --base64url
    expect(await hashOidcClientSecret("secret")).toBe("K7gNU3sdo-OL0wNhqoVWhr3g6s1xYv72ol_pe_Unols");
  });
});

describe("legacy claims", () => {
  it("splits names on the first two words and keeps preferred_username without a scope", () => {
    expect(legacyUserInfoClaims(user, ["openid"])).toEqual({ preferred_username: "ada" });
    expect(legacyUserInfoClaims(user, ["openid", "profile"])).toEqual({
      given_name: "Ada", family_name: "King", name: "Ada King Lovelace", picture: null, preferred_username: "ada",
    });
  });

  it("puts profile and email claims in the ID token like the old plugin", () => {
    expect(legacyIdTokenClaims({ ...user, username: "lovelace" }, ["openid", "profile", "email"])).toEqual({
      given_name: "Ada",
      family_name: "King",
      name: "Ada King Lovelace",
      profile: null,
      updated_at: "2026-09-01T12:00:00.000Z",
      email: "ada@example.com",
      email_verified: true,
      preferred_username: "lovelace",
    });
  });
});

describe("legacyTokenRequest", () => {
  const url = "https://auth.115jon.site/api/auth/oauth2/token";

  it("moves body credentials into Basic for trusted clients", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic stale" },
      body: "grant_type=authorization_code&code=c&client_id=litellm&client_secret=s%26cret",
    });
    const next = (await legacyTokenRequest(request, trusted))!;
    expect(next.headers.get("authorization")).toBe(`Basic ${btoa("litellm:s%26cret")}`);
    expect(new URLSearchParams(await next.text()).get("client_secret")).toBeNull();
  });

  it("turns a JSON body into a form", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: "r", client_id: "litellm", client_secret: "s" }),
    });
    const next = (await legacyTokenRequest(request, trusted))!;
    expect(next.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(await next.text()))).toEqual({ grant_type: "refresh_token", refresh_token: "r", client_id: "litellm" });
  });

  it("leaves other clients and Basic-only requests alone", async () => {
    const other = new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "client_id=x&client_secret=y" });
    expect(await legacyTokenRequest(other, trusted)).toBeNull();
    const basicOnly = new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic abc" }, body: "grant_type=authorization_code" });
    expect(await legacyTokenRequest(basicOnly, trusted)).toBeNull();
  });
});

describe("legacyAuthorizeUrl", () => {
  const base = "https://auth.115jon.site/api/auth/oauth2/authorize?client_id=litellm&scope=openid+email+offline_access";

  it("drops offline_access only when neither PKCE nor an OIDC nonce is present", () => {
    expect(legacyAuthorizeUrl(new URL(base), trusted)?.searchParams.get("scope")).toBe("openid email");
    expect(legacyAuthorizeUrl(new URL(`${base}&nonce=n`), trusted)).toBeNull();
    expect(legacyAuthorizeUrl(new URL(`${base}&code_challenge=c`), trusted)).toBeNull();
    expect(legacyAuthorizeUrl(new URL(base.replace("litellm", "other")), trusted)).toBeNull();
  });
});

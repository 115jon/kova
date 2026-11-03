/**
 * Dual-host serving during the 115jon.site → 115jon.com move: AUTH_URL stays
 * the canonical host, AUTH_ALT_URLS names the other one, and each request sees
 * the host it arrived on as AUTH_URL.
 */
import { describe, expect, it } from "vitest";
import { alternateAuthOrigins, envForHost, legacyPageRedirect, matchAlternateAuthOrigin } from "./lib/auth-hosts";
import { passkeyRpId } from "./lib/passkey-origins";
import { staticOrigins } from "./middleware/cors";
import { createHarness } from "./test-support/auth-harness";

const SITE = "https://auth.115jon.site";
const COM = "https://auth.115jon.com";
const base = { AUTH_URL: SITE, DASHBOARD_URL: SITE, AUTH_ALT_URLS: ` ${COM}/ , not a url,${SITE}` };

describe("envForHost", () => {
  it("parses AUTH_ALT_URLS, dropping junk and the canonical origin", () => {
    expect(alternateAuthOrigins(base)).toEqual([COM]);
    expect(alternateAuthOrigins({ AUTH_URL: SITE })).toEqual([]);
    // Parents or children of the canonical host would capture its requests.
    expect(alternateAuthOrigins({ AUTH_URL: SITE, AUTH_ALT_URLS: "https://115jon.site,https://x.auth.115jon.site" })).toEqual([]);
  });

  it("matches the alternate host and its subdomains only", () => {
    expect(matchAlternateAuthOrigin(base, "auth.115jon.com")).toBe(COM);
    expect(matchAlternateAuthOrigin(base, "Ralph.Auth.115jon.com")).toBe(COM);
    expect(matchAlternateAuthOrigin(base, "evilauth.115jon.com")).toBeNull();
    expect(matchAlternateAuthOrigin(base, "auth.115jon.com.evil.test")).toBeNull();
    expect(matchAlternateAuthOrigin(base, "yap.115jon.com")).toBeNull();
  });

  it("leaves env alone on the canonical host", () => {
    expect(envForHost(base, "auth.115jon.site")).toBe(base);
    expect(envForHost(base, "mira.auth.115jon.site")).toBe(base);
  });

  it("swaps AUTH_URL and a same-host DASHBOARD_URL on the alternate host", () => {
    const env = envForHost(base, "mira.auth.115jon.com");
    expect(env.AUTH_URL).toBe(COM);
    expect(env.DASHBOARD_URL).toBe(COM);
    expect(alternateAuthOrigins(env)).toEqual([SITE]);
    expect(base.AUTH_URL).toBe(SITE);
    // A separate dashboard host is not the auth host and stays put.
    expect(envForHost({ ...base, DASHBOARD_URL: "https://dash.example" }, "auth.115jon.com").DASHBOARD_URL).toBe("https://dash.example");
  });

  it("keeps both hosts first-party whichever one served the request", () => {
    for (const env of [base, envForHost(base, "auth.115jon.com")]) {
      const origins = staticOrigins(env);
      expect(origins.has(SITE)).toBe(true);
      expect(origins.has(COM)).toBe(true);
    }
    expect(staticOrigins({ AUTH_URL: SITE, DASHBOARD_URL: SITE }).has(COM)).toBe(false);
  });
});

describe("worker on both hosts", () => {
  const harness = () => createHarness({ env: { AUTH_URL: SITE, DASHBOARD_URL: SITE, AUTH_ALT_URLS: COM } });

  it("answers CORS for either first-party origin on either host", async () => {
    const h = harness();
    for (const host of [SITE, COM]) {
      for (const origin of [SITE, COM]) {
        const response = await h.fetch(`${host}/health`, { headers: { origin } });
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin"), `${host} ← ${origin}`).toBe(origin);
      }
    }
  });

  it("serves OIDC discovery with the issuer of the host asked", async () => {
    const h = harness();
    for (const host of [SITE, COM]) {
      const doc = (await (await h.fetch(`${host}/.well-known/openid-configuration`)).json()) as Record<string, string>;
      expect(doc.issuer).toBe(`${host}/api/auth`);
      expect(doc.token_endpoint).toBe(`${host}/api/auth/oauth2/token`);
    }
  });

  it("resolves slug hosts under both roots and hands back device URLs on the same root", async () => {
    const h = harness();
    const app = h.createApp({ authSlug: "ralph" });
    h.sqlite.prepare(`UPDATE application SET device_verification_uri = NULL WHERE id = ?`).run(app.id);

    for (const [host, slugHost] of [[SITE, "ralph.auth.115jon.site"], [COM, "ralph.auth.115jon.com"]] as const) {
      const page = await h.fetch(`https://${slugHost}/device`);
      expect(page.status, slugHost).toBe(200);

      const started = await h.fetch(`${host}/api/pub/apps/${app.publishableKey}/device/start`, {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
        body: JSON.stringify({ hostname: "ada-pc", platform: "Windows", label: "Ralph" }),
      });
      expect(started.status).toBe(201);
      expect(((await started.json()) as { verificationUri: string }).verificationUri).toBe(`https://${slugHost}/device`);
    }

    expect((await h.fetch("https://nope.auth.115jon.com/device")).status).toBe(404);
  });

  it("links device-challenge approvals to the host that created them", async () => {
    const h = harness();
    for (const host of [SITE, COM]) {
      const response = await h.fetch(`${host}/api/device-challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: "pc" }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { id: string; approveUrl: string };
      expect(body.approveUrl).toBe(`${host}/approve/${body.id}`);
    }
  });
});

describe("legacy page redirect after cutover", () => {
  const after = { AUTH_URL: COM, DASHBOARD_URL: COM, AUTH_ALT_URLS: SITE, AUTH_REDIRECT_ALT_PAGES: "true" };
  const get = (url: string, method = "GET") => legacyPageRedirect(after, new Request(url, { method }));

  it("sends old-host pages to the same path on the new host", () => {
    const response = get(`${SITE}/sign-in?pk=pk_1&redirect_url=https%3A%2F%2Fyap.115jon.com`);
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe(`${COM}/sign-in?pk=pk_1&redirect_url=https%3A%2F%2Fyap.115jon.com`);
  });

  it("keeps API, discovery, health, slug hosts, POSTs and the new host untouched", () => {
    expect(get(`${SITE}/api/auth/get-session`)).toBeNull();
    expect(get(`${SITE}/.well-known/openid-configuration`)).toBeNull();
    expect(get(`${SITE}/health`)).toBeNull();
    expect(get("https://mira-wulx5t.auth.115jon.site/sign-in")).toBeNull();
    expect(get(`${SITE}/sign-in`, "POST")).toBeNull();
    expect(get(`${COM}/sign-in`)).toBeNull();
    expect(legacyPageRedirect({ ...after, AUTH_REDIRECT_ALT_PAGES: undefined }, new Request(`${SITE}/`))).toBeNull();
  });

  it("is wired into the worker", async () => {
    const h = createHarness({ env: after });
    const response = await h.fetch(`${SITE}/applications`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect((await h.fetch(`${SITE}/health`)).status).toBe(200);
  });
});

describe("passkey rpID", () => {
  it("uses PASSKEY_RP_ID on hosts under it and the hostname elsewhere", () => {
    const env = { ...base, PASSKEY_RP_ID: "115jon.com" };
    expect(passkeyRpId(envForHost(env, "auth.115jon.com"))).toBe("115jon.com");
    expect(passkeyRpId(env)).toBe("auth.115jon.site");
    expect(passkeyRpId({ AUTH_URL: "https://auth.lvh.me", PASSKEY_RP_ID: "115jon.com" })).toBe("auth.lvh.me");
    expect(passkeyRpId({ AUTH_URL: "https://auth.115jon.com" })).toBe("auth.115jon.com");
    expect(passkeyRpId({ AUTH_URL: "not a url" })).toBe("localhost");
    expect(passkeyRpId({ AUTH_URL: "https://evil115jon.com", PASSKEY_RP_ID: "115jon.com" })).toBe("evil115jon.com");
  });
});

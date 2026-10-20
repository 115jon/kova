import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../../applications";
import { pubAppsRouter } from "./apps";

const getSession = vi.fn(async () => ({ user: { id: "user-1" }, session: { id: "session-1" } }));
const sessionMayActForApp = vi.fn(async (_db: unknown, _sessionId: unknown, _appId: unknown) => true);
const resolveAppScopedSession = vi.fn(async (_db: unknown, _input: unknown) => ({ token: "app-token" }));

vi.mock("../../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));
vi.mock("../../lib/app-session", () => ({
  resolveAppScopedSession: (db: unknown, input: unknown) => resolveAppScopedSession(db, input),
  sessionMayActForApp: (db: unknown, sessionId: unknown, appId: unknown) => sessionMayActForApp(db, sessionId, appId),
}));
vi.mock("better-auth", () => ({ generateId: () => "generated" }));
vi.mock("../../applications", async (original) => ({
  ...await original<typeof import("../../applications")>(),
  getApplicationByPublishableKey: async () => application,
}));

const application: Application = {
  id: "app-1", name: "Test", environment: "production", publishable_key: "pk_test",
  allowed_origins: ["https://consumer.example"], redirect_uris: ["https://consumer.example/callback"],
  createdBy: "user-1", createdAt: 1, updatedAt: 1, display_name: null, logo_url: null,
  favicon_url: null, primary_color: "#3b82f6", background_color: "#0f172a", theme: "dark",
  home_url: null, terms_url: null, privacy_url: null, hide_branding: false,
  from_name: null, from_email: null, support_email: null, smtp_host: null, smtp_port: 587,
  smtp_user: null, smtp_secure: false, stripe_customer_id: null, stripe_subscription_id: null,
  plan: "free", plan_expires_at: null, suspended_at: null, auth_slug: "test-app", custom_domain: null,
};

let providerRows: Array<{ provider: string; enabled: number }> = [];
let policyFails = false;
const env = {
  AUTH_URL: "https://auth.example",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DB: {
    prepare: () => ({
      bind: () => ({
        all: async () => {
          if (policyFails) throw new Error("D1 unavailable");
          return { results: providerRows, success: true };
        },
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
  },
} as unknown as Env;

const post = (path: string, headers: Record<string, string> = {}) =>
  pubAppsRouter.request(`/pk_test${path}`, { method: "POST", headers }, env);

beforeEach(() => {
  providerRows = [];
  policyFails = false;
  getSession.mockClear();
  resolveAppScopedSession.mockClear();
  sessionMayActForApp.mockReset();
  sessionMayActForApp.mockResolvedValue(true);
});

describe.each(["/session-token", "/me"])("POST %s origin check", (path) => {
  it.each([
    ["no Origin (native or server-to-server)", {}],
    ["the app's own registered origin", { Origin: "https://consumer.example" }],
    ["the auth server itself", { Origin: "https://auth.example" }],
  ])("serves %s", async (_label, headers) => {
    const response = await post(path, headers);
    expect(response.status).toBe(200);
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("refuses an origin that belongs to a different app", async () => {
    const response = await post(path, { Origin: "https://other-app.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "origin_not_allowed" });
    expect(getSession).not.toHaveBeenCalled();
    expect(resolveAppScopedSession).not.toHaveBeenCalled();
  });
});

describe("session minted for another app", () => {
  it("/session-token answers 401 and mints nothing", async () => {
    sessionMayActForApp.mockResolvedValue(false);
    const response = await post("/session-token");
    expect(response.status).toBe(401);
    expect(resolveAppScopedSession).not.toHaveBeenCalled();
  });

  it("/me answers no_session and registers nothing", async () => {
    sessionMayActForApp.mockResolvedValue(false);
    const response = await post("/me");
    expect(await response.json()).toEqual({ ok: false, reason: "no_session" });
    expect(resolveAppScopedSession).not.toHaveBeenCalled();
  });
});

describe("GET /:pk/oauth/start provider policy", () => {
  const start = (provider: string) => {
    const query = new URLSearchParams({ provider, redirect_uri: "https://consumer.example/callback" });
    return pubAppsRouter.request(`/pk_test/oauth/start?${query}`, {}, env);
  };

  it("starts a provider the app enables and the server has credentials for", async () => {
    const response = await start("google");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/api/auth/sign-in/social");
  });

  it("carries the caller's state into the bounce URL", async () => {
    const query = new URLSearchParams({ provider: "google", redirect_uri: "https://consumer.example/callback", state: "abc_123-x." });
    const html = await (await pubAppsRouter.request(`/pk_test/oauth/start?${query}`, {}, env)).text();
    expect(html).toMatch(/state=abc_123-x./);
  });

  it("rejects a state that is not a plain token", async () => {
    const query = new URLSearchParams({ provider: "google", redirect_uri: "https://consumer.example/callback", state: "<script>" });
    const response = await pubAppsRouter.request(`/pk_test/oauth/start?${query}`, {}, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_state" });
  });

  it("refuses a provider the app has switched off", async () => {
    providerRows = [{ provider: "google", enabled: 0 }, { provider: "discord", enabled: 1 }];
    const response = await start("google");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "provider_unavailable" });
  });

  it("refuses a provider the server has no credentials for, or does not know", async () => {
    expect((await start("github")).status).toBe(403);
    expect((await start("nonsense")).status).toBe(403);
  });

  it("fails closed when the provider policy cannot be read", async () => {
    policyFails = true;
    expect((await start("google")).status).toBe(503);
  });
});

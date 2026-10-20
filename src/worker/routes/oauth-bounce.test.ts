import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getCookies } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import type { Application } from "../applications";
import { decodeOAuthCtx, encodeOAuthCtx, handleOAuthBounce, handleOAuthStart } from "./oauth-bounce";
import { hostedAuthRouter } from "./hosted-auth";

const secret = "test-oauth-context-signing-secret";
const context = { slug: "test-app", appId: "app-1", redirect_uri: "", state: "" };
const cookies = getCookies({ baseURL: "https://test-app.auth.example", advanced: {
  defaultCookieAttributes: { sameSite: "none", secure: true },
} });
const insertSession = vi.fn(async (_db: unknown, _input: unknown) => undefined);
const getSession = vi.fn(async () => ({ user: { id: "user-1" }, session: { id: "main-session" } }));
vi.mock("../auth", () => ({ createAuth: () => ({
  api: { getSession }, $context: Promise.resolve({ authCookies: cookies, secret }),
}) }));
vi.mock("../lib/app-session", async (original) => ({
  ...await original<typeof import("../lib/app-session")>(),
  insertAppScopedSession: (db: unknown, input: unknown) => insertSession(db, input),
}));
vi.mock("../org-settings", () => ({ findMFAEnforcedOrgBlockingUser: async () => null }));
vi.mock("../applications", async (original) => ({
  ...await original<typeof import("../applications")>(),
  getApplicationById: async () => application,
  getApplicationByPublishableKey: async () => application,
}));

const application: Application = {
  id: "app-1", name: "Test", environment: "production", publishable_key: "pk_test",
  allowed_origins: [], redirect_uris: ["https://consumer.example/callback", "mira://auth"],
  createdBy: "user-1", createdAt: 1, updatedAt: 1, display_name: null, logo_url: null,
  favicon_url: null, primary_color: "#3b82f6", background_color: "#0f172a", theme: "dark",
  home_url: "https://consumer.example", terms_url: null, privacy_url: null, hide_branding: false,
  from_name: null, from_email: null, support_email: null, smtp_host: null, smtp_port: 587,
  smtp_user: null, smtp_secure: false, stripe_customer_id: null, stripe_subscription_id: null,
  plan: "free", plan_expires_at: null, suspended_at: null, auth_slug: "test-app", custom_domain: null,
};
let providerRows: Array<{ provider: string; enabled: number }> = [];
let databaseFails = false;
function environment() {
  const values = new Map<string, string>();
  return {
    AUTH_URL: "https://auth.example", BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-client-secret",
    DB: { prepare: () => ({ bind: () => ({ all: async () => {
      if (databaseFails) throw new Error("database unavailable");
      return { results: providerRows, success: true };
    } }) }) },
    KV: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
    },
    __hostedApp: { app: application },
  };
}
const main = new Hono<{ Bindings: Env & { ASSETS: Fetcher } }>();
main.get("/start", handleOAuthStart);
main.get("/bounce", handleOAuthBounce);
beforeEach(() => {
  providerRows = [];
  databaseFails = false;
  insertSession.mockReset().mockResolvedValue(undefined);
});

async function start(provider: string, overrides: Partial<typeof context> & { returnPath?: string } = {}) {
  const ctx = await encodeOAuthCtx({ ...context, ...overrides }, secret);
  return main.request(`/start?pk=pk_test&provider=${provider}&ctx=${encodeURIComponent(ctx)}`, {}, environment() as never);
}
async function bounce(env: ReturnType<typeof environment>, returnPath?: string, redirect_uri = "") {
  const ctx = await encodeOAuthCtx({ ...context, redirect_uri, ...returnPath ? { returnPath } : {} }, secret);
  return main.request(`/bounce?ctx=${encodeURIComponent(ctx)}`, {}, env as never);
}
async function complete(env: ReturnType<typeof environment>, location: string) {
  return hostedAuthRouter.request(new Request(location, { headers: { host: "test-app.auth.example" } }), {}, env as never);
}

describe("signed hosted OAuth context", () => {
  it.each([
    "https://evil.example/device?code=ABCD-EFGH",
    "//evil.example/device?code=ABCD-EFGH",
    "/device?code=ABCD-EFGH&redirect=https://evil.example",
    "/device?code=ABCD-EFGH#fragment",
    "/device?code=invalid",
  ])("rejects unsafe device return %s even when signed", async (returnPath) => {
    const raw = await encodeOAuthCtx({ ...context, ...{ returnPath } }, secret);
    expect(await decodeOAuthCtx(raw, secret)).toBeNull();
  });

  it("keeps the exact safe device destination inside the signed context", async () => {
    const returnPath = "/device?code=ABCD-EFGH";
    const raw = await encodeOAuthCtx({ ...context, ...{ returnPath } }, secret);
    expect(await decodeOAuthCtx(raw, secret)).toMatchObject({ returnPath });
    expect(await decodeOAuthCtx(`${raw}tampered`, secret)).toBeNull();
  });
});

describe("hosted provider start", () => {
  it("accepts configured Google for device sign-in and keeps its signed context", async () => {
    const response = await start("google", { returnPath: "/device?code=ABCD-EFGH" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/api/auth/sign-in/social");
  });
  it.each(["github", "unknown"])("rejects unavailable provider %s", async (provider) => {
    expect((await start(provider)).status).toBe(403);
  });
  it("does not re-enable defaults when explicit provider rows are all disabled", async () => {
    providerRows = [{ provider: "google", enabled: 0 }];
    expect((await start("google")).status).toBe(403);
  });
  it("fails closed when provider policy cannot be read", async () => {
    databaseFails = true;
    expect((await start("google")).status).toBe(503);
  });
  it("preserves the custom-scheme SDK bounce", async () => {
    const response = await start("google", { redirect_uri: "mira://auth", state: "nonce" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("mode=sdk");
  });
  it("rejects a context belonging to another app", async () => {
    expect((await start("google", { appId: "other-app" })).status).toBe(400);
  });
});

describe("main host to hosted device completion", () => {
  it("returns to the exact device page with a valid Better Auth cookie", async () => {
    const env = environment();
    const returnPath = "/device?code=ABCD-EFGH";
    const response = await bounce(env, returnPath);
    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).not.toContain("main-session");
    const finished = await complete(env, location);
    expect(finished.status).toBe(302);
    expect(finished.headers.get("location")).toBe(`https://test-app.auth.example${returnPath}`);
    const inserted = insertSession.mock.calls[0]![1] as { token: string; appId: string };
    expect(inserted.appId).toBe(application.id);
    const setCookie = finished.headers.getSetCookie().find(value => value.startsWith(`${cookies.sessionToken.name}=`))!;
    expect(setCookie).toContain(encodeURIComponent(`${inserted.token}.${await makeSignature(inserted.token, secret)}`));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    expect(await finished.text()).not.toContain(inserted.token);
    expect((await complete(env, location)).status).toBe(400);
  });
  it.each(["change", "remove", "external", "other-app"])("rejects ticket destination tampering: %s", async (mode) => {
    const env = environment();
    const response = await bounce(env, "/device?code=ABCD-EFGH");
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    if (mode === "change") location.searchParams.set("returnPath", "/device?code=WXYZ-2345");
    if (mode === "remove") location.searchParams.delete("returnPath");
    if (mode === "external") location.searchParams.set("returnPath", "https://evil.example");
    if (mode === "other-app") env.__hostedApp = { app: { ...application, id: "other-app" } };
    const finished = await complete(env, location.toString());
    expect(finished.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
    expect(finished.headers.get("set-cookie")).toBeNull();
  });
  it("fails visibly when a device session cannot be inserted", async () => {
    const env = environment();
    const response = await bounce(env, "/device?code=ABCD-EFGH");
    expect(response.status).toBe(302);
    insertSession.mockRejectedValueOnce(new Error("D1 unavailable"));
    const finished = await complete(env, response.headers.get("location")!);
    expect(finished.status).toBe(503);
    expect(finished.headers.get("location")).toBeNull();
    expect(finished.headers.get("set-cookie")).toBeNull();
  });
  it("allows normal home OAuth with an empty redirect URI", async () => {
    const env = environment();
    const response = await bounce(env);
    expect(response.status).toBe(302);
    const finished = await complete(env, response.headers.get("location")!);
    expect(finished.status).toBe(302);
    expect(finished.headers.get("location")).toBe(new URL(application.home_url!).toString());
  });
  it("preserves allowlisted HTTPS ticket completion", async () => {
    const env = environment();
    const response = await bounce(env, undefined, "https://consumer.example/callback");
    expect(response.status).toBe(302);
    const finished = await complete(env, response.headers.get("location")!);
    expect(finished.status).toBe(302);
    expect(new URL(finished.headers.get("location")!).searchParams.get("code")).toMatch(/^ticket_/);
  });
});

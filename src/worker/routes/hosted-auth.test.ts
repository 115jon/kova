import { describe, expect, it, vi } from "vitest";
import type { Application } from "../applications";

const session = {
  user: { id: "user_1" },
  session: { id: "sess_cookie", token: "cookie_tok" },
};

const getSession = vi.fn(async () => session);
const insertAppScopedSession = vi.fn(async (_db: unknown, _input: unknown) => undefined);
const createAuthTicket = vi.fn(async (_kv: unknown, _payload: unknown) => "ticket_https");
const createSessionTransferCode = vi.fn(async (
  _kv: unknown,
  _token: unknown,
  _pk: unknown,
  _origin: unknown,
) => "xfr_native");

vi.mock("../auth", () => ({
  createAuth: () => ({ api: { getSession } }),
}));

vi.mock("../lib/app-session", () => ({
  APP_SESSION_TTL_MS: 1,
  insertAppScopedSession: (db: unknown, input: unknown) => insertAppScopedSession(db, input),
}));

vi.mock("../lib/auth-ticket", () => ({
  createAuthTicket: (kv: unknown, payload: unknown) => createAuthTicket(kv, payload),
  createSessionTransferCode: (
    kv: unknown,
    token: unknown,
    pk: unknown,
    origin: unknown,
  ) => createSessionTransferCode(kv, token, pk, origin),
  exchangeAuthTicket: vi.fn(),
}));

vi.mock("better-auth", () => ({
  generateId: (size?: number) => (size === 32 ? "app_session_token" : "app_session_id"),
}));

function app(redirectUris: string[]): Application {
  return {
    id: "app_mira",
    name: "Mira",
    environment: "production",
    publishable_key: "pk_live_mira",
    allowed_origins: [],
    redirect_uris: redirectUris,
    createdBy: "user_1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    display_name: null,
    logo_url: null,
    favicon_url: null,
    primary_color: "#3b82f6",
    background_color: "#0f172a",
    theme: "dark",
    home_url: null,
    terms_url: null,
    privacy_url: null,
    hide_branding: false,
    from_name: null,
    from_email: null,
    support_email: null,
    smtp_host: null,
    smtp_port: 587,
    smtp_user: null,
    smtp_secure: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: "free",
    plan_expires_at: null,
    suspended_at: null,
    auth_slug: "mira",
    custom_domain: null,
  };
}

function request(redirectUri: string, state: string): Request {
  return new Request("https://mira.auth.115jon.site/api/hosted/create-ticket", {
    method: "POST",
    headers: {
      host: "mira.auth.115jon.site",
      "content-type": "application/json",
    },
    body: JSON.stringify({ redirect_uri: redirectUri, state }),
  });
}

async function postTicket(redirectUri: string) {
  const { hostedAuthRouter } = await import("./hosted-auth");
  const env = {
    __hostedApp: { app: app([redirectUri]) },
    DB: {},
    KV: {},
    BETTER_AUTH_SECRET: "test-secret",
    AUTH_URL: "https://auth.115jon.site",
  };
  return hostedAuthRouter.request(
    request(redirectUri, "app-nonce"),
    {},
    env as never,
  );
}

describe("hosted password create-ticket", () => {
  it("mints an xfr_ code for a custom-scheme redirect and keeps the app state", async () => {
    createSessionTransferCode.mockClear();
    createAuthTicket.mockClear();
    insertAppScopedSession.mockClear();

    const response = await postTicket("mira://auth");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: "xfr_native",
      kova_auth_code: "xfr_native",
      state: "app-nonce",
    });
    expect(createAuthTicket).not.toHaveBeenCalled();
    expect(insertAppScopedSession).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "user_1",
        token: "app_session_token",
        appId: "app_mira",
      }),
    );
    expect(createSessionTransferCode).toHaveBeenCalledWith(
      {},
      "app_session_token",
      "pk_live_mira",
      "null",
    );
  });

  it("keeps an https redirect on the hosted ticket hop", async () => {
    createSessionTransferCode.mockClear();
    createAuthTicket.mockClear();

    const response = await postTicket("https://app.example.com/callback");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: "ticket_https",
      state: "app-nonce",
    });
    expect(createSessionTransferCode).not.toHaveBeenCalled();
    expect(createAuthTicket).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "user_1",
        sessionId: "sess_cookie",
        appId: "app_mira",
        redirectUri: "https://app.example.com/callback",
      }),
    );
  });
});

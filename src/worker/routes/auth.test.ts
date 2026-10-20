import { describe, expect, it, vi } from "vitest";

const { authHandler } = vi.hoisted(() => ({
  authHandler: vi.fn(async () => new Response("handled")),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({ handler: authHandler }),
}));

vi.mock("../applications", async (original) => ({
  ...await original<typeof import("../applications")>(),
  getApplicationByPublishableKey: async () => ({
    id: "app-1",
    name: "Ralph Meet",
    environment: "development",
    publishable_key: "pk_test",
    allowed_origins: ["https://meet.example"],
    redirect_uris: [],
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
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
    auth_slug: null,
    custom_domain: null,
  }),
}));

const env = {
  AUTH_URL: "https://auth.lvh.me",
  DB: {},
  KV: {
    get: async () => null,
    put: async () => undefined,
  },
} as unknown as Env;

describe("auth route origin enforcement", () => {
  it("accepts the configured auth origin when the proxy supplies an internal request URL", async () => {
    const { authRouter } = await import("./auth");
    const response = await authRouter.request(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          Origin: "https://auth.lvh.me",
          "Content-Type": "application/json",
          "X-Publishable-Key": "pk_test",
        },
        body: JSON.stringify({ provider: "google" }),
      }),
      {},
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("handled");
    expect(authHandler).toHaveBeenCalledOnce();
  });
});

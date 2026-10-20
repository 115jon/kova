import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth";

// Only the options matter here; skip opening a database.
vi.mock("better-auth", async (original) => ({
  ...(await original<typeof import("better-auth")>()),
  betterAuth: (options: unknown) => ({ options }),
}));

const env = {
  AUTH_URL: "https://auth.115jon.site",
  DASHBOARD_URL: "https://auth.115jon.site",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "g",
  RESEND_API_KEY: "re_unused",
  DB: {},
  KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
} as unknown as Env;

describe("sign-in method configuration", () => {
  const { options } = createAuth(env);

  it("signs a user in when they verify their email, so the app handoff gets the right account", () => {
    expect(options.emailVerification?.autoSignInAfterVerification).toBe(true);
    expect(options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("throttles the endpoints that send email or take codes, by their current paths", () => {
    const rules: Record<string, unknown> = options.rateLimit?.customRules ?? {};
    for (const path of ["/sign-in/email", "/sign-in/magic-link", "/two-factor/verify-totp", "/request-password-reset"]) {
      expect(rules[path], path).toBeTruthy();
    }
  });

  it("keeps the plugins the sign-in methods need", () => {
    const ids = (options.plugins ?? []).map((plugin) => plugin.id);
    expect(ids).toEqual(expect.arrayContaining(["passkey", "magic-link", "two-factor", "bearer", "multi-session"]));
  });
});

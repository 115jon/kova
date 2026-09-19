import { describe, expect, it } from "vitest";
import {
  generateKey,
  isValidOrigin,
  isValidRedirectUri,
  isOriginAllowed,
  isRedirectUriAllowed,
  type Application,
} from "./applications";
import { isDashboardHost } from "./index";
import { encodeOAuthCtx, decodeOAuthCtx } from "./routes/oauth-bounce";
import { verifyStripeWebhookSignature } from "./lib/stripe-webhook";

function app(overrides: Partial<Application>): Application {
  return {
    id: "app_1",
    name: "App",
    environment: "production",
    publishable_key: "pk_live_123",
    allowed_origins: ["https://app.example.com"],
    redirect_uris: ["https://app.example.com/callback"],
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
    auth_slug: "app",
    custom_domain: null,
    ...overrides,
  };
}

async function stripeSig(body: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("application policy helpers", () => {
  it("rejects redirect prefix bypasses", () => {
    const subject = app({});
    expect(isRedirectUriAllowed(subject, "https://app.example.com/callback")).toBe(true);
    expect(isRedirectUriAllowed(subject, "https://app.example.com/callback/extra")).toBe(false);
    expect(isRedirectUriAllowed(subject, "https://app.example.com.evil.test/callback")).toBe(false);
  });

  it("allows origin-only redirect entries for same-origin app paths", () => {
    const subject = app({ redirect_uris: ["https://app.example.com"] });
    expect(isRedirectUriAllowed(subject, "https://app.example.com/chat")).toBe(true);
    expect(isRedirectUriAllowed(subject, "https://app.example.com/sign-in?error=oauth")).toBe(true);
    expect(isRedirectUriAllowed(subject, "https://app.example.com.evil.test/chat")).toBe(false);
  });

  it("fails closed for empty production allowlists but keeps localhost for development", () => {
    expect(isOriginAllowed(app({ allowed_origins: [] }), "https://anything.test")).toBe(false);
    expect(isRedirectUriAllowed(app({ redirect_uris: [] }), "https://anything.test/cb")).toBe(false);

    const dev = app({ environment: "development", allowed_origins: [], redirect_uris: [] });
    expect(isOriginAllowed(dev, "http://localhost:5173")).toBe(true);
    expect(isRedirectUriAllowed(dev, "http://127.0.0.1:5173/callback")).toBe(true);
    expect(isOriginAllowed(dev, "http://tauri.localhost")).toBe(true);
    expect(isRedirectUriAllowed(dev, "http://tauri.localhost/callback")).toBe(true);
  });

  it("allows exact custom-scheme redirect URIs without treating all opaque origins as equal", () => {
    const subject = app({ redirect_uris: ["kovameet://auth"] });
    expect(isRedirectUriAllowed(subject, "kovameet://auth")).toBe(true);
    expect(isRedirectUriAllowed(subject, "otherapp://auth")).toBe(false);
    expect(isRedirectUriAllowed(subject, "kovameet://callback")).toBe(false);
  });

  it("allows development HTTP origins on a private Tailscale IP", () => {
    expect(isValidOrigin("http://100.117.132.115", "development")).toBe(true);
    expect(isValidRedirectUri("http://100.117.132.115/auth/callback", "development")).toBe(true);
  });

  it("allows development HTTP origins on a Tailscale hostname", () => {
    expect(isValidOrigin("http://joi.tail91a4f4.ts.net", "development")).toBe(true);
    expect(isValidRedirectUri("http://joi.tail91a4f4.ts.net/auth/callback", "development")).toBe(true);
  });

  it("honors explicit development allowlists for private hosts", () => {
    const subject = app({
      environment: "development",
      allowed_origins: ["http://100.117.132.115"],
      redirect_uris: ["http://100.117.132.115/auth/callback"],
    });
    expect(isOriginAllowed(subject, "http://100.117.132.115")).toBe(true);
    expect(isOriginAllowed(subject, "http://100.117.132.116")).toBe(false);
    expect(isRedirectUriAllowed(subject, "http://100.117.132.115/auth/callback")).toBe(true);
    expect(isRedirectUriAllowed(subject, "http://100.117.132.116/auth/callback")).toBe(false);
  });

  it("keeps HTTP private-network URLs out of production", () => {
    expect(isValidOrigin("http://100.117.132.115", "production")).toBe(false);
    expect(isValidRedirectUri("http://joi.tail91a4f4.ts.net/auth/callback", "production")).toBe(false);
  });

  it("does not treat a localhost hostname as permission for non-HTTP URLs", () => {
    expect(isValidOrigin("javascript://localhost", "development")).toBe(false);
    expect(isValidRedirectUri("javascript://localhost/callback", "development")).toBe(false);
  });

  it("generates URL-safe high-entropy keys without modulo alphabet mapping", () => {
    const key = generateKey("sk_live");
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
  });
});

describe("signed OAuth context", () => {
  it("accepts valid signed contexts and rejects tampering", async () => {
    const secret = "test-secret";
    const encoded = await encodeOAuthCtx({
      slug: "app",
      appId: "app_1",
      redirect_uri: "https://app.example.com/callback",
      state: "state",
    }, secret);

    await expect(decodeOAuthCtx(encoded, secret)).resolves.toMatchObject({ appId: "app_1" });
    const [payload, sig] = encoded.split(".");
    const tampered = `${payload!.slice(0, -1)}${payload!.endsWith("A") ? "B" : "A"}.${sig}`;
    await expect(decodeOAuthCtx(tampered, secret)).resolves.toBeNull();
  });
});

describe("Stripe webhook verification", () => {
  it("accepts valid signatures and rejects stale or bad signatures", async () => {
    const body = JSON.stringify({ id: "evt_1" });
    const secret = "whsec_test";
    const now = 1_700_000_000_000;
    const timestamp = Math.floor(now / 1000);
    const valid = await stripeSig(body, secret, timestamp);

    await expect(verifyStripeWebhookSignature(body, valid, secret, now)).resolves.toBe(true);
    await expect(verifyStripeWebhookSignature(body, valid.replace(/.$/, "0"), secret, now)).resolves.toBe(false);
    await expect(verifyStripeWebhookSignature(body, valid, secret, now + 10 * 60 * 1000)).resolves.toBe(false);
  });
});

describe("dashboard host routing", () => {
  it("treats loopback dev hosts as the dashboard root", () => {
    expect(isDashboardHost("localhost:5174", "auth.lvh.me")).toBe(true);
    expect(isDashboardHost("127.0.0.1:5174", "auth.lvh.me")).toBe(true);
    expect(isDashboardHost("[::1]:5174", "auth.lvh.me")).toBe(true);
  });

  it("keeps unknown non-loopback hosts on application resolution", () => {
    expect(isDashboardHost("unknown.auth.lvh.me", "auth.lvh.me")).toBe(false);
  });
});

/**
 * Kova's own hosts come from env (AUTH_URL, DASHBOARD_URL, EMAIL_FROM), so a
 * domain move is configuration: CORS first-party origins, device-challenge
 * approve links, and the email sender.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EMAIL_FROM, sendEmail } from "./email";
import { STATIC_ORIGINS, staticOrigins } from "./middleware/cors";
import { createHarness } from "./test-support/auth-harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first-party CORS origins", () => {
  it("come from AUTH_URL and DASHBOARD_URL, not a hardcoded host", () => {
    expect(STATIC_ORIGINS.has("https://auth.115jon.site")).toBe(false);
    const origins = staticOrigins({ AUTH_URL: "https://auth.115jon.com/", DASHBOARD_URL: "https://dash.115jon.com/x" });
    expect(origins.has("https://auth.115jon.com")).toBe(true);
    expect(origins.has("https://dash.115jon.com")).toBe(true);
    expect(origins.has("https://auth.115jon.site")).toBe(false);
    expect(staticOrigins({ AUTH_URL: "not a url" })).toEqual(STATIC_ORIGINS);
  });

  it("reflect the configured auth origin on a real request", async () => {
    const h = createHarness({ env: { AUTH_URL: "https://auth.115jon.com", DASHBOARD_URL: "https://auth.115jon.com" } });
    const moved = await h.fetch("https://auth.115jon.com/health", { headers: { origin: "https://auth.115jon.com" } });
    expect(moved.headers.get("access-control-allow-origin")).toBe("https://auth.115jon.com");
    const old = await h.fetch("https://auth.115jon.com/health", { headers: { origin: "https://auth.115jon.site" } });
    expect(old.headers.get("access-control-allow-origin")).toBe("null");
  });
});

describe("device challenge approve link", () => {
  it("uses DASHBOARD_URL, else AUTH_URL", async () => {
    const h = createHarness({ env: { AUTH_URL: "https://auth.115jon.com", DASHBOARD_URL: "" } });
    const response = await h.fetch("https://auth.115jon.com/api/device-challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "pc" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; approveUrl: string };
    expect(body.approveUrl).toBe(`https://auth.115jon.com/approve/${body.id}`);
  });
});

describe("email sender", () => {
  function stubResend() {
    const sent: Array<{ from: string }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ id: "em_1" });
    });
    return sent;
  }

  it("uses EMAIL_FROM when set and the old sender otherwise", async () => {
    const sent = stubResend();
    await sendEmail({ to: "a@example.com", subject: "s", html: "h", apiKey: "re_x", from: "Kova <noreply@115jon.com>" });
    await sendEmail({ to: "a@example.com", subject: "s", html: "h", apiKey: "re_x" });
    await sendEmail({ to: "a@example.com", subject: "s", html: "h", apiKey: "re_x", from: "  " });
    expect(sent.map((m) => m.from)).toEqual(["Kova <noreply@115jon.com>", DEFAULT_EMAIL_FROM, DEFAULT_EMAIL_FROM]);
    expect(DEFAULT_EMAIL_FROM).toBe("kova-auth <noreply@115jon.site>");
  });
});

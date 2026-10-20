import { afterEach, describe, expect, it, vi } from "vitest";
import { devEmailCaptureEnabled, magicLinkEmail, sendEmail } from "./email";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("devEmailCaptureEnabled", () => {
  it("needs both the flag and a local AUTH_URL", () => {
    expect(devEmailCaptureEnabled({ AUTH_URL: "http://localhost:5291", KOVA_DEV_EMAIL_CAPTURE: "1" })).toBe(true);
    expect(devEmailCaptureEnabled({ AUTH_URL: "https://auth.lvh.me", KOVA_DEV_EMAIL_CAPTURE: "1" })).toBe(true);
    expect(devEmailCaptureEnabled({ AUTH_URL: "http://localhost:5291" })).toBe(false);
    expect(devEmailCaptureEnabled({ AUTH_URL: "http://localhost:5291", KOVA_DEV_EMAIL_CAPTURE: "true" })).toBe(false);
  });

  it("is never on for a deployed host, even with the flag set", () => {
    for (const AUTH_URL of [
      "https://auth.115jon.site",
      "https://app.auth.115jon.site",
      "https://lvh.me.evil.test",
      "https://evillvh.me",
      "https://localhost.evil.test",
      "not a url",
      "",
    ]) {
      expect(devEmailCaptureEnabled({ AUTH_URL, KOVA_DEV_EMAIL_CAPTURE: "1" }), AUTH_URL).toBe(false);
    }
    expect(devEmailCaptureEnabled({ KOVA_DEV_EMAIL_CAPTURE: "1" })).toBe(false);
  });
});

describe("sendEmail", () => {
  it("logs the links and skips Resend when capturing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { subject, html } = magicLinkEmail("http://localhost:5291/api/auth/magic-link/verify?token=abc&callbackURL=%2F");

    await sendEmail({ to: "a@b.test", subject, html, apiKey: "unused", capture: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    const line = String(log.mock.calls[0]?.[0]);
    expect(line.startsWith("[kova-dev-mail] ")).toBe(true);
    expect(JSON.parse(line.slice("[kova-dev-mail] ".length))).toMatchObject({
      to: "a@b.test",
      links: ["http://localhost:5291/api/auth/magic-link/verify?token=abc&callbackURL=%2F"],
    });
  });

  it("calls Resend when not capturing", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendEmail({ to: "a@b.test", subject: "s", html: "<p>x</p>", apiKey: "re_test" });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

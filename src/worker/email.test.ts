import { afterEach, describe, expect, it, vi } from "vitest";
import { devEmailCaptureEnabled, invitationEmail, magicLinkEmail, resetPasswordEmail, sendEmail, twoFactorOtpEmail, verificationEmail } from "./email";

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

describe("templates", () => {
  const url = "https://auth.115jon.com/api/auth/reset-password/abc?callbackURL=%2F";
  const all = [
    verificationEmail(url),
    resetPasswordEmail(url),
    twoFactorOtpEmail("482913"),
    magicLinkEmail(url),
    invitationEmail({ inviterName: "Jon", inviterEmail: "jon@example.com", orgName: "House", inviteLink: url, role: "admin" }),
  ];

  it("keep every style attribute intact and leak no template text", () => {
    for (const { html } of all) {
      // A double quote inside style="" closes the attribute and drops the rest.
      for (const [, style] of html.matchAll(/style="([^"]*)"/g)) expect(style).not.toMatch(/font-family:\s*$/);
      expect(html).not.toMatch(/font-family:"/);
      expect(html).not.toContain("${");
      expect(html).toContain("https://auth.115jon.com/email/kova-mark.png");
    }
  });

  it("brand the subject as Kova and put the code first", () => {
    expect(all.map((m) => m.subject)).toEqual([
      "Verify your email for Kova",
      "Reset your Kova password",
      "482913 is your Kova sign-in code",
      "Your Kova sign-in link",
      "Jon invited you to House on Kova",
    ]);
  });

  it("escape names that came from users", () => {
    const { html } = invitationEmail({ inviterName: "<b>x</b>", inviterEmail: "a@b.c", orgName: "A & <i>B</i>", inviteLink: url, role: "member" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>B</i>");
    expect(html).toContain("A &amp; &lt;i&gt;B&lt;/i&gt;");
    expect(html).toContain("as a <strong");
  });
});

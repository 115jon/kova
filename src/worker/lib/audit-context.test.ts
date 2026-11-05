import { describe, expect, it } from "vitest";
import {
  authFailureCode,
  classifySessionEnd,
  describeClient,
  geoFromCf,
  isDisposableEmailAddress,
  requestMeta,
  signInMethodFromPath,
} from "./audit-context";

const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F77 Instagram 447.0.0.34.80 (iPhone18,1; iOS 26_5; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1065993616) Safari/604.1";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";

describe("describeClient", () => {
  it("flags the Instagram in-app browser", () => {
    const client = describeClient(INSTAGRAM_UA);
    expect(client.inApp).toBe("instagram");
    expect(client.platform).toBe("mobile");
    expect(client.os).toBe("iOS");
  });

  it("describes Safari with no in-app browser", () => {
    const client = describeClient(SAFARI_UA);
    expect(client.browser).toBe("Safari");
    expect(client.browserVersion).toBe("26.5");
    expect(client.platform).toBe("mobile");
    expect(client.inApp).toBeNull();
  });

  it("returns nothing for a missing User-Agent", () => {
    expect(describeClient(null)).toEqual({});
    expect(describeClient("")).toEqual({});
  });
});

describe("geoFromCf", () => {
  it("keeps the fields present and drops the rest", () => {
    const cf = { country: "US", city: "Austin", colo: "DFW", timezone: "America/Chicago", latitude: "30.2", asn: 1 };
    expect(geoFromCf(cf as unknown as IncomingRequestCfProperties)).toEqual({
      country: "US",
      city: "Austin",
      colo: "DFW",
      timezone: "America/Chicago",
      latitude: "30.2",
    });
  });

  it("is empty without cf", () => {
    expect(geoFromCf(undefined)).toEqual({});
  });
});

describe("requestMeta", () => {
  it("reads CF-Connecting-IP and User-Agent from a Request", () => {
    const request = new Request("https://auth.example/x", { headers: { "CF-Connecting-IP": "203.0.113.9", "User-Agent": "UA/1" } });
    expect(requestMeta(request)).toEqual({ ipAddress: "203.0.113.9", userAgent: "UA/1" });
  });

  it("falls back to the first X-Forwarded-For hop, and accepts bare Headers", () => {
    const headers = new Headers({ "X-Forwarded-For": "198.51.100.1, 10.0.0.1" });
    expect(requestMeta(headers)).toEqual({ ipAddress: "198.51.100.1", userAgent: null });
  });

  it("is null-safe", () => {
    expect(requestMeta(undefined)).toEqual({ ipAddress: null, userAgent: null });
  });
});

describe("signInMethodFromPath", () => {
  it("resolves the OAuth provider from route params or the concrete path", () => {
    expect(signInMethodFromPath("/callback/:id", { id: "google" })).toEqual({ method: "oauth", provider: "google" });
    expect(signInMethodFromPath("/callback/github")).toEqual({ method: "oauth", provider: "github" });
    expect(signInMethodFromPath("/oauth2/callback/:providerId", { providerId: "okta" })).toEqual({ method: "oauth", provider: "okta" });
    expect(signInMethodFromPath("/callback/:id")).toEqual({ method: "oauth" });
  });

  it.each([
    ["/sign-in/email", "password"],
    ["/sign-in/username", "password"],
    ["/magic-link/verify", "magic_link"],
    ["/passkey/verify-authentication", "passkey"],
    ["/verify-email", "email_verification"],
    ["/two-factor/verify-totp", "two_factor"],
    ["/two-factor/verify-otp", "two_factor"],
    ["/device/token", "device_code"],
    ["/get-session", "unknown"],
    [undefined, "unknown"],
  ] as const)("%s is %s", (path, method) => {
    expect(signInMethodFromPath(path).method).toBe(method);
  });
});

describe("classifySessionEnd", () => {
  it.each(["/sign-out", "/multi-session/revoke"])("%s is a real sign-out", (path) => {
    expect(classifySessionEnd(path)).toEqual({ action: "user.signOut", reason: "signed_out" });
  });

  it.each([
    ["/get-session", "expired"],
    ["/revoke-session", "revoked"],
    ["/revoke-sessions", "revoked"],
    ["/revoke-other-sessions", "revoked"],
    ["/admin/revoke-user-sessions", "revoked"],
    ["/admin/ban-user", "revoked"],
    ["/change-password", "revoked"],
    // Multi-session drops the user's older sessions after a same-user sign-in.
    ["/callback/:id", "replaced"],
    ["/sign-in/email", "replaced"],
    ["/magic-link/verify", "replaced"],
    // 2FA discards the provisional session the password sign-in created.
    ["/two-factor/verify-totp", "replaced"],
    ["/something-else", "unknown"],
  ] as const)("%s is session.ended (%s), not a sign-out", (path, reason) => {
    expect(classifySessionEnd(path)).toEqual({ action: "session.ended", reason });
  });

  it("is session.ended/unknown outside any endpoint", () => {
    expect(classifySessionEnd(undefined)).toEqual({ action: "session.ended", reason: "unknown" });
    expect(classifySessionEnd(null)).toEqual({ action: "session.ended", reason: "unknown" });
  });

  it("treats an already-expired row as expired cleanup, whichever endpoint hit it", () => {
    const now = 1_000_000;
    expect(classifySessionEnd("/callback/:id", now - 1, now)).toEqual({ action: "session.ended", reason: "expired" });
    expect(classifySessionEnd("/callback/:id", now + 1, now).reason).toBe("replaced");
  });

  it("never downgrades a sign-out because the row had expired", () => {
    expect(classifySessionEnd("/sign-out", 1, 1_000_000).action).toBe("user.signOut");
  });
});

describe("authFailureCode", () => {
  it("returns the error code of an APIError-shaped failure", () => {
    expect(authFailureCode({ statusCode: 401, status: "UNAUTHORIZED", body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "x" } })).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );
    expect(authFailureCode({ statusCode: 403, status: "FORBIDDEN", body: {} })).toBe("FORBIDDEN");
  });

  it("reads a Response status", () => {
    expect(authFailureCode(new Response(null, { status: 500 }))).toBe("500");
  });

  it("reads an ?error= redirect and ignores a clean one", () => {
    const failed = { statusCode: 302, status: "FOUND", headers: { Location: "https://app.example/?error=INVALID_TOKEN" } };
    expect(authFailureCode(failed)).toBe("INVALID_TOKEN");
    expect(authFailureCode({ statusCode: 302, headers: { Location: "https://app.example/dashboard" } })).toBeNull();
  });

  it("is null for success payloads", () => {
    expect(authFailureCode({ user: { id: "u" }, token: "t" })).toBeNull();
    expect(authFailureCode(undefined)).toBeNull();
  });
});

describe("isDisposableEmailAddress", () => {
  it("flags a disposable domain and passes a normal one", async () => {
    expect(await isDisposableEmailAddress("someone@mailinator.com")).toBe(true);
    expect(await isDisposableEmailAddress("someone@gmail.com")).toBe(false);
    expect(await isDisposableEmailAddress(undefined)).toBe(false);
  });
});

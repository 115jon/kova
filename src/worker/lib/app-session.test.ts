import { describe, expect, it } from "vitest";
import {
  APP_SESSION_TTL_MS,
  appSessionTimestampValues,
  dashboardCanUseCookieSession,
  isSessionUnexpired,
  pickActiveAppSession,
  sdkCookieProvesIdentity,
  sessionExpiryMs,
} from "./app-session";

describe("sessionExpiryMs", () => {
  it("parses Date, epoch ms, numeric strings, and ISO strings", () => {
    const iso = "2026-09-26T09:40:45.345Z";
    const ms = Date.parse(iso);
    expect(sessionExpiryMs(new Date(iso))).toBe(ms);
    expect(sessionExpiryMs(ms)).toBe(ms);
    expect(sessionExpiryMs(String(ms))).toBe(ms);
    expect(sessionExpiryMs(iso)).toBe(ms);
  });

  it("rejects empty and garbage values", () => {
    expect(sessionExpiryMs("")).toBeNull();
    expect(sessionExpiryMs("not-a-date")).toBeNull();
    expect(sessionExpiryMs(Number.NaN)).toBeNull();
    expect(sessionExpiryMs(undefined)).toBeNull();
  });
});

describe("isSessionUnexpired", () => {
  it("treats ISO bounce rows as alive against Date.now()", () => {
    const now = Date.parse("2026-09-19T09:40:00.000Z");
    expect(isSessionUnexpired("2026-09-26T09:40:45.345Z", now)).toBe(true);
    expect(isSessionUnexpired("2026-09-18T09:40:45.345Z", now)).toBe(false);
    expect(isSessionUnexpired(now + 1000, now)).toBe(true);
    expect(isSessionUnexpired(now - 1000, now)).toBe(false);
  });
});

describe("cookie session policy", () => {
  it("keeps the dashboard on unscoped SSO cookies only", () => {
    expect(dashboardCanUseCookieSession(null)).toBe(true);
    expect(dashboardCanUseCookieSession(undefined)).toBe(true);
    expect(dashboardCanUseCookieSession("")).toBe(true);
    expect(dashboardCanUseCookieSession("app_2db95e2369dd")).toBe(false);
  });

  it("lets any auth-domain cookie prove identity to an SDK app", () => {
    expect(sdkCookieProvesIdentity(null)).toBe(true);
    expect(sdkCookieProvesIdentity("app_7cc00cce6784")).toBe(true);
    expect(sdkCookieProvesIdentity("app_2db95e2369dd")).toBe(true);
  });
});

describe("pickActiveAppSession", () => {
  it("returns the first unexpired row and skips dead ISO bounce rows", () => {
    const now = Date.parse("2026-09-19T09:40:00.000Z");
    expect(
      pickActiveAppSession(
        [
          { token: "dead", expiresAt: "2026-09-18T09:40:45.345Z" },
          { token: "live", expiresAt: "2026-09-26T09:40:45.345Z" },
        ],
        now,
      )?.token,
    ).toBe("live");
    expect(pickActiveAppSession([{ token: "dead", expiresAt: now - 1 }], now)).toBeNull();
  });
});

describe("appSessionTimestampValues", () => {
  it("mints a 7-day ISO window from epoch ms", () => {
    const now = Date.parse("2026-09-19T09:40:00.000Z");
    const stamps = appSessionTimestampValues(now);
    expect(stamps.expiresAt).toBe(now + APP_SESSION_TTL_MS);
    expect(stamps.createdAtIso).toBe("2026-09-19T09:40:00.000Z");
    expect(Date.parse(stamps.expiresAtIso)).toBe(now + APP_SESSION_TTL_MS);
  });
});

import { describe, expect, it } from "vitest";
import { confirmMethods, isSessionNotFresh } from "./fresh-session";

describe("isSessionNotFresh", () => {
  it("recognises Better Auth's error by code or message", () => {
    expect(isSessionNotFresh({ status: 403, code: "SESSION_NOT_FRESH", message: "Session is not fresh" })).toBe(true);
    expect(isSessionNotFresh({ message: "Session is not fresh" })).toBe(true);
    expect(isSessionNotFresh({ code: "SESSION_NOT_FRESH" })).toBe(true);
  });

  it("ignores other failures", () => {
    expect(isSessionNotFresh({ status: 403, code: "FORBIDDEN", message: "Forbidden" })).toBe(false);
    expect(isSessionNotFresh({ status: 401, message: "Unauthorized" })).toBe(false);
    expect(isSessionNotFresh(new Error("network"))).toBe(false);
    expect(isSessionNotFresh(null)).toBe(false);
    expect(isSessionNotFresh(undefined)).toBe(false);
    expect(isSessionNotFresh("Session is not fresh")).toBe(false);
  });
});

describe("confirmMethods", () => {
  const base = { hasPassword: false, twoFactorEnabled: false, hasPasskey: false, providers: [] as string[] };

  it("checks the password for a password account", () => {
    expect(confirmMethods({ ...base, hasPassword: true, providers: ["google"] })).toEqual({
      password: true, passkey: false, providers: ["google"], emailLink: false,
    });
  });

  it("never takes the password path on a 2FA account, which would sign the browser out", () => {
    const methods = confirmMethods({ ...base, hasPassword: true, twoFactorEnabled: true, providers: ["github"] });
    expect(methods.password).toBe(false);
    expect(methods.providers).toEqual(["github"]);
    expect(methods.emailLink).toBe(false);
  });

  it("falls back to an emailed link only when nothing else is left", () => {
    expect(confirmMethods({ ...base, hasPassword: true, twoFactorEnabled: true }).emailLink).toBe(true);
    expect(confirmMethods(base).emailLink).toBe(true);
    expect(confirmMethods({ ...base, hasPasskey: true }).emailLink).toBe(false);
    expect(confirmMethods({ ...base, providers: ["discord"] }).emailLink).toBe(false);
  });
});

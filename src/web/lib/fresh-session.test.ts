import { describe, expect, it } from "vitest";
import { classifySecondFactor, confirmMethods, isSessionNotFresh, normalizeBackupCode } from "./fresh-session";

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
      password: true, code: false, passkey: false, providers: ["google"], emailLink: false,
    });
  });

  it("asks for a code too on a password account with 2FA", () => {
    expect(confirmMethods({ ...base, hasPassword: true, twoFactorEnabled: true })).toEqual({
      password: true, code: true, passkey: false, providers: [], emailLink: false,
    });
  });

  it("falls back to an emailed link only when nothing else is left", () => {
    const methods = confirmMethods({ ...base, twoFactorEnabled: true });
    expect(methods.emailLink).toBe(true);
    expect(methods.code).toBe(false);
    expect(confirmMethods({ ...base, hasPasskey: true }).emailLink).toBe(false);
    expect(confirmMethods({ ...base, providers: ["discord"] }).emailLink).toBe(false);
  });
});

describe("classifySecondFactor", () => {
  it("tells codes apart", () => {
    expect(classifySecondFactor("123456")).toBe("totp");
    expect(classifySecondFactor("123 456")).toBe("totp");
    expect(classifySecondFactor("ab1cd2ef3g")).toBe("backup");
    expect(classifySecondFactor("ab1cd-2ef3g")).toBe("backup");
    expect(classifySecondFactor("12345")).toBeNull();
    expect(classifySecondFactor("")).toBeNull();
  });
});

describe("normalizeBackupCode", () => {
  it("formats as xxxxx-xxxxx", () => {
    expect(normalizeBackupCode("ab1cd2ef3g")).toBe("ab1cd-2ef3g");
    expect(normalizeBackupCode(" ab1cd-2ef3g ")).toBe("ab1cd-2ef3g");
  });
});

import { describe, expect, it } from "vitest";
import {
  clipDeviceLabel,
  deviceReturnPath,
  formatUserCode,
  generateDeviceCode,
  hostedVerificationUri,
  isSafeDeviceReturnPath,
  normalizeUserCode,
} from "./device-code";

describe("user codes", () => {
  it("normalizes a displayed user code and rejects lookalikes", () => {
    expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeUserCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(normalizeUserCode(" abcd efgh ")).toBe("ABCDEFGH");
    expect(formatUserCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeUserCode("IIII-OOOO")).toBeNull();
    expect(normalizeUserCode("0000-1111")).toBeNull();
    expect(normalizeUserCode("abcd-efg")).toBeNull();
    expect(normalizeUserCode(12)).toBeNull();
  });

  it("only allows a same-origin /device return path", () => {
    expect(deviceReturnPath("abcd-efgh")).toBe("/device?code=ABCD-EFGH");
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH")).toBe(true);
    expect(isSafeDeviceReturnPath("https://evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("//evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH&next=https://evil.example")).toBe(false);
    expect(isSafeDeviceReturnPath("/sign-in?code=ABCD-EFGH")).toBe(false);
  });
});

describe("device codes and context", () => {
  it("issues dvc_ codes with 256 bits of entropy", () => {
    const a = generateDeviceCode();
    expect(a).toMatch(/^dvc_[A-Za-z0-9_-]{43}$/);
    expect(generateDeviceCode()).not.toBe(a);
  });

  it("cleans device labels for display", () => {
    expect(clipDeviceLabel("  joi\n")).toBe("joi");
    expect(clipDeviceLabel("a\u0007b c")).toBe("abc");
    expect(clipDeviceLabel("é".repeat(200))).toHaveLength(128);
    expect(clipDeviceLabel("   ")).toBeNull();
    expect(clipDeviceLabel(5)).toBeNull();
  });

  it("builds the app's hosted verification URI", () => {
    expect(hostedVerificationUri("https://auth.115jon.site", "ralph")).toBe("https://ralph.auth.115jon.site/device");
    expect(hostedVerificationUri("https://auth.115jon.site", null)).toBeNull();
    expect(hostedVerificationUri("https://auth.115jon.site", "Bad.Slug")).toBeNull();
  });
});

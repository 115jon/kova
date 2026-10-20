import { describe, expect, it } from "vitest";
import { KOVA_HOSTED_AUTH_URL, encodePublishableKey, resolveAuthUrl } from "./key";

describe("resolveAuthUrl", () => {
  const serverIssuedKey = "pk_live_q8Zr3n0b-Xw_Kd1hY5tLmA2cVe7uPj9sRf4gHoNiTzU";

  it("prefers an explicit authUrl", () => {
    expect(
      resolveAuthUrl({ publishableKey: serverIssuedKey, authUrl: "https://auth.lvh.me/" }),
    ).toBe("https://auth.lvh.me");
  });

  it("accepts the opaque keys Kova issues without throwing", () => {
    expect(resolveAuthUrl({ publishableKey: serverIssuedKey })).toBe(KOVA_HOSTED_AUTH_URL);
    expect(resolveAuthUrl({ publishableKey: "pk_dev_abc123" })).toBe(KOVA_HOSTED_AUTH_URL);
  });

  it("still reads legacy self-describing keys", () => {
    const key = encodePublishableKey("https://kova.example.com/");
    expect(resolveAuthUrl({ publishableKey: key })).toBe("https://kova.example.com");
  });

  it("requires a key or URL", () => {
    expect(() => resolveAuthUrl({})).toThrow(/publishableKey/);
  });
});

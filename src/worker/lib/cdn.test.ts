import { describe, expect, it } from "vitest";
import { appAssetKey, sniffImageType } from "./cdn";

describe("appAssetKey", () => {
  const cdn = "https://cdn.115jon.site";
  const own = `${cdn}/kova-auth/apps/app_1/`;

  it("returns the key of an asset in the app's own folder", () => {
    expect(appAssetKey(cdn, "app_1", `${own}logo-ab12.webp`)).toBe("kova-auth/apps/app_1/logo-ab12.webp");
    expect(appAssetKey(`${cdn}/`, "app_1", `${own}logo-ab12.webp?v=2#top`)).toBe("kova-auth/apps/app_1/logo-ab12.webp");
    expect(appAssetKey(cdn, "app_1", `${own}nested/logo.webp`)).toBe("kova-auth/apps/app_1/nested/logo.webp");
  });

  it("refuses another app's folder, even one that shares a prefix", () => {
    expect(appAssetKey(cdn, "app_1", `${cdn}/kova-auth/apps/app_2/logo.webp`)).toBeNull();
    expect(appAssetKey(cdn, "app_1", `${cdn}/kova-auth/apps/app_10/logo.webp`)).toBeNull();
    expect(appAssetKey(cdn, "app_1", `${cdn}/kova-auth/apps/app_1logo.webp`)).toBeNull();
  });

  it("refuses other Kova assets and other CDN apps", () => {
    expect(appAssetKey(cdn, "app_1", `${cdn}/kova-auth/org-logos/org_1/x.webp`)).toBeNull();
    expect(appAssetKey(cdn, "app_1", `${cdn}/kova-auth/avatars/user_1/x.webp`)).toBeNull();
    expect(appAssetKey(cdn, "app_1", `${cdn}/other-app/apps/app_1/logo.webp`)).toBeNull();
  });

  it("refuses traversal, empty segments and encoded separators", () => {
    for (const rest of [
      "../app_2/logo.webp",
      "../../org-logos/org_1/x.webp",
      "nested/../../app_2/logo.webp",
      "./logo.webp",
      "..",
      "%2e%2e/app_2/logo.webp",
      "%2E%2E%2Fapp_2%2Flogo.webp",
      "a%2Fb.webp",
      "a//b.webp",
      "a\\..\\b.webp",
      "logo.webp/",
      "",
    ]) {
      expect(appAssetKey(cdn, "app_1", `${own}${rest}`), rest).toBeNull();
    }
  });

  it("refuses share links, other hosts and empty values", () => {
    expect(appAssetKey(cdn, "app_1", `${cdn}/s/0123456789abcdef`)).toBeNull();
    expect(appAssetKey(cdn, "app_1", "https://evil.example/kova-auth/apps/app_1/logo.webp")).toBeNull();
    expect(appAssetKey(cdn, "app_1", null)).toBeNull();
    expect(appAssetKey(cdn, "app_1", "")).toBeNull();
  });

  it("refuses an app id that could change the folder", () => {
    expect(appAssetKey(cdn, "../org-logos", `${cdn}/kova-auth/apps/../org-logos/x.webp`)).toBeNull();
    expect(appAssetKey(cdn, "app_1/..", `${cdn}/kova-auth/apps/app_1/../x.webp`)).toBeNull();
    expect(appAssetKey(cdn, "", `${cdn}/kova-auth/apps//x.webp`)).toBeNull();
  });
});

describe("sniffImageType", () => {
  const webp = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38];

  it("names JPEG, PNG and WebP by their signatures", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array(webp))).toBe("image/webp");
  });

  it("returns null for everything else, including files that are too short", () => {
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // WAV
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

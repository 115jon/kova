import { describe, expect, it } from "vitest";
import { passkeyOrigins } from "./passkey-origins";

describe("passkeyOrigins", () => {
  it("is just the auth origin when the dashboard shares it", () => {
    expect(passkeyOrigins({ AUTH_URL: "https://auth.115jon.site", DASHBOARD_URL: "https://auth.115jon.site/" })).toEqual([
      "https://auth.115jon.site",
    ]);
  });

  it("keeps the auth origin when DASHBOARD_URL points elsewhere or is unset", () => {
    expect(passkeyOrigins({ AUTH_URL: "https://auth.115jon.site", DASHBOARD_URL: "https://old.example" })).toEqual([
      "https://old.example",
      "https://auth.115jon.site",
    ]);
    expect(passkeyOrigins({ AUTH_URL: "https://auth.115jon.site" })).toEqual(["https://auth.115jon.site"]);
  });

  it("skips a malformed value", () => {
    expect(passkeyOrigins({ AUTH_URL: "https://auth.115jon.site", DASHBOARD_URL: "not a url" })).toEqual([
      "https://auth.115jon.site",
    ]);
  });
});

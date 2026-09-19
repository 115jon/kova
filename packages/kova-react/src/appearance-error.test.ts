import { describe, expect, it } from "vitest";
import { appearanceLoadErrorMessage } from "./context";

describe("appearanceLoadErrorMessage", () => {
  it("maps a failed CORS/network fetch to an origin-allowlist error", () => {
    expect(appearanceLoadErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "This origin is not allowed to talk to the auth server. Add it to the application's allowed origins.",
    );
  });

  it("keeps HTTP status failures readable", () => {
    expect(
      appearanceLoadErrorMessage(new Error("Appearance request failed (403)")),
    ).toBe("Appearance request failed (403)");
  });

  it("does not swallow unknown failures into a blank card", () => {
    expect(appearanceLoadErrorMessage("nope")).toBe(
      "Could not load sign-in settings.",
    );
  });
});

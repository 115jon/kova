import { describe, expect, it } from "vitest";
import { appSignInLook, appSignInProviders, resolveColorScheme } from "./app-sign-in";

describe("app sign-in look", () => {
  it("follows the app theme, and the system only for auto", () => {
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("auto", true)).toBe("dark");
    expect(resolveColorScheme("auto", false)).toBe("light");
  });

  it("uses the app's colors for the page and the primary action", () => {
    const look = appSignInLook({ primaryColor: "#c2364a", backgroundColor: "#0c0e13", theme: "dark" }, false);
    expect(look).toMatchObject({ scheme: "dark", backdrop: "dark", background: "#0c0e13", primary: "#c2364a" });
    expect(look.variables.colorPrimary).toBe("#c2364a");
    expect(look.variables.colorBackground).toBe("#0c0e13");
  });

  it("keeps outside text readable when a light card sits on a dark background", () => {
    const look = appSignInLook({ primaryColor: null, backgroundColor: "#0f172a", theme: "light" }, true);
    expect(look.scheme).toBe("light");
    expect(look.backdrop).toBe("dark");
    expect(look.variables.colorSurface).toBe("#ffffff");
    expect(look.primary).toBe("#3b82f6");
  });

  it("falls back to a background that matches the theme", () => {
    expect(appSignInLook({ primaryColor: null, backgroundColor: null, theme: "light" }, true).backdrop).toBe("light");
    expect(appSignInLook({ primaryColor: null, backgroundColor: "", theme: "dark" }, true).backdrop).toBe("dark");
  });
});

describe("app sign-in providers", () => {
  const configured = [
    { id: "google", name: "Google" },
    { id: "discord", name: "Discord" },
    { id: "github", name: "GitHub" },
  ] as const;

  it("shows only providers the app enabled and Kova has credentials for", () => {
    expect(appSignInProviders(configured, ["google"])).toEqual([{ id: "google", label: "Google" }]);
    expect(appSignInProviders(configured, ["github", "apple", "google"])).toEqual([
      { id: "google", label: "Google" },
      { id: "github", label: "GitHub" },
    ]);
    expect(appSignInProviders(configured, [])).toEqual([]);
  });
});

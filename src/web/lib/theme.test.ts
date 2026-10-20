import { describe, expect, it } from "vitest";
import { parseThemePreference, THEME_BOOT_SCRIPT } from "./theme";

/** Runs the inlined boot script against a fake document and storage. */
function boot(stored: string | null | Error) {
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: () => {
      if (stored instanceof Error) throw stored;
      return stored;
    },
  };
  new Function("document", "localStorage", THEME_BOOT_SCRIPT)({ documentElement }, localStorage);
  return documentElement.dataset.theme;
}

describe("theme boot script", () => {
  it("follows the device when nothing is stored", () => {
    expect(boot(null)).toBe("system");
  });

  it("follows the device when storage is unreadable", () => {
    expect(boot(new Error("blocked"))).toBe("system");
  });

  it("falls back to system for values it does not know", () => {
    expect(boot("")).toBe("system");
    expect(boot("midnight")).toBe("system");
  });

  it.each(["light", "dark", "system"])("keeps a stored %s choice", (choice) => {
    expect(boot(choice)).toBe(choice);
  });
});

describe("parseThemePreference", () => {
  it("defaults to system", () => {
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference("nope")).toBe("system");
  });

  it("accepts the explicit schemes", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });
});

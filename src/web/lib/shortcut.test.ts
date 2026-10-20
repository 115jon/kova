import { describe, expect, it } from "vitest";
import { searchShortcutLabel } from "./shortcut";

describe("searchShortcutLabel", () => {
  it.each(["MacIntel", "macOS", "iPhone", "iPad", "iPod touch"])("uses the command key on %s", (platform) => {
    expect(searchShortcutLabel(platform)).toBe("⌘K");
  });

  it.each(["Win32", "Windows", "Linux x86_64", "Linux armv8l", "CrOS", "Android"])("uses Ctrl on %s", (platform) => {
    expect(searchShortcutLabel(platform)).toBe("Ctrl K");
  });
});

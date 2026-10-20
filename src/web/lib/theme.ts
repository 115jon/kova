import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

/** Order shown in Settings, the topbar menu and the command palette. */
export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const STORAGE_KEY = "kova-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before hydration so the first paint already has the right
 * theme. Keep it tiny and dependency-free; it is inlined as a string.
 * Anything that is not an explicit "light" or "dark" means follow the device.
 */
export const THEME_BOOT_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${STORAGE_KEY}")}catch(e){}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"system"})()`;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  if (typeof document === "undefined") return "system";
  return parseThemePreference(document.documentElement.dataset.theme);
}

export function setThemePreference(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode: the choice still applies for this page view.
  }
  for (const listener of listeners) listener();
}

/** The scheme actually on screen, resolving "system" through the OS setting. */
export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

/**
 * Returns the stored preference and the scheme it resolves to right now.
 * The server cannot know either, so both start from the same snapshot the
 * boot script falls back to; the client value lands right after hydration.
 */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolvedTheme(readPreference()),
    () => "light" as const,
  );
  return { preference, resolved };
}

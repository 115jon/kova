import type { AppearanceVariables, OAuthProvider, ServerAppearance } from "@115jon/kova-react";
import type { SocialProvider } from "./providers";

export type AppAppearance = ServerAppearance;
export type ColorScheme = "dark" | "light";

const SANS = '"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
export const DEFAULT_PRIMARY = "#026f8e";
export const DEFAULT_BACKGROUND: Record<ColorScheme, string> = { dark: "#131515", light: "#f7f7f7" };

export function resolveColorScheme(
  theme: AppAppearance["theme"] | null | undefined,
  prefersDark: boolean,
): ColorScheme {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

/** Relative luminance of a #rgb/#rrggbb color, or null for anything else. */
function hexLuminance(color: string): number | null {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const linear = (i: number) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(0) + 0.7152 * linear(2) + 0.0722 * linear(4);
}

export interface AppSignInLook {
  scheme: ColorScheme;
  background: string;
  primary: string;
  /** Scheme of the page background itself, which can differ from the card's theme. */
  backdrop: ColorScheme;
  variables: AppearanceVariables;
}

/**
 * The SDK card colors for an app's hosted sign-in page. The card follows the
 * app's theme; text outside the card follows the page background, because
 * apps often keep the default dark background with a light theme.
 */
export function appSignInLook(
  appearance: Pick<AppAppearance, "primaryColor" | "backgroundColor" | "theme">,
  prefersDark: boolean,
): AppSignInLook {
  const scheme = resolveColorScheme(appearance.theme, prefersDark);
  const background = appearance.backgroundColor?.trim() || DEFAULT_BACKGROUND[scheme];
  const primary = appearance.primaryColor?.trim() || DEFAULT_PRIMARY;
  const luminance = hexLuminance(background);
  const backdrop: ColorScheme = luminance === null ? scheme : luminance > 0.4 ? "light" : "dark";

  const shared = {
    colorPrimary: primary,
    colorBackground: background,
    borderRadius: "20px",
    borderRadiusSm: "12px",
    fontFamily: SANS,
    fontFamilyMono: MONO,
    fontSize: "15px",
  };

  const variables: AppearanceVariables = scheme === "dark"
    ? {
      ...shared,
      colorPrimaryHover: `color-mix(in oklab, ${primary} 86%, white)`,
      colorSurface: backdrop === "dark" ? `color-mix(in oklab, ${background} 95%, white)` : "#1a1c1c",
      colorSurfaceRaised: backdrop === "dark" ? `color-mix(in oklab, ${background} 89%, white)` : "#222525",
      colorText: "#ffffff",
      colorTextSecondary: "#b8b8b8",
      colorTextTertiary: "#8a9090",
      colorBorder: "rgba(255, 255, 255, 0.1)",
      colorBorderStrong: "rgba(255, 255, 255, 0.18)",
      colorError: "#ff6b6b",
      colorSuccess: "#4ade80",
      colorWarning: "#ffb020",
      shadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
    }
    : {
      ...shared,
      colorPrimaryHover: `color-mix(in oklab, ${primary} 88%, black)`,
      colorSurface: "#ffffff",
      colorSurfaceRaised: "#f0f0f0",
      colorText: "#131515",
      colorTextSecondary: "#494d4d",
      colorTextTertiary: "#6b7070",
      colorBorder: "rgba(19, 21, 21, 0.1)",
      colorBorderStrong: "rgba(19, 21, 21, 0.18)",
      colorError: "#d92d20",
      colorSuccess: "#0f8a08",
      colorWarning: "#9a5b00",
      shadow: "0 8px 20px rgba(19, 21, 21, 0.05)",
    };

  return { scheme, background, primary, backdrop, variables };
}

/**
 * Kova's own /sign-in: the same card as an app page, in Kova's colours, with
 * pill controls. Follows the dashboard theme the visitor last chose.
 */
export function kovaSignInLook(scheme: ColorScheme): AppSignInLook {
  const look = appSignInLook({ primaryColor: null, backgroundColor: null, theme: scheme }, scheme === "dark");
  return { ...look, variables: { ...look.variables, borderRadiusSm: "999px" } };
}

/**
 * Social buttons for the app page: enabled for this app and configured on this
 * Kova deployment, in the platform's provider order.
 */
export function appSignInProviders(
  configured: readonly Pick<SocialProvider, "id" | "name">[],
  enabledProviders: readonly string[],
): OAuthProvider[] {
  const enabled = new Set(enabledProviders);
  return configured
    .filter((provider) => enabled.has(provider.id))
    .map((provider) => ({ id: provider.id, label: provider.name }));
}

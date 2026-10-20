import type { AppearanceVariables, OAuthProvider, ServerAppearance } from "@115jon/kova-react";
import type { SocialProvider } from "./providers";

export type AppAppearance = ServerAppearance;
export type ColorScheme = "dark" | "light";

const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const DEFAULT_PRIMARY = "#3b82f6";
const DEFAULT_BACKGROUND: Record<ColorScheme, string> = { dark: "#0b0d12", light: "#f5f6f8" };

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
    borderRadius: "16px",
    borderRadiusSm: "10px",
    fontFamily: SANS,
    fontFamilyMono: SANS,
    fontSize: "14px",
  };

  const variables: AppearanceVariables = scheme === "dark"
    ? {
      ...shared,
      colorPrimaryHover: `color-mix(in oklab, ${primary} 86%, white)`,
      colorSurface: backdrop === "dark" ? `color-mix(in oklab, ${background} 95%, white)` : "#16181d",
      colorSurfaceRaised: backdrop === "dark" ? `color-mix(in oklab, ${background} 89%, white)` : "#1e2026",
      colorText: "#f3f4f6",
      colorTextSecondary: "rgb(243 244 246 / 0.7)",
      colorTextTertiary: "rgb(243 244 246 / 0.5)",
      colorBorder: "rgb(255 255 255 / 0.09)",
      colorBorderStrong: "rgb(255 255 255 / 0.17)",
      colorError: "#f87171",
      colorSuccess: "#4ade80",
    }
    : {
      ...shared,
      colorPrimaryHover: `color-mix(in oklab, ${primary} 88%, black)`,
      colorSurface: "#ffffff",
      colorSurfaceRaised: "#f4f5f7",
      colorText: "#15171c",
      colorTextSecondary: "rgb(21 23 28 / 0.68)",
      colorTextTertiary: "rgb(21 23 28 / 0.5)",
      colorBorder: "rgb(21 23 28 / 0.1)",
      colorBorderStrong: "rgb(21 23 28 / 0.18)",
      colorError: "#dc2626",
      colorSuccess: "#16a34a",
    };

  return { scheme, background, primary, backdrop, variables };
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

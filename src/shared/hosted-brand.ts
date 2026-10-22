export const HOSTED_PROVIDERS = ["google", "github", "discord", "microsoft", "apple", "facebook"] as const;
export type HostedProvider = typeof HOSTED_PROVIDERS[number];
export const PROVIDER_LABELS: Record<HostedProvider, string> = {
  google: "Google", github: "GitHub", discord: "Discord", microsoft: "Microsoft", apple: "Apple", facebook: "Facebook",
};

// Ralph Meet gets its native look on hosted pages unless its own branding is
// set. The app id is the stable identity; the key changed when the app was
// promoted to production (the old pk_dev_ key lives on as its legacy key).
export const RALPH_APP_ID = "app_2db95e2369dd";
export const RALPH_PUBLISHABLE_KEY = "pk_dev_fhygLR-eApZ4HvSfu-v-LEGFp7WAsgkLRhlveveNzhk";
// The small radio mark used by the native Ralph authentication screen.
export const RALPH_RADIO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.48M7.76 16.24a6 6 0 0 1 0-8.48M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>';

export interface HostedAppearance {
  primaryColor: string;
  backgroundColor: string;
  theme: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  brandMark?: "ralph-radio";
}

/** Who the page is for: the app row (preferred), or just a publishable key. */
export type HostedBrandSubject =
  | string
  | { id: string; publishable_key: string; legacy_publishable_key?: string | null };

function isRalph(subject: HostedBrandSubject): boolean {
  if (typeof subject === "string") return subject === RALPH_PUBLISHABLE_KEY;
  return subject.id === RALPH_APP_ID
    || subject.publishable_key === RALPH_PUBLISHABLE_KEY
    || subject.legacy_publishable_key === RALPH_PUBLISHABLE_KEY;
}

/**
 * Pass the app row, not its publishable key: after promotion Ralph's current
 * key is a pk_live_ key this module cannot know, so only the id or the legacy
 * key identifies it. A bare key still matches the original pk_dev_ key.
 */
export function resolveHostedAppearance(subject: HostedBrandSubject, input: HostedAppearance): HostedAppearance {
  if (!isRalph(subject)) return input;
  return {
    ...input,
    primaryColor: ["#026f8e", "#3b82f6", ""].includes(input.primaryColor.toLowerCase()) ? "#5865f2" : input.primaryColor,
    backgroundColor: ["#3b82f6", "#0f172a", "#0a0a0a", ""].includes(input.backgroundColor.toLowerCase())
      ? (input.theme === "light" ? "#f8f8f8" : "#070709") : input.backgroundColor,
    ...!input.logoUrl ? { brandMark: "ralph-radio" as const } : {},
  };
}

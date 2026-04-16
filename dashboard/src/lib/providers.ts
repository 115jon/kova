/**
 * Central registry of all supported social OAuth providers.
 *
 * To enable/disable a provider, flip its `configured` flag.
 * Also set the matching server credentials:
 *   Dev:  server/.dev.vars   → GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 *   Prod: wrangler secret put GITHUB_CLIENT_ID
 */

const AUTH_SERVER = import.meta.env.VITE_AUTH_URL || "http://localhost:8787";

export type ProviderId =
  | "google"
  | "discord"
  | "github"
  | "microsoft"
  | "facebook"
  | "apple";

export type SocialProvider = {
  id: ProviderId;
  name: string;
  /** Button label shown in sign-in page */
  label: string;
  /** True when the server has credentials for this provider */
  configured: boolean;
  callbackUrl: string;
  scopes: string[];
  docsUrl: string;
};

export const SOCIAL_PROVIDERS: SocialProvider[] = [
  // ── Enabled providers ──────────────────────────────────────────────────────
  // Flip `configured` to enable/disable a provider's sign-in button and badge.
  // Make sure the matching server credentials are also set.
  {
    id: "google",
    name: "Google",
    label: "Continue with Google",
    configured: true,                // always required
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/google`,
    scopes: ["openid", "email", "profile"],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    id: "discord",
    name: "Discord",
    label: "Continue with Discord",
    configured: true,                // DISCORD_CLIENT_ID set in .dev.vars + wrangler secrets
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/discord`,
    scopes: ["identify", "email"],
    docsUrl: "https://discord.com/developers/applications",
  },
  {
    id: "github",
    name: "GitHub",
    label: "Continue with GitHub",
    configured: true,                // GITHUB_CLIENT_ID set in .dev.vars + wrangler secrets
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/github`,
    scopes: ["user:email"],
    docsUrl: "https://github.com/settings/developers",
  },
  // ── Not yet configured ─────────────────────────────────────────────────────
  // Set configured: true once server credentials are added.
  {
    id: "microsoft",
    name: "Microsoft",
    label: "Continue with Microsoft",
    configured: true,                // MICROSOFT_CLIENT_ID set in .dev.vars + wrangler secrets
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/microsoft`,
    scopes: ["openid", "email", "profile"],
    docsUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  },
  {
    id: "facebook",
    name: "Facebook",
    label: "Continue with Facebook",
    configured: false,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/facebook`,
    scopes: ["email", "public_profile"],
    docsUrl: "https://developers.facebook.com/apps",
  },
  {
    id: "apple",
    name: "Apple",
    label: "Continue with Apple",
    configured: false,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/apple`,
    scopes: ["name", "email"],
    docsUrl: "https://developer.apple.com/account/resources/identifiers/list/serviceId",
  },
];

/** Only the providers that are actually wired up on the server */
export const CONFIGURED_PROVIDERS = SOCIAL_PROVIDERS.filter(p => p.configured);

/**
 * Central registry of all supported social OAuth providers.
 * Add an entry here → sign-in buttons + OAuth Apps page update automatically.
 *
 * `configured` should be true when the server has the credentials for
 * that provider (i.e., secrets are set in .dev.vars / wrangler secrets).
 */

const AUTH_SERVER = import.meta.env.VITE_AUTH_URL || "http://localhost:8787";

export type ProviderId = "google" | "discord"; // extend as providers are added

export type SocialProvider = {
  id: ProviderId;
  name: string;
  /** Button label: "Continue with {name}" by default */
  label: string;
  configured: boolean;
  callbackUrl: string;
  scopes: string[];
  docsUrl: string;
};

export const SOCIAL_PROVIDERS: SocialProvider[] = [
  {
    id: "google",
    name: "Google",
    label: "Continue with Google",
    configured: true,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/google`,
    scopes: ["openid", "email", "profile"],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    id: "discord",
    name: "Discord",
    label: "Continue with Discord",
    configured: true,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/discord`,
    scopes: ["identify", "email"],
    docsUrl: "https://discord.com/developers/applications",
  },
  // ── Add new providers below ────────────────────────────────────────────────
  // {
  //   id: "github",
  //   name: "GitHub",
  //   label: "Continue with GitHub",
  //   configured: false, // flip to true after adding secrets
  //   callbackUrl: `${AUTH_SERVER}/api/auth/callback/github`,
  //   scopes: ["user:email"],
  //   docsUrl: "https://github.com/settings/developers",
  // },
];

/** Only the providers that are actually wired up on the server */
export const CONFIGURED_PROVIDERS = SOCIAL_PROVIDERS.filter(p => p.configured);

/**
 * @kova/react — shared TypeScript types
 *
 * All public-facing interfaces live here so they can be imported
 * without pulling in any React dependencies.
 */

import type { ServerAppearance } from "./context";


// ── Appearance API ────────────────────────────────────────────────────────────

/**
 * Design tokens that cascade as CSS custom properties onto every SDK component.
 * Any value not specified falls back to Kova's dark default.
 */
export interface AppearanceVariables {
  /** Primary accent (submit button, active tab, focus ring). White text sits on it. @default "#026f8e" */
  colorPrimary?: string;
  /** Hover tone of primary. @default "#025a73" */
  colorPrimaryHover?: string;
  /** Background behind the card. @default "#131515" */
  colorBackground?: string;
  /** Card / surface background. @default "#1a1c1c" */
  colorSurface?: string;
  /** Raised surface (inputs, social buttons, skeletons). @default "#222525" */
  colorSurfaceRaised?: string;
  /** Primary text. @default "#ffffff" */
  colorText?: string;
  /** Secondary / label text. @default "#b8b8b8" */
  colorTextSecondary?: string;
  /** Meta and placeholder text. @default "#8a9090" */
  colorTextTertiary?: string;
  /** Default border color. @default "rgba(255,255,255,0.10)" */
  colorBorder?: string;
  /** Strong border (hovered controls, menus). @default "rgba(255,255,255,0.18)" */
  colorBorderStrong?: string;
  /** Error / destructive color. @default "#ff6b6b" */
  colorError?: string;
  /** Success color. @default "#4ade80" */
  colorSuccess?: string;
  /** Warning color (development-instance badge). @default "#ffb020" */
  colorWarning?: string;
  /** Card shadow. @default "0 8px 20px rgba(0,0,0,0.35)" */
  shadow?: string;
  /** Border radius for cards. @default "20px" */
  borderRadius?: string;
  /** Border radius for inputs and buttons. @default "12px" */
  borderRadiusSm?: string;
  /** Body font family. @default "\"Figtree\", system-ui, -apple-system, \"Segoe UI\", sans-serif" */
  fontFamily?: string;
  /** Monospace font family, for codes only. @default "\"IBM Plex Mono\", ui-monospace, monospace" */
  fontFamilyMono?: string;
  /** Base font size. Inputs stay at 16px below 480px wide to stop iOS zoom. @default "15px" */
  fontSize?: string;
}

/**
 * Per-element style overrides.
 * Keys match the `data-ra-element` attribute of each rendered node.
 */
export interface AppearanceElements {
  // ── Card shell ───────────────────────────────────────────────────────
  card?: React.CSSProperties;
  cardHeader?: React.CSSProperties;
  appLogo?: React.CSSProperties;
  cardTitle?: React.CSSProperties;
  cardSubtitle?: React.CSSProperties;
  cardBody?: React.CSSProperties;
  cardFooter?: React.CSSProperties;

  // ── Form ────────────────────────────────────────────────────────────
  formField?: React.CSSProperties;
  formFieldLabel?: React.CSSProperties;
  formFieldInput?: React.CSSProperties;
  formFieldError?: React.CSSProperties;
  formSubmitButton?: React.CSSProperties;
  /** Container for the 429 rate-limit feedback banner. */
  rateLimitBanner?: React.CSSProperties;

  // ── Social ──────────────────────────────────────────────────────────
  socialButtonsRoot?: React.CSSProperties;
  socialButton?: React.CSSProperties;

  // ── Divider ─────────────────────────────────────────────────────────
  dividerRow?: React.CSSProperties;
  dividerLine?: React.CSSProperties;
  dividerText?: React.CSSProperties;

  // ── Tabs ────────────────────────────────────────────────────────────
  tabsRoot?: React.CSSProperties;
  tab?: React.CSSProperties;
  tabActive?: React.CSSProperties;

  // ── UserButton ───────────────────────────────────────────────────────
  userButtonTrigger?: React.CSSProperties;
  userButtonAvatar?: React.CSSProperties;
  userButtonMenu?: React.CSSProperties;
  userButtonMenuItem?: React.CSSProperties;

  // ── Connected accounts (in UserButton / profile) ──────────────────────────
  connectedAccountsSection?: React.CSSProperties;
  connectedAccountsItem?: React.CSSProperties;
  connectedAccountsItemLabel?: React.CSSProperties;
  connectedAccountsConnectButton?: React.CSSProperties;

  // ── OrgSwitcher ──────────────────────────────────────────────────────
  orgSwitcherTrigger?: React.CSSProperties;
  orgSwitcherMenu?: React.CSSProperties;
  orgSwitcherOrgItem?: React.CSSProperties;
}

/**
 * Top-level appearance configuration — combines design tokens with
 * per-element overrides for fully themeable components.
 *
 * @example
 * ```tsx
 * <SignIn
 *   appearance={{
 *     variables: { colorPrimary: "#7c3aed", borderRadius: "12px" },
 *     elements: { card: { boxShadow: "none" } },
 *   }}
 * />
 * ```
 */
export interface Appearance {
  variables?: AppearanceVariables;
  elements?: AppearanceElements;
}

// ── Plugin feature flags ──────────────────────────────────────────────────────

export interface OAuthProvider {
  id:
    | "google"
    | "discord"
    | "github"
    | "microsoft"
    | "apple"
    | "facebook"
    | "twitter"
    | string;
  label?: string;
  /** Resolved icon URL or React element, populated automatically for known providers. */
  icon?: string;
}

/** Per-plugin enable/configure flags for `createKovaAuthClient`. */
export interface PluginConfig {
  /**
   * Admin client plugin — required for `user.role`, `banned`,
   * and `/api/auth/admin/*` management endpoints.
   */
  admin?: boolean;
  /**
   * API Key plugin — `personal` and `organization` key types.
   */
  apiKey?: boolean;
  /**
   * Two-factor authentication — TOTP authenticator app + email OTP.
   */
  twoFactor?:
    | boolean
    | {
        /** Called when the server triggers a 2FA challenge during sign-in. */
        onTwoFactorRedirect?: () => void;
      };
  /**
   * Organization plugin — multi-tenancy with teams and dynamic RBAC.
   * Both `teams` and `dynamicAccessControl` are enabled by default
   * to match the server configuration.
   */
  organization?:
    | boolean
    | {
        teams?: boolean;
        dynamicAccessControl?: boolean;
      };
  /**
   * Multi-session plugin — simultaneous sign-in with multiple accounts.
   */
  multiSession?: boolean;
  /**
   * Passkey/WebAuthn plugin — biometric + hardware key authentication.
   * Note: rpID is pinned to the auth server domain on the server side.
   */
  passkey?: boolean;
  /**
   * Magic link plugin — passwordless sign-in via email URL (10-min expiry).
   */
  magicLink?: boolean;
  /**
   * Username plugin — adds `username` field (3–32 chars, lowercase).
   */
  username?: boolean;
  /**
   * Generic OAuth / OIDC plugin — enables custom identity providers
   * (Keycloak, Auth0, Okta, any OIDC-compatible IdP).
   * Requires the `genericOAuth()` plugin to be configured on the server.
   *
   * @deprecated No effect since Better Auth 1.7. Generic providers register
   * as social providers, so `signIn.social({ provider })` reaches them
   * without a client plugin.
   */
  genericOAuth?: boolean;
  /**
   * NOTE: `bearer` is a SERVER-SIDE-ONLY plugin.
   * There is no `bearerClient()` — it does not belong in this config.
   * Bearer authentication is for API consumers using
   * `Authorization: Bearer <token>` and requires no client-side plugin.
   */
  // bearer is intentionally omitted — server only
}

// ── Provider config ───────────────────────────────────────────────────────────

export interface KovaAuthConfig {
  /**
   * Publishable key from your kova-auth dashboard.
   * Format: `pk_dev_<random>` or `pk_live_<random>`. It identifies the
   * application only; it does not encode the auth server URL.
   */
  publishableKey?: string;

  /**
   * Auth server base URL. Defaults to the hosted Kova service
   * (`https://auth.115jon.site`); set it for a self-hosted or local Kova.
   * @example "https://auth.115jon.site"
   */
  authUrl?: string;

  /** Plugin subset to activate (all enabled by default). */
  plugins?: PluginConfig;

  /**
   * OAuth providers to render in social buttons.
   * Defaults to `["google", "discord"]` if not set.
   */
  oauthProviders?: OAuthProvider[];

  // ── Navigation callbacks ──────────────────────────────────────────────
  /** Absolute or relative URL to navigate to after sign-in. */
  afterSignInUrl?: string;
  /** Absolute or relative URL to navigate to after sign-up. */
  afterSignUpUrl?: string;
  /** Absolute or relative URL to navigate to after sign-out. */
  afterSignOutUrl?: string;

  // ── Session behaviour ──────────────────────────────────────────────────
  /** Controls how often the SDK re-validates the session with the server. */
  sessionOptions?: {
    /** Seconds between automatic session re-checks. @default undefined (Better Auth default) */
    refetchInterval?: number;
    /** Re-check session when the browser tab regains focus. @default true */
    refetchOnWindowFocus?: boolean;
    /** Re-check session when the device is offline. @default true */
    refetchWhenOffline?: boolean;
  };

  /**
   * Optional raw session token supplied by a host shell.
   * Native containers can persist the app-scoped bearer token outside browser
   * storage and seed the SDK with it at startup.
   */
  initialSessionToken?: string | null;

  /**
   * Called whenever the SDK stores or clears the current app-scoped bearer
   * token. Host apps can mirror the token into their own API fetch layer.
   */
  onSessionTokenChange?: (token: string | null) => void;

  // ── UI ────────────────────────────────────────────────────────────────
  /** Global appearance overrides applied to all SDK components. */
  appearance?: Appearance;

  /**
   * Application branding to use instead of fetching it by `publishableKey`.
   * For hosts that already loaded `/api/pub/apps/:pk/appearance`, such as
   * Kova's own sign-in page, which must not send the key with auth requests.
   */
  appAppearance?: ServerAppearance;

  /**
   * When true, the SDK updates the host document's favicon from application
   * appearance. Defaults to false so embedded sign-in components do not
   * override the containing site's favicon.
   */
  manageFavicon?: boolean;
}

// ── Session / user types ──────────────────────────────────────────────────────

// ── Linked / connected account record ────────────────────────────────────────

/**
 * A provider account linked to the current user.
 * Returned by `useLinkedAccounts()` and `client.listAccounts()`.
 */
export interface LinkedAccount {
  /** Better Auth account row ID. */
  id: string;
  /** Provider identifier ("google", "github", "credential", etc.). */
  providerId: string;
  /** The opaque account ID from the provider side. */
  accountId: string;
  /** ISO date string when the link was created. */
  createdAt: string;
  /** "credential" | "oauth2" | "oidc" — from the account row */
  accessToken?: string | null;
  scopes?: string[];
}

export interface KovaUser {
  id: string;
  name: string;
  fullName: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  imageUrl?: string;
  role: string | null;
  banned: boolean;
  createdAt: Date;
  updatedAt: Date;
  username: string | null;
  twoFactorEnabled: boolean;
  primaryEmailAddress: { emailAddress: string } | null;
  unsafeMetadata: Record<string, unknown>;
  reload?: () => Promise<void> | void;
}

export interface KovaSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  activeOrganizationId: string | null;
}

export interface KovaOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface KovaMembership {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
}

// ── Hook return shapes ────────────────────────────────────────────────────────

export interface UseSessionReturn {
  session: { user: KovaUser; session: KovaSession } | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  refetch: () => void;
}

export interface UseUserReturn {
  user: KovaUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  /** Update mutable user fields (name, username, image). */
  updateUser: (data: { name?: string; image?: string }) => Promise<void>;
}

// ── useLinkedAccounts return ──────────────────────────────────────────────────

export interface UseLinkedAccountsReturn {
  /** All provider accounts linked to the current user. */
  accounts: LinkedAccount[];
  /** `false` until the first fetch resolves. */
  isLoaded: boolean;
  /** True while a link or unlink operation is in-flight. */
  isUpdating: boolean;
  /** Error message from the last failed operation, or `null`. */
  error: string | null;
  /**
   * Initiate an OAuth redirect to link a new provider account.
   * Redirects the browser — resolves immediately after redirect is triggered.
   */
  linkAccount: (opts: {
    provider: string;
    callbackURL?: string;
  }) => Promise<void>;
  /**
   * Refresh the list from the server.
   */
  refetch: () => void;
}

export interface UseOrganizationReturn {
  organization: KovaOrganization | null;
  membership: KovaMembership | null;
  isLoaded: boolean;
}

// ── Component props ───────────────────────────────────────────────────────────

export type SignInTab = "email" | "magic-link" | "passkey";
export type SignUpTab = "email";

export interface SignInProps {
  /** Override the URL the user is sent to on success. Inherits from provider. */
  afterSignInUrl?: string;
  /** Override the sign-up link href; `null` hides the link. @default "/sign-up" */
  signUpUrl?: string | null;
  /** "Forgot password?" target. Default: Kova's reset page for this app, which returns to `afterSignInUrl` after sign-in. `null` hides the link. */
  forgotPasswordUrl?: string | null;
  /** Initial tab shown. @default "email" */
  defaultTab?: SignInTab;
  /** Custom appearance for this instance. Merged with provider appearance. */
  appearance?: Appearance;
  /** Additional CSS class on the root element. */
  className?: string;
}

export interface SignUpProps {
  /** Override redirect after registration. Inherits from provider. */
  afterSignUpUrl?: string;
  /** Override the sign-in link href. @default "/sign-in" */
  signInUrl?: string;
  appearance?: Appearance;
  className?: string;
}

export interface UserButtonProps {
  /** URL to redirect to after sign-out. Inherits from provider. */
  afterSignOutUrl?: string;
  /** Show the user's name next to the avatar. @default false */
  showName?: boolean;
  /** Avatar diameter in px. @default 32 */
  size?: number;
  appearance?: Appearance;
  className?: string;
}

export interface OrgSwitcherProps {
  /** Hide the component until organizations are loaded. @default false */
  hideWhenLoading?: boolean;
  /** Hide the component when user has no org memberships. @default false */
  hideWhenNoOrgs?: boolean;
  appearance?: Appearance;
  className?: string;
}

export interface ProtectProps {
  /**
   * Required auth state.
   * - `"signed-in"` (default) — user must be signed in
   * - `"signed-out"` — user must NOT be signed in (useful for auth pages)
   */
  condition?: "signed-in" | "signed-out";
  /** Required platform role (e.g. "admin"). Implies signed-in. */
  role?: string;
  /**
   * Rendered when the condition is not met.
   * Defaults to `null` (nothing is rendered).
   */
  fallback?: React.ReactNode;
  /** Shown during loading. Defaults to `null`. */
  loading?: React.ReactNode;
  children: React.ReactNode;
}

// Required to use JSX without importing React in every file (React 17+ transform)
import type React from "react";

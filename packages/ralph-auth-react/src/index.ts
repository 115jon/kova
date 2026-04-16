/**
 * @ralph-auth/react
 *
 * Drop-in React SDK for ralph-auth — the self-hosted Clerk alternative.
 *
 * Quick start:
 * ```tsx
 * import { RalphAuthProvider, SignIn, useUser } from "@ralph-auth/react";
 *
 * // Wrap your app:
 * <RalphAuthProvider publishableKey="pk_live_..." afterSignInUrl="/dashboard">
 *   <App />
 * </RalphAuthProvider>
 *
 * // Drop-in sign-in card:
 * <SignIn afterSignInUrl="/dashboard" />
 *
 * // Access the current user anywhere:
 * const { user, isSignedIn } = useUser();
 * ```
 */

// ── Provider ─────────────────────────────────────────────────────────────────
export { RalphAuthProvider } from "./context";
export type { RalphAuthProviderProps } from "./context";

// ── Components ────────────────────────────────────────────────────────────────
export { OrgSwitcher } from "./components/OrgSwitcher";
export { Protect } from "./components/Protect";
export { SignIn } from "./components/SignIn";
export { SignUp } from "./components/SignUp";
export { UserButton } from "./components/UserButton";

// ── Hooks ─────────────────────────────────────────────────────────────────────
export { useAuth } from "./hooks/use-auth";
export type { UseAuthReturn } from "./hooks/use-auth";

export { useOrganization } from "./hooks/use-organization";
export { useSession } from "./hooks/use-session";
export { useSignIn } from "./hooks/use-sign-in";
export { useSignUp } from "./hooks/use-sign-up";
export { useUser } from "./hooks/use-user";

/**
 * Low-level context access — prefer the purpose-built hooks above.
 */
export { useRalphAuth } from "./context";

// ── Client factory ────────────────────────────────────────────────────────────
export { createRalphAuthClient } from "./client";
export type { ClientOptions, RalphAuthClient } from "./client";

// ── Key utilities ─────────────────────────────────────────────────────────────
export { decodePublishableKey, encodePublishableKey } from "./key";
export type { DecodedKey } from "./key";

// ── Webhook verification ───────────────────────────────────────────────────────
export { verifyWebhookSignature } from "./webhook";
export type { VerifyOptions, WebhookEvent } from "./webhook";

// ── Types (all public interfaces) ─────────────────────────────────────────────
export type {
  // Appearance
  Appearance, AppearanceElements, AppearanceVariables, OAuthProvider, OrgSwitcherProps, PluginConfig, ProtectProps,
  // Config
  RalphAuthConfig, RalphMembership, RalphOrganization, RalphSession,
  // Domain models
  RalphUser,
  // Component props
  SignInProps, SignInTab, SignUpProps, UseOrganizationReturn, UserButtonProps,
  // Hook returns
  UseSessionReturn,
  UseUserReturn
} from "./types";


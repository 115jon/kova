/**
 * RalphAuthProvider + useRalphAuth context
 *
 * Wraps the root of your app. Supplies the resolved auth client and
 * merged config (appearance, URLs) to every SDK component and hook
 * via React context — no prop-drilling required.
 *
 * @example
 * ```tsx
 * // main.tsx
 * import { RalphAuthProvider } from "@ralph-auth/react";
 *
 * createRoot(document.getElementById("root")!).render(
 *   <RalphAuthProvider publishableKey="pk_live_...">
 *     <App />
 *   </RalphAuthProvider>
 * );
 * ```
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  createRalphAuthClient,
  type RalphAuthClient,
} from "./client";
import { resolveAuthUrl } from "./key";
import { injectAppearanceVars } from "./styles/inject";
import type {
  Appearance,
  AppearanceVariables,
  OAuthProvider,
  RalphAuthConfig,
} from "./types";

// ── Default appearance variables ─────────────────────────────────────────────

const DEFAULT_VARS: Required<AppearanceVariables> = {
  colorPrimary: "#3b82f6",
  colorPrimaryHover: "#2563eb",
  colorBackground: "#0a0a0a",
  colorSurface: "#111111",
  colorSurfaceRaised: "#1a1a1a",
  colorText: "#f5f5f5",
  colorTextSecondary: "#a0a0a0",
  colorTextTertiary: "#606060",
  colorBorder: "#2a2a2a",
  colorBorderStrong: "#3a3a3a",
  colorError: "#f87171",
  colorSuccess: "#4ade80",
  borderRadius: "8px",
  borderRadiusSm: "5px",
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: "14px",
};

/**
 * OAuth providers whose social-login buttons are shown by default.
 *
 * These reflect the social providers that ralph-auth supports server-side.
 * All providers except Google are **conditional** — they only activate when
 * the corresponding env vars are set on the server. If a provider is not
 * configured on your server, its button will trigger a 400/not-found error.
 *
 * To limit the displayed buttons to only what your server supports, pass
 * `oauthProviders` explicitly to `<RalphAuthProvider>`:
 *
 * ```tsx
 * // Only Google (minimal setup):
 * <RalphAuthProvider oauthProviders={[{ id: "google" }]} ... />
 *
 * // Google + Discord + GitHub:
 * <RalphAuthProvider oauthProviders={[
 *   { id: "google" }, { id: "discord" }, { id: "github" }
 * ]} ... />
 * ```
 *
 * Provider → required env vars:
 *  google    — always (GOOGLE_CLIENT_ID/SECRET)
 *  discord   — DISCORD_CLIENT_ID/SECRET
 *  github    — GITHUB_CLIENT_ID/SECRET
 *  microsoft — MICROSOFT_CLIENT_ID/SECRET
 *  apple     — APPLE_CLIENT_ID/SECRET + APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY
 *  facebook  — FACEBOOK_CLIENT_ID/SECRET
 */
const DEFAULT_OAUTH_PROVIDERS: OAuthProvider[] = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
];


// ── Context value ────────────────────────────────────────────────────────────

export interface RalphAuthContextValue {
  /** The underlying Better Auth client instance. */
  client: RalphAuthClient;
  /** Resolved base URL of the auth server. */
  authUrl: string;
  /** Merged effective appearance (provider + optional instance override). */
  appearance: Appearance;
  /** Merged appearance variable map (defaults + provider). */
  vars: Required<AppearanceVariables>;
  /** OAuth provider list (from config or defaults). */
  oauthProviders: OAuthProvider[];
  // ── Navigation URLs ────────────────────────────────────────────────────
  afterSignInUrl: string;
  afterSignUpUrl: string;
  afterSignOutUrl: string;
}

const RalphAuthContext = createContext<RalphAuthContextValue | null>(null);
RalphAuthContext.displayName = "RalphAuthContext";

// ── Provider ─────────────────────────────────────────────────────────────────

export interface RalphAuthProviderProps extends RalphAuthConfig {
  children: ReactNode;
}

/**
 * Mount at the root of your application — above your router and any SDK
 * components. All `<SignIn>`, `<SignUp>`, `<UserButton>`, hooks, etc. must
 * be descendants of this provider.
 */
export function RalphAuthProvider({
  children,
  publishableKey,
  authUrl,
  plugins,
  appearance,
  oauthProviders,
  afterSignInUrl = "/",
  afterSignUpUrl = "/",
  afterSignOutUrl = "/sign-in",
  ...rest
}: RalphAuthProviderProps) {
  void rest; // absorb any extra props silently

  // Resolve auth URL once (throws early with a helpful message on misconfiguration)
  const resolvedAuthUrl = useMemo(
    () => resolveAuthUrl({ publishableKey, authUrl }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishableKey, authUrl]
  );

  // Create the Better Auth client once per resolved URL
  const client = useMemo(
    () => createRalphAuthClient({ authUrl: resolvedAuthUrl, plugins }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedAuthUrl]
  );

  // Merge appearance variables (defaults → provider)
  const vars = useMemo<Required<AppearanceVariables>>(
    () => ({ ...DEFAULT_VARS, ...(appearance?.variables ?? {}) }),
    [appearance?.variables]
  );

  // Track previous CSS injection styleId so we can remove stale rules on update
  const styleIdRef = useRef<string | null>(null);

  useEffect(() => {
    styleIdRef.current = injectAppearanceVars(vars, styleIdRef.current);
  }, [vars]);

  const resolvedProviders = oauthProviders ?? DEFAULT_OAUTH_PROVIDERS;

  const value = useMemo<RalphAuthContextValue>(
    () => ({
      client,
      authUrl: resolvedAuthUrl,
      appearance: appearance ?? {},
      vars,
      oauthProviders: resolvedProviders,
      afterSignInUrl,
      afterSignUpUrl,
      afterSignOutUrl,
    }),
    [
      client,
      resolvedAuthUrl,
      appearance,
      vars,
      resolvedProviders,
      afterSignInUrl,
      afterSignUpUrl,
      afterSignOutUrl,
    ]
  );

  return (
    <RalphAuthContext.Provider value={value}>
      {children}
    </RalphAuthContext.Provider>
  );
}

// ── useRalphAuth ─────────────────────────────────────────────────────────────

/**
 * Low-level hook — returns the full context value.
 * Prefer the purpose-built hooks (`useSession`, `useUser`, etc.) in most cases.
 *
 * @throws {Error} When used outside `<RalphAuthProvider>`.
 */
export function useRalphAuth(): RalphAuthContextValue {
  const ctx = useContext(RalphAuthContext);
  if (!ctx) {
    throw new Error(
      "[RalphAuth] `useRalphAuth` was called outside of <RalphAuthProvider>. " +
      "Make sure your component is a descendant of <RalphAuthProvider>."
    );
  }
  return ctx;
}

// ── mergeAppearance ───────────────────────────────────────────────────────────

/**
 * Merges a component-level appearance override into the provider-level one.
 * Component-level overrides win.
 */
export function mergeAppearance(
  base: Appearance,
  override?: Appearance
): Appearance {
  if (!override) return base;
  return {
    variables: { ...base.variables, ...override.variables },
    elements: { ...base.elements, ...override.elements },
  };
}

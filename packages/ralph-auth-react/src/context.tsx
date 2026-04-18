/**
 * RalphAuthProvider + useRalphAuth context
 *
 * Appearance priority (highest wins):
 *   component-level prop > provider-level prop > server-fetched > SDK defaults
 *
 * On mount, fetches /api/pub/apps/:pk/appearance and merges:
 *  - primaryColor, backgroundColor → CSS vars
 *  - enabledProviders → filters the OAuth buttons shown (no code change needed)
 *  - faviconUrl → injected into <head>
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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

const ALL_OAUTH_PROVIDERS: OAuthProvider[] = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
];

// ── Server appearance payload shape ──────────────────────────────────────────

export interface ServerAppearance {
  displayName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  backgroundColor: string | null;
  theme: "dark" | "light" | "auto";
  homeUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Whether the app has paid to suppress the ralph-auth badge. */
  hideBranding: boolean;
  /** Provider IDs enabled in the dashboard, e.g. ["google","github"] */
  enabledProviders: string[];
}

// ── Context value ────────────────────────────────────────────────────────────

export interface RalphAuthContextValue {
  client: RalphAuthClient;
  authUrl: string;
  appearance: Appearance;
  vars: Required<AppearanceVariables>;
  oauthProviders: OAuthProvider[];
  /** Live server-fetched branding — null until the first fetch resolves. */
  serverAppearance: ServerAppearance | null;
  afterSignInUrl: string;
  afterSignUpUrl: string;
  afterSignOutUrl: string;
  /**
   * "live" for pk_live_ keys (production), "test" for pk_dev_ / pk_test_ keys.
   * Components use this to render the "Development" badge.
   */
  mode: "live" | "test";
  /**
   * True when the platform admin flag is set on the current user.
   * Unlocks all plan-gated features without a paid subscription.
   * Set by the consumer app (e.g. the ralph-auth dashboard itself).
   */
  isPlatformAdmin: boolean;
}

const RalphAuthContext = createContext<RalphAuthContextValue | null>(null);
RalphAuthContext.displayName = "RalphAuthContext";

// ── Provider ─────────────────────────────────────────────────────────────────

export interface RalphAuthProviderProps extends RalphAuthConfig {
  children: ReactNode;
}

export function RalphAuthProvider({
  children,
  publishableKey,
  authUrl,
  plugins,
  appearance,
  oauthProviders,
  isPlatformAdmin = false,
  afterSignInUrl = "/",
  afterSignUpUrl = "/",
  afterSignOutUrl = "/sign-in",
  ...rest
}: RalphAuthProviderProps & { isPlatformAdmin?: boolean }) {
  void rest;

  // Derive mode from the publishable key prefix:
  //   pk_live_ → "live"  (production)
  //   pk_dev_ / pk_test_ → "test"  (shows Development badge)
  //   fallback (authUrl-only) → "live"
  const mode = useMemo<"live" | "test">(() => {
    if (!publishableKey) return "live";
    return publishableKey.startsWith("pk_live_") ? "live" : "test";
  }, [publishableKey]);

  const resolvedAuthUrl = useMemo(
    () => resolveAuthUrl({ publishableKey, authUrl }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishableKey, authUrl]
  );

  const client = useMemo(
    () => createRalphAuthClient({ authUrl: resolvedAuthUrl, publishableKey, plugins }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedAuthUrl, publishableKey]
  );

  // ── Server appearance ─────────────────────────────────────────────────────
  const [serverAppearance, setServerAppearance] = useState<ServerAppearance | null>(null);

  useEffect(() => {
    if (!publishableKey) return;
    // Public endpoint — KV-cached for 5 min, so cost ≈ 0 after first load.
    // NOTE: The path must include /api/ so Vite's dev proxy (sdk-demo) routes it
    // correctly to the auth server.  Production workers handle /api/* natively.
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/appearance`, {
      cache: "default",
    })
      .then(r => r.ok ? (r.json() as Promise<ServerAppearance>) : null)
      .then(data => { if (data) setServerAppearance(data); })
      .catch(() => { /* progressive enhancement — never blocks sign-in */ });

    // Register any pre-existing session into app_user (fire-and-forget).
    // The session.create.after hook handles brand-new sign-ins, but if the
    // user was already signed in before visiting this SDK-powered app, we
    // upsert membership here so they appear in the app's user list.
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/me`, {
      method: "POST",
      credentials: "include",
    }).catch(() => { /* best-effort */ });
  }, [resolvedAuthUrl, publishableKey]);

  // Inject/update favicon from server
  useEffect(() => {
    const url = serverAppearance?.faviconUrl;
    if (!url) return;
    let el = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!el) {
      el = document.createElement("link");
      el.rel = "icon";
      document.head.appendChild(el);
    }
    el.href = url;
  }, [serverAppearance?.faviconUrl]);

  // ── Merge: defaults → server colors → developer prop ─────────────────────
  const vars = useMemo<Required<AppearanceVariables>>(() => {
    const serverOverrides: Partial<AppearanceVariables> = serverAppearance
      ? {
        ...(serverAppearance.primaryColor ? { colorPrimary: serverAppearance.primaryColor } : {}),
        ...(serverAppearance.backgroundColor ? { colorBackground: serverAppearance.backgroundColor } : {}),
      }
      : {};
    return { ...DEFAULT_VARS, ...serverOverrides, ...(appearance?.variables ?? {}) };
  }, [serverAppearance, appearance?.variables]);

  const styleIdRef = useRef<string | null>(null);
  useEffect(() => {
    styleIdRef.current = injectAppearanceVars(vars, styleIdRef.current);
  }, [vars]);

  // ── OAuth providers: server list → developer override ────────────────────
  const resolvedProviders = useMemo<OAuthProvider[]>(() => {
    if (oauthProviders) return oauthProviders;
    if (serverAppearance?.enabledProviders?.length) {
      return ALL_OAUTH_PROVIDERS.filter(p =>
        (serverAppearance.enabledProviders).includes(p.id)
      );
    }
    return ALL_OAUTH_PROVIDERS;
  }, [oauthProviders, serverAppearance]);

  const value = useMemo<RalphAuthContextValue>(
    () => ({
      client, authUrl: resolvedAuthUrl,
      appearance: appearance ?? {}, vars,
      oauthProviders: resolvedProviders,
      serverAppearance,
      afterSignInUrl, afterSignUpUrl, afterSignOutUrl,
      mode,
      isPlatformAdmin,
    }),
    [client, resolvedAuthUrl, appearance, vars, resolvedProviders,
      serverAppearance, afterSignInUrl, afterSignUpUrl, afterSignOutUrl,
      mode, isPlatformAdmin]
  );

  return (
    <RalphAuthContext.Provider value={value}>
      {children}
    </RalphAuthContext.Provider>
  );
}

// ── useRalphAuth ─────────────────────────────────────────────────────────────

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

export function mergeAppearance(base: Appearance, override?: Appearance): Appearance {
  if (!override) return base;
  return {
    variables: { ...base.variables, ...override.variables },
    elements: { ...base.elements, ...override.elements },
  };
}

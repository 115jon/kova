import { KovaAuthProvider, SignIn, useSession } from "@115jon/kova-react";
import {
  appSignInLook,
  appSignInProviders,
  kovaSignInLook,
  type AppAppearance,
} from "@/lib/app-sign-in";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import { useTheme } from "@/lib/theme";
import {
  buildNativeHandoffPath,
  buildSignInReturnPath,
  isAddAccount,
  safeSignInReturnPath,
  searchParamString,
  type SignInRouteSearch,
} from "@/lib/sign-in-redirect";
import { createFileRoute, useHydrated, useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInRouteSearch => ({
    pk: searchParamString(search.pk),
    redirect_url: searchParamString(search.redirect_url),
    native_handoff: searchParamString(search.native_handoff),
    add_account: isAddAccount(search.add_account) ? "1" : undefined,
    state: searchParamString(search.state),
  }),
  component: SignInPage,
});

function SignInPage() {
  const search = Route.useSearch();
  return search.pk ? <AppSignInPage pk={search.pk} search={search} /> : <KovaSignInPage search={search} />;
}

/**
 * Runs `onComplete` once the SDK's own session store sees a user. The SDK
 * client, not the dashboard client, is the one its sign-in forms update.
 * With `skipInitialUser` (add_account), the account already signed in when
 * the page loaded does not count; a newly signed-in one does.
 */
function CompleteOnSession({ enabled, skipInitialUser = false, onComplete }: {
  enabled: boolean;
  skipInitialUser?: boolean;
  onComplete: () => void;
}) {
  const { session, isLoaded } = useSession();
  const userId = session?.user?.id ?? null;
  const initialUserId = useRef<string | null | undefined>(undefined);
  if (isLoaded && initialUserId.current === undefined) initialUserId.current = userId;
  useEffect(() => {
    if (!enabled || !userId) return;
    if (skipInitialUser && userId === initialUserId.current) return;
    onComplete();
  }, [enabled, onComplete, skipInitialUser, userId]);
  return null;
}

function currentOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

// ── Kova's own sign-in (/sign-in without pk) ─────────────────────────────────

// SDK social-buttons adds the "Continue with " prefix.
const KOVA_PROVIDERS = CONFIGURED_PROVIDERS.map((p) => ({ id: p.id, label: p.name }));

// Gives the card its title ("Sign in to Kova") and mark, like an app's page.
const KOVA_APP_APPEARANCE: AppAppearance = {
  displayName: "Kova",
  logoUrl: "/favicon.svg",
  faviconUrl: null,
  primaryColor: null,
  backgroundColor: null,
  theme: "auto",
  homeUrl: null,
  termsUrl: null,
  privacyUrl: null,
  hideBranding: true,
  enabledProviders: KOVA_PROVIDERS.map((p) => p.id),
};

function KovaSignInPage({ search }: { search: SignInRouteSearch }) {
  const navigate = useNavigate();
  // The SDK needs this page's origin, which the server render doesn't have.
  const hydrated = useHydrated();
  const signInReturnPath = buildSignInReturnPath(search);
  const { resolved } = useTheme();
  const look = useMemo(() => kovaSignInLook(resolved), [resolved]);

  const completeSignIn = useCallback(() => {
    const returnPath = safeSignInReturnPath(search.redirect_url);
    if (returnPath) {
      window.location.assign(returnPath);
      return;
    }
    navigate({ to: "/" });
  }, [navigate, search.redirect_url]);

  // Page colours come from the dashboard tokens (set before hydration by the
  // theme script), so the shell never flashes the wrong scheme.
  return (
    <div className="app-auth-shell is-kova">
      <main className="app-auth-stage">
        {hydrated ? (
          <KovaAuthProvider
            authUrl={currentOrigin()}
            appAppearance={KOVA_APP_APPEARANCE}
            oauthProviders={KOVA_PROVIDERS}
            afterSignInUrl={signInReturnPath}
            appearance={{ variables: look.variables }}
          >
            <CompleteOnSession enabled={!isAddAccount(search.add_account)} onComplete={completeSignIn} />
            <SignIn afterSignInUrl={signInReturnPath} />
          </KovaAuthProvider>
        ) : (
          <div className="app-auth-placeholder" role="status" aria-label="Loading sign-in" />
        )}
      </main>
    </div>
  );
}

// ── App sign-in (/sign-in?pk=…&redirect_url=…) ───────────────────────────────

type AppSignInContext =
  | { status: "loading" }
  | { status: "error"; message: string; appearance?: AppAppearance }
  | { status: "ready"; appearance: AppAppearance };

async function loadAppSignInContext(
  pk: string,
  redirectUrl: string | undefined,
): Promise<AppSignInContext> {
  const base = `/api/pub/apps/${encodeURIComponent(pk)}`;
  const appearanceRes = await fetch(`${base}/appearance`, { cache: "no-store" });
  if (appearanceRes.status === 404) {
    return { status: "error", message: "This sign-in link points to an app Kova doesn't recognize." };
  }
  if (appearanceRes.status === 403) {
    return { status: "error", message: "This app is suspended." };
  }
  if (!appearanceRes.ok) throw new Error(`appearance ${appearanceRes.status}`);
  const appearance = (await appearanceRes.json()) as AppAppearance;
  if (!redirectUrl) return { status: "ready", appearance };

  const checkRes = await fetch(
    `${base}/redirect-check?redirect_uri=${encodeURIComponent(redirectUrl)}`,
    { cache: "no-store" },
  );
  const check = checkRes.ok ? ((await checkRes.json()) as { allowed: boolean }) : { allowed: false };
  if (!check.allowed) {
    return {
      status: "error",
      appearance,
      message: `${appearance.displayName} can't send you back to ${redirectUrl} because that address isn't registered. Add it under Redirect URIs in the app's Kova settings.`,
    };
  }
  return { status: "ready", appearance };
}

function useAppSignInContext(pk: string, redirectUrl: string | undefined) {
  const [ctx, setCtx] = useState<AppSignInContext>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setCtx({ status: "loading" });
    loadAppSignInContext(pk, redirectUrl)
      .catch((): AppSignInContext => ({
        status: "error",
        message: "Couldn't load this sign-in page. Check your connection and try again.",
      }))
      .then((next) => { if (!cancelled) setCtx(next); });
    return () => { cancelled = true; };
  }, [pk, redirectUrl]);
  return ctx;
}

function usePrefersDark() {
  const [prefersDark, setPrefersDark] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

function AppMark({ appearance }: { appearance: AppAppearance }) {
  if (appearance.logoUrl) {
    return <img className="app-auth-mark" src={appearance.logoUrl} alt="" />;
  }
  return (
    <span className="app-auth-mark app-auth-mark--letter" aria-hidden="true">
      {appearance.displayName.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function AppFooter({ appearance, isDevelopment }: { appearance?: AppAppearance; isDevelopment: boolean }) {
  const links = [
    appearance?.termsUrl ? { href: appearance.termsUrl, label: "Terms" } : null,
    appearance?.privacyUrl ? { href: appearance.privacyUrl, label: "Privacy" } : null,
  ].filter((link): link is { href: string; label: string } => link !== null);
  if (links.length === 0 && !isDevelopment) return null;
  return (
    <footer className="app-auth-footer">
      {links.map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
      ))}
      {isDevelopment && <span className="app-auth-dev">Development</span>}
    </footer>
  );
}

function AppSignInPage({ pk, search }: { pk: string; search: SignInRouteSearch }) {
  const ctx = useAppSignInContext(pk, search.redirect_url);
  const prefersDark = usePrefersDark();
  const appearance = ctx.status === "loading" ? undefined : ctx.appearance;
  const look = useMemo(
    () => appSignInLook(appearance ?? { primaryColor: null, backgroundColor: null, theme: "dark" }, prefersDark),
    [appearance, prefersDark],
  );
  const providers = useMemo(
    () => appSignInProviders(CONFIGURED_PROVIDERS, appearance?.enabledProviders ?? []),
    [appearance],
  );
  const nativeHandoffPath = buildNativeHandoffPath(search);
  // Without a redirect_url this is a dashboard preview: signing in lands in Kova.
  // add_account only skips the session present on arrival, so the page a
  // sign-in method returns to drops it and continues with the new account.
  const afterSignInUrl = nativeHandoffPath ? buildSignInReturnPath({ ...search, add_account: undefined }) : "/";
  const isDevelopment = pk.startsWith("pk_dev_");
  const addAccount = isAddAccount(search.add_account);

  // An existing session continues only to a redirect the app registered.
  // handleSdkBounce re-checks it; this is not the security boundary.
  const canComplete = ctx.status === "ready" && !!nativeHandoffPath;
  const completeSignIn = useCallback(() => {
    if (nativeHandoffPath) window.location.assign(nativeHandoffPath);
  }, [nativeHandoffPath]);

  useEffect(() => {
    if (appearance) document.title = `Sign in to ${appearance.displayName}`;
  }, [appearance]);

  const shellStyle = {
    "--app-bg": look.background,
    "--app-accent": look.primary,
  } as CSSProperties;

  return (
    <div className="app-auth-shell" data-scheme={look.scheme} data-backdrop={look.backdrop} style={shellStyle}>
      <main className="app-auth-stage">
        {ctx.status === "loading" ? (
          <div className="app-auth-placeholder" role="status" aria-label="Loading sign-in" />
        ) : (
          <KovaAuthProvider
            authUrl={currentOrigin()}
            appAppearance={appearance}
            oauthProviders={providers}
            afterSignInUrl={afterSignInUrl}
            appearance={{ variables: look.variables }}
            manageFavicon
          >
            {ctx.status === "error" ? (
              <div className="app-auth-card" data-ra-root>
                {appearance && (
                  <div className="app-auth-card-head">
                    <AppMark appearance={appearance} />
                    <h1>{appearance.displayName}</h1>
                  </div>
                )}
                <p className="app-auth-alert" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{ctx.message}</span>
                </p>
              </div>
            ) : (
              <>
                <CompleteOnSession enabled={canComplete} skipInitialUser={addAccount} onComplete={completeSignIn} />
                {!search.redirect_url && (
                  <p className="app-auth-notice">
                    Preview. This link has no redirect_url, so signing in opens the Kova dashboard instead of the app.
                  </p>
                )}
                <SignIn afterSignInUrl={afterSignInUrl} signUpUrl={null} />
              </>
            )}
          </KovaAuthProvider>
        )}
        <AppFooter appearance={appearance} isDevelopment={isDevelopment} />
      </main>
    </div>
  );
}

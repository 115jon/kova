import { authErrorMessage, KovaAuthProvider, SignIn, SignUp, useSession } from "@115jon/kova-react";
import { AccountChooser } from "@/components/AccountChooser";
import {
  appSignInLook,
  appSignInProviders,
  kovaSignInLook,
  type AppAppearance,
} from "@/lib/app-sign-in";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import { useTheme } from "@/lib/theme";
import {
  buildAuthPagePath,
  buildFreshSignInReturnPath,
  buildNativeHandoffPath,
  canContinueWithSession,
  existingSessionAction,
  isAddAccount,
  safeSignInReturnPath,
  type AuthPage as AuthPageMode,
  type SignInRouteSearch,
} from "@/lib/sign-in-redirect";
import { useHydrated, useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/**
 * The sign-in and sign-up pages share one frame: Kova's own (no `pk`) or an
 * app's hosted page (`pk` + `redirect_url`). Only the card differs.
 */
export function AuthPage({ mode, search }: { mode: AuthPageMode; search: SignInRouteSearch }) {
  return search.pk
    ? <AppAuthPage pk={search.pk} search={search} mode={mode} />
    : <KovaAuthPage search={search} mode={mode} />;
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

/** Shown instead of carrying on when a link or provider sign-in sent us back with an error. */
function FailedLinkNotice({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <p className="app-auth-alert" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{authErrorMessage(error)}</span>
    </p>
  );
}

function currentOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

// ── Kova's own sign-in and sign-up (no pk) ───────────────────────────────────

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

function KovaAuthPage({ search, mode }: { search: SignInRouteSearch; mode: AuthPageMode }) {
  const navigate = useNavigate();
  // The SDK needs this page's origin, which the server render doesn't have.
  const hydrated = useHydrated();
  const signInReturnPath = buildAuthPagePath("sign-in", search);
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
            <CompleteOnSession
              enabled={!isAddAccount(search.add_account) && canContinueWithSession(search)}
              skipInitialUser={mode === "sign-up"}
              onComplete={completeSignIn}
            />
            <FailedLinkNotice error={search.error} />
            {mode === "sign-up"
              ? <SignUp afterSignUpUrl={signInReturnPath} signInUrl={signInReturnPath} />
              : <SignIn afterSignInUrl={signInReturnPath} signUpUrl={buildAuthPagePath("sign-up", search)} forgotPasswordUrl={buildAuthPagePath("reset-password", search)} />}
          </KovaAuthProvider>
        ) : (
          <div className="app-auth-placeholder" role="status" aria-label="Loading sign-in" />
        )}
      </main>
    </div>
  );
}

// ── App sign-in and sign-up (?pk=…&redirect_url=…) ───────────────────────────

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

/**
 * The body of an app's sign-in page once its branding has loaded. Someone
 * already signed in gets the account chooser; a sign-in made here, or one that
 * returned with `fresh=1` moments after it happened, continues to the app.
 */
function AppSignInFlow({ mode, search, appearance }: {
  mode: AuthPageMode;
  search: SignInRouteSearch;
  appearance: AppAppearance;
}) {
  const { session, isLoaded } = useSession();
  const [usingAnother, setUsingAnother] = useState(false);
  const arrivedWithSessionId = useRef<string | null | undefined>(undefined);
  const leaving = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // KovaSession's type leaves out createdAt; get-session always returns it.
  const current = session?.session
    ? { id: session.session.id, token: session.session.token, createdAt: (session.session as { createdAt?: unknown }).createdAt }
    : null;
  if (isLoaded && arrivedWithSessionId.current === undefined) arrivedWithSessionId.current = current?.id ?? null;

  const handoffPath = buildNativeHandoffPath(search);
  const freshHandoffPath = buildNativeHandoffPath(search, { fresh: true });
  // Without a redirect_url this is a dashboard preview: signing in lands in Kova.
  const freshReturnPath = handoffPath ? buildFreshSignInReturnPath(search) : "/";
  const signInPath = buildAuthPagePath("sign-in", { ...search, add_account: undefined });

  const action = !isLoaded
    ? null
    : !handoffPath
      ? "form"
      : existingSessionAction({
        // Sign-up never continues as the account that was there on arrival.
        search: mode === "sign-up" ? { ...search, add_account: "1" } : search,
        session: current,
        arrivedWithSessionId: arrivedWithSessionId.current ?? null,
      });

  useEffect(() => {
    if (action !== "continue" || !freshHandoffPath || leaving.current) return;
    leaving.current = true;
    window.location.assign(freshHandoffPath);
  }, [action, freshHandoffPath]);

  const continueWithChosen = useCallback(() => {
    if (!handoffPath) return;
    // Switching accounts updates the session store; that must not also count as a new sign-in.
    leaving.current = true;
    window.location.assign(handoffPath);
  }, [handoffPath]);

  const showSignInForm = useCallback(() => {
    setUsingAnother(true);
    // The chooser's button is gone; start keyboard users at the form.
    requestAnimationFrame(() => {
      stageRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    });
  }, []);

  if (action === null || action === "continue") {
    return <div className="app-auth-placeholder" role="status" aria-label={action ? "Signing you in" : "Loading sign-in"} />;
  }

  if (action === "choose" && current && session && !usingAnother) {
    return (
      <AccountChooser
        appearance={appearance}
        active={{ sessionId: current.id, sessionToken: current.token, user: session.user }}
        onContinue={continueWithChosen}
        onUseAnother={showSignInForm}
      />
    );
  }

  return (
    <div className="app-auth-flow" ref={stageRef}>
      {mode === "sign-up"
        ? <SignUp afterSignUpUrl={freshReturnPath} signInUrl={signInPath} />
        : <SignIn
            afterSignInUrl={freshReturnPath}
            signUpUrl={buildAuthPagePath("sign-up", { ...search, add_account: undefined })}
            forgotPasswordUrl={buildAuthPagePath("reset-password", { ...search, add_account: undefined })}
          />}
      {action === "choose" && usingAnother && (
        <button type="button" className="app-auth-back" onClick={() => setUsingAnother(false)}>
          Back to signed-in accounts
        </button>
      )}
    </div>
  );
}

function AppAuthPage({ pk, search, mode }: { pk: string; search: SignInRouteSearch; mode: AuthPageMode }) {
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
  const afterSignInUrl = search.redirect_url ? buildFreshSignInReturnPath(search) : "/";
  const isDevelopment = pk.startsWith("pk_dev_");

  useEffect(() => {
    if (appearance) {
      document.title = mode === "sign-up" ? `Create an account for ${appearance.displayName}` : `Sign in to ${appearance.displayName}`;
    }
  }, [appearance, mode]);

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
                <FailedLinkNotice error={search.error} />
                {!search.redirect_url && (
                  <p className="app-auth-notice">
                    Preview. This link has no redirect_url, so signing in opens the Kova dashboard instead of the app.
                  </p>
                )}
                <AppSignInFlow mode={mode} search={search} appearance={ctx.appearance} />
              </>
            )}
          </KovaAuthProvider>
        )}
        <AppFooter appearance={appearance} isDevelopment={isDevelopment} />
      </main>
    </div>
  );
}

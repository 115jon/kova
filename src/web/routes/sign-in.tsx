import { KovaAuthProvider, SignIn } from "@115jon/kova-react";
import { authClient } from "@/lib/auth-client";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import {
  buildNativeHandoffPath,
  buildSignInReturnPath,
  isAddAccount,
  safeSignInReturnPath,
  searchParamString,
  type SignInRouteSearch,
} from "@/lib/sign-in-redirect";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInRouteSearch => ({
    pk: searchParamString(search.pk),
    redirect_url: searchParamString(search.redirect_url),
    native_handoff: searchParamString(search.native_handoff),
    add_account: isAddAccount(search.add_account) ? "1" : undefined,
  }),
  component: SignInPage,
});

// ── Main sign-in page using Kova React SDK ────────────────────────────────────

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-auth-shell">
      <div className="coast-paint" aria-hidden="true" />
      <div className="auth-window">
        <div className="auth-dots" aria-hidden="true">
          <span className="auth-dot auth-dot-red" />
          <span className="auth-dot auth-dot-amber" />
          <span className="auth-dot auth-dot-green" />
        </div>
        <div className="auth-window-spacer" />
        <div className="auth-glass">{children}</div>
      </div>
    </div>
  );
}

function SignInPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { data: session } = authClient.useSession();
  const nativeHandoffPath = buildNativeHandoffPath(search);
  const signInReturnPath = buildSignInReturnPath(search);

  const completeSignIn = useCallback(() => {
    if (nativeHandoffPath) {
      window.location.assign(nativeHandoffPath);
      return;
    }
    const returnPath = safeSignInReturnPath(search.redirect_url);
    if (returnPath) {
      window.location.assign(returnPath);
      return;
    }
    navigate({ to: "/" });
  }, [nativeHandoffPath, navigate, search.redirect_url]);

  useEffect(() => {
    if (session?.user && !isAddAccount(search.add_account)) {
      completeSignIn();
    }
  }, [completeSignIn, search.add_account, session?.user]);

  // Derive authUrl from the current origin
  const authUrl = typeof window !== "undefined" ? window.location.origin : "";

  // Map CONFIGURED_PROVIDERS to SDK format
  // Strip "Continue with " prefix since SDK social-buttons.tsx adds it
  const oauthProviders = CONFIGURED_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label.replace(/^Continue with /, ""),
  }));

  return (
    <AuthFrame>
      <KovaAuthProvider
        authUrl={authUrl}
        oauthProviders={oauthProviders}
        afterSignInUrl={signInReturnPath}
        appearance={{
          variables: {
            colorPrimary: "oklch(0.51 0.095 176)",
            colorPrimaryHover: "oklch(0.47 0.085 176)",
            colorBackground: "oklch(0.16 0.02 255)",
            colorSurface: "oklch(0.20 0.03 245 / 0.78)",
            colorSurfaceRaised: "oklch(0.24 0.03 245 / 0.55)",
            colorText: "oklch(0.97 0.01 210)",
            colorTextSecondary: "oklch(0.84 0.018 210)",
            colorTextTertiary: "oklch(0.78 0.02 215)",
            colorBorder: "oklch(0.955 0.01 95 / 0.18)",
            colorBorderStrong: "oklch(0.955 0.01 95 / 0.32)",
            colorError: "oklch(0.72 0.14 25)",
            colorSuccess: "oklch(0.78 0.12 155)",
            borderRadius: "18px",
            borderRadiusSm: "999px",
            fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
            fontFamilyMono: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: "14px",
          },
        }}
      >
        <SignIn afterSignInUrl={signInReturnPath} />
      </KovaAuthProvider>
    </AuthFrame>
  );
}

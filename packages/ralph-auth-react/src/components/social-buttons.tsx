/**
 * Shared OAuth social buttons used by both <SignIn /> and <SignUp />.
 *
 * Handles:
 *  - Absolute callbackURL resolution (avoids Better Auth resolving relative
 *    paths against its own baseURL, which would redirect users to the auth
 *    server instead of the client app).
 *  - Per-app redirect URI / origin enforcement errors (403 responses from
 *    the ralph-auth server) surfaced as inline Alert messages.
 *  - Loading state per-provider with disabled state during in-flight requests.
 */

import { useState } from "react";
import { useRalphAuth } from "../context";
import type { AppearanceElements } from "../types";
import { ProviderIcon, providerLabel } from "./icons";
import { Alert } from "./ui";

// ── Shared utility ─────────────────────────────────────────────────────────────

/**
 * Resolves a potentially-relative path to an absolute URL rooted at the
 * client app's origin (authUrl from context).
 *
 * Better Auth uses its own `baseURL` (the auth server) to resolve relative
 * callbackURL values, which would redirect the browser to the auth server
 * after OAuth instead of back to the consuming client app.
 *
 * If the input is already an absolute URL it is returned unchanged.
 */
export function resolveAbsoluteUrl(authUrl: string, path?: string): string {
  const input = path ?? "/";
  try {
    // Already absolute — trust it as-is.
    new URL(input);
    return input;
  } catch {
    const base = authUrl.replace(/\/$/, "");
    const segment = input.startsWith("/") ? input : `/${input}`;
    return `${base}${segment}`;
  }
}

// ── Better Auth client response shape ─────────────────────────────────────────

interface SocialSignInResult {
  data: { url?: string; redirect?: boolean } | null;
  /** error.error holds the code from our server's JSON body */
  error: { error?: string; message?: string; status?: number } | null;
}

/** Convert a server error code to a human-readable UI message. */
function oauthErrorMessage(code: string, fallback?: string): string {
  if (code === "redirect_uri_not_allowed") {
    return (
      "This application's redirect URI is not configured correctly. " +
      "A developer needs to add this URL to the app's allowed redirect URIs in the ralph-auth dashboard."
    );
  }
  if (code === "origin_not_allowed") {
    return (
      "This origin is not in the application's allowed origins list. " +
      "A developer needs to add it in the ralph-auth dashboard."
    );
  }
  return fallback ?? "OAuth sign-in failed. Please try again.";
}

// ── Component ──────────────────────────────────────────────────────────────────

interface SocialButtonsProps {
  /** Absolute or relative post-auth redirect URL. */
  callbackURL?: string;
  /** URL to redirect to on OAuth error (relative or absolute). */
  errorCallbackURL?: string;
  /** Per-element appearance overrides from the parent card. */
  elements?: AppearanceElements;
}

export function SocialButtons({
  callbackURL,
  errorCallbackURL,
  elements,
}: SocialButtonsProps) {
  const { oauthProviders, client, authUrl } = useRalphAuth();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  // Always rendered before early-return so hooks order is stable.
  if (!oauthProviders.length) return null;

  const absCallback = resolveAbsoluteUrl(authUrl, callbackURL);
  const absError = resolveAbsoluteUrl(authUrl, errorCallbackURL ?? "/sign-in?error=oauth");

  const handleSocial = async (providerId: string) => {
    setOauthError(null);
    setLoadingProvider(providerId);
    try {
      const result = await client.signIn.social({
        provider: providerId,
        callbackURL: absCallback,
        errorCallbackURL: absError,
      } as Parameters<typeof client.signIn.social>[0]);

      const r = result as SocialSignInResult | null;
      if (r?.error) {
        setOauthError(oauthErrorMessage(r.error.error ?? "", r.error.message));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OAuth sign-in failed. Please try again.";
      setOauthError(msg);
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div data-ra-element="socialButtonsRoot" style={elements?.socialButtonsRoot}>
      {oauthError && <Alert variant="error">{oauthError}</Alert>}
      {oauthProviders.map((p) => (
        <button
          key={p.id}
          type="button"
          data-ra-element="socialButton"
          style={elements?.socialButton}
          disabled={loadingProvider !== null}
          onClick={() => void handleSocial(p.id)}
        >
          <ProviderIcon provider={p.id} size={18} />
          {loadingProvider === p.id
            ? "Connecting…"
            : `Continue with ${p.label ?? providerLabel(p.id)}`}
        </button>
      ))}
    </div>
  );
}

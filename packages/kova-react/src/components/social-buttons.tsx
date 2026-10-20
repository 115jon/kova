/**
 * Shared OAuth social buttons used by both <SignIn /> and <SignUp />.
 *
 * Handles:
 *  - Absolute callbackURL resolution (avoids Better Auth resolving relative
 *    paths against its own baseURL, which would redirect users to the auth
 *    server instead of the client app).
 *  - Errors surfaced as inline Alert messages (via useSignIn).
 *  - Loading state per-provider with disabled state during in-flight requests.
 */

import { useState } from "react";
import { resolveAbsoluteUrl } from "../auth-result";
import { useKovaAuth } from "../context";
import { useSignIn } from "../hooks/use-sign-in";
import type { AppearanceElements } from "../types";
import { ProviderIcon, providerLabel } from "./icons";
import { Alert } from "./ui";

export { resolveAbsoluteUrl };

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
  const { oauthProviders } = useKovaAuth();
  const { signIn, error } = useSignIn();
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  if (!oauthProviders.length) return null;

  const handleSocial = async (providerId: string) => {
    setLoadingProvider(providerId);
    await signIn
      .social({ provider: providerId, callbackURL, errorCallbackURL })
      .catch(() => null);
    setLoadingProvider(null);
  };

  return (
    <div
      data-ra-element="socialButtonsRoot"
      style={elements?.socialButtonsRoot}
    >
      {error && <Alert variant="error">{error}</Alert>}
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

/**
 * useSignIn — imperative sign-in actions.
 *
 * Provides typed methods for every auth flow: email/password, magic link,
 * OAuth redirect, passkey, and TOTP verification. Tracks loading / error
 * state per-action so you can build a completely custom sign-in UI.
 *
 * @example
 * ```tsx
 * const { signIn, isLoading, error } = useSignIn();
 *
 * async function handleSubmit(e: FormEvent) {
 *   e.preventDefault();
 *   await signIn.email({ email, password });
 * }
 * ```
 */

import { useCallback, useState } from "react";
import { useRalphAuth } from "../context";

interface SignInEmailOpts {
  email: string;
  password: string;
  rememberMe?: boolean;
  /** Override the URL to redirect. Inherits from provider if omitted. */
  callbackURL?: string;
}

interface SignInMagicLinkOpts {
  email: string;
  callbackURL?: string;
}

interface SignInSocialOpts {
  provider: string;
  callbackURL?: string;
  errorCallbackURL?: string;
}

interface SignInPasskeyOpts {
  callbackURL?: string;
}

interface SignInTOTPOpts {
  code: string;
}

interface SignInEmailOtpVerifyOpts {
  email: string;
  otp: string;
}

interface UseSignInReturn {
  signIn: {
    /**
     * Sign in with email + password.
     * Returns `{ twoFactorRequired: true }` if 2FA is pending.
     */
    email: (opts: SignInEmailOpts) => Promise<{ twoFactorRequired?: boolean }>;
    /** Send a magic link email — user clicks it to sign in. */
    magicLink: (opts: SignInMagicLinkOpts) => Promise<void>;
    /** Redirect to an OAuth provider's consent page. */
    social: (opts: SignInSocialOpts) => Promise<void>;
    /** Authenticate with a registered WebAuthn passkey. */
    passkey: (opts?: SignInPasskeyOpts) => Promise<void>;
    /** Submit a TOTP code for pending 2FA challenge. */
    totp: (opts: SignInTOTPOpts) => Promise<void>;
    /** Verify an email OTP for pending 2FA challenge. */
    emailOtp: (opts: SignInEmailOtpVerifyOpts) => Promise<void>;
  };
  /** `true` while any sign-in action is in flight. */
  isLoading: boolean;
  /** Last error message from a failed sign-in attempt. `null` if none. */
  error: string | null;
  /** Clears the current error. */
  clearError: () => void;
  /**
   * Present when email/password sign-in succeeds but the server requires a
   * 2FA step before granting a full session.
   */
  twoFactorRequired: boolean;
}

/** Extracts a human-readable message from any error shape returned by Better Auth. */
function extractMessage(err: unknown): string {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof (err as { message?: unknown }).message === "string")
    return (err as { message: string }).message;
  if (typeof (err as { error?: { message?: unknown } }).error?.message === "string")
    return (err as { error: { message: string } }).error.message;
  return "An unexpected error occurred.";
}

export function useSignIn(): UseSignInReturn {
  const { client, afterSignInUrl } = useRalphAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(extractMessage(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const signInEmail = useCallback(
    async (opts: SignInEmailOpts) => {
      return run(async () => {
        const res = await client.signIn.email({
          email: opts.email,
          password: opts.password,
          rememberMe: opts.rememberMe ?? true,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          fetchOptions: {
            onSuccess() {
              setTwoFactorRequired(false);
            },
            onError(ctx: { error: { message?: string; status?: number } }) {
              const msg = ctx.error.message ?? "";
              // Better Auth returns this specific message for pending 2FA
              if (
                msg.toLowerCase().includes("two factor") ||
                ctx.error.status === 403
              ) {
                setTwoFactorRequired(true);
              }
            },
          },
        });
        // Check if the response body signals 2FA is required
        const body = (res as unknown as { data?: { twoFactorRedirect?: boolean } })?.data;
        if (body?.twoFactorRedirect) {
          setTwoFactorRequired(true);
          return { twoFactorRequired: true };
        }
        return {};
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInMagicLink = useCallback(
    async (opts: SignInMagicLinkOpts) => {
      await run(async () => {
        await (client as unknown as {
          signIn: { magicLink: (o: { email: string; callbackURL: string }) => Promise<unknown> };
        }).signIn.magicLink({
          email: opts.email,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
        });
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInSocial = useCallback(
    async (opts: SignInSocialOpts) => {
      await run(async () => {
        await client.signIn.social({
          provider: opts.provider,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          errorCallbackURL: opts.errorCallbackURL,
        } as Parameters<typeof client.signIn.social>[0]);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInPasskey = useCallback(
    async (opts: SignInPasskeyOpts = {}) => {
      await run(async () => {
        await (client as unknown as {
          signIn: {
            passkey: (o: { callbackURL: string }) => Promise<unknown>;
          };
        }).signIn.passkey({
          callbackURL: opts.callbackURL ?? afterSignInUrl,
        });
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInTotp = useCallback(
    async (opts: SignInTOTPOpts) => {
      await run(async () => {
        await (client as unknown as {
          twoFactor: {
            verifyTotp: (o: {
              code: string;
              callbackURL: string;
            }) => Promise<unknown>;
          };
        }).twoFactor.verifyTotp({
          code: opts.code,
          callbackURL: afterSignInUrl,
        });
        setTwoFactorRequired(false);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInEmailOtp = useCallback(
    async (opts: SignInEmailOtpVerifyOpts) => {
      await run(async () => {
        await (client as unknown as {
          twoFactor: {
            verifyOtp: (o: { code: string }) => Promise<unknown>;
          };
        }).twoFactor.verifyOtp({ code: opts.otp });
        setTwoFactorRequired(false);
      });
    },
    [client, run]
  );

  return {
    signIn: {
      email: signInEmail,
      magicLink: signInMagicLink,
      social: signInSocial,
      passkey: signInPasskey,
      totp: signInTotp,
      emailOtp: signInEmailOtp,
    },
    isLoading,
    error,
    clearError,
    twoFactorRequired,
  };
}

/**
 * useSignUp — imperative sign-up actions.
 *
 * Supports email/password registration with optional username.
 * After successful registration, the user is redirected to `afterSignUpUrl`
 * (from provider config) unless overridden per-call.
 */

import { useCallback, useState } from "react";
import { useRalphAuth } from "../context";

interface SignUpEmailOpts {
  email: string;
  password: string;
  name: string;
  username?: string;
  callbackURL?: string;
}

interface UseSignUpReturn {
  signUp: {
    /** Register a new account with email + password. */
    email: (opts: SignUpEmailOpts) => Promise<void>;
  };
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  /**
   * `true` after successful registration when email verification is required.
   * Show a "check your email" message in this state.
   */
  verificationPending: boolean;
}

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

export function useSignUp(): UseSignUpReturn {
  const { client, afterSignUpUrl } = useRalphAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);

  const clearError = useCallback(() => setError(null), []);

  const signUpEmail = useCallback(
    async (opts: SignUpEmailOpts) => {
      setLoading(true);
      setError(null);
      try {
        const res = await client.signUp.email({
          email: opts.email,
          password: opts.password,
          name: opts.name,
          // username is an optional plugin field — pass through if provided
          ...(opts.username ? { username: opts.username } : {}),
          callbackURL: opts.callbackURL ?? afterSignUpUrl,
        } as Parameters<typeof client.signUp.email>[0]);

        // Better Auth sets `requireEmailVerification` — the response body
        // won't contain a session token; it returns a redirect or empty body.
        const data = (res as unknown as { data?: { requiresEmailVerification?: boolean } })?.data;
        if (data?.requiresEmailVerification) {
          setVerificationPending(true);
        }
      } catch (err) {
        setError(extractMessage(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [client, afterSignUpUrl]
  );

  return {
    signUp: { email: signUpEmail },
    isLoading,
    error,
    clearError,
    verificationPending,
  };
}

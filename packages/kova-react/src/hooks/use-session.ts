/**
 * useSession — current auth session state.
 *
 * Returns the raw session + user objects along with derived booleans.
 * Equivalent to Clerk's `useAuth()` but typed against kova-auth's user model.
 *
 * @example
 * ```tsx
 * const { session, isLoaded, isSignedIn } = useSession();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return <Redirect to="/sign-in" />;
 * return <Dashboard user={session.user} />;
 * ```
 */

import { useKovaAuth } from "../context";
import { readAuthSessionPayload } from "../session-token";
import type { KovaSession, KovaUser, UseSessionReturn } from "../types";

export function useSession(): UseSessionReturn {
  const { sessionResult, client: _client } = useKovaAuth();

  // Read from the shared subscription set up once in KovaAuthProvider.
  // Do NOT call client.useSession() here — each independent call creates its
  // own Better Auth subscription that fires a separate get-session request.
  const result = sessionResult;

  const isLoaded = !result.isPending;
  const payload = readAuthSessionPayload(result.data);
  const isSignedIn = !!payload?.user && !result.error;

  const session = payload
    ? {
        user: payload.user as unknown as KovaUser,
        session: payload.session as unknown as KovaSession,
      }
    : null;

  return {
    session,
    isLoaded,
    isSignedIn,
    refetch: () => result.refetch(),
  };
}

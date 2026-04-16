/**
 * useSession — current auth session state.
 *
 * Returns the raw session + user objects along with derived booleans.
 * Equivalent to Clerk's `useAuth()` but typed against ralph-auth's user model.
 *
 * @example
 * ```tsx
 * const { session, isLoaded, isSignedIn } = useSession();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return <Redirect to="/sign-in" />;
 * return <Dashboard user={session.user} />;
 * ```
 */

import { useRalphAuth } from "../context";
import type { RalphSession, RalphUser, UseSessionReturn } from "../types";

export function useSession(): UseSessionReturn {
  const { client } = useRalphAuth();

  // Better Auth's reactive hook — re-renders when session changes
  const result = client.useSession();

  const isLoaded = !result.isPending;
  const isSignedIn = !!result.data?.user && !result.error;

  // Better Auth's base user type lacks plugin-extended fields (role, banned, etc.)
  // We cast through unknown here; the actual values are present at runtime because
  // the server always returns them — the type narrowing is a client-side limitation.
  const session = result.data
    ? ({
      user: result.data.user as unknown as RalphUser,
      session: result.data.session as unknown as RalphSession,
    })
    : null;

  return {
    session,
    isLoaded,
    isSignedIn,
    refetch: () => result.refetch(),
  };
}

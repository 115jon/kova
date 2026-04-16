/**
 * useAuth — combined auth state hook.
 *
 * A convenience hook that mirrors Clerk's `useAuth()` API for teams
 * already familiar with Clerk. Provides everything you need for a typical
 * "is the user signed in?" check without composing multiple hooks.
 *
 * @example
 * ```tsx
 * const { isSignedIn, isLoaded, userId, getToken } = useAuth();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return null;
 * ```
 */

import { useCallback } from "react";
import { useRalphAuth } from "../context";

export interface UseAuthReturn {
  /** `false` until the initial session check completes (prevents flash of wrong UI). */
  isLoaded: boolean;
  /** `true` when a valid session exists. */
  isSignedIn: boolean;
  /** The current user's ID, or `null` if not signed in. */
  userId: string | null;
  /** HMAC session token (the raw Better Auth token), or `null`. */
  sessionId: string | null;
  orgId: string | null;
  orgRole: string | null;
  /** Imperatively sign out. */
  signOut: (callbackURL?: string) => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { client, afterSignOutUrl } = useRalphAuth();
  const result = client.useSession();

  const isLoaded = !result.isPending;
  const session = result.data;
  const user = session?.user ?? null;
  const rawSession = session?.session ?? null;

  const signOut = useCallback(
    async (callbackURL?: string) => {
      await client.signOut({
        fetchOptions: {
          onSuccess() {
            const dest = callbackURL ?? afterSignOutUrl;
            if (typeof window !== "undefined") {
              window.location.href = dest;
            }
          },
        },
      });
    },
    [client, afterSignOutUrl]
  );

  const activeOrgId =
    (rawSession as { activeOrganizationId?: string | null } | null)
      ?.activeOrganizationId ?? null;

  return {
    isLoaded,
    isSignedIn: !!user,
    userId: user?.id ?? null,
    sessionId:
      (rawSession as { token?: string | null } | null)?.token ?? null,
    orgId: activeOrgId,
    orgRole: null, // resolved per-request; use useOrganization() for membership role
    signOut,
  };
}

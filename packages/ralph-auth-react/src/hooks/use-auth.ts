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
  const { client, authUrl, publishableKey, afterSignOutUrl, sessionResult, clearSessionToken, hasBearerSession, sessionToken } = useRalphAuth();
  // Shared session subscription — avoids a duplicate get-session request.
  const result = sessionResult;

  const isLoaded = !result.isPending;
  const session = result.data;
  const user = session?.user ?? null;
  const rawSession = session?.session ?? null;

  const signOut = useCallback(
    async (callbackURL?: string) => {
      const dest = callbackURL ?? afterSignOutUrl;
      if (hasBearerSession) {
        // Cross-origin Bearer flow: revoke this app-scoped session token, then
        // clear it locally. The platform session on auth.115jon.site stays intact.
        if (sessionToken && publishableKey) {
          try {
            await fetch(`${authUrl}/api/pub/apps/${publishableKey}/revoke-session`, {
              method: "POST",
              headers: { Authorization: `Bearer ${sessionToken}` },
            });
          } catch { }
        }
        clearSessionToken();
        if (typeof window !== "undefined") {
          window.location.href = dest;
        }
      } else {
        // Same-origin cookie flow: call the server to invalidate ONLY this specific session.
        // Using `client.signOut()` with multi-session enabled deletes ALL sessions on the device.
        if (rawSession?.token && (client as any).multiSession) {
          await (client as any).multiSession.revokeDeviceSession({ sessionToken: rawSession.token });
        } else {
          try {
            await client.signOut();
          } catch { }
        }

        if (typeof window !== "undefined") {
          window.location.href = dest;
        }
      }
    },
    [client, authUrl, publishableKey, afterSignOutUrl, clearSessionToken, hasBearerSession, sessionToken]
  );

  const activeOrgId =
    (rawSession as { activeOrganizationId?: string | null } | null)
      ?.activeOrganizationId ?? null;

  return {
    isLoaded,
    isSignedIn: !!user,
    userId: user?.id ?? null,
    sessionId:
      sessionToken ?? (rawSession as { token?: string | null } | null)?.token ?? null,
    orgId: activeOrgId,
    orgRole: null,
    signOut,
  };
}

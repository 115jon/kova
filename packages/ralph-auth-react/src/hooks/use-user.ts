/**
 * useUser — the currently signed-in user record.
 *
 * Provides the user object and an `updateUser` imperative method that
 * patches the user's profile and automatically refreshes the session.
 *
 * @example
 * ```tsx
 * const { user, isLoaded, isSignedIn, updateUser } = useUser();
 *
 * async function handleNameChange(newName: string) {
 *   await updateUser({ name: newName });
 * }
 * ```
 */

import { useCallback } from "react";
import { useRalphAuth } from "../context";
import type { RalphUser, UseUserReturn } from "../types";

export function useUser(): UseUserReturn {
  const { client } = useRalphAuth();
  const result = client.useSession();

  const isLoaded = !result.isPending;
  const rawUser = result.data?.user ?? null;

  // Coerce Better Auth's user shape to our typed RalphUser.
  // BA's inferred user type doesn't include plugin-added fields, so we cast
  // through a plain Record to avoid DTS type-overlap errors.
  const user: RalphUser | null = rawUser
    ? (() => {
      const u = rawUser as unknown as Record<string, unknown>;
      const toDate = (v: unknown) =>
        v instanceof Date ? v : new Date((v as number | string | undefined) ?? Date.now());
      return {
        id: rawUser.id,
        name: rawUser.name,
        email: rawUser.email,
        emailVerified: !!(u["emailVerified"] as boolean | undefined),
        image: (u["image"] as string | null | undefined) ?? null,
        role: (u["role"] as string | null | undefined) ?? null,
        banned: !!(u["banned"] as boolean | undefined),
        createdAt: toDate(u["createdAt"]),
        updatedAt: toDate(u["updatedAt"]),
        username: (u["username"] as string | null | undefined) ?? null,
        twoFactorEnabled: !!(u["twoFactorEnabled"] as boolean | undefined),
      };
    })()
    : null;

  const updateUser = useCallback(
    async (data: { name?: string; image?: string }) => {
      await client.updateUser(data);
      result.refetch();
    },
    [client, result]
  );

  return {
    user,
    isLoaded,
    isSignedIn: !!user,
    updateUser,
  };
}

import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// In dev: Vite proxies /api → http://localhost:8787, so we use a relative
// base URL. In prod: set VITE_AUTH_URL to the real auth server URL.
const AUTH_URL = (import.meta.env.VITE_AUTH_URL as string) ?? "";

export const authClient = createAuthClient({
  baseURL: AUTH_URL || undefined,
  plugins: [
    adminClient(),        // session.user.role, banned, etc.
    apiKeyClient(),       // create/list/delete/verify API keys
    twoFactorClient({
      // Handle 2FA challenge in sign-in.tsx manually (no page redirect)
      onTwoFactorRedirect: () => {
        // Intentionally left blank — sign-in.tsx checks twoFactorRequired
      },
    }),
    organizationClient(), // orgs, members, invitations, roles
  ],
  fetchOptions: {
    credentials: "include",
  },
});

export const {
  signIn,
  signOut,
  useSession,
  getSession,  // imperative fetch — call after TOTP to refresh the session store
} = authClient;

// ── Typed plugin accessors ────────────────────────────────────────────────────
// Use these instead of `(authClient as any).pluginName` in route components.
// TypeScript will catch typos in method names and wrong argument shapes.
export const twoFactor = authClient.twoFactor;
export const organization = authClient.organization;
export const apiKey = authClient.apiKey;
export const admin = authClient.admin;

// ── Reactive org hooks (from organizationClient plugin) ───────────────────────
/** Reactive list of all orgs the current user is a member of. */
export const useListOrganizations = () => authClient.useListOrganizations();
/** Reactive active organization (re-evaluates when setActive is called). */
export const useActiveOrganization = () => authClient.useActiveOrganization();

/** List OAuth + credential accounts linked to the current user. */
export const listAccounts = () => authClient.listAccounts();

// Exported for direct use in components (e.g. building OAuth redirect URLs)
export { AUTH_URL };


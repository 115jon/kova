import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  adminClient,
  magicLinkClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
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
    // ── Feature 6 plugins ────────────────────────────────────────
    multiSessionClient(),   // simultaneous multi-account sessions
    passkeyClient(),        // WebAuthn passkey registration + sign-in
    magicLinkClient(),      // passwordless email link sign-in
    usernameClient(),       // username field on sign-up + sign-in by username
    // bearer: server-side only — no client plugin needed
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
  updateUser,  // patches user fields + invalidates Better Auth's KV session cache
} = authClient;

// ── Typed plugin accessors ────────────────────────────────────────────────────
// Use these instead of `(authClient as any).pluginName` in route components.
// TypeScript will catch typos in method names and wrong argument shapes.
export const twoFactor = authClient.twoFactor;
export const organization = authClient.organization;
export const apiKey = authClient.apiKey;
export const admin = authClient.admin;
export const passkey = authClient.passkey;
export const multiSession = authClient.multiSession;

// ── Reactive org hooks (from organizationClient plugin) ───────────────────────
/** Reactive list of all orgs the current user is a member of. */
export const useListOrganizations = () => authClient.useListOrganizations();
/** Reactive active organization (re-evaluates when setActive is called). */
export const useActiveOrganization = () => authClient.useActiveOrganization();

// ── Multi-session (imperative API only — no reactive hook in BA) ──────────────
// Use `multiSession.listDeviceSessions()` directly in components.
// e.g.: const { data } = await multiSession.listDeviceSessions();
//       await multiSession.setActive({ sessionToken });
//       await multiSession.revoke({ sessionToken });

/** List OAuth + credential accounts linked to the current user. */
export const listAccounts = () => authClient.listAccounts();

// Exported for direct use in components (e.g. building OAuth redirect URLs)
export { AUTH_URL };


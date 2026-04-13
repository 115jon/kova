import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// In dev: Vite proxies /api → http://localhost:8787, so we use a relative
// base URL. In prod: set VITE_AUTH_URL to the real auth server URL.
const AUTH_URL = (import.meta.env.VITE_AUTH_URL as string) ?? "";

export const authClient = createAuthClient({
  baseURL: AUTH_URL || undefined,
  plugins: [
    adminClient(),       // session.user.role, banned, etc.
    apiKeyClient(),      // create/list/delete/verify API keys
    twoFactorClient({
      // Handle 2FA challenge in sign-in.tsx manually (no page redirect)
      onTwoFactorRedirect: () => {
        // Intentionally left blank — sign-in.tsx checks twoFactorRequired
      },
    }),
  ],
  fetchOptions: {
    credentials: "include",
  },
});

export const {
  signIn,
  signOut,
  useSession,
} = authClient;

// Exported for direct use in components (e.g. building OAuth redirect URLs)
export { AUTH_URL };

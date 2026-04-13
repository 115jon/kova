import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// In dev: Vite proxies /api → http://localhost:8787, so we use a relative
// base URL. This eliminates all CORS issues — browser sees one origin.
// In prod: set VITE_AUTH_URL to the real auth server URL.
const AUTH_URL = (import.meta.env.VITE_AUTH_URL as string) ?? "";

export const authClient = createAuthClient({
  baseURL: AUTH_URL || undefined,
  plugins: [
    adminClient(), // adds role, banned, etc. to the session user type
    apiKeyClient(),
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

// Exported for direct use in components (e.g. building redirect URLs manually)
export { AUTH_URL };


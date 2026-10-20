import { multiSessionClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { AUTH_URL } from "./auth-client";

/** Own session store: re-confirming must not make the dashboard's useSession see the cookie-less moment between sign-in and the code. */
export function createReauthClient() {
  return createAuthClient({
    baseURL: AUTH_URL || undefined,
    plugins: [twoFactorClient({ onTwoFactorRedirect() {} }), multiSessionClient()],
    fetchOptions: { credentials: "include" },
  });
}

/**
 * Better Auth guards a few endpoints with `freshAge`: the session must have been
 * created recently, however active it has been since. In 1.6 that covers
 * list-sessions, unlink-account and passkey registration. Everything else that
 * sounds sensitive (change password, revoke sessions, disable 2FA) only needs an
 * authoritative session and does not trip this.
 */
export function isSessionNotFresh(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "SESSION_NOT_FRESH" || (typeof message === "string" && /session is not fresh/i.test(message));
}

/**
 * Which ways "Confirm it's you" offers for an account.
 *
 * A password sign-in on a 2FA account is the one to avoid: Better Auth's
 * two-factor plugin deletes the new session and expires the browser's own
 * session cookies until a code is verified, and the dashboard sends a signed-out
 * browser to /sign-in. Providers, passkeys and email links do not go through
 * that hook, so 2FA accounts use those instead.
 */
export function confirmMethods(account: {
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  hasPasskey: boolean;
  providers: readonly string[];
}) {
  const password = account.hasPassword && !account.twoFactorEnabled;
  return {
    password,
    passkey: account.hasPasskey,
    providers: account.providers,
    // The last resort, so there is always a way through.
    emailLink: !password && !account.hasPasskey && account.providers.length === 0,
  };
}

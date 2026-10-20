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
 * A password sign-in on a 2FA account deletes the new session and expires the
 * browser's session cookies until a code is verified, so the modal collects the
 * password and the code on one form and sends both requests back to back. That
 * makes `code` true for password accounts with 2FA. Accounts with no password,
 * passkey or provider get an emailed link as the last resort.
 */
export function confirmMethods(account: {
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  hasPasskey: boolean;
  providers: readonly string[];
}) {
  return {
    password: account.hasPassword,
    code: account.hasPassword && account.twoFactorEnabled,
    passkey: account.hasPasskey,
    providers: account.providers,
    emailLink: !account.hasPassword && !account.hasPasskey && account.providers.length === 0,
  };
}

/** Tells an authenticator code from a backup code. */
export function classifySecondFactor(code: string): "totp" | "backup" | null {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed.replace(/\s+/g, ""))) return "totp";
  if (/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(trimmed)) return "backup";
  return null;
}

/** Backup codes are stored as `xxxxx-xxxxx`. */
export function normalizeBackupCode(code: string): string {
  const raw = code.replace(/[\s-]+/g, "");
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

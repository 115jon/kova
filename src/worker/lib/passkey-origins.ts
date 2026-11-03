/**
 * Origins whose pages may run the WebAuthn ceremony. The browser puts the page
 * origin in the signed response and the server compares it exactly. The page is
 * the auth server's own sign-in page (the dashboard shares its origin), so
 * AUTH_URL counts even when DASHBOARD_URL names something else. App hosts such
 * as {slug}.auth.… redirect to that page before any ceremony.
 */
export function passkeyOrigins(env: { AUTH_URL?: string; DASHBOARD_URL?: string }): string[] {
  const origins = new Set<string>();
  for (const url of [env.DASHBOARD_URL, env.AUTH_URL]) {
    if (!url) continue;
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A malformed var must not take passkeys down for the other one.
    }
  }
  return [...origins];
}

/**
 * The WebAuthn relying-party ID. PASSKEY_RP_ID (e.g. "115jon.com") applies
 * when the auth host is that domain or under it, so passkeys also work on
 * sibling apps such as yap.115jon.com. Any other host (the old .site host,
 * local dev) uses its own hostname, as before.
 */
export function passkeyRpId(env: { AUTH_URL?: string; PASSKEY_RP_ID?: string }): string {
  let host: string;
  try {
    host = new URL(env.AUTH_URL ?? "").hostname;
  } catch {
    return "localhost";
  }
  const rpId = env.PASSKEY_RP_ID?.trim().toLowerCase();
  if (rpId && (host === rpId || host.endsWith(`.${rpId}`))) return rpId;
  return host;
}

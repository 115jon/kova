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

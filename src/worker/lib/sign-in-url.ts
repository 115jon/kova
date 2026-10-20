/**
 * The one sign-in URL an application sends users to:
 *
 *   {AUTH_URL}/sign-in?pk={publishable_key}&redirect_url={registered redirect URI}
 *
 * The page renders the app's branding, and after sign-in hands an app-scoped
 * session back to `redirect_url` as `?kova_auth_code=…` (exchanged at
 * /api/pub/apps/:pk/exchange-code). `redirect_url` must exactly match one of the
 * app's registered redirect URIs. An optional `state` is echoed back unchanged.
 * `native_handoff=1` is accepted as a legacy hint and changes nothing.
 */
export function appSignInUrl(
  authOrigin: string,
  publishableKey: string,
  redirectUrl?: string,
  state?: string,
): string {
  const url = new URL("/sign-in", authOrigin);
  url.searchParams.set("pk", publishableKey);
  if (redirectUrl) url.searchParams.set("redirect_url", redirectUrl);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

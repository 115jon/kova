/**
 * The one sign-in URL an application sends users to:
 *
 *   {AUTH_URL}/sign-in?pk={publishable_key}&redirect_url={registered redirect URI}
 *
 * The page renders the app's branding, and after sign-in hands an app-scoped
 * session back to `redirect_url` as `?kova_auth_code=…` (exchanged at
 * /api/pub/apps/:pk/exchange-code). `redirect_url` must match one of the app's
 * registered redirect URIs: the same path, and the same query if the
 * registration has one. A registration of just an origin and `/` (no query)
 * allows any path on that origin. An optional `state` is echoed back unchanged.
 * `native_handoff=1` is accepted as a legacy hint and changes nothing.
 * Someone already signed in picks an account first; `prompt=login` shows the
 * sign-in form instead.
 * `/sign-up` takes the same query, for the page that creates the account.
 */
export function appSignInUrl(
  authOrigin: string,
  publishableKey: string,
  redirectUrl?: string,
  state?: string,
  page: "sign-in" | "sign-up" = "sign-in",
): string {
  const url = new URL(`/${page}`, authOrigin);
  url.searchParams.set("pk", publishableKey);
  if (redirectUrl) url.searchParams.set("redirect_url", redirectUrl);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

const APPROVE_PATH = /^\/approve\/dc_[A-Za-z0-9_-]+$/;

export type SignInRouteSearch = {
  pk?: string;
  redirect_url?: string;
  native_handoff?: string;
};

export function safeApproveReturnPath(redirectUrl: string | undefined): string | null {
  if (!redirectUrl) return null;
  const trimmed = redirectUrl.trim();
  if (!APPROVE_PATH.test(trimmed)) return null;
  return trimmed;
}

export function buildNativeHandoffPath(
  search: SignInRouteSearch,
): string | null {
  const pk = search.pk?.trim();
  const redirectUrl = search.redirect_url?.trim();

  if (!pk || !redirectUrl) return null;

  const params = new URLSearchParams({
    mode: "sdk",
    pk,
    redirect_uri: redirectUrl,
  });
  return `/api/hosted/oauth-complete?${params.toString()}`;
}

export function buildSignInReturnPath(search: SignInRouteSearch): string {
  const params = new URLSearchParams();

  if (search.pk) params.set("pk", search.pk);
  if (search.redirect_url) params.set("redirect_url", search.redirect_url);
  if (search.native_handoff) {
    params.set("native_handoff", search.native_handoff);
  }

  const query = params.toString();
  return query ? `/sign-in?${query}` : "/sign-in";
}

export function buildSignInReturnUrl(
  search: SignInRouteSearch,
  origin: string,
): string {
  return new URL(buildSignInReturnPath(search), origin).toString();
}

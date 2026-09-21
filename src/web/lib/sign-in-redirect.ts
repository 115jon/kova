import { safeOauthContinuePath } from "../../worker/lib/oidc-account-picker";

const APPROVE_PATH = /^\/approve\/dc_[A-Za-z0-9_-]+$/;

export type SignInRouteSearch = {
  pk?: string;
  redirect_url?: string;
  native_handoff?: string;
  add_account?: string;
};

export { safeOauthContinuePath };

export function safeApproveReturnPath(redirectUrl: string | undefined): string | null {
  if (!redirectUrl) return null;
  const trimmed = redirectUrl.trim();
  if (!APPROVE_PATH.test(trimmed)) return null;
  return trimmed;
}

export function safeSignInReturnPath(redirectUrl: string | undefined): string | null {
  return safeApproveReturnPath(redirectUrl) ?? safeOauthContinuePath(redirectUrl);
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
  if (search.add_account) params.set("add_account", search.add_account);

  const query = params.toString();
  return query ? `/sign-in?${query}` : "/sign-in";
}

export function buildSignInReturnUrl(
  search: SignInRouteSearch,
  origin: string,
): string {
  return new URL(buildSignInReturnPath(search), origin).toString();
}

const CONTINUE_SEARCH_KEY = "kova:oidc-continue-search";

export function persistOauthContinueSearch(search: string): void {
  if (typeof sessionStorage === "undefined") return;
  const query = search.startsWith("?") ? search : search ? `?${search}` : "";
  if (!query.includes("client_id=")) return;
  sessionStorage.setItem(CONTINUE_SEARCH_KEY, query);
}

export function restoreOauthContinueSearch(currentSearch: string): string {
  const current = currentSearch.startsWith("?") || currentSearch === ""
    ? currentSearch
    : `?${currentSearch}`;
  if (current.includes("client_id=")) {
    persistOauthContinueSearch(current);
    return current;
  }
  if (typeof sessionStorage === "undefined") return current;
  return sessionStorage.getItem(CONTINUE_SEARCH_KEY) ?? current;
}

export function oauthContinueCallbackUrl(
  origin: string,
  redirectUrl: string | undefined,
): string | null {
  const path = safeOauthContinuePath(redirectUrl);
  if (!path) return null;
  return new URL(path, origin).toString();
}

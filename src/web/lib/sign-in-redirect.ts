import { safeOauthContinuePath } from "../../worker/lib/oidc-account-picker";

const APPROVE_PATH = /^\/approve\/dc_[A-Za-z0-9_-]+$/;

export type SignInRouteSearch = {
  pk?: string;
  redirect_url?: string;
  native_handoff?: string;
  add_account?: string;
  /** App nonce echoed back to redirect_url unchanged. */
  state?: string;
  /**
   * Better Auth's code when an emailed link or provider sign-in failed and sent
   * the browser back here. Never carried onward; see canContinueWithSession.
   */
  error?: string;
};

export { safeOauthContinuePath };

export function searchParamString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : undefined;
  return undefined;
}

export function isAddAccount(value: unknown): boolean {
  return value === "1" || value === "true" || value === "yes" || value === 1 || value === true;
}

/** Search handling shared by the sign-in and sign-up routes. */
export function validateSignInSearch(search: Record<string, unknown>): SignInRouteSearch {
  return {
    pk: searchParamString(search.pk),
    redirect_url: searchParamString(search.redirect_url),
    native_handoff: searchParamString(search.native_handoff),
    add_account: isAddAccount(search.add_account) ? "1" : undefined,
    state: searchParamString(search.state),
    error: searchParamString(search.error),
  };
}

/**
 * Whether the page may carry on with the session already in the browser. After
 * a failed link that session belongs to someone else, so the page stops and
 * says what went wrong instead of continuing as them.
 */
export function canContinueWithSession(search: Pick<SignInRouteSearch, "error">): boolean {
  return !search.error;
}

export type ResetPasswordSearch = Pick<SignInRouteSearch, "pk" | "redirect_url" | "state"> & {
  token?: string;
  error?: string;
};

export function validateResetPasswordSearch(search: Record<string, unknown>): ResetPasswordSearch {
  return {
    pk: searchParamString(search.pk),
    redirect_url: searchParamString(search.redirect_url),
    state: searchParamString(search.state),
    token: searchParamString(search.token),
    error: searchParamString(search.error),
  };
}

export function safeApproveReturnPath(redirectUrl: string | undefined): string | null {
  if (!redirectUrl) return null;
  const trimmed = redirectUrl.trim();
  if (!APPROVE_PATH.test(trimmed)) return null;
  return trimmed;
}

export function safeSignInReturnPath(redirectUrl: string | undefined): string | null {
  return safeApproveReturnPath(redirectUrl) ?? safeOauthContinuePath(redirectUrl);
}

/**
 * App sign-in rule: `pk` + `redirect_url` means "sign in for this app, then
 * hand an app session back to redirect_url" (see worker/lib/sign-in-url.ts).
 * `native_handoff=1` is an optional legacy hint and is not required. The
 * redirect is never trusted here: the sign-in page pre-checks it and
 * handleSdkBounce enforces the app's redirect URI allowlist.
 */
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
  if (search.state) params.set("state", search.state);
  return `/api/hosted/oauth-complete?${params.toString()}`;
}

export type AuthPage = "sign-in" | "sign-up" | "reset-password";

/** Path of the sign-in, sign-up or reset-password page carrying the app context along. */
export function buildAuthPagePath(page: AuthPage, search: SignInRouteSearch): string {
  const params = new URLSearchParams();

  if (search.pk) params.set("pk", search.pk);
  if (search.redirect_url) params.set("redirect_url", search.redirect_url);
  if (search.native_handoff) {
    params.set("native_handoff", search.native_handoff);
  }
  if (search.add_account) params.set("add_account", search.add_account);
  if (search.state) params.set("state", search.state);

  const query = params.toString();
  return query ? `/${page}?${query}` : `/${page}`;
}

export function buildSignInReturnPath(search: SignInRouteSearch): string {
  return buildAuthPagePath("sign-in", search);
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

export const OIDC_ACCOUNT_SELECTED_PARAM = "account_selected";
export const OIDC_CONTINUE_PATH = "/oauth/continue";
export const OIDC_LAST_USER_STORAGE_KEY = "kova:oidc-last-user:forgejo";

export function sortAccountsLastUsedFirst<T extends { user: { id: string } }>(
  accounts: T[],
  lastUserId: string | null | undefined,
): T[] {
  if (!lastUserId) return accounts;
  return [...accounts].sort((a, b) => {
    if (a.user.id === lastUserId) return -1;
    if (b.user.id === lastUserId) return 1;
    return 0;
  });
}

export function shouldOfferOidcAccountPicker(opts: {
  method: string;
  pathname: string;
  clientId: string | null;
  forgejoClientId: string | undefined;
  accountSelected: string | null;
}): boolean {
  if (opts.method !== "GET") return false;
  if (!opts.pathname.endsWith("/oauth2/authorize")) return false;
  const expected = opts.forgejoClientId?.trim();
  if (!expected || !opts.clientId) return false;
  if (opts.clientId !== expected) return false;
  return opts.accountSelected !== "1";
}

export function buildOidcContinueLocation(origin: string, search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete(OIDC_ACCOUNT_SELECTED_PARAM);
  const query = params.toString();
  return `${origin}${OIDC_CONTINUE_PATH}${query ? `?${query}` : ""}`;
}

export function buildAuthorizeUrlAfterAccountSelected(origin: string, search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(OIDC_ACCOUNT_SELECTED_PARAM, "1");
  return `${origin}/api/auth/oauth2/authorize?${params.toString()}`;
}

export function safeOauthContinuePath(redirectUrl: string | undefined): string | null {
  if (!redirectUrl) return null;
  const trimmed = redirectUrl.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://kova.invalid");
  } catch {
    return null;
  }

  if (parsed.username || parsed.password || parsed.host !== "kova.invalid") {
    return null;
  }
  if (parsed.pathname !== OIDC_CONTINUE_PATH) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}`;
}

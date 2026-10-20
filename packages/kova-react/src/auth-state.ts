/**
 * Pending sign-in `state` values. Every flow that ends in a `kova_auth_code`
 * redirect mints one first, and the code is only accepted if its `state` is
 * still pending in this browser. Otherwise anyone could hand a victim a link
 * carrying the attacker's code and sign them in as the attacker (login CSRF).
 *
 * localStorage, not sessionStorage: emailed links open in a new tab.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 5;

type Pending = { state: string; createdAt: number };

export function pendingStateKey(pk: string) {
  return `kova-auth:${pk}:pending-states`;
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 24 random bytes as base64url without padding. */
export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readPending(storage: Storage, pk: string, now: number): Pending[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(pendingStateKey(pk)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Pending =>
        !!e && typeof e.state === "string" && typeof e.createdAt === "number" && now - e.createdAt < TTL_MS,
    );
  } catch {
    return [];
  }
}

function writePending(storage: Storage, pk: string, list: Pending[]) {
  try {
    storage.setItem(pendingStateKey(pk), JSON.stringify(list));
  } catch {
    // Private mode or quota: the flow proceeds, the code will just be refused.
  }
}

export function createPendingState(storage: Storage | null, pk: string, now = Date.now()): string {
  const state = randomState();
  if (!storage) return state;
  const list = readPending(storage, pk, now);
  list.push({ state, createdAt: now });
  writePending(storage, pk, list.slice(-MAX));
  return state;
}

/** True once, for a state this browser minted and has not yet used. */
export function consumePendingState(
  storage: Storage | null,
  pk: string,
  state: string | null,
  now = Date.now(),
): boolean {
  if (!storage || !state) return false;
  const list = readPending(storage, pk, now);
  const index = list.findIndex((e) => e.state === state);
  if (index !== -1) list.splice(index, 1);
  writePending(storage, pk, list);
  return index !== -1;
}

function authBase(authUrl: string) {
  return authUrl.replace(/\/+$/, "");
}

/**
 * Link to Kova's hosted sign-in page that this browser will accept a code from.
 * Call it in a click handler, not during render or on the server: the state is saved to this browser's localStorage when minted.
 */
export function createHostedSignInUrl(o: {
  authUrl: string;
  publishableKey: string;
  redirectUrl: string;
  page?: "sign-in" | "sign-up";
}): string {
  const url = new URL(`${authBase(o.authUrl)}/${o.page ?? "sign-in"}`);
  url.searchParams.set("pk", o.publishableKey);
  url.searchParams.set("redirect_url", o.redirectUrl);
  url.searchParams.set("state", createPendingState(browserStorage(), o.publishableKey));
  return url.toString();
}

/**
 * Kova's reset-password page; with a key it returns to `redirectUrl` after sign-in.
 * Call it in a click handler, not during render or on the server: the state is saved to this browser's localStorage when minted.
 */
export function createPasswordResetUrl(o: { authUrl: string; publishableKey?: string; redirectUrl?: string }): string {
  const url = new URL(`${authBase(o.authUrl)}/reset-password`);
  if (o.publishableKey) {
    url.searchParams.set("pk", o.publishableKey);
    if (o.redirectUrl) url.searchParams.set("redirect_url", o.redirectUrl);
    url.searchParams.set("state", createPendingState(browserStorage(), o.publishableKey));
  }
  return url.toString();
}

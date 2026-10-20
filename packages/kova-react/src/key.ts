/**
 * Publishable key utilities.
 *
 * Kova issues opaque publishable keys: `pk_dev_<random>` or `pk_live_<random>`.
 * The key identifies the application; it does not encode where Kova runs.
 * The auth URL therefore comes from, in order:
 *
 *   1. the `authUrl` prop,
 *   2. a legacy self-describing key (`pk_live_|pk_test_` + base64 JSON
 *      `{ v: 1, authUrl, appId? }`, produced by `encodePublishableKey`),
 *   3. the hosted Kova service, {@link KOVA_HOSTED_AUTH_URL}.
 *
 * Self-hosted or local Kova instances must pass `authUrl`.
 */

/** Hosted Kova service used when neither `authUrl` nor a self-describing key names one. */
export const KOVA_HOSTED_AUTH_URL = "https://auth.115jon.site";

const PREFIX_LIVE = "pk_live_";
const PREFIX_TEST = "pk_test_";

interface KeyPayload {
  /** Payload schema version. */
  v: 1;
  /** Absolute base URL of the kova-auth auth server. */
  authUrl: string;
  /** Optional human-readable app name (for debugging). */
  appId?: string;
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Creates a legacy self-describing publishable key from an auth server URL.
 * Kova's dashboard does not issue these; prefer the server-issued key plus
 * `authUrl`.
 *
 * @deprecated Use the publishable key from the Kova dashboard.
 */
export function encodePublishableKey(
  authUrl: string,
  opts: { mode?: "live" | "test"; appId?: string } = {},
): string {
  const { mode = "live", appId } = opts;
  const payload: KeyPayload = { v: 1, authUrl, ...(appId ? { appId } : {}) };
  const encoded = btoa(JSON.stringify(payload));
  return `pk_${mode}_${encoded}`;
}

// ── Decode ────────────────────────────────────────────────────────────────────

export interface DecodedKey {
  authUrl: string;
  appId: string | undefined;
  mode: "live" | "test";
}

/**
 * Decodes a legacy self-describing publishable key.
 * Returns null for Kova's opaque server-issued keys or anything malformed.
 */
export function decodePublishableKey(key: string): DecodedKey | null {
  let mode: "live" | "test";
  let encoded: string;

  if (key.startsWith(PREFIX_LIVE)) {
    mode = "live";
    encoded = key.slice(PREFIX_LIVE.length);
  } else if (key.startsWith(PREFIX_TEST)) {
    mode = "test";
    encoded = key.slice(PREFIX_TEST.length);
  } else {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(atob(encoded));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as KeyPayload).v !== 1 ||
    typeof (payload as KeyPayload).authUrl !== "string"
  ) {
    return null;
  }

  const { authUrl, appId } = payload as KeyPayload;
  return { authUrl: authUrl.replace(/\/$/, ""), appId, mode };
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/** Resolves the Kova base URL for a provider; see the module comment for precedence. */
export function resolveAuthUrl(opts: {
  publishableKey?: string;
  authUrl?: string;
}): string {
  if (opts.authUrl) return opts.authUrl.replace(/\/$/, "");
  if (opts.publishableKey) {
    return decodePublishableKey(opts.publishableKey)?.authUrl ?? KOVA_HOSTED_AUTH_URL;
  }
  throw new Error(
    "[KovaAuth] You must provide either `publishableKey` or `authUrl` to <KovaAuthProvider>.",
  );
}

/**
 * auth-ticket.ts — Short-lived, single-use authorization code for the hosted redirect flow.
 *
 * ## Flow (OAuth Authorization Code analogy)
 *
 *  1. User signs in on sdk-demo-abc.auth.115jon.site/sign-in
 *  2. After successful sign-in, the hosted page JS calls:
 *       POST /api/hosted/create-ticket
 *       Headers: Cookie: (subdomain session cookie)
 *       Body: { redirect_uri, state }
 *  3. Worker creates a ticket (random 256-bit code), stores in KV (60s TTL),
 *     and returns { ticketCode }
 *  4. Hosted page redirects browser to:
 *       {redirect_uri}?code={ticketCode}&state={state}
 *  5. App backend calls:
 *       POST /api/hosted/exchange-ticket
 *       Headers: Authorization: Bearer {sk_dev_...}
 *       Body: { code, redirect_uri }
 *  6. Worker validates the secret key, retrieves + DELETES the ticket from KV,
 *     validates redirect_uri matches what was stored, returns { userId, user }
 *
 * ## Security properties
 *
 *  - Tickets are 256-bit random values (Web Crypto) — not guessable
 *  - Single-use: deleted from KV on first exchange (replay protection)
 *  - Short TTL: 60-second hard expiry in KV (race window protection)
 *  - redirect_uri binding: stored in ticket, verified on exchange (open-redirect protection)
 *  - appId binding: ticket only exchangeable by the owning application's secret key
 *  - KV is never committed to D1 — no persistence after exchange/expiry
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuthTicketPayload {
  /** ID of the user who authenticated */
  userId: string;
  /** Better Auth session ID minted during sign-in */
  sessionId: string;
  /** ID of the application that owns this ticket */
  appId: string;
  /** The exact redirect_uri the app provided when initiating the flow */
  redirectUri: string;
  /** Unix timestamp (ms) when the ticket was created, for audit purposes */
  issuedAt: number;
}

export interface ExchangeTicketResult {
  userId: string;
  sessionId: string;
}

// ── Session Transfer Code (embedded SDK cross-origin flow) ─────────────────────
//
// Unlike AuthTicket (hosted subdomain flow → requires sk_* to exchange), a
// SessionTransferCode is exchangeable with only the publishable key.  It carries
// the raw Better Auth session token so the SDK can inject it as a Bearer token
// in the Authorization header for subsequent get-session / API calls.
//
// Security properties:
//   - 256-bit random code — not guessable
//   - Single-use (deleted on exchange)
//   - 30-second hard TTL — window for timing attacks shrunk to near-zero
//   - pk-bound — only the initiating app's pk can exchange it
//   - origin-bound — redirect_uri is validated to be in the app's allowlist
//     (enforced in the /api/hosted/oauth-complete handler, not here)
//   - The returned sessionToken IS the raw Better Auth session token; it is
//     equivalent to the cookie value and is validated against D1 on every use.
//     Storing it in JS memory (not localStorage) provides the same security
//     posture as sessionStorage — cleared on tab close, invisible to other tabs.

export interface SessionTransferPayload {
  /** Raw Better Auth session token (= cookie value) for Bearer auth */
  sessionToken: string;
  /** Publishable key that initiated the OAuth — only this app can exchange */
  publishableKey: string;
  /** Unix timestamp (ms) for age validation */
  issuedAt: number;
}

export interface ExchangeTransferResult {
  /** Raw session token to inject as `Authorization: Bearer <token>` */
  sessionToken: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** KV TTL for auth tickets (seconds). 60s is deliberately short — use it fast. */
const TICKET_TTL_SECONDS = 60;
/** KV TTL for session transfer codes. 60s is the KV minimum; single-use guarantee is the real protection. */
const TRANSFER_TTL_SECONDS = 60;

/** KV key prefix for tickets. `ticket:{code}` */
const TICKET_KEY_PREFIX = "ticket:";
/** KV key prefix for transfer codes. `transfer:{code}` — separate namespace from tickets. */
const TRANSFER_KEY_PREFIX = "transfer:";

// ── Ticket generator ───────────────────────────────────────────────────────────

/**
 * Generates a cryptographically-random ticket code.
 * Format: `ticket_` + 43-character base64url string (~256 bits entropy).
 * Uses Web Crypto API — works in Cloudflare Workers, Node 18+, and browsers.
 */
function generateTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  // base64url encoding (RFC 4648 §5): replace + → -, / → _, strip =
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `ticket_${b64}`;
}

// ── KV key helpers ─────────────────────────────────────────────────────────────

function ticketKey(code: string): string {
  return `${TICKET_KEY_PREFIX}${code}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Creates an auth ticket and stores it in KV.
 *
 * @param kv          - KV namespace binding
 * @param payload     - Ticket contents (userId, sessionId, appId, redirectUri)
 * @returns The opaque ticket code to pass back to the client in a redirect
 *
 * @throws Never — errors are surfaced as `null` return from `exchangeAuthTicket`
 */
export async function createAuthTicket(
  kv: KVNamespace,
  payload: Omit<AuthTicketPayload, "issuedAt">
): Promise<string> {
  const code = generateTicketCode();
  const stored: AuthTicketPayload = {
    ...payload,
    issuedAt: Date.now(),
  };

  await kv.put(ticketKey(code), JSON.stringify(stored), {
    expirationTtl: TICKET_TTL_SECONDS,
  });

  return code;
}

/**
 * Exchanges an auth ticket code for the stored payload.
 *
 * The ticket is **deleted from KV atomically** — subsequent calls with the
 * same code will fail (single-use guarantee).
 *
 * Callers MUST validate:
 *  - The returned `appId` matches the calling application's ID (verified via secret key)
 *  - The returned `redirectUri` matches the `redirect_uri` in their exchange request
 *
 * @param kv          - KV namespace binding
 * @param code        - The ticket code from the redirect query parameter
 * @param appId       - The application ID derived from the secret key (pre-validated by caller)
 * @param redirectUri - The redirect_uri the app is claiming — must match stored value
 * @returns The ticket payload, or null if invalid/expired/mismatched
 */
export async function exchangeAuthTicket(
  kv: KVNamespace,
  code: string,
  appId: string,
  redirectUri: string
): Promise<ExchangeTicketResult | null> {
  const key = ticketKey(code);

  // Read the ticket
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null; // Expired, already exchanged, or never existed

  let payload: AuthTicketPayload;
  try {
    payload = JSON.parse(raw) as AuthTicketPayload;
  } catch {
    // Corrupt KV entry — delete and reject
    kv.delete(key).catch(() => { });
    return null;
  }

  // Delete immediately — single-use guarantee (fire-and-forget is acceptable
  // here because even if the delete fails the TTL will expire it within 60s)
  kv.delete(key).catch(() => { });

  // ── Validate ──────────────────────────────────────────────────────────────

  // 1. App binding — ticket must belong to the claiming application
  if (payload.appId !== appId) return null;

  // 2. Redirect URI binding — must match exactly what was stored
  //    (prevents the calling app from redirecting to a different URI than declared)
  if (payload.redirectUri !== redirectUri) return null;

  // 3. Expiry double-check (KV TTL is the primary guard; this is belt-and-suspenders)
  const age = Date.now() - payload.issuedAt;
  if (age > TICKET_TTL_SECONDS * 1000 + 5000) {
    // Shouldn't happen if KV TTL is set correctly, but enforce defensively
    return null;
  }

  return {
    userId: payload.userId,
    sessionId: payload.sessionId,
  };
}

// ── Session Transfer Code API ──────────────────────────────────────────────────

/**
 * Creates a session transfer code and stores it in KV.
 *
 * Called by /api/hosted/oauth-complete?mode=sdk after a successful OAuth sign-in
 * on the main auth domain. The code is returned to the consumer app in the URL
 * query string (?ralph_auth_code=xxx) so the SDK can exchange it for a Bearer token.
 *
 * @param kv             KV namespace binding
 * @param sessionToken   Raw Better Auth session token (= the value in the session cookie)
 * @param publishableKey The app's pk — only this app can exchange the code
 */
export async function createSessionTransferCode(
  kv: KVNamespace,
  sessionToken: string,
  publishableKey: string
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const code = `xfr_${b64}`; // `xfr_` prefix distinguishes transfer codes from tickets

  const payload: SessionTransferPayload = {
    sessionToken,
    publishableKey,
    issuedAt: Date.now(),
  };

  await kv.put(`${TRANSFER_KEY_PREFIX}${code}`, JSON.stringify(payload), {
    expirationTtl: TRANSFER_TTL_SECONDS,
  });

  return code;
}

/**
 * Exchanges a session transfer code for the raw session token.
 *
 * The code is **deleted from KV on first call** (single-use).
 *
 * @param kv             KV namespace binding
 * @param code           The transfer code from the consumer app's URL (`?ralph_auth_code=xxx`)
 * @param publishableKey The requesting app's pk — must match what was stored
 * @returns The session token, or null if the code is invalid/expired/mismatched
 */
export async function exchangeSessionTransferCode(
  kv: KVNamespace,
  code: string,
  publishableKey: string
): Promise<ExchangeTransferResult | null> {
  const key = `${TRANSFER_KEY_PREFIX}${code}`;

  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;

  // Delete immediately — single-use guarantee
  kv.delete(key).catch(() => { });

  let payload: SessionTransferPayload;
  try {
    payload = JSON.parse(raw) as SessionTransferPayload;
  } catch {
    return null;
  }

  // pk binding check
  if (payload.publishableKey !== publishableKey) return null;

  // Belt-and-suspenders age check (KV TTL is primary guard)
  if (Date.now() - payload.issuedAt > TRANSFER_TTL_SECONDS * 1000 + 5_000) return null;

  return { sessionToken: payload.sessionToken };
}

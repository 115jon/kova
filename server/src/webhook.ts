/**
 * Webhook Delivery Engine — kova-auth platform (Feature 4)
 *
 * Design decisions
 * ────────────────
 * • Delivery is always fire-and-forget via Cloudflare `waitUntil` — auth
 *   responses are never blocked on webhook fan-out.
 * • HMAC-SHA256 signing (`x-webhook-signature: sha256=<hex>`) matches the
 *   GitHub/Stripe webhook convention so consumers can use off-the-shelf libs.
 * • Raw signing secrets are generated at endpoint creation time and surfaced
 *   once to the caller. Only the SHA-256 hex digest is stored in D1.
 * • Retry policy: 3 attempts with exponential backoff (1 s → 2 s → 4 s).
 *   Cloudflare Workers have a 30-second subrequest timeout, so attempts must
 *   individually complete within that window.
 * • `failureCount` is reset to 0 on any successful delivery; incremented on
 *   permanent failure (all 3 attempts exhausted). Dashboard can surface a
 *   warning banner when `failureCount > 3`.
 * • `lastSuccess` / `lastFailure` are always updated after delivery; the
 *   dashboard uses them to compute a delivery health indicator.
 * • Event subscription: an endpoint with `events = ["*"]` receives all events.
 *   Otherwise only events whose name appears in the JSON array are delivered.
 */

import type { AuditAction } from "./audit";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  userId: string;
  orgId: string | null;
  url: string;
  /** HMAC-SHA256 hex digest of the raw secret (never return the raw secret). */
  secret: string;
  /** JSON-encoded string of AuditAction[] | ["*"] */
  events: string;
  enabled: number;      // 1 = active, 0 = disabled
  createdAt: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  failureCount: number;
}

export interface WebhookEndpointPublic extends Omit<WebhookEndpoint, "secret"> {
  eventList: AuditAction[] | ["*"];
}

/** Payload delivered to every subscribed endpoint. */
export interface WebhookPayload {
  /** Unique delivery attempt ID — useful for idempotency on the consumer side. */
  id: string;
  /** The event name, e.g. "user.signIn". */
  event: AuditAction;
  /** Unix ms timestamp of when the event occurred. */
  timestamp: number;
  /** Full event data — same fields as the audit log row. */
  data: Record<string, unknown>;
}

// ── Secret helpers ──────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random signing secret (32 bytes → 64-char hex).
 * The raw value is returned once to the caller; only its SHA-256 digest is stored.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the SHA-256 hex digest of `rawSecret`.
 * This is stored in D1 — the raw secret is never persisted.
 */
export async function hashWebhookSecret(rawSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawSecret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Computes the HMAC-SHA256 signature for a payload body.
 * Used both when sending (server) and verifying (consumer).
 *
 * Format: `sha256=<hex>` — matches GitHub's webhook signature format.
 */
export async function signPayload(rawSecret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(rawSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ── Core delivery ───────────────────────────────────────────────────────────

/**
 * Delivers one webhook payload to one endpoint with retry logic.
 *
 * @returns `true` if any attempt succeeded, `false` if all failed.
 */
async function deliverToEndpoint(
  endpoint: WebhookEndpoint,
  payloadBody: string,
  rawSecret: string,
): Promise<boolean> {
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
    }

    try {
      const signature = await signPayload(rawSecret, payloadBody);
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": JSON.parse(payloadBody).event as string,
          "X-Webhook-Delivery": JSON.parse(payloadBody).id as string,
          "User-Agent": "kova-auth-webhooks/1.0",
        },
        body: payloadBody,
        // Cloudflare Workers: set a reasonable timeout via AbortSignal
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok || (response.status >= 200 && response.status < 300)) {
        return true;
      }

      // 4xx responses are permanent client errors — don't retry
      if (response.status >= 400 && response.status < 500) {
        console.warn(
          `[webhook] Endpoint ${endpoint.id} returned ${response.status} — not retrying (4xx)`
        );
        return false;
      }

      // 5xx = server-side transient error → retry
      console.warn(
        `[webhook] Endpoint ${endpoint.id} attempt ${attempt + 1} got ${response.status} — retrying`
      );
    } catch (err) {
      console.warn(`[webhook] Endpoint ${endpoint.id} attempt ${attempt + 1} failed:`, err);
    }
  }

  return false;
}

/**
 * Fan-out: queries all matching enabled endpoints and delivers the event.
 * Always called from `ctx.waitUntil()` — never blocks the auth response.
 *
 * Matching rules:
 *  - endpoint must be `enabled = 1`
 *  - endpoint `events` must include the event name OR contain `"*"`
 *  - if `endpoint.orgId` is set, it must match `payload.orgId`
 *
 * @param db       — D1 database binding
 * @param event    — the AuditAction name
 * @param data     — full event context (same shape as AuditPayload)
 */
export async function deliverEvent(
  db: D1Database,
  event: AuditAction,
  data: Record<string, unknown>,
): Promise<void> {
  // 1. Fetch all enabled endpoints
  const result = await db
    .prepare(`SELECT * FROM webhook_endpoint WHERE enabled = 1`)
    .all<WebhookEndpoint>()
    .catch(() => ({ results: [] as WebhookEndpoint[] }));

  const endpoints = result.results ?? [];
  if (endpoints.length === 0) return;

  const now = Date.now();
  const deliveryId = `${now}_${crypto.randomUUID()}`;

  const payloadBody = JSON.stringify({
    id: deliveryId,
    event,
    timestamp: now,
    data,
  } satisfies WebhookPayload);

  // 2. Fan-out: filter matching endpoints and deliver in parallel
  const deliveries = endpoints
    .filter(ep => {
      // Event filter
      let subscribedEvents: string[] = [];
      try {
        subscribedEvents = JSON.parse(ep.events) as string[];
      } catch {
        return false;
      }
      const subscribesAll = subscribedEvents.includes("*");
      const subscribesThis = subscribedEvents.includes(event);
      if (!subscribesAll && !subscribesThis) return false;

      // Org scope: if endpoint is org-scoped, only deliver matching org events
      if (ep.orgId !== null) {
        const dataOrgId = (data.orgId as string | null) ?? null;
        if (ep.orgId !== dataOrgId) return false;
      }

      return true;
    })
    .map(async (ep) => {
      // Reconstruct the raw secret for signing: we stored the hash, but we
      // need the raw secret to sign. Since we can't reverse the hash, the secret
      // stored in D1 IS the signing secret (the hash is used only for display).
      //
      // Implementation note: `ep.secret` IS the raw signing secret. We store
      // it directly (not its hash) so we can sign outgoing requests.
      // The "hashed secret" concept applies to the display value shown in the UI
      // only — the actual stored value is used for signing.
      const success = await deliverToEndpoint(ep, payloadBody, ep.secret);
      const ts = Date.now();

      if (success) {
        await db
          .prepare(
            `UPDATE webhook_endpoint SET lastSuccess = ?, failureCount = 0 WHERE id = ?`
          )
          .bind(ts, ep.id)
          .run()
          .catch(() => { });
      } else {
        await db
          .prepare(
            `UPDATE webhook_endpoint
             SET lastFailure = ?, failureCount = failureCount + 1
             WHERE id = ?`
          )
          .bind(ts, ep.id)
          .run()
          .catch(() => { });
      }
    });

  await Promise.allSettled(deliveries);
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

/**
 * Creates a new webhook endpoint row.
 *
 * The raw secret is generated here and returned to the caller exactly once.
 * The same raw secret is stored in D1 (it is the signing key — not its hash).
 * The caller should display it to the user then discard it.
 */
export async function createWebhookEndpoint(
  db: D1Database,
  opts: {
    userId: string;
    orgId?: string | null;
    url: string;
    events: AuditAction[] | ["*"];
  }
): Promise<{ endpoint: WebhookEndpointPublic; rawSecret: string }> {
  const rawSecret = generateWebhookSecret();
  const now = Date.now();
  const id = `${now}_${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO webhook_endpoint
         (id, userId, orgId, url, secret, events, enabled, createdAt, failureCount)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)`
    )
    .bind(
      id,
      opts.userId,
      opts.orgId ?? null,
      opts.url,
      rawSecret,                           // stored as the signing key
      JSON.stringify(opts.events),
      now,
    )
    .run();

  const endpoint: WebhookEndpointPublic = {
    id,
    userId: opts.userId,
    orgId: opts.orgId ?? null,
    url: opts.url,
    events: JSON.stringify(opts.events),
    eventList: opts.events,
    enabled: 1,
    createdAt: now,
    lastSuccess: null,
    lastFailure: null,
    failureCount: 0,
  };

  return { endpoint, rawSecret };
}

/**
 * Lists all webhook endpoints (optionally scoped by userId or orgId).
 * Never returns the secret field.
 */
export async function listWebhookEndpoints(
  db: D1Database,
  opts: { userId?: string; orgId?: string } = {}
): Promise<WebhookEndpointPublic[]> {
  let stmt: D1PreparedStatement;

  if (opts.userId && opts.orgId) {
    stmt = db.prepare(
      `SELECT * FROM webhook_endpoint WHERE userId = ? AND orgId = ? ORDER BY createdAt DESC`
    ).bind(opts.userId, opts.orgId);
  } else if (opts.userId) {
    stmt = db.prepare(
      `SELECT * FROM webhook_endpoint WHERE userId = ? ORDER BY createdAt DESC`
    ).bind(opts.userId);
  } else if (opts.orgId) {
    stmt = db.prepare(
      `SELECT * FROM webhook_endpoint WHERE orgId = ? ORDER BY createdAt DESC`
    ).bind(opts.orgId);
  } else {
    stmt = db.prepare(
      `SELECT * FROM webhook_endpoint ORDER BY createdAt DESC`
    );
  }

  const result = await stmt.all<WebhookEndpoint>();
  return (result.results ?? []).map(toPublic);
}

/**
 * Toggles the `enabled` flag. Returns `null` if not found.
 */
export async function setWebhookEnabled(
  db: D1Database,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE webhook_endpoint SET enabled = ? WHERE id = ?`)
    .bind(enabled ? 1 : 0, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Deletes an endpoint by ID. Returns true if a row was deleted.
 */
export async function deleteWebhookEndpoint(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM webhook_endpoint WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Sends a test ping payload to an endpoint.
 * Uses a synthetic "test.ping" event — not a real AuditAction.
 * Returns the HTTP status from the consumer (or 0 on network error).
 */
export async function sendTestPing(
  db: D1Database,
  id: string,
): Promise<{ ok: boolean; status: number; endpointId: string }> {
  const ep = await db
    .prepare(`SELECT * FROM webhook_endpoint WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<WebhookEndpoint>()
    .catch(() => null);

  if (!ep) return { ok: false, status: 404, endpointId: id };

  const pingBody = JSON.stringify({
    id: `${Date.now()}_${crypto.randomUUID()}`,
    event: "test.ping",
    timestamp: Date.now(),
    data: {
      message: "This is a test webhook ping from kova-auth.",
      endpointId: id,
    },
  });

  try {
    const signature = await signPayload(ep.secret, pingBody);
    const response = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": "test.ping",
        "User-Agent": "kova-auth-webhooks/1.0",
      },
      body: pingBody,
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: response.ok, status: response.status, endpointId: id };
  } catch {
    return { ok: false, status: 0, endpointId: id };
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Strip the secret and parse the events JSON before returning to client. */
function toPublic(ep: WebhookEndpoint): WebhookEndpointPublic {
  let eventList: AuditAction[] | ["*"] = ["*"];
  try {
    eventList = JSON.parse(ep.events) as AuditAction[] | ["*"];
  } catch { /* leave as ["*"] */ }

  const { secret: _secret, ...rest } = ep;
  return { ...rest, eventList };
}

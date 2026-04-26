/**
 * subdomain.ts — Host-header parsing and slug→Application resolver.
 *
 * Used by the worker's pre-route middleware to detect and dispatch requests
 * arriving on auth subdomains (*.auth.115jon.site or custom_domain aliases).
 *
 * ## Caching strategy
 *
 * Slug lookups happen on every subdomain request. We use a KV write-through
 * cache (5-minute TTL) to avoid hitting D1 on every request:
 *
 *   KV key: `slug:{auth_slug}`     → serialised Application JSON (5 min TTL)
 *   KV key: `domain:{host}`        → serialised Application JSON (5 min TTL)
 *
 * Cache is invalidated (fire-and-forget KV.delete) by:
 *   - updateApplication() — clears both slug and domain keys
 *   - deleteApplication() — clears slug key
 *
 * ## Resolution order
 *
 *  1. Extract hostname from the `Host` header
 *  2. If host === baseHost (root domain) → return null (not a subdomain)
 *  3. If host ends with `.{baseHost}` → extract the leading slug label
 *  4. KV cache lookup (slug or domain key)
 *  5. D1 lookup (auth_slug column or custom_domain column)
 *  6. Populate KV cache; return Application or null
 */

import { type Application, type AppRow, rowToApp } from "../applications";



// ── Constants ──────────────────────────────────────────────────────────────────

/** KV TTL for slug → Application cache entries (seconds). */
const SLUG_CACHE_TTL = 5 * 60; // 5 minutes

/** KV key prefix for slug-based cache entries. */
const SLUG_KEY_PREFIX = "slug:";

/** KV key prefix for custom domain cache entries. */
const DOMAIN_KEY_PREFIX = "domain:";

// ── Host parsing ───────────────────────────────────────────────────────────────

/**
 * Extracts the auth slug from the `Host` header.
 *
 * @param host     - The `Host` header value (e.g. "sdk-demo-abc.auth.115jon.site")
 * @param baseHost - The root auth domain (e.g. "auth.115jon.site")
 * @returns The slug label ("sdk-demo-abc") or null if host is the root domain or unrelated.
 *
 * @example
 * parseAuthSlug("sdk-demo-a1b2c3.auth.115jon.site", "auth.115jon.site") // → "sdk-demo-a1b2c3"
 * parseAuthSlug("auth.115jon.site", "auth.115jon.site")                 // → null (root)
 * parseAuthSlug("evil.example.com", "auth.115jon.site")                 // → null (unrelated)
 */
export function parseAuthSlug(host: string, baseHost: string): string | null {
  // Exact match → root domain, not a subdomain
  if (host === baseHost) return null;

  // Must be a subdomain of baseHost
  const suffix = `.${baseHost}`;
  if (!host.endsWith(suffix)) return null;

  const slug = host.slice(0, host.length - suffix.length);

  // Validate: must be a non-empty DNS label ([a-z0-9-]+)
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;

  return slug;
}

// ── KV helpers ─────────────────────────────────────────────────────────────────

async function kvGet(kv: KVNamespace, key: string): Promise<Application | null> {
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Application;
  } catch {
    return null;
  }
}

function kvPut(kv: KVNamespace, key: string, app: Application): void {
  kv
    .put(key, JSON.stringify(app), { expirationTtl: SLUG_CACHE_TTL })
    .catch(() => { /* fire-and-forget — never block the response */ });
}

// ── Application resolver ───────────────────────────────────────────────────────

/**
 * Result returned by resolveAppByHost.
 * Carries both the resolved Application and the resolved sub-type for logging.
 */
export interface HostedAppContext {
  app: Application;
  /** How the app was resolved: "slug" | "custom_domain" */
  via: "slug" | "custom_domain";
  /** The hostname as received in the Host header */
  host: string;
  /** The auth slug (null for custom_domain resolutions) */
  slug: string | null;
}

/**
 * Resolves the Application for a request arriving on a subdomain or custom domain.
 *
 * Returns null for:
 *  - Requests on the root auth domain (should be handled by normal routing)
 *  - Unknown slugs / custom domains (caller should return a branded 404)
 *
 * @param request  - The incoming fetch Request (Host header is read from here)
 * @param db       - D1 database binding
 * @param kv       - KV namespace binding (used for caching)
 * @param baseHost - Root auth hostname, e.g. "auth.115jon.site"
 */
export async function resolveAppByHost(
  request: Request,
  db: D1Database,
  kv: KVNamespace,
  baseHost: string
): Promise<HostedAppContext | null> {
  const host = request.headers.get("Host") ?? "";
  if (!host) return null;

  // ── 1. Determine if this is a known subdomain ────────────────────────────────
  const slug = parseAuthSlug(host, baseHost);

  if (slug) {
    // ── 2a. Subdomain path: slug → Application ─────────────────────────────────
    const slugKey = `${SLUG_KEY_PREFIX}${slug}`;

    // Tier 0: KV cache
    const cached = await kvGet(kv, slugKey);
    if (cached) return { app: cached, via: "slug", host, slug };

    // Tier 1: D1 lookup by auth_slug
    const row = await db
      .prepare("SELECT * FROM application WHERE auth_slug = ? LIMIT 1")
      .bind(slug)
      .first<Record<string, unknown>>()
      .catch(() => null);

    if (!row) return null;

    const app = rowToApp(row as unknown as AppRow);

    kvPut(kv, slugKey, app);
    return { app, via: "slug", host, slug };
  }

  // ── 2b. Custom domain path: host → Application ─────────────────────────────
  // Only attempt if the host is NOT the baseHost (already handled above)
  // and is NOT a subdomain of baseHost (slug would have matched).
  // This allows fully-custom domains like "login.mycompany.com".
  if (host === baseHost) return null;

  const domainKey = `${DOMAIN_KEY_PREFIX}${host}`;

  // Tier 0: KV cache
  const cached = await kvGet(kv, domainKey);
  if (cached) return { app: cached, via: "custom_domain", host, slug: null };

  // Tier 1: D1 lookup by custom_domain
  const row = await db
    .prepare("SELECT * FROM application WHERE custom_domain = ? LIMIT 1")
    .bind(host)
    .first<Record<string, unknown>>()
    .catch(() => null);

  if (!row) return null;

  const app = rowToApp(row as unknown as AppRow);

  kvPut(kv, domainKey, app);
  return { app, via: "custom_domain", host, slug: null };
}

// ── Cache invalidation helpers ─────────────────────────────────────────────────

/**
 * Removes the KV cache entry for a slug.
 * Call from updateApplication() and deleteApplication().
 * Fire-and-forget: never awaited in critical paths.
 */
export function invalidateSlugCache(kv: KVNamespace, slug: string | null | undefined): void {
  if (!slug) return;
  kv.delete(`${SLUG_KEY_PREFIX}${slug}`).catch(() => { });
}

/**
 * Removes the KV cache entry for a custom domain.
 * Call from updateApplication() when custom_domain changes.
 */
export function invalidateDomainCache(kv: KVNamespace, domain: string | null | undefined): void {
  if (!domain) return;
  kv.delete(`${DOMAIN_KEY_PREFIX}${domain}`).catch(() => { });
}

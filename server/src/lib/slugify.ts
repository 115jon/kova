/**
 * slugify.ts — URL-safe slug generation for auth subdomains.
 *
 * Auth slugs are used as the hostname component of per-app auth subdomains:
 *   {slug}.auth.115jon.site
 *
 * Rules (RFC 1035 DNS label compliance):
 *   - Lowercase alphanumeric + hyphens only: /^[a-z0-9-]+$/
 *   - Max 63 characters (DNS label limit)
 *   - Cannot start or end with a hyphen
 *   - 6-character random suffix appended (Web Crypto, no deps) to guarantee
 *     uniqueness even when multiple apps share the same name.
 *
 * Slugs are IMMUTABLE after creation. The random suffix means even renaming the
 * app display name does not change the slug — this is intentional.
 */

// ── Slug generator ──────────────────────────────────────────────────────────────

/**
 * Converts an app name into a DNS-safe slug prefix.
 * e.g. "My SDK Demo!" → "my-sdk-demo"
 *
 * Steps:
 *  1. Lowercase everything
 *  2. Replace any non-alphanumeric character (except hyphens) with a hyphen
 *  3. Collapse multiple consecutive hyphens into one
 *  4. Trim leading/trailing hyphens
 *  5. Truncate to 50 chars to leave room for "-" + 6-char suffix
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // non-alphanum → hyphen
    .replace(/-{2,}/g, "-")         // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "")        // trim leading/trailing hyphens
    .slice(0, 50)                   // leave room for suffix
    || "app";                       // fallback for edge cases (e.g. name = "!!!")
}

/**
 * Generates 6 cryptographically random lowercase alphanumeric characters.
 * Uses Web Crypto API (available in all Cloudflare Workers runtimes).
 * Character set: [a-z0-9] (36 chars) — avoids ambiguous chars (l/1/0/o).
 */
export function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(9)); // oversample for uniform distribution
  let result = "";
  for (const b of bytes) {
    if (result.length >= 6) break;
    // Rejection sampling: skip values that would skew distribution
    const max = Math.floor(256 / chars.length) * chars.length;
    if (b < max) result += chars[b % chars.length];
  }
  // Fallback: fill any remaining chars if rejection removed too many
  while (result.length < 6) {
    result += chars[(crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) % chars.length];
  }
  return result;
}

/**
 * Generates a complete auth slug for an application.
 *
 * Format: `{slugifiedName}-{6-char-random}`
 * Example: "My SDK Demo" → "my-sdk-demo-a1b2c3"
 *
 * The DNS label is guaranteed to:
 *  - Be ≤ 63 characters
 *  - Contain only [a-z0-9-]
 *  - Not start or end with a hyphen
 */
export function generateAuthSlug(appName: string): string {
  const prefix = slugifyName(appName);
  const suffix = randomSuffix();
  const slug = `${prefix}-${suffix}`;
  // Final safety clamp — should never exceed 63 given the 50-char prefix truncation
  return slug.slice(0, 63);
}

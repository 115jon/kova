/**
 * Fixed-window counters for Kova's own routes, kept in the same D1
 * `rateLimit` table Better Auth uses (it needs atomic increments, which KV
 * cannot do). Keys are prefixed `kova:` so they never meet Better Auth's.
 *
 * One upsert per call: the check and the increment are a single statement,
 * so concurrent requests cannot all slip past a stale read.
 *
 * Better Auth prunes this table, deleting rows older than its longest
 * configured window (600s: the device plugin's /device rule). A longer window
 * here would be reset early by that pruner, so windows are capped at 600s.
 */

/** Better Auth's longest rate-limit window; its pruner keeps rows this long. */
export const MAX_WINDOW_SECONDS = 600;

export type RateLimitRule = { windowSeconds: number; max: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export async function consumeRateLimit(
  db: D1Database,
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitResult> {
  if (rule.windowSeconds > MAX_WINDOW_SECONDS) {
    throw new Error(`rate-limit window ${rule.windowSeconds}s exceeds ${MAX_WINDOW_SECONDS}s; Better Auth would prune it early`);
  }
  const windowMs = rule.windowSeconds * 1000;
  const fullKey = `kova:${key}`;
  const row = await db
    .prepare(
      `INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest") VALUES (?1, ?2, 1, ?3)
       ON CONFLICT("key") DO UPDATE SET
         "count" = CASE WHEN ?3 - "lastRequest" >= ?4 THEN 1 ELSE "count" + 1 END,
         "lastRequest" = CASE WHEN ?3 - "lastRequest" >= ?4 THEN ?3 ELSE "lastRequest" END
       RETURNING "count", "lastRequest"`,
    )
    .bind(crypto.randomUUID(), fullKey, now, windowMs)
    .first<{ count: number; lastRequest: number }>();
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const allowed = Number(row.count) <= rule.max;
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((Number(row.lastRequest) + windowMs - now) / 1000));
  return { allowed, retryAfterSeconds };
}

/** The client IP Cloudflare saw, for rate-limit keys and display. */
export function requestIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Real-IP") ?? null;
}

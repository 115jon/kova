/**
 * Audit log retention: rows older than a year are deleted by the daily cron
 * (wrangler.toml [triggers]). Deletes run in bounded batches so one statement
 * never touches more than `batchSize` rows, and one run stops after
 * `maxBatches`; anything left over goes on the next day's run.
 */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export interface PurgeResult {
  cutoff: number;
  deleted: number;
  batches: number;
  /** False when the run hit maxBatches with rows possibly still left. */
  complete: boolean;
}

export async function purgeExpiredAuditLogs(
  db: D1Database,
  options: { now?: number; batchSize?: number; maxBatches?: number } = {},
): Promise<PurgeResult> {
  const cutoff = (options.now ?? Date.now()) - AUDIT_RETENTION_MS;
  const batchSize = options.batchSize ?? 5000;
  const maxBatches = options.maxBatches ?? 40;
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const result = await db
      .prepare("DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE createdAt < ? LIMIT ?)")
      .bind(cutoff, batchSize)
      .run();
    batches += 1;
    const changes = Number(result.meta?.changes ?? 0);
    deleted += changes;
    if (changes < batchSize) return { cutoff, deleted, batches, complete: true };
  }
  return { cutoff, deleted, batches, complete: false };
}

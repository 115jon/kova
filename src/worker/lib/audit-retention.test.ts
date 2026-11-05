import { describe, expect, it } from "vitest";
import { migratedD1 } from "../test-support/d1";
import { AUDIT_RETENTION_MS, purgeExpiredAuditLogs } from "./audit-retention";

const NOW = Date.UTC(2026, 10, 5, 3, 17);

function seed(ages: number[]) {
  const { sqlite, db } = migratedD1();
  const insert = sqlite.prepare("INSERT INTO audit_log (id, userId, actor, action, createdAt) VALUES (?, 'u', 'u', 'user.signIn', ?)");
  ages.forEach((age, index) => insert.run(`${NOW - age}_${index}`, NOW - age));
  const remaining = () => (sqlite.prepare("SELECT createdAt FROM audit_log ORDER BY createdAt").all() as { createdAt: number }[]).map((row) => NOW - row.createdAt);
  return { db, remaining };
}

describe("purgeExpiredAuditLogs", () => {
  it("deletes only rows older than a year", async () => {
    const day = 24 * 60 * 60 * 1000;
    const { db, remaining } = seed([AUDIT_RETENTION_MS + day, AUDIT_RETENTION_MS + 1, AUDIT_RETENTION_MS, AUDIT_RETENTION_MS - 1, day]);

    const result = await purgeExpiredAuditLogs(db, { now: NOW });

    expect(result).toMatchObject({ deleted: 2, complete: true, cutoff: NOW - AUDIT_RETENTION_MS });
    expect(remaining().sort((a, b) => b - a)).toEqual([AUDIT_RETENTION_MS, AUDIT_RETENTION_MS - 1, day]);
  });

  it("works in batches and stops at the batch cap", async () => {
    const old = Array.from({ length: 7 }, (_, index) => AUDIT_RETENTION_MS + 1000 + index);
    const { db, remaining } = seed([...old, 1000]);

    const capped = await purgeExpiredAuditLogs(db, { now: NOW, batchSize: 3, maxBatches: 2 });
    expect(capped).toMatchObject({ deleted: 6, batches: 2, complete: false });
    expect(remaining()).toHaveLength(2);

    const rest = await purgeExpiredAuditLogs(db, { now: NOW, batchSize: 3, maxBatches: 2 });
    expect(rest).toMatchObject({ deleted: 1, batches: 1, complete: true });
    expect(remaining()).toEqual([1000]);
  });
});

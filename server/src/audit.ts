/**
 * Audit Log — thin write helper for the ralph-auth platform.
 *
 * Design decisions:
 * - IDs are generated as `${Date.now()}_${crypto.randomUUID()}` so rows
 *   naturally sort by time even without an ORDER BY, and collisions are
 *   impossible even in parallel requests.
 * - All writes are fire-and-forget (`waitUntil`-friendly): callers should
 *   not await this in hot paths, but the function itself is async so callers
 *   that DO await it get error propagation.
 * - `metadata` is JSON-stringified for D1's TEXT column.
 * - Extra fields (actorName, actorEmail, targetLabel) are denormalised at
 *   write time so the audit log is self-contained — no joins needed for display.
 */

export type AuditAction =
  // Auth
  | "user.signIn"
  | "user.signOut"
  | "user.signUp"
  | "user.passwordChanged"
  | "user.passwordSet"          // OAuth-only user adds a password for the first time
  | "user.emailVerified"
  | "user.avatarUpdated"        // user or admin changed the profile photo
  | "user.fieldsUpdated"        // additional metadata fields updated (self or admin)
  // Two-factor
  | "twoFactor.enabled"
  | "twoFactor.disabled"
  | "twoFactor.challengePassed"
  // API Keys
  | "apiKey.created"
  | "apiKey.revoked"
  | "apiKey.allExpiredDeleted"
  // Sessions
  | "session.revoked"           // admin-initiated revoke
  | "session.revokeAll"         // admin bulk-revoked all other sessions
  | "session.expired"
  // Organization
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "member.invited"
  | "member.joined"             // accepted invitation
  | "member.removed"
  | "member.roleChanged"
  // Admin actions
  | "admin.userBanned"
  | "admin.userUnbanned"
  | "admin.userDeleted"
  | "admin.roleChanged"
  | "admin.passwordReset";      // admin forced password reset email

export interface AuditPayload {
  /** Subject — the user the event is *about* (may differ from actor on admin actions). */
  userId: string;
  /** Organization context — omit for global/personal events. */
  orgId?: string | null;
  /** Who triggered the event — usually same as userId, but is the admin's ID for admin actions. */
  actor: string;
  actorName?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  /** What type of secondary entity was affected, if any. */
  targetType?: "session" | "apiKey" | "member" | "user" | "org" | null;
  targetId?: string | null;
  /** Human-readable label e.g. email address, key prefix, org name. */
  targetLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Any extra structured context to attach to the event. */
  metadata?: Record<string, unknown> | null;
  /** Override createdAt (Unix ms). Defaults to Date.now(). */
  createdAt?: number;
}

/**
 * Write one audit log entry to D1.
 *
 * @example
 * await logAudit(env.DB, {
 *   userId: session.user.id,
 *   actor:  session.user.id,
 *   actorName: session.user.name,
 *   actorEmail: session.user.email,
 *   action: "user.signIn",
 *   ipAddress: request.headers.get("CF-Connecting-IP"),
 *   userAgent: request.headers.get("User-Agent"),
 * });
 */
export async function logAudit(db: D1Database, payload: AuditPayload): Promise<void> {
  const now = payload.createdAt ?? Date.now();
  // Compound ID: sortable by time, unique by UUID suffix.
  const id = `${now}_${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO audit_log
         (id, userId, orgId, actor, actorName, actorEmail,
          action, targetType, targetId, targetLabel,
          ipAddress, userAgent, metadata, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      payload.userId,
      payload.orgId ?? null,
      payload.actor,
      payload.actorName ?? null,
      payload.actorEmail ?? null,
      payload.action,
      payload.targetType ?? null,
      payload.targetId ?? null,
      payload.targetLabel ?? null,
      payload.ipAddress ?? null,
      payload.userAgent ?? null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      now
    )
    .run();
}

/**
 * Query audit logs with cursor-based pagination.
 *
 * @param db - D1 database binding
 * @param opts - filter options
 * @returns `{ logs, nextCursor }` — nextCursor is null when no more rows exist
 */
export async function queryAuditLogs(
  db: D1Database,
  opts: {
    userId?: string;
    orgId?: string;
    action?: string;
    /** Opaque cursor returned from a previous call — pass to fetch the next page. */
    before?: string | null;
    limit?: number;
  }
): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 50, 200);

  // Build WHERE clauses dynamically
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (opts.userId) {
    conditions.push("userId = ?");
    bindings.push(opts.userId);
  }
  if (opts.orgId) {
    conditions.push("orgId = ?");
    bindings.push(opts.orgId);
  }
  if (opts.action) {
    // Support prefix matching: "user" matches "user.signIn", "user.signOut" etc.
    if (opts.action.endsWith(".*")) {
      conditions.push("action LIKE ?");
      bindings.push(opts.action.replace(".*", ".%"));
    } else {
      conditions.push("action = ?");
      bindings.push(opts.action);
    }
  }
  // Cursor: rows created strictly before the cursor's createdAt timestamp
  if (opts.before) {
    const cursorTs = Number(opts.before.split("_")[0]);
    if (!isNaN(cursorTs)) {
      conditions.push("createdAt < ?");
      bindings.push(cursorTs);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // Fetch one extra row to detect if there's a next page
  const stmt = db.prepare(
    `SELECT audit_log.*, "user".image as actorImage
     FROM audit_log
     LEFT JOIN "user" ON audit_log.actor = "user".id
     ${where} ORDER BY audit_log.createdAt DESC LIMIT ?`
  );

  const result = await stmt.bind(...bindings, limit + 1).all<AuditLogRow>();
  const rows = result.results ?? [];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return { logs: page, nextCursor };
}

/** Row shape as returned from D1. */
export interface AuditLogRow {
  id: string;
  userId: string;
  orgId: string | null;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;  // JSON string — parse before returning to client
  createdAt: number;
  actorImage?: string | null;
}

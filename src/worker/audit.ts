/**
 * Audit Log — thin write helper for the kova-auth platform.
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
  | "user.signInFailed"         // wrong password / bad link / failed passkey for a known user
  | "user.passwordChanged"
  | "user.passwordSet"          // OAuth-only user adds a password for the first time
  | "user.emailVerified"
  | "user.avatarUpdated"        // user or admin changed the profile photo
  | "user.wallpaperUpdated"     // user set, replaced, or cleared their wallpaper
  | "user.fieldsUpdated"        // additional metadata fields updated (self or admin)
  // Two-factor
  | "twoFactor.enabled"
  | "twoFactor.disabled"
  | "twoFactor.challengePassed"
  | "twoFactor.challengeFailed"
  // API Keys
  | "apiKey.created"
  | "apiKey.revoked"
  | "apiKey.allExpiredDeleted"
  // Sessions
  | "session.revoked"           // admin-initiated revoke
  | "session.revokeAll"         // admin bulk-revoked all other sessions
  | "session.expired"
  | "session.ended"             // a session row was deleted by something other than a user sign-out
  // App-scoped (SDK) sessions
  | "app.signIn"
  | "app.signOut"
  // Account security
  | "security.signInAlertSent"  // emailed the user about a sign-in from a new device or country
  | "security.signOutEverywhere" // user revoked every session from a sign-in alert's "This wasn't me"
  // Organization
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "member.invited"
  | "member.joined"             // accepted invitation
  | "member.autoJoined"         // auto-joined via domain enrollment
  | "member.removed"
  | "member.roleChanged"
  // Admin actions
  | "admin.userBanned"
  | "admin.userUnbanned"
  | "admin.userDeleted"
  | "admin.roleChanged"
  | "admin.passwordReset"       // admin forced password reset email
  | "admin.userImpersonated"    // admin initiated impersonation session
  | "admin.userLocked"          // admin locked user (soft-lock, no sign-in)
  | "admin.userUnlocked"        // admin unlocked user
  | "admin.userAvatarUpdated"  // admin updated an app member's avatar
  | "device.approved";

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
  /** application.id the event happened in; omit for platform/dashboard events. */
  appId?: string | null;
  country?: string | null;
  city?: string | null;
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
/** Resolves to the new row's id. */
export async function logAudit(db: D1Database, payload: AuditPayload): Promise<string> {
  const now = payload.createdAt ?? Date.now();
  // Compound ID: sortable by time, unique by UUID suffix.
  const id = `${now}_${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO audit_log
         (id, userId, orgId, actor, actorName, actorEmail,
          action, targetType, targetId, targetLabel,
          ipAddress, userAgent, metadata, createdAt,
          appId, country, city)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now,
      payload.appId ?? null,
      payload.country ?? null,
      payload.city ?? null
    )
    .run()
    .catch((error: unknown) => {
      // Callers swallow audit failures so auth never breaks; log here so a
      // systematic failure (e.g. code deployed before migration 0031) shows up.
      console.error("[audit] write failed", payload.action, error);
      throw error;
    });
  return id;
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
    appId?: string;
    action?: string;
    /** Case-insensitive substring of actorEmail, actorName, userId or targetLabel. */
    q?: string;
    /** ISO 3166-1 alpha-2 country code. */
    country?: string;
    /** "failure": failed sign-ins and failed 2FA challenges only. */
    outcome?: "failure";
    /** createdAt >= from (Unix ms). */
    from?: number;
    /** createdAt < to (Unix ms). */
    to?: number;
    /** Opaque cursor returned from a previous call — pass to fetch the next page. */
    before?: string | null;
    limit?: number;
  }
): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 50, 200);

  // Build WHERE clauses dynamically
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  // Columns are qualified: "user" and application both have a createdAt.
  if (opts.userId) {
    conditions.push("audit_log.userId = ?");
    bindings.push(opts.userId);
  }
  if (opts.orgId) {
    conditions.push("audit_log.orgId = ?");
    bindings.push(opts.orgId);
  }
  if (opts.appId) {
    conditions.push("audit_log.appId = ?");
    bindings.push(opts.appId);
  }
  if (opts.action) {
    // Support prefix matching: "user" matches "user.signIn", "user.signOut" etc.
    if (opts.action.endsWith(".*")) {
      conditions.push("audit_log.action LIKE ?");
      bindings.push(opts.action.replace(".*", ".%"));
    } else {
      conditions.push("audit_log.action = ?");
      bindings.push(opts.action);
    }
  }
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    const pattern = `%${q.replace(/[!%_]/g, (char) => `!${char}`)}%`;
    conditions.push(
      "(" + ["actorEmail", "actorName", "userId", "targetLabel"]
        .map((column) => `LOWER(audit_log.${column}) LIKE ? ESCAPE '!'`)
        .join(" OR ") + ")",
    );
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (opts.country) {
    conditions.push("audit_log.country = ?");
    bindings.push(opts.country.toUpperCase());
  }
  if (opts.outcome === "failure") {
    conditions.push(`audit_log.action IN (${FAILURE_ACTIONS.map(() => "?").join(", ")})`);
    bindings.push(...FAILURE_ACTIONS);
  }
  if (opts.from !== undefined && Number.isFinite(opts.from)) {
    conditions.push("audit_log.createdAt >= ?");
    bindings.push(opts.from);
  }
  if (opts.to !== undefined && Number.isFinite(opts.to)) {
    conditions.push("audit_log.createdAt < ?");
    bindings.push(opts.to);
  }
  // Cursor: the last row's id, `${createdAt}_${uuid}`. Rows strictly after it in
  // (createdAt DESC, id DESC) order, so rows sharing a millisecond are neither
  // skipped nor repeated across pages.
  if (opts.before) {
    const cursorTs = Number(opts.before.split("_")[0]);
    if (!isNaN(cursorTs)) {
      conditions.push("(audit_log.createdAt < ? OR (audit_log.createdAt = ? AND audit_log.id < ?))");
      bindings.push(cursorTs, cursorTs, opts.before);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // Fetch one extra row to detect if there's a next page
  const stmt = db.prepare(
    `SELECT audit_log.*, "user".image as actorImage, application.name as appName
     FROM audit_log
     LEFT JOIN "user" ON audit_log.actor = "user".id
     LEFT JOIN application ON audit_log.appId = application.id
     ${where} ORDER BY audit_log.createdAt DESC, audit_log.id DESC LIMIT ?`
  );

  const result = await stmt.bind(...bindings, limit + 1).all<AuditLogRow>();
  const rows = result.results ?? [];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return { logs: page, nextCursor };
}

/** Actions the admin log's "failures" filter shows. */
export const FAILURE_ACTIONS: readonly AuditAction[] = ["user.signInFailed", "twoFactor.challengeFailed"];

/**
 * Filter values for the admin audit log: every app, and the countries and
 * actions that occur since `since` (Unix ms; the retention window).
 */
export async function queryAuditFacets(
  db: D1Database,
  since: number,
): Promise<{ apps: { id: string; name: string }[]; countries: string[]; actions: string[] }> {
  const [apps, countries, actions] = await Promise.all([
    db.prepare("SELECT id, name FROM application ORDER BY name COLLATE NOCASE")
      .all<{ id: string; name: string }>(),
    db.prepare("SELECT DISTINCT country FROM audit_log WHERE country IS NOT NULL AND country != '' AND createdAt >= ? ORDER BY country")
      .bind(since)
      .all<{ country: string }>(),
    db.prepare("SELECT DISTINCT action FROM audit_log WHERE createdAt >= ? ORDER BY action")
      .bind(since)
      .all<{ action: string }>(),
  ]);
  return {
    apps: (apps.results ?? []).map((row) => ({ id: row.id, name: row.name })),
    countries: (countries.results ?? []).map((row) => row.country),
    actions: (actions.results ?? []).map((row) => row.action),
  };
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
  appId: string | null;
  country: string | null;
  city: string | null;
  actorImage?: string | null;
  /** application.name for appId, joined at read time. */
  appName?: string | null;
}

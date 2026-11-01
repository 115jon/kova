/**
 * App-scoped sessions vs the auth-domain SSO cookie.
 *
 * The HttpOnly cookie on the auth host is the identity-platform session.
 * SDK apps mint a sibling row with `app_id` set and use that token as Bearer.
 * Never stamp `app_id` onto the cookie session — that locks the dashboard out
 * (`get-session` without a publishable key rejects any scoped cookie).
 */

export const APP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionExpiryMs(expiresAt: unknown): number | null {
  if (expiresAt instanceof Date) {
    const ms = expiresAt.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt;
  }
  if (typeof expiresAt === "string") {
    const trimmed = expiresAt.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * `session.expiresAt` as epoch milliseconds, for SQL that compares it to a
 * number. Better Auth writes integers, but insertAppScopedSession writes ISO
 * text, and SQLite sorts every TEXT value above every INTEGER, so a bare
 * `expiresAt > ?` counts expired app sessions as live forever. The SQL twin of
 * sessionExpiryMs.
 */
export function sessionExpiresAtMs(column = "expiresAt"): string {
  return `(CASE WHEN typeof(${column}) = 'text' THEN CAST(strftime('%s', ${column}) AS INTEGER) * 1000 ELSE ${column} END)`;
}

export function isSessionUnexpired(expiresAt: unknown, now = Date.now()): boolean {
  const ms = sessionExpiryMs(expiresAt);
  return ms !== null && ms > now;
}

export function dashboardCanUseCookieSession(
  sessionAppId: string | null | undefined,
): boolean {
  return sessionAppId == null || sessionAppId === "";
}

export function sdkCookieProvesIdentity(
  _sessionAppId: string | null | undefined,
): boolean {
  return true;
}

export function appSessionTimestampValues(now = Date.now()): {
  now: number;
  expiresAt: number;
  expiresAtIso: string;
  createdAtIso: string;
} {
  const expiresAt = now + APP_SESSION_TTL_MS;
  return {
    now,
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
    createdAtIso: new Date(now).toISOString(),
  };
}

export type AppSessionRow = {
  id: string;
  userId: string;
  token: string;
  expiresAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  activeOrganizationId: string | null;
  app_id: string;
};

export function pickActiveAppSession<T extends { expiresAt: unknown }>(
  rows: T[],
  now = Date.now(),
): T | null {
  return rows.find((row) => isSessionUnexpired(row.expiresAt, now)) ?? null;
}

const APP_SESSION_COLUMNS =
  "id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, activeOrganizationId, app_id";

/**
 * The app session for this browser. `parentSessionId` is the caller's own
 * session (normally the auth-domain cookie). Only a session minted for that
 * parent is reused, so two browsers signed in as the same user get different
 * tokens, and revoking one leaves the other alone. Rows with no parent (minted
 * before parent tracking, or standalone device and native tokens) are never
 * handed to a caller. A caller already holding this app's session gets it back.
 *
 * Returns null when the caller's session is gone from the database (a revoked
 * session can still pass getSession for the life of its cookie cache), belongs
 * to someone else, or has expired. Fails closed on a database error.
 */
export async function resolveAppScopedSession(
  db: D1Database,
  input: {
    userId: string;
    appId: string;
    parentSessionId: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
): Promise<AppSessionRow | null> {
  const caller = await db
    .prepare(`SELECT ${APP_SESSION_COLUMNS} FROM session WHERE id = ? LIMIT 1`)
    .bind(input.parentSessionId)
    .first<Omit<AppSessionRow, "app_id"> & { app_id: string | null }>()
    .catch(() => null);
  if (!caller || caller.userId !== input.userId || !isSessionUnexpired(caller.expiresAt)) {
    return null;
  }
  if (caller.app_id === input.appId) return caller as AppSessionRow;

  const existing = await db
    .prepare(
      `SELECT ${APP_SESSION_COLUMNS}
       FROM session
       WHERE parent_session_id = ? AND userId = ? AND app_id = ?
       ORDER BY createdAt DESC
       LIMIT 20`,
    )
    .bind(input.parentSessionId, input.userId, input.appId)
    .all<AppSessionRow>()
    .then((r) => r.results)
    .catch(() => [] as AppSessionRow[]);

  const active = pickActiveAppSession(existing);
  if (active?.token) return active;

  const { generateId } = await import("better-auth");
  const sessionId = generateId();
  const token = generateId(32);
  await insertAppScopedSession(db, {
    sessionId,
    userId: input.userId,
    token,
    appId: input.appId,
    parentSessionId: input.parentSessionId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  const stamps = appSessionTimestampValues();
  return {
    id: sessionId,
    userId: input.userId,
    token,
    expiresAt: stamps.expiresAtIso,
    createdAt: stamps.createdAtIso,
    updatedAt: stamps.createdAtIso,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    activeOrganizationId: null,
    app_id: input.appId,
  };
}

/**
 * `parentSessionId` is the browser session the token is for, so that browser
 * can reuse it. Leave it null for a token that leaves the browser (device-code
 * approval, native-app handoff): it is then standalone and never reused.
 * Signing the parent out does not revoke its app sessions: sign-out is per app
 * (POST /:pk/revoke-session deletes exactly the token presented).
 */
export async function insertAppScopedSession(
  db: D1Database,
  input: {
    sessionId: string;
    userId: string;
    token: string;
    appId: string;
    parentSessionId?: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    now?: number;
  },
): Promise<void> {
  const stamps = appSessionTimestampValues(input.now);
  await db
    .prepare(
      `INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, app_id, parent_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.sessionId,
      input.userId,
      input.token,
      stamps.expiresAtIso,
      stamps.createdAtIso,
      stamps.createdAtIso,
      input.ipAddress,
      input.userAgent,
      input.appId,
      input.parentSessionId ?? null,
    )
    .run();
}

/**
 * Better Auth's bearer plugin accepts any session token, including one minted
 * for another app. Only a platform session (no app_id) or this app's own session
 * may act for `appId`. Fails closed.
 */
export async function sessionMayActForApp(
  db: D1Database,
  sessionId: string,
  appId: string,
): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT app_id FROM session WHERE id = ? LIMIT 1")
      .bind(sessionId)
      .first<{ app_id: string | null }>();
    return row ? !row.app_id || row.app_id === appId : false;
  } catch {
    return false;
  }
}

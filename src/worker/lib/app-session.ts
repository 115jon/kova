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

export async function resolveAppScopedSession(
  db: D1Database,
  input: {
    userId: string;
    appId: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
): Promise<AppSessionRow> {
  const existing = await db
    .prepare(
      `SELECT id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, activeOrganizationId, app_id
       FROM session
       WHERE userId = ? AND app_id = ?
       ORDER BY createdAt DESC
       LIMIT 20`,
    )
    .bind(input.userId, input.appId)
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

export async function insertAppScopedSession(
  db: D1Database,
  input: {
    sessionId: string;
    userId: string;
    token: string;
    appId: string;
    ipAddress: string | null;
    userAgent: string | null;
    now?: number;
  },
): Promise<void> {
  const stamps = appSessionTimestampValues(input.now);
  await db
    .prepare(
      `INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, app_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();
}

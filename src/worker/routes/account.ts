/**
 * End-user account API: a signed-in user's own security activity and sessions.
 * One handler set, two mounts, each bringing its own authentication:
 *
 *   {AUTH_URL}/api/pub/apps/:pk/account/*   SDK apps, app bearer token or cookie (routes/pub/apps.ts)
 *   https://{slug}.auth.<base>/api/account/* hosted account page, subdomain cookie (routes/hosted-auth.ts)
 *
 *   GET  /activity?before=&limit=   → { events: AccountEvent[], nextCursor }
 *   GET  /sessions                  → { sessions: AccountSession[] }
 *   POST /sessions/revoke {sessionId} → { ok: true }            (404 if not the caller's)
 *   POST /sessions/revoke-others    → { ok: true, revoked }
 *
 * Only the caller's rows, ever. Responses carry no IP addresses and no tokens.
 */
import { type Context, Hono } from "hono";
import { logAudit } from "../audit";
import { sessionExpiresAtMs, sessionExpiryMs } from "../lib/app-session";
import { describeClient, geoFromCf, requestMeta } from "../lib/audit-context";
import { consumeRateLimit } from "../lib/rate-limit";
import { revokeUserSessions } from "../lib/session-revoke";
import { notTwoFactorPendingSql } from "../lib/sign-in-alert";

export interface AccountCaller {
  userId: string;
  /** The session making the request. */
  sessionId: string;
}

export interface AccountClient {
  browser?: string;
  os?: string;
  platform?: string;
  inApp?: string | null;
}

export interface AccountEvent {
  id: string;
  action: string;
  createdAt: number;
  appName: string | null;
  country: string | null;
  city: string | null;
  client: AccountClient | null;
}

export interface AccountSession {
  id: string;
  /** null: a Kova browser session (no app). */
  appName: string | null;
  current: boolean;
  createdAt: number;
  lastActiveAt: number;
  country: string | null;
  city: string | null;
  client: AccountClient | null;
}

/** What a user sees of their own audit trail. */
export const ACCOUNT_ACTIVITY_ACTIONS = [
  "user.signIn",
  "user.signOut",
  "app.signIn",
  "app.signOut",
  "user.signInFailed",
  "user.passwordChanged",
  "user.passwordSet",
  "user.emailVerified",
  "twoFactor.enabled",
  "twoFactor.disabled",
  "twoFactor.challengeFailed",
  "session.revoked",
  "session.revokeAll",
  "security.signOutEverywhere",
  "security.signInAlertSent",
] as const;

const WRITE_LIMIT = { windowSeconds: 60, max: 10 };

/** Only the display fields of a stored client description. */
export function accountClient(value: unknown): AccountClient | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const client: AccountClient = {};
  if (typeof record.browser === "string") client.browser = record.browser;
  if (typeof record.os === "string") client.os = record.os;
  if (typeof record.platform === "string") client.platform = record.platform;
  if (typeof record.inApp === "string" || record.inApp === null) client.inApp = record.inApp as string | null;
  return Object.keys(client).length ? client : null;
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Cursor = the last row's id, `${createdAt}_${uuid}` (audit.ts); compared as (createdAt, id). */
function parseCursor(before: string | undefined): { createdAt: number; id: string } | null {
  if (!before) return null;
  const createdAt = Number(before.split("_")[0]);
  return Number.isFinite(createdAt) ? { createdAt, id: before } : null;
}

export async function listAccountActivity(
  db: D1Database,
  userId: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ events: AccountEvent[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20) || 20, 1), 50);
  const cursor = parseCursor(options.before);
  const actions = ACCOUNT_ACTIVITY_ACTIONS.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT audit_log.id, audit_log.action, audit_log.createdAt, audit_log.country, audit_log.city,
              CASE WHEN json_valid(audit_log.metadata) THEN json_extract(audit_log.metadata, '$.client') END AS client,
              COALESCE(application.display_name, application.name) AS appName
       FROM audit_log
       LEFT JOIN application ON application.id = audit_log.appId
       WHERE audit_log.userId = ? AND audit_log.action IN (${actions})
         AND ${notTwoFactorPendingSql("audit_log.metadata")}
         ${cursor ? "AND (audit_log.createdAt < ? OR (audit_log.createdAt = ? AND audit_log.id < ?))" : ""}
       ORDER BY audit_log.createdAt DESC, audit_log.id DESC
       LIMIT ?`,
    )
    .bind(
      userId,
      ...ACCOUNT_ACTIVITY_ACTIONS,
      ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
      limit + 1,
    )
    .all<{ id: string; action: string; createdAt: number; country: string | null; city: string | null; client: string | null; appName: string | null }>()
    .then((result) => result.results ?? []);

  const page = rows.slice(0, limit);
  return {
    events: page.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: Number(row.createdAt),
      appName: row.appName ?? null,
      country: row.country ?? null,
      city: row.city ?? null,
      client: accountClient(parseJson(row.client)),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function listAccountSessions(
  db: D1Database,
  caller: AccountCaller,
  now = Date.now(),
): Promise<AccountSession[]> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.createdAt, s.updatedAt, s.country, s.city, s.userAgent,
              COALESCE(a.display_name, a.name) AS appName
       FROM session s
       LEFT JOIN application a ON a.id = s.app_id
       WHERE s.userId = ? AND ${sessionExpiresAtMs("s.expiresAt")} > ?`,
    )
    .bind(caller.userId, now)
    .all<{ id: string; createdAt: unknown; updatedAt: unknown; country: string | null; city: string | null; userAgent: string | null; appName: string | null }>()
    .then((result) => result.results ?? []);

  return rows
    .map((row) => {
      const createdAt = sessionExpiryMs(row.createdAt) ?? 0;
      return {
        id: row.id,
        appName: row.appName ?? null,
        current: row.id === caller.sessionId,
        createdAt,
        lastActiveAt: sessionExpiryMs(row.updatedAt) ?? createdAt,
        country: row.country ?? null,
        city: row.city ?? null,
        client: row.userAgent ? accountClient(describeClient(row.userAgent)) : null,
      };
    })
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Audit row for something the user did to their own sessions. */
async function logSessionAction(
  db: D1Database,
  request: Request,
  caller: AccountCaller,
  entry: { action: "session.revoked" | "session.revokeAll"; targetId?: string; metadata: Record<string, unknown> },
): Promise<void> {
  try {
    const user = await db
      .prepare('SELECT name, email FROM "user" WHERE id = ? LIMIT 1')
      .bind(caller.userId)
      .first<{ name: string | null; email: string | null }>();
    const { ipAddress, userAgent } = requestMeta(request);
    const geo = geoFromCf(request.cf as IncomingRequestCfProperties | undefined);
    await logAudit(db, {
      userId: caller.userId,
      actor: caller.userId,
      actorName: user?.name ?? null,
      actorEmail: user?.email ?? null,
      action: entry.action,
      targetType: "session",
      targetId: entry.targetId ?? null,
      ipAddress,
      userAgent,
      country: geo.country ?? null,
      city: geo.city ?? null,
      metadata: { ...entry.metadata, client: describeClient(userAgent) },
    });
  } catch {
    // Audit is best-effort; the sessions are already revoked.
  }
}

async function rateLimited(db: D1Database, userId: string): Promise<Response | null> {
  // Fails open: refusing a user who is locking an attacker out is worse.
  const limit = await consumeRateLimit(db, `account-write:${userId}`, WRITE_LIMIT).catch(() => null);
  if (!limit || limit.allowed) return null;
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
  );
}

/**
 * The account routes over a mount's own authentication. `authenticate`
 * returns the caller, or the Response to send instead (401, 403, 404).
 */
export function createAccountRouter<E extends { Bindings: Env }>(
  authenticate: (c: Context<E>) => Promise<AccountCaller | Response>,
): Hono<E> {
  const router = new Hono<E>();

  router.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  router.get("/activity", async (c) => {
    const caller = await authenticate(c);
    if (caller instanceof Response) return caller;
    const limit = c.req.query("limit");
    return c.json(await listAccountActivity(c.env.DB, caller.userId, {
      before: c.req.query("before") || undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  });

  router.get("/sessions", async (c) => {
    const caller = await authenticate(c);
    if (caller instanceof Response) return caller;
    return c.json({ sessions: await listAccountSessions(c.env.DB, caller) });
  });

  router.post("/sessions/revoke", async (c) => {
    const caller = await authenticate(c);
    if (caller instanceof Response) return caller;
    const limited = await rateLimited(c.env.DB, caller.userId);
    if (limited) return limited;

    const body = (await c.req.json().catch(() => null)) as { sessionId?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

    const row = await c.env.DB
      .prepare("SELECT id, app_id FROM session WHERE id = ? AND userId = ? LIMIT 1")
      .bind(sessionId, caller.userId)
      .first<{ id: string; app_id: string | null }>();
    if (!row) return c.json({ error: "not_found" }, 404);

    const revoked = await revokeUserSessions(c.env, caller.userId, { only: row.id });
    if (!revoked) return c.json({ error: "not_found" }, 404);
    await logSessionAction(c.env.DB, c.req.raw, caller, {
      action: "session.revoked",
      targetId: row.id,
      metadata: { by: "user", sessionId: row.id, appId: row.app_id, current: row.id === caller.sessionId },
    });
    return c.json({ ok: true });
  });

  router.post("/sessions/revoke-others", async (c) => {
    const caller = await authenticate(c);
    if (caller instanceof Response) return caller;
    const limited = await rateLimited(c.env.DB, caller.userId);
    if (limited) return limited;

    const revoked = await revokeUserSessions(c.env, caller.userId, { except: caller.sessionId });
    await logSessionAction(c.env.DB, c.req.raw, caller, {
      action: "session.revokeAll",
      metadata: { by: "user", revoked, keptSessionId: caller.sessionId },
    });
    return c.json({ ok: true, revoked });
  });

  return router;
}

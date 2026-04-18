/**
 * routes/apps/users.ts — Per-app user management API.
 *
 * Mounted at: /api/admin/apps/:appId/users
 *
 * All routes require admin role. Manages the app_user join table — these
 * operations affect a user's *membership* in a specific application only.
 * Removing a user here does NOT delete the global Better Auth user row.
 *
 * Routes:
 *   GET    /                      → paginated list of app members
 *   GET    /:userId               → single member detail
 *   POST   /:userId/ban           → global ban (sets user.banned = 1)
 *   POST   /:userId/unban         → remove global ban
 *   POST   /:userId/role          → change role within this app
 *   DELETE /:userId               → remove from app (not a global delete)
 *   GET    /stats (via parent)    → handled in apps.ts
 */

import { Hono } from "hono";
import { createAuth } from "../../auth";
import { hasAdminRole } from "../../lib/roles";

const appUsersRouter = new Hono<{ Bindings: Env }>();

// ── Auth guard ─────────────────────────────────────────────────────────────────

async function requireAdmin(c: { req: { raw: Request }; env: Env }) {
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !hasAdminRole((session.user as { role?: string }).role)) {
    return null;
  }
  return session;
}

// ── GET / — paginated member list ─────────────────────────────────────────────

appUsersRouter.get("/", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const appId = c.req.param("appId") as string;  // always defined when mounted under /:appId/users
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = (page - 1) * limit;
  const search = c.req.query("search") ?? "";
  const role = c.req.query("role") ?? "";

  const searchPat = `%${search}%`;

  const query = `
    SELECT
      au.id       AS membershipId,
      au.user_id  AS userId,
      au.role,
      au.joined_at AS joinedAt,
      u.name,
      u.email,
      u.image,
      u.banned,
      u.emailVerified,
      (SELECT COUNT(*) FROM session s WHERE s.userId = u.id AND s.app_id = ?) AS sessionCount
    FROM app_user au
    JOIN "user" u ON u.id = au.user_id
    WHERE au.app_id = ?
      ${search ? "AND (u.email LIKE ? OR u.name LIKE ?)" : ""}
      ${role ? "AND au.role = ?" : ""}
    ORDER BY au.joined_at DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM app_user au
    JOIN "user" u ON u.id = au.user_id
    WHERE au.app_id = ?
      ${search ? "AND (u.email LIKE ? OR u.name LIKE ?)" : ""}
      ${role ? "AND au.role = ?" : ""}
  `;

  const baseList: (string | number)[] = [appId, appId];
  if (search) baseList.push(searchPat, searchPat);
  if (role) baseList.push(role);
  const listBindings = [...baseList, limit, offset];

  const countBindings: (string | number)[] = [appId];
  if (search) countBindings.push(searchPat, searchPat);
  if (role) countBindings.push(role);

  const [listResult, countResult] = await c.env.DB.batch([
    c.env.DB.prepare(query).bind(...listBindings),
    c.env.DB.prepare(countQuery).bind(...countBindings),
  ]);

  const members = (listResult?.results ?? []) as Record<string, unknown>[];
  const total = ((countResult?.results?.[0] as { total?: number } | undefined)?.total) ?? 0;

  return Response.json({
    members,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ── GET /:userId — single member detail ───────────────────────────────────────

appUsersRouter.get("/:userId", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");

  const row = await c.env.DB
    .prepare(`
      SELECT
        au.id AS membershipId, au.role, au.joined_at AS joinedAt,
        u.id AS userId, u.name, u.email, u.image, u.banned, u.banReason,
        u.emailVerified, u.createdAt,
        (SELECT COUNT(*) FROM session s WHERE s.userId = u.id AND s.app_id = ?1) AS sessionCount,
        (SELECT COUNT(*) FROM session s WHERE s.userId = u.id AND s.app_id = ?1
           AND s.expiresAt > ?3) AS activeSessions
      FROM app_user au
      JOIN "user" u ON u.id = au.user_id
      WHERE au.app_id = ?1 AND au.user_id = ?2
      LIMIT 1
    `)
    .bind(appId, userId, Date.now())
    .first<Record<string, unknown>>();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ member: row });
});

// ── POST /:userId/ban ─────────────────────────────────────────────────────────

appUsersRouter.post("/:userId/ban", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = c.req.param();
  const body = await c.req.raw.json().catch(() => ({})) as { reason?: string };

  await c.env.DB
    .prepare(`UPDATE "user" SET banned = 1, banReason = ?, updatedAt = ? WHERE id = ?`)
    .bind(body.reason ?? "Banned by admin", Date.now(), userId)
    .run();

  // Revoke all active sessions for this user
  await c.env.DB
    .prepare(`DELETE FROM session WHERE userId = ?`)
    .bind(userId)
    .run();

  return Response.json({ ok: true });
});

// ── POST /:userId/unban ───────────────────────────────────────────────────────

appUsersRouter.post("/:userId/unban", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = c.req.param();

  await c.env.DB
    .prepare(`UPDATE "user" SET banned = 0, banReason = NULL, updatedAt = ? WHERE id = ?`)
    .bind(Date.now(), userId)
    .run();

  return Response.json({ ok: true });
});

// ── POST /:userId/role ────────────────────────────────────────────────────────

appUsersRouter.post("/:userId/role", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");
  const body = await c.req.raw.json().catch(() => ({})) as { role?: string };
  const newRole = body.role;

  if (!newRole || !["owner", "admin", "member"].includes(newRole)) {
    return Response.json({ error: "role must be one of: owner, admin, member" }, { status: 400 });
  }

  const result = await c.env.DB
    .prepare(`UPDATE app_user SET role = ? WHERE app_id = ? AND user_id = ?`)
    .bind(newRole, appId, userId)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  return Response.json({ ok: true, role: newRole });
});

// ── DELETE /:userId — remove from app (not global delete) ─────────────────────

appUsersRouter.delete("/:userId", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");

  await c.env.DB
    .prepare(`DELETE FROM app_user WHERE app_id = ? AND user_id = ?`)
    .bind(appId, userId)
    .run();

  return Response.json({ ok: true });
});

export { appUsersRouter };


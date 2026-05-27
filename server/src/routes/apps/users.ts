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
import { isFileLike } from "../../lib/cdn";

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

// ── GET /:userId/detail — rich member detail ───────────────────────────────────
//
// Returns the member row, linked OAuth accounts, recent audit activity,
// active session count, and a 365-day activity histogram for the heatmap.

appUsersRouter.get("/:userId/detail", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");
  const nowMs = Date.now();
  const yearAgoMs = nowMs - 365 * 24 * 60 * 60 * 1000;

  // Member + user row
  const member = await c.env.DB
    .prepare(`
      SELECT
        au.id AS membershipId, au.role, au.joined_at AS joinedAt,
        u.id AS userId, u.name, u.email, u.image, u.banned, u.banReason,
        u.emailVerified, u.createdAt, u.updatedAt, u.username
      FROM app_user au
      JOIN "user" u ON u.id = au.user_id
      WHERE au.app_id = ? AND au.user_id = ?
      LIMIT 1
    `)
    .bind(appId, userId)
    .first<Record<string, unknown>>();

  if (!member) return Response.json({ error: "Not found" }, { status: 404 });

  // Linked OAuth accounts
  const accounts = await c.env.DB
    .prepare(`SELECT id, providerId, accountId, createdAt FROM account WHERE userId = ? ORDER BY createdAt ASC`)
    .bind(userId)
    .all<{ id: string; providerId: string; accountId: string; createdAt: number }>();

  // Active sessions for this app
  const sessionsRow = await c.env.DB
    .prepare(`SELECT COUNT(*) as count FROM session WHERE userId = ? AND app_id = ? AND expiresAt > ?`)
    .bind(userId, appId, nowMs)
    .first<{ count: number }>();

  // Recent audit activity (last 15 entries)
  const activityRows = await c.env.DB
    .prepare(`
      SELECT id, action, actorName, actorEmail, ipAddress, userAgent, metadata, createdAt
      FROM audit_log
      WHERE userId = ?
      ORDER BY createdAt DESC
      LIMIT 15
    `)
    .bind(userId)
    .all<{
      id: string; action: string; actorName: string | null; actorEmail: string | null;
      ipAddress: string | null; userAgent: string | null; metadata: string | null; createdAt: number;
    }>();

  // 365-day activity histogram: { "YYYY-MM-DD": count }
  const histRows = await c.env.DB
    .prepare(`
      SELECT
        strftime('%Y-%m-%d', datetime(createdAt / 1000, 'unixepoch')) AS day,
        COUNT(*) AS count
      FROM audit_log
      WHERE userId = ? AND createdAt >= ?
      GROUP BY day
    `)
    .bind(userId, yearAgoMs)
    .all<{ day: string; count: number }>();

  const activityHist: Record<string, number> = {};
  for (const row of histRows.results ?? []) {
    activityHist[row.day] = row.count;
  }

  const recentActivity = (activityRows.results ?? []).map(r => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));

  return Response.json({
    member: {
      ...member,
      emailVerified: Boolean(member.emailVerified),
      banned: Boolean(member.banned),
    },
    accounts: accounts.results ?? [],
    activeSessionCount: sessionsRow?.count ?? 0,
    recentActivity,
    activityHist,
  });
});

// ── POST /:userId/avatar — upload avatar for an app member ─────────────────────

appUsersRouter.post("/:userId/avatar", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");

  // Verify membership
  const member = await c.env.DB
    .prepare(`SELECT u.id, u.email, u.image FROM app_user au JOIN "user" u ON u.id = au.user_id WHERE au.app_id = ? AND au.user_id = ? LIMIT 1`)
    .bind(appId, userId)
    .first<{ id: string; email: string; image: string | null }>();
  if (!member) return Response.json({ error: "Not found" }, { status: 404 });

  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!isFileLike(file)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!ALLOWED.includes(file.type)) return Response.json({ error: "Only JPEG, PNG, WebP or GIF accepted" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Image must be <= 10 MB" }, { status: 400 });

  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const cdnKey = `avatars/${userId}/${uploadId}.webp`;

  const cdnForm = new FormData();
  cdnForm.append("file", new File([await file.arrayBuffer()], "avatar.webp", { type: file.type }));
  cdnForm.append("app", "kova-auth");
  cdnForm.append("key", cdnKey);
  cdnForm.append("uploader", session.user.id);
  cdnForm.append("tags", "avatar");
  cdnForm.append("cacheControl", "immutable");

  const cdnRes = await fetch(`${c.env.CDN_URL}/upload`, {
    method: "POST",
    headers: { "CDN-API-Key": c.env.CDN_API_KEY },
    body: cdnForm,
  });
  if (!cdnRes.ok) {
    const detail = await cdnRes.text().catch(() => "");
    return Response.json({ error: `CDN upload failed: ${detail}` }, { status: 502 });
  }
  const { url: imageUrl } = (await cdnRes.json()) as { url: string };

  // Delete old avatar from CDN if it was ours
  if (member.image?.startsWith(c.env.CDN_URL)) {
    const oldKey = member.image.replace(`${c.env.CDN_URL}/`, "").split("?")[0];
    fetch(`${c.env.CDN_URL}/files/${oldKey}`, { method: "DELETE", headers: { "CDN-API-Key": c.env.CDN_API_KEY } }).catch(() => {});
  }

  await c.env.DB.prepare(`UPDATE "user" SET image = ?, updatedAt = ? WHERE id = ?`).bind(imageUrl, Date.now(), userId).run();

  return Response.json({ imageUrl });
});

// ── DELETE /:userId/avatar — remove avatar ─────────────────────────────────────

appUsersRouter.delete("/:userId/avatar", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");

  const member = await c.env.DB
    .prepare(`SELECT u.image FROM app_user au JOIN "user" u ON u.id = au.user_id WHERE au.app_id = ? AND au.user_id = ? LIMIT 1`)
    .bind(appId, userId)
    .first<{ image: string | null }>();
  if (!member) return Response.json({ error: "Not found" }, { status: 404 });

  if (member.image?.startsWith(c.env.CDN_URL)) {
    const oldKey = member.image.replace(`${c.env.CDN_URL}/`, "").split("?")[0];
    fetch(`${c.env.CDN_URL}/files/${oldKey}`, { method: "DELETE", headers: { "CDN-API-Key": c.env.CDN_API_KEY } }).catch(() => {});
  }

  await c.env.DB.prepare(`UPDATE "user" SET image = NULL, updatedAt = ? WHERE id = ?`).bind(Date.now(), userId).run();
  return Response.json({ ok: true });
});

// ── POST /:userId/lock — soft-lock (prevent sign-in without full ban) ──────────

appUsersRouter.post("/:userId/lock", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const userId = c.req.param("userId");
  const body = await c.req.raw.json().catch(() => ({})) as { reason?: string };

  await c.env.DB
    .prepare(`UPDATE "user" SET banned = 1, banReason = ?, updatedAt = ? WHERE id = ?`)
    .bind(body.reason ?? "__locked__", Date.now(), userId)
    .run();

  // Revoke all active sessions
  await c.env.DB.prepare(`DELETE FROM session WHERE userId = ?`).bind(userId).run();

  return Response.json({ ok: true });
});

// ── POST /:userId/unlock ───────────────────────────────────────────────────────

appUsersRouter.post("/:userId/unlock", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const userId = c.req.param("userId");

  await c.env.DB
    .prepare(`UPDATE "user" SET banned = 0, banReason = NULL, updatedAt = ? WHERE id = ?`)
    .bind(Date.now(), userId)
    .run();

  return Response.json({ ok: true });
});

// ── POST /:userId/impersonate — return impersonation info ──────────────────────
//
// Full token-based impersonation requires hosted-auth integration.
// This endpoint returns the user ID + a signed 15-min JWT hint for external use.
// Audit-logged regardless.

appUsersRouter.post("/:userId/impersonate", async (c) => {
  const session = await requireAdmin(c);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { appId } = c.req.param() as { appId?: string };
  const userId = c.req.param("userId");

  const member = await c.env.DB
    .prepare(`SELECT u.id, u.email, u.name FROM app_user au JOIN "user" u ON u.id = au.user_id WHERE au.app_id = ? AND au.user_id = ? LIMIT 1`)
    .bind(appId, userId)
    .first<{ id: string; email: string; name: string }>();
  if (!member) return Response.json({ error: "Not found" }, { status: 404 });

  // Generate a short-lived token stub (future: sign with HMAC)
  const token = `imp_${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = Date.now() + 15 * 60 * 1000;

  // Audit log
  const { logAudit } = await import("../../audit");
  await logAudit(c.env.DB, {
    userId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "admin.userImpersonated",
    targetType: "user",
    targetId: userId,
    targetLabel: member.email,
    ipAddress: c.req.raw.headers.get("CF-Connecting-IP"),
    userAgent: c.req.raw.headers.get("User-Agent"),
    metadata: { appId },
  }).catch(() => {});

  return Response.json({ token, userId: member.id, email: member.email, expiresAt });
});

export { appUsersRouter };


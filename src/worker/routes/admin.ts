import { Hono } from "hono";
import type { FieldMap } from "../additional-fields";
import {
  getAdditionalFields,
  hydrateFields,
  setAdditionalFields,
  validatePatch,
} from "../additional-fields";
import type { AuditAction } from "../audit";
import { logAudit, queryAuditLogs } from "../audit";
import { createAuth } from "../auth";
import { parseDevice, parseGeo } from "../device";
import { ALLOWED_IMAGE_TYPES, isFileLike, scanUpload } from "../lib/cdn";
import { hasAdminRole } from "../lib/roles";
import {
  addOrgDomain,
  getOrgSettings,
  listOrgDomains,
  removeOrgDomain,
  setRequireMFA,
} from "../org-settings";
import { deliverEvent } from "../webhook";

const adminRouter = new Hono<{ Bindings: Env }>();

// ── Shared admin auth guard ───────────────────────────────────────────────────
//
// Inline guard per route (no Hono middleware) so each handler controls its own
// error shape. All routes below require admin role.

// ── Audit log query ───────────────────────────────────────────────────────────
//
// GET /api/admin/audit/logs
//   ?userId=  ?orgId=  ?action=  ?limit=  ?before=  (cursor)
adminRouter.get("/audit/logs", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const params = c.req.query();
  const { logs, nextCursor } = await queryAuditLogs(env.DB, {
    userId: params.userId ?? undefined,
    orgId: params.orgId ?? undefined,
    action: params.action ?? undefined,
    before: params.before ?? null,
    limit: params.limit ? Number(params.limit) : 50,
  });

  const parsed = logs.map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));

  return Response.json({ logs: parsed, nextCursor });
});

// ── User detail (aggregate) ───────────────────────────────────────────────────
//
// GET /api/admin/users/:userId
adminRouter.get("/users/:userId", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetId = c.req.param("userId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const user = await env.DB.prepare(
    `SELECT id, name, email, emailVerified, image, role, banned, banReason, banExpires, createdAt, updatedAt, username
     FROM "user" WHERE id = ? LIMIT 1`
  )
    .bind(targetId)
    .first<{
      id: string; name: string; email: string; emailVerified: number;
      image: string | null; role: string | null; banned: number;
      banReason: string | null; banExpires: number | null;
      createdAt: number; updatedAt: number; username: string | null;
    }>();
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const accounts = await env.DB.prepare(
    `SELECT id, providerId, accountId, createdAt FROM account WHERE userId = ? ORDER BY createdAt ASC`
  )
    .bind(targetId)
    .all<{ id: string; providerId: string; accountId: string; createdAt: number }>();

  const sessionsRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM session WHERE userId = ? AND expiresAt > ?`
  )
    .bind(targetId, Date.now())
    .first<{ count: number }>();

  const apiKeyRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM "apikey" WHERE userId = ? AND enabled = 1`
  )
    .bind(targetId)
    .first<{ count: number }>()
    .catch(() => ({ count: 0 }));

  const { logs } = await queryAuditLogs(env.DB, { userId: targetId, limit: 10 });
  const recentActivity = logs.map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));

  return Response.json({
    user: {
      ...user,
      emailVerified: Boolean(user.emailVerified),
      banned: Boolean(user.banned),
    },
    accounts: accounts.results ?? [],
    sessionCount: sessionsRow?.count ?? 0,
    apiKeyCount: apiKeyRow?.count ?? 0,
    recentActivity,
  });
});

// ── Admin avatar upload ───────────────────────────────────────────────────────
//
// POST /api/admin/users/:userId/avatar
adminRouter.post("/users/:userId/avatar", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetUserId = c.req.param("userId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const targetUser = await env.DB.prepare(
    `SELECT id, name, email, image FROM "user" WHERE id = ? LIMIT 1`
  )
    .bind(targetUserId)
    .first<{ id: string; name: string; email: string; image: string | null }>()
    .catch(() => null);
  if (!targetUser) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!isFileLike(file)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return Response.json({ error: "Only JPEG, PNG and WebP images are accepted" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "Image must be <= 10 MB" }, { status: 400 });
  }

  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const cdnKey = `avatars/${targetUserId}/${uploadId}.webp`;
  const oldTargetImage = targetUser.image ?? null;

  const cdnForm = new FormData();
  cdnForm.append("file", new File([await file.arrayBuffer()], "avatar.webp", { type: file.type }));
  cdnForm.append("app", "kova-auth");
  cdnForm.append("key", cdnKey);
  cdnForm.append("uploader", session.user.id);
  cdnForm.append("tags", "avatar");
  cdnForm.append("cacheControl", "immutable");

  const cdnRes = await fetch(`${env.CDN_URL}/upload`, {
    method: "POST",
    headers: { "CDN-API-Key": env.CDN_API_KEY },
    body: cdnForm,
  });
  if (!cdnRes.ok) {
    const detail = await cdnRes.text().catch(() => "");
    return Response.json({ error: `CDN upload failed: ${detail}` }, { status: 502 });
  }
  const { url: imageUrl } = (await cdnRes.json()) as { url: string };

  const isSafe = await scanUpload(env.CDN_URL, env.CDN_API_KEY, `kova-auth/${cdnKey}`);
  if (!isSafe) {
    fetch(`${env.CDN_URL}/files/${cdnKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
    return Response.json({ error: "Image rejected: content policy violation" }, { status: 422 });
  }

  await env.DB.prepare(`UPDATE "user" SET image = ?, updatedAt = ? WHERE id = ?`)
    .bind(imageUrl, Date.now(), targetUserId)
    .run();

  if (oldTargetImage && oldTargetImage.startsWith(env.CDN_URL)) {
    const oldKey = oldTargetImage.replace(`${env.CDN_URL}/`, "").split("?")[0];
    fetch(`${env.CDN_URL}/files/${oldKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
  }

  await logAudit(env.DB, {
    userId: targetUserId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.avatarUpdated" as AuditAction,
    targetType: "user",
    targetId: targetUserId,
    targetLabel: targetUser.email,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
  }).catch(() => { });
  deliverEvent(env.DB, "user.avatarUpdated", {
    userId: targetUserId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    targetId: targetUserId,
    targetLabel: targetUser.email,
  }).catch(() => { });

  return Response.json({ imageUrl });
});

// ── Admin additional fields read ──────────────────────────────────────────────
//
// GET /api/admin/users/:userId/fields
adminRouter.get("/users/:userId/fields", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetUserId = c.req.param("userId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const userExists = await env.DB.prepare(`SELECT id FROM "user" WHERE id = ? LIMIT 1`)
    .bind(targetUserId)
    .first<{ id: string }>()
    .catch(() => null);
  if (!userExists) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const storedMap = await getAdditionalFields(env.DB, targetUserId);
  const fields = hydrateFields(storedMap);
  return Response.json({ fields });
});

// ── Admin additional fields write ─────────────────────────────────────────────
//
// PATCH /api/admin/users/:userId/fields
adminRouter.patch("/users/:userId/fields", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetUserId = c.req.param("userId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const targetUser = await env.DB.prepare(
    `SELECT id, name, email FROM "user" WHERE id = ? LIMIT 1`
  )
    .bind(targetUserId)
    .first<{ id: string; name: string; email: string }>()
    .catch(() => null);
  if (!targetUser) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  let patch: Record<string, unknown>;
  try {
    patch = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof patch !== "object" || Array.isArray(patch) || patch === null) {
    return Response.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Patch must contain at least one field" }, { status: 400 });
  }

  // Admin: selfEditableOnly = false — all registered fields are permitted
  const validation = validatePatch(patch, false);
  if (!validation.valid) {
    return Response.json(
      { error: "Validation failed", fieldErrors: validation.errors },
      { status: 422 }
    );
  }

  const typedPatch = patch as FieldMap;
  const { saved, errors } = await setAdditionalFields(env.DB, targetUserId, typedPatch);

  await logAudit(env.DB, {
    userId: targetUserId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.fieldsUpdated" as AuditAction,
    targetType: "user",
    targetId: targetUserId,
    targetLabel: targetUser.email,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    metadata: { updatedKeys: Object.keys(saved), adminOverride: true },
  }).catch(() => { });

  const storedMap = await getAdditionalFields(env.DB, targetUserId);
  const fields = hydrateFields(storedMap);

  if (errors.length > 0) {
    return Response.json({ fields, partialErrors: errors }, { status: 207 });
  }
  return Response.json({ fields });
});

// ── Sessions list ─────────────────────────────────────────────────────────────
//
// GET /api/admin/sessions   ?userId=
adminRouter.get("/sessions", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const filterUserId = c.req.query("userId");
  const nowMs = Date.now();

  type RawSession = {
    id: string; userId: string;
    userAgent: string | null; ipAddress: string | null;
    createdAt: number; updatedAt: number; expiresAt: number;
    userName: string; userEmail: string; userImage: string | null;
  };

  let sessionsResult: D1Result<RawSession>;
  if (filterUserId) {
    sessionsResult = await env.DB.prepare(
      `SELECT s.id, s.userId, s.userAgent, s.ipAddress,
              s.createdAt, s.updatedAt, s.expiresAt,
              u.name as userName, u.email as userEmail, u.image as userImage
       FROM session s
       JOIN "user" u ON u.id = s.userId
       WHERE s.expiresAt > ? AND s.userId = ?
       ORDER BY s.updatedAt DESC`
    )
      .bind(nowMs, filterUserId)
      .all<RawSession>();
  } else {
    sessionsResult = await env.DB.prepare(
      `SELECT s.id, s.userId, s.userAgent, s.ipAddress,
              s.createdAt, s.updatedAt, s.expiresAt,
              u.name as userName, u.email as userEmail, u.image as userImage
       FROM session s
       JOIN "user" u ON u.id = s.userId
       WHERE s.expiresAt > ?
       ORDER BY s.updatedAt DESC
       LIMIT 500`
    )
      .bind(nowMs)
      .all<RawSession>();
  }

  const rawSessions = sessionsResult.results ?? [];
  const callerSessionId = session.session.id;
  const geo = parseGeo(request.cf as IncomingRequestCfProperties | undefined);

  const enriched = rawSessions.map((s) => {
    const device = parseDevice(s.userAgent);
    return {
      ...s,
      isCurrent: s.id === callerSessionId,
      deviceType: device.deviceType,
      browser: device.browser,
      browserVersion: device.browserVersion,
      os: device.os,
      osVersion: device.osVersion,
      deviceLabel: device.label,
      geoCity: geo.city,
      geoCountry: geo.country,
      geoLocation: geo.location,
      geoFlag: geo.flag,
    };
  });

  return Response.json({ sessions: enriched, currentSessionId: callerSessionId });
});

adminRouter.delete("/sessions/:sessionId", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const sessionId = c.req.param("sessionId");
  if (sessionId === session.session.id) {
    return Response.json({ error: "Cannot revoke current session" }, { status: 400 });
  }

  const result = await env.DB.prepare(`DELETE FROM session WHERE id = ?`)
    .bind(sessionId)
    .run();

  return Response.json({ success: true, revokedCount: result.meta?.changes ?? 0 });
});

// ── Bulk revoke other sessions ────────────────────────────────────────────────
//
// POST /api/admin/sessions/revoke-all-others
// Body: { exceptSessionId: string }
adminRouter.post("/sessions/revoke-all-others", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let exceptSessionId: string;
  try {
    const body = (await request.json()) as { exceptSessionId?: string };
    exceptSessionId = body.exceptSessionId ?? session.session.id;
  } catch {
    exceptSessionId = session.session.id;
  }

  const nowMs = Date.now();
  const result = await env.DB.prepare(`DELETE FROM session WHERE id != ? AND expiresAt > ?`)
    .bind(exceptSessionId, nowMs)
    .run();

  await logAudit(env.DB, {
    userId: session.user.id,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "session.revokeAll",
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    metadata: { revokedCount: result.meta?.changes ?? 0 },
  }).catch(() => { });
  deliverEvent(env.DB, "session.revokeAll", {
    userId: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    revokedCount: result.meta?.changes ?? 0,
  }).catch(() => { });

  return Response.json({ success: true, revokedCount: result.meta?.changes ?? 0 });
});

// ── Org Settings ──────────────────────────────────────────────────────────────
//
// GET  /api/admin/orgs/:orgId/settings
// PATCH /api/admin/orgs/:orgId/settings

adminRouter.get("/orgs/:orgId/settings", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const orgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const settings = await getOrgSettings(env.DB, orgId);
  return Response.json(settings);
});

adminRouter.patch("/orgs/:orgId/settings", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const orgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { require_mfa?: boolean };
  try {
    body = (await request.json()) as { require_mfa?: boolean };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.require_mfa === "boolean") {
    await setRequireMFA(env.DB, orgId, body.require_mfa);
    await logAudit(env.DB, {
      userId: session.user.id,
      orgId,
      actor: session.user.id,
      actorName: session.user.name ?? null,
      actorEmail: session.user.email,
      action: "org.updated",
      targetType: "org",
      targetId: orgId,
      ipAddress: request.headers.get("CF-Connecting-IP"),
      userAgent: request.headers.get("User-Agent"),
      metadata: { field: "require_mfa", value: body.require_mfa },
    }).catch(() => { });
  }
  const settings = await getOrgSettings(env.DB, orgId);
  return Response.json(settings);
});

// ── Org Domains ───────────────────────────────────────────────────────────────
//
// GET    /api/admin/orgs/:orgId/domains
// POST   /api/admin/orgs/:orgId/domains
// DELETE /api/admin/orgs/:orgId/domains/:id

adminRouter.get("/orgs/:orgId/domains", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const orgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const domains = await listOrgDomains(env.DB, orgId);
  return Response.json({ domains });
});

adminRouter.post("/orgs/:orgId/domains", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const orgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { domain?: string; enrollment_mode?: string; default_role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.domain || typeof body.domain !== "string") {
    return Response.json({ error: "domain is required" }, { status: 400 });
  }
  const domain = await addOrgDomain(env.DB, {
    orgId,
    domain: body.domain,
    enrollment_mode:
      body.enrollment_mode === "automatic_join" ? "automatic_join" : "automatic_invitation",
    default_role: body.default_role ?? "member",
  });
  return Response.json({ domain });
});

adminRouter.delete("/orgs/:orgId/domains/:domainId", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const orgId = c.req.param("orgId");
  const domainId = c.req.param("domainId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasAdminRole((session.user as { role?: string }).role)) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  await removeOrgDomain(env.DB, domainId, orgId);
  return Response.json({ ok: true });
});

export { adminRouter };

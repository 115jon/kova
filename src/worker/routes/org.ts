import { Hono } from "hono";
import type { AuditAction } from "../audit";
import { logAudit } from "../audit";
import { createAuth } from "../auth";
import { ALLOWED_IMAGE_TYPES, isFileLike, scanUpload } from "../lib/cdn";
import { hasAdminRole } from "../lib/roles";

const orgRouter = new Hono<{ Bindings: Env }>();

// ── Org logo upload ───────────────────────────────────────────────────────────
//
// POST /api/org/avatar/:orgId   (multipart/form-data, field "avatar")
//
// Uploads an org logo to R2 via CDN, stores the absolute URL in
// organization.logo. Caller must be authenticated and an owner/admin
// of the target org (verified via D1 member lookup).
orgRouter.post("/avatar/:orgId", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetOrgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Verify caller is owner or admin of this org (or global admin)
  const callerRole = (session.user as { role?: string }).role ?? "";
  const isGlobalAdmin = hasAdminRole(callerRole);
  if (!isGlobalAdmin) {
    const membership = await env.DB.prepare(
      `SELECT role FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`
    )
      .bind(targetOrgId, session.user.id)
      .first<{ role: string }>()
      .catch(() => null);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return Response.json(
        { error: "Only org owners and admins can update the org logo" },
        { status: 403 }
      );
    }
  }

  const orgRow = await env.DB.prepare(
    `SELECT id, name, logo FROM organization WHERE id = ? LIMIT 1`
  )
    .bind(targetOrgId)
    .first<{ id: string; name: string; logo: string | null }>()
    .catch(() => null);
  if (!orgRow) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!isFileLike(file)) {
    return Response.json(
      { error: "No file provided — send a multipart field named 'avatar'" },
      { status: 400 }
    );
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return Response.json({ error: "Only JPEG, PNG and WebP images are accepted" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "Image must be <= 10 MB" }, { status: 400 });
  }

  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const cdnKey = `org-logos/${targetOrgId}/${uploadId}.webp`;
  const oldLogo = orgRow.logo ?? null;

  const cdnForm = new FormData();
  cdnForm.append("file", new File([await file.arrayBuffer()], "logo.webp", { type: file.type }));
  cdnForm.append("app", "kova-auth");
  cdnForm.append("key", cdnKey);
  cdnForm.append("uploader", session.user.id);
  cdnForm.append("tags", "org-logo");
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
  const { url: logoUrl } = (await cdnRes.json()) as { url: string };

  // ── NSFW scan ──────────────────────────────────────────────────────────────
  const isSafe = await scanUpload(env.CDN_URL, env.CDN_API_KEY, `kova-auth/${cdnKey}`);
  if (!isSafe) {
    fetch(`${env.CDN_URL}/files/${cdnKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
    return Response.json({ error: "Image rejected: content policy violation" }, { status: 422 });
  }

  await env.DB.prepare(`UPDATE organization SET logo = ? WHERE id = ?`)
    .bind(logoUrl, targetOrgId)
    .run();

  if (oldLogo && oldLogo.startsWith(env.CDN_URL)) {
    const oldKey = oldLogo.replace(`${env.CDN_URL}/`, "").split("?")[0];
    fetch(`${env.CDN_URL}/files/${oldKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
  }

  await logAudit(env.DB, {
    userId: session.user.id,
    orgId: targetOrgId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "org.updated" as AuditAction,
    targetType: "org",
    targetId: targetOrgId,
    targetLabel: orgRow.name,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    metadata: { field: "logo" },
  }).catch(() => { });

  return Response.json({ imageUrl: logoUrl });
});

// ── Org logo remove ───────────────────────────────────────────────────────────
//
// DELETE /api/org/avatar/:orgId
//
// Nulls organization.logo in D1 and deletes the CDN asset.
orgRouter.delete("/avatar/:orgId", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const targetOrgId = c.req.param("orgId");
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const callerRole = (session.user as { role?: string }).role ?? "";
  const isGlobalAdmin = hasAdminRole(callerRole);
  if (!isGlobalAdmin) {
    const membership = await env.DB.prepare(
      `SELECT role FROM member WHERE organizationId = ? AND userId = ? LIMIT 1`
    )
      .bind(targetOrgId, session.user.id)
      .first<{ role: string }>()
      .catch(() => null);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return Response.json(
        { error: "Only org owners and admins can update the org logo" },
        { status: 403 }
      );
    }
  }

  const orgRow = await env.DB.prepare(
    `SELECT logo, name FROM organization WHERE id = ? LIMIT 1`
  )
    .bind(targetOrgId)
    .first<{ logo: string | null; name: string }>()
    .catch(() => null);

  await env.DB.prepare(`UPDATE organization SET logo = NULL WHERE id = ?`)
    .bind(targetOrgId)
    .run();

  if (orgRow?.logo && orgRow.logo.startsWith(env.CDN_URL)) {
    const oldKey = orgRow.logo.replace(`${env.CDN_URL}/`, "").split("?")[0];
    fetch(`${env.CDN_URL}/files/${oldKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
  }

  await logAudit(env.DB, {
    userId: session.user.id,
    orgId: targetOrgId,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "org.updated" as AuditAction,
    targetType: "org",
    targetId: targetOrgId,
    targetLabel: orgRow?.name ?? null,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    metadata: { field: "logo", removed: true },
  }).catch(() => { });

  return Response.json({ ok: true, previous: orgRow?.logo ?? null });
});

export { orgRouter };


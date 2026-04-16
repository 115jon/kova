import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import type { FieldMap } from "../additional-fields";
import {
  FIELD_DEFINITIONS,
  getAdditionalFields,
  hydrateFields,
  setAdditionalFields,
  toPublicDef,
  validatePatch,
} from "../additional-fields";
import type { AuditAction } from "../audit";
import { logAudit } from "../audit";
import { createAuth } from "../auth";
import { ALLOWED_IMAGE_TYPES, isFileLike, scanUpload } from "../lib/cdn";
import { validatePassword } from "../password";
import { deliverEvent } from "../webhook";

const userRouter = new Hono<{ Bindings: Env }>();

// ── Avatar upload (self) ─────────────────────────────────────────────────────
//
// POST /api/user/avatar   (multipart/form-data, field name "avatar")
//
// Validates: image/jpeg | image/png | image/webp, ≤ 10 MB.
// Forwards to CDN; the returned absolute URL is stored as user.image in D1.
userRouter.post("/avatar", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
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

  // Content-addressed upload — each upload gets a unique ID like Discord's
  // /avatars/{userId}/{hash}.webp. URL is immutable; old avatar is deleted
  // from R2 as fire-and-forget to avoid accumulating stale files.
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const cdnKey = `avatars/${session.user.id}/${uploadId}.webp`;
  const oldImage = (session.user as { image?: string | null }).image ?? null;

  const cdnForm = new FormData();
  cdnForm.append("file", new File([await file.arrayBuffer()], "avatar.webp", { type: file.type }));
  cdnForm.append("app", "ralph-auth");
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

  // ── NSFW scan ──────────────────────────────────────────────────────────────
  const isSafe = await scanUpload(env.CDN_URL, env.CDN_API_KEY, `ralph-auth/${cdnKey}`);
  if (!isSafe) {
    fetch(`${env.CDN_URL}/files/${cdnKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
    return Response.json({ error: "Image rejected: content policy violation" }, { status: 422 });
  }

  await env.DB.prepare(`UPDATE "user" SET image = ?, updatedAt = ? WHERE id = ?`)
    .bind(imageUrl, Date.now(), session.user.id)
    .run();

  if (oldImage && oldImage.startsWith(env.CDN_URL)) {
    const oldKey = oldImage.replace(`${env.CDN_URL}/`, "").split("?")[0];
    fetch(`${env.CDN_URL}/files/${oldKey}`, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
  }

  await logAudit(env.DB, {
    userId: session.user.id,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.avatarUpdated" as AuditAction,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
  }).catch(() => { });
  deliverEvent(env.DB, "user.avatarUpdated", {
    userId: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    imageUrl,
  }).catch(() => { });

  return Response.json({ imageUrl });
});

// ── Avatar remove (self) ─────────────────────────────────────────────────────
//
// DELETE /api/user/avatar
//
// Nulls user.image in D1 and deletes the CDN asset.
userRouter.delete("/avatar", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const row = await env.DB.prepare(`SELECT image FROM "user" WHERE id = ? LIMIT 1`)
    .bind(session.user.id)
    .first<{ image: string | null }>();

  await env.DB.prepare(`UPDATE "user" SET image = NULL, updatedAt = ? WHERE id = ?`)
    .bind(Date.now(), session.user.id)
    .run();

  if (row?.image && row.image.startsWith(env.CDN_URL)) {
    const oldKey = row.image.replace(env.CDN_URL + "/", "").split("?")[0];
    fetch(env.CDN_URL + "/files/" + oldKey, {
      method: "DELETE",
      headers: { "CDN-API-Key": env.CDN_API_KEY },
    }).catch(() => { });
  }

  await logAudit(env.DB, {
    userId: session.user.id,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.avatarUpdated" as AuditAction,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
  }).catch(() => { });
  deliverEvent(env.DB, "user.avatarUpdated", {
    userId: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    removed: true,
  }).catch(() => { });

  return Response.json({ ok: true, previous: row?.image ?? null });
});

// ── Avatar serve – legacy redirect ──────────────────────────────────────────
//
// GET /api/avatar/avatars/{userId}.{ext}
//
// Old avatars stored as relative /api/avatar/... paths in the DB redirect
// permanently to the CDN URL. New uploads store absolute CDN URLs directly.
userRouter.get("/avatar-legacy/*", (c) => {
  const { env } = c;
  const suffix = c.req.path.replace(/^\/avatar-legacy\//, "");
  return Response.redirect(`${env.CDN_URL}/ralph-auth/${suffix}`, 301);
});

// ── Set initial password ─────────────────────────────────────────────────────
//
// POST /api/user/set-initial-password  { newPassword: string }
//
// Better Auth's admin.setUserPassword doesn't create a credential
// account entry — it only updates an existing one. For OAuth-only
// users we need to INSERT a new account row ourselves using the
// same hashPassword function that Better Auth uses for sign-in.
userRouter.post("/set-initial-password", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let rawPassword: string | undefined;
  try {
    const body = (await request.json()) as { newPassword?: string };
    rawPassword = body.newPassword;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const newPassword = rawPassword ?? "";
  const { valid, errors } = validatePassword(newPassword);
  if (!valid) {
    return Response.json(
      { error: errors[0] ?? "Password does not meet requirements" },
      { status: 400 }
    );
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM account WHERE userId = ? AND providerId = 'credential'"
  )
    .bind(session.user.id)
    .first<{ id: string }>();
  if (existing) {
    return Response.json(
      { error: "You already have a password. Use 'Change Password' to update it." },
      { status: 409 }
    );
  }

  const hashed = await hashPassword(newPassword);
  const accountId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (?, ?, 'credential', ?, ?, ?, ?)`
  )
    .bind(accountId, session.user.email, session.user.id, hashed, now, now)
    .run();

  await logAudit(env.DB, {
    userId: session.user.id,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.passwordSet",
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
  });
  deliverEvent(env.DB, "user.passwordSet", {
    userId: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
  }).catch(() => { });

  return Response.json({ success: true });
});

// ── Additional Fields: schema introspection ───────────────────────────────────
//
// GET /api/user/fields/schema
//
// Returns the public field definitions array so the dashboard can build
// its form dynamically without hardcoding field metadata client-side.
// No authentication required — definitions are not sensitive.
userRouter.get("/fields/schema", (c) => {
  const publicDefs = FIELD_DEFINITIONS.map(toPublicDef);
  return Response.json({ fields: publicDefs });
});

// ── Additional Fields: self-service read ──────────────────────────────────────
//
// GET /api/user/fields
userRouter.get("/fields", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const storedMap = await getAdditionalFields(env.DB, session.user.id);
  const fields = hydrateFields(storedMap);
  return Response.json({ fields });
});

// ── Additional Fields: self-service write ────────────────────────────────────
//
// PATCH /api/user/fields
// Body: Record<fieldKey, value | null>
userRouter.patch("/fields", async (c) => {
  const { env } = c;
  const request = c.req.raw;
  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
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

  const validation = validatePatch(patch, /* selfEditableOnly */ true);
  if (!validation.valid) {
    return Response.json(
      { error: "Validation failed", fieldErrors: validation.errors },
      { status: 422 }
    );
  }

  const typedPatch = patch as FieldMap;
  const { saved, errors } = await setAdditionalFields(env.DB, session.user.id, typedPatch);

  await logAudit(env.DB, {
    userId: session.user.id,
    actor: session.user.id,
    actorName: session.user.name ?? null,
    actorEmail: session.user.email,
    action: "user.fieldsUpdated" as AuditAction,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    metadata: { updatedKeys: Object.keys(saved) },
  }).catch(() => { });

  const storedMap = await getAdditionalFields(env.DB, session.user.id);
  const fields = hydrateFields(storedMap);

  if (errors.length > 0) {
    return Response.json({ fields, partialErrors: errors }, { status: 207 });
  }
  return Response.json({ fields });
});

export { userRouter };


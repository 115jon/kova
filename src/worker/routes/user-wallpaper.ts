import { Hono } from "hono";
import type { Context } from "hono";
import type { AuditAction } from "../audit";
import { logAudit } from "../audit";
import { createAuth } from "../auth";
import { isFileLike, scanUpload } from "../lib/cdn";
import { exceeds4k, readImageSize, sniffImageType, type SniffedImageType } from "../lib/image-size";
import { deliverEvent } from "../webhook";

export const WALLPAPER_EFFECTS = ["none", "dither", "ascii", "halftone", "scanlines", "haze"] as const;
export type WallpaperEffect = (typeof WALLPAPER_EFFECTS)[number];
export const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024;
const WALLPAPER_LIMIT = 6;
const EXT_BY_TYPE: Record<SniffedImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const WALLPAPER_PATH = /^\/kova-auth\/(wallpapers\/([^/]+)\/[^/]+\.(?:jpg|jpeg|png|webp|gif))$/;

export interface WallpaperView { url: string; effect: WallpaperEffect }
export interface WallpaperRecord { wallpaperUrl: string; effect: WallpaperEffect; updatedAt: number }
interface UploadRow { id: string; url: string; content_type: string; created_at: number }

export function parseEffect(value: unknown): WallpaperEffect | null {
  if (value === undefined || value === null || value === "") return "none";
  if (typeof value !== "string") return null;
  return (WALLPAPER_EFFECTS as readonly string[]).includes(value) ? value as WallpaperEffect : null;
}

export async function getUserWallpaper(db: D1Database, userId: string): Promise<WallpaperRecord | null> {
  try {
    const row = await db.prepare(`SELECT wallpaper_url, effect, updated_at FROM user_wallpapers WHERE user_id = ? LIMIT 1`).bind(userId).first<{ wallpaper_url: string | null; effect: string; updated_at: number }>();
    if (!row?.wallpaper_url) return null;
    return { wallpaperUrl: row.wallpaper_url, effect: parseEffect(row.effect) ?? "none", updatedAt: row.updated_at };
  } catch { return null; }
}

function userIdOf(user: object): string | null {
  if (!("id" in user)) return null;
  const id = (user as { id: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function withWallpaper<T extends object>(db: D1Database, user: T): Promise<T & { wallpaper?: WallpaperView }> {
  const id = userIdOf(user);
  if (!id) return user;
  const row = await getUserWallpaper(db, id);
  return row ? { ...user, wallpaper: { url: row.wallpaperUrl, effect: row.effect } } : user;
}

function normalizeDeclaredType(type: string): string { return type === "image/jpg" ? "image/jpeg" : type; }

function ownedCdnKey(env: Env, userId: string, storedUrl: string | null): string | null {
  if (!storedUrl) return null;
  try {
    const base = new URL(env.CDN_URL);
    const target = new URL(storedUrl);
    const match = target.pathname.match(WALLPAPER_PATH);
    return target.origin === base.origin && match?.[2] === userId ? match[1] ?? null : null;
  } catch { return null; }
}

async function deleteCdnObject(env: Env, userId: string, storedUrl: string | null): Promise<void> {
  const key = ownedCdnKey(env, userId, storedUrl);
  if (!key) return;
  await fetch(`${env.CDN_URL}/files/kova-auth/${key}`, { method: "DELETE", headers: { "CDN-API-Key": env.CDN_API_KEY } }).catch(() => undefined);
}

async function requireUser(c: { env: Env; req: { raw: Request } }) {
  const auth = createAuth(c.env, c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

async function listUploads(db: D1Database, userId: string): Promise<UploadRow[]> {
  const result = await db.prepare(`SELECT id, url, content_type, created_at FROM user_wallpaper_uploads WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(userId, WALLPAPER_LIMIT).all<UploadRow>();
  return result.results;
}

async function auditAndEvent(c: { env: Env; executionCtx: ExecutionContext }, user: { id: string; name?: string | null; email: string }, wallpaperUrl: string | null, effect: WallpaperEffect | null, updatedAt: number): Promise<void> {
  const event = deliverEvent(c.env.DB, "user.wallpaperUpdated", { userId: user.id, actorName: user.name ?? null, actorEmail: user.email, wallpaperUrl, effect, timestamp: updatedAt, removed: wallpaperUrl === null }).catch(() => undefined);
  c.executionCtx.waitUntil(event);
  await logAudit(c.env.DB, { userId: user.id, actor: user.id, actorName: user.name ?? null, actorEmail: user.email, action: "user.wallpaperUpdated" as AuditAction, ipAddress: null, userAgent: null, metadata: { wallpaperUrl, effect } }).catch(() => undefined);
}

const wallpaperRouter = new Hono<{ Bindings: Env }>();
const libraryRouter = new Hono<{ Bindings: Env }>();

wallpaperRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const row = await getUserWallpaper(c.env.DB, user.id);
  if (!row) return Response.json({ error: "No wallpaper set" }, { status: 404 });
  return Response.json({ wallpaperUrl: row.wallpaperUrl, effect: row.effect, updatedAt: row.updatedAt });
});

libraryRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const [items, active] = await Promise.all([listUploads(c.env.DB, user.id), getUserWallpaper(c.env.DB, user.id)]);
  return Response.json({ items: items.map((item) => ({ id: item.id, url: item.url, contentType: item.content_type, createdAt: new Date(item.created_at).toISOString() })), activeUrl: active?.wallpaperUrl ?? null });
});

libraryRouter.post("/select", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  let body: unknown;
  try { body = await c.req.raw.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string" || body.id.length === 0 || body.id.length > 200) return Response.json({ error: "id is required" }, { status: 400 });
  const requestedEffect = "effect" in body ? parseEffect(body.effect) : null;
  if ("effect" in body && !requestedEffect) return Response.json({ error: "Invalid effect" }, { status: 400 });
  const current = await getUserWallpaper(c.env.DB, user.id);
  const updatedAt = Date.now();
  const effect = requestedEffect ?? current?.effect ?? "none";
  const selected = await c.env.DB.prepare(
    `INSERT INTO user_wallpapers (user_id, wallpaper_url, effect, updated_at)
     SELECT ?, url, ?, ? FROM user_wallpaper_uploads WHERE id = ? AND user_id = ?
     ON CONFLICT(user_id) DO UPDATE SET wallpaper_url = excluded.wallpaper_url, effect = excluded.effect, updated_at = excluded.updated_at
     RETURNING wallpaper_url, effect, updated_at`,
  ).bind(user.id, effect, updatedAt, body.id, user.id).first<{ wallpaper_url: string; effect: WallpaperEffect; updated_at: number }>().catch(() => null);
  if (!selected) return Response.json({ error: "Wallpaper not found" }, { status: 404 });
  await auditAndEvent(c, user, selected.wallpaper_url, selected.effect, selected.updated_at);
  return Response.json({ wallpaperUrl: selected.wallpaper_url, effect: selected.effect, updatedAt: selected.updated_at });
});

type WallpaperContext = Context<{ Bindings: Env }>;

async function uploadWallpaper(c: WallpaperContext): Promise<Response> {
  const { env } = c;
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("image");
  if (!isFileLike(file)) return Response.json({ error: "No file provided — send a multipart field named 'image'" }, { status: 400 });
  const effect = parseEffect(form?.get("effect"));
  if (!effect) return Response.json({ error: "Invalid effect" }, { status: 400 });
  if (file.size > WALLPAPER_MAX_BYTES) return Response.json({ error: "Image must be <= 10 MB" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) return Response.json({ error: "Only JPEG, PNG, WebP, and GIF images are accepted" }, { status: 400 });
  const declared = normalizeDeclaredType(file.type);
  if (declared && declared !== "application/octet-stream" && declared !== sniffed) return Response.json({ error: "Image content does not match the declared Content-Type" }, { status: 400 });
  const size = readImageSize(bytes);
  if (size && exceeds4k(size.width, size.height)) return Response.json({ error: "Image is over 4K" }, { status: 400 });
  const uploadId = crypto.randomUUID().replace(/-/g, "");
  const cdnKey = `wallpapers/${user.id}/${uploadId}.${EXT_BY_TYPE[sniffed]}`;
  const cdnForm = new FormData();
  cdnForm.append("file", new File([bytes], `wallpaper.${EXT_BY_TYPE[sniffed]}`, { type: sniffed }));
  cdnForm.append("app", "kova-auth"); cdnForm.append("key", cdnKey); cdnForm.append("uploader", user.id); cdnForm.append("tags", "wallpaper"); cdnForm.append("cacheControl", "immutable");
  const cdnRes = await fetch(`${env.CDN_URL}/upload`, { method: "POST", headers: { "CDN-API-Key": env.CDN_API_KEY }, body: cdnForm });
  if (!cdnRes.ok) return Response.json({ error: "CDN upload failed" }, { status: 502 });
  const uploaded = await cdnRes.json().catch(() => null) as { url?: string } | null;
  if (!uploaded?.url) return Response.json({ error: "CDN upload failed" }, { status: 502 });
  if (!await scanUpload(env.CDN_URL, env.CDN_API_KEY, `kova-auth/${cdnKey}`)) {
    await deleteCdnObject(env, user.id, uploaded.url);
    return Response.json({ error: "Image rejected: content policy violation" }, { status: 422 });
  }
  const now = Date.now();
  const uploadStmt = env.DB.prepare(`INSERT INTO user_wallpaper_uploads (id, user_id, url, content_type, created_at) VALUES (?, ?, ?, ?, ?)`);
  const activeStmt = env.DB.prepare(`INSERT INTO user_wallpapers (user_id, wallpaper_url, effect, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET wallpaper_url = excluded.wallpaper_url, effect = excluded.effect, updated_at = excluded.updated_at`);
  const doomedStmt = env.DB.prepare(`SELECT url FROM user_wallpaper_uploads WHERE user_id = ? AND id <> ? AND url <> ? AND id NOT IN (SELECT id FROM user_wallpaper_uploads WHERE user_id = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT ?)`);
  const trimStmt = env.DB.prepare(`DELETE FROM user_wallpaper_uploads WHERE user_id = ? AND id <> ? AND url <> ? AND id NOT IN (SELECT id FROM user_wallpaper_uploads WHERE user_id = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT ?)`);
  let trimmed: { url: string }[] = [];
  try {
    const results = await env.DB.batch([
      uploadStmt.bind(uploadId, user.id, uploaded.url, sniffed, now),
      activeStmt.bind(user.id, uploaded.url, effect, now),
      doomedStmt.bind(user.id, uploadId, uploaded.url, user.id, uploadId, WALLPAPER_LIMIT - 1),
      trimStmt.bind(user.id, uploadId, uploaded.url, user.id, uploadId, WALLPAPER_LIMIT - 1),
    ]);
    trimmed = (results[2] as D1Result & { results?: { url: string }[] }).results ?? [];
  }
  catch { await deleteCdnObject(env, user.id, uploaded.url); return Response.json({ error: "Could not save wallpaper" }, { status: 500 }); }
  for (const item of trimmed) await deleteCdnObject(env, user.id, item.url);
  await auditAndEvent(c, user, uploaded.url, effect, now);
  return Response.json({ wallpaperUrl: uploaded.url, effect, updatedAt: now });
}

wallpaperRouter.post("/effect", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  let body: unknown;
  try { body = await c.req.raw.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const effect = typeof body === "object" && body !== null && "effect" in body ? parseEffect(body.effect) : null;
  if (!effect) return Response.json({ error: "Invalid effect" }, { status: 400 });
  const updatedAt = Date.now();
  const updated = await c.env.DB.prepare(
    `UPDATE user_wallpapers SET effect = ?, updated_at = ? WHERE user_id = ? AND wallpaper_url IS NOT NULL RETURNING wallpaper_url, effect, updated_at`,
  ).bind(effect, updatedAt, user.id).first<{ wallpaper_url: string; effect: WallpaperEffect; updated_at: number }>().catch(() => null);
  if (!updated) return Response.json({ error: "No wallpaper set" }, { status: 404 });
  await auditAndEvent(c, user, updated.wallpaper_url, updated.effect, updated.updated_at);
  return Response.json({ wallpaperUrl: updated.wallpaper_url, effect: updated.effect, updatedAt: updated.updated_at });
});

wallpaperRouter.post("/", uploadWallpaper);
libraryRouter.post("/", uploadWallpaper);

libraryRouter.delete("/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const id = c.req.param("id");
  const deleted = await c.env.DB.prepare(
    `DELETE FROM user_wallpaper_uploads WHERE id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM user_wallpapers WHERE user_id = ? AND wallpaper_url = user_wallpaper_uploads.url) RETURNING url`,
  ).bind(id, user.id, user.id).first<{ url: string }>();
  if (!deleted) {
    const exists = await c.env.DB.prepare(`SELECT id FROM user_wallpaper_uploads WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
    return Response.json({ error: exists ? "Active wallpaper cannot be deleted" : "Wallpaper not found" }, { status: exists ? 409 : 404 });
  }
  await deleteCdnObject(c.env, user.id, deleted.url);
  return Response.json({ ok: true });
});

wallpaperRouter.delete("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const previous = await getUserWallpaper(c.env.DB, user.id);
  await c.env.DB.prepare(`DELETE FROM user_wallpapers WHERE user_id = ?`).bind(user.id).run().catch(() => undefined);
  if (previous) await auditAndEvent(c, user, null, null, Date.now());
  return Response.json({ ok: true });
});

export { wallpaperRouter };
export { libraryRouter };

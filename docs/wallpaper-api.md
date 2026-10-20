# Kova Wallpaper Sync API

Per-user wallpaper. One row in `user_wallpapers`. The image bytes live on the house CDN (`CDN_URL`, `https://cdn.115jon.site`), same path as avatars. This worker does not bind `mira-user-assets` or any other R2 bucket, and it does not publish `assets.115jon.site`.

Effects are client-side rendering hints for Mira. Kova stores the string and does not transform the image.

## Migration

`migrations/0022_user_wallpapers.sql` and `migrations/0024_user_wallpaper_haze.sql`

```sql
CREATE TABLE IF NOT EXISTS user_wallpapers (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  wallpaper_url TEXT,
  effect TEXT NOT NULL DEFAULT 'none' CHECK (
    effect IN ('none', 'dither', 'ascii', 'halftone', 'scanlines', 'haze')
  ),
  updated_at INTEGER NOT NULL
);
```

Apply with `pnpm run migrate:dev` locally, or `pnpm run migrate:prod` when shipping. Until that migration is applied, `GET /api/user/wallpaper` returns 404 and `GET /api/auth/get-session` omits `user.wallpaper`.

## Upload Wallpaper

**POST** `/api/user/wallpaper`

**Auth:** Required. Better Auth session, cookie or bearer that `getSession` accepts. `401` if missing.

**Request:**

- Content-Type: `multipart/form-data`
- `image`: file (`image/png`, `image/jpeg`, `image/webp`, `image/gif`)
- `effect`: optional string. Default `none`.

**Limits:**

- 10 MB. Larger uploads are `400`. The server does not resize.
- Up to 4K in either orientation: long edge ≤ 3840 and short edge ≤ 2160. Anything larger is `400`. Clients must downscale first.
- Magic bytes must match the declared type. Unrecognized files are `400`.

**Storage:**

- CDN app: `kova-auth`
- Object key: `wallpapers/{userId}/{uploadId}.{ext}`
- Public URL: whatever the CDN returns, shaped like `https://cdn.115jon.site/kova-auth/wallpapers/{userId}/{uploadId}.png`
- A previous CDN object for that user is deleted after the new row is saved.
- CDN NSFW scan runs after upload. A policy hit deletes the new object, leaves the previous wallpaper in place, and returns `422`.

**Response:** `200`

```json
{
  "wallpaperUrl": "https://cdn.115jon.site/kova-auth/wallpapers/user_abc/0123456789abcdef.png",
  "effect": "dither",
  "updatedAt": 1750000000000
}
```

`updatedAt` is Unix milliseconds, same as the rest of Kova.

## Get Wallpaper

**GET** `/api/user/wallpaper`

**Auth:** Required.

**Response:** same JSON as upload, or `404` `{ "error": "No wallpaper set" }`.

**GET** `/api/auth/get-session` adds `user.wallpaper` only when a wallpaper is stored. Sessions with no wallpaper stay unchanged.

```json
{
  "user": {
    "id": "user_abc",
    "email": "ada@example.com",
    "wallpaper": {
      "url": "https://cdn.115jon.site/kova-auth/wallpapers/user_abc/0123456789abcdef.png",
      "effect": "dither"
    }
  }
}
```

## Delete Wallpaper

**DELETE** `/api/user/wallpaper`

**Auth:** Required.

Deletes the CDN object when the stored URL starts with `CDN_URL`, deletes the D1 row, and returns `200`:

```json
{ "ok": true }
```

Deleting when nothing is set is also `200` and does not emit a webhook.

## Webhook

Event name: `user.wallpaperUpdated` (Kova's existing audit style, same family as `user.avatarUpdated`).

Upload `data`:

```json
{
  "userId": "user_abc",
  "actorName": "Ada",
  "actorEmail": "ada@example.com",
  "wallpaperUrl": "https://cdn.115jon.site/...",
  "effect": "dither",
  "timestamp": 1750000000000
}
```

Delete `data` sets `wallpaperUrl` and `effect` to `null` and adds `"removed": true`.

The delivery envelope is the normal webhook payload: `id`, `event`, `timestamp`, `data`.

## Effects

- `none`: no effect
- `dither`: dithering
- `ascii`: ASCII art
- `halftone`: halftone dots
- `scanlines`: CRT scanline overlay
- `haze`: fades the artwork into the theme toward the bottom

## Not in this worker

- No server-side resize or effect render.
- No direct R2 binding. Do not create `mira-user-assets` for this API.
- No per-device wallpaper. One row per user.

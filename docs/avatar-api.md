# Kova Avatar API

Avatars already ship. No new column, migration, or R2 binding was added.

The profile photo lives on Better Auth's `user.image` column (`migrations/0000_init.sql`). Upload and delete go through the house CDN (`CDN_URL`, `https://cdn.115jon.site`). This worker does not bind `mira-user-assets` or any other avatar bucket.

Session and the React SDK expose that column as `image` / `imageUrl`. There is no `avatarUrl` or `avatar_url` field.

## Upload Avatar

**POST** `/api/user/avatar`

**Auth:** Better Auth session (cookie or bearer that `getSession` accepts). `401` if missing.

**Request:**

- Content-Type: `multipart/form-data`
- File field name: `avatar` (not `image`)
- Types: `image/jpeg`, `image/png`, `image/webp`
- Max size: 10 MB

**Storage:**

- CDN app: `kova-auth`
- Object key: `avatars/{userId}/{uploadId}.webp` (`uploadId` is a UUID with dashes stripped)
- The worker forwards the original bytes. It does not resize or transcode.
- CDN NSFW scan runs after upload. A policy hit deletes the object and returns `422`.
- The absolute URL from the CDN is written to `user.image`. A previous CDN object for that user is deleted.

**Response:** `200`

```json
{
  "imageUrl": "https://cdn.115jon.site/kova-auth/avatars/user_abc123/<uploadId>.webp"
}
```

The exact URL is whatever the CDN returns. Legacy rows that still store `/api/avatar/...` redirect with `301` to `${CDN_URL}/kova-auth/<suffix>`.

**Errors:** `400` missing file, bad type, or over 10 MB. `502` CDN upload failed. `422` content policy.

## Get Avatar

Included on the session user. Field name is `image`.

**GET** `/api/auth/get-session`

Cookie sessions return Better Auth's user, which includes `image`. App bearer sessions select `image` explicitly in `src/worker/routes/auth.ts`.

```json
{
  "user": {
    "id": "user_abc123",
    "email": "user email",
    "name": "Test User",
    "image": "https://cdn.115jon.site/kova-auth/avatars/user_abc123/<uploadId>.webp"
  },
  "session": {}
}
```

`image` is `null` when no avatar is set.

`useUser()` in `packages/kova-react` maps `user.image` to both `user.image` and `user.imageUrl`.

## Delete Avatar

**DELETE** `/api/user/avatar`

**Auth:** same as upload.

Sets `user.image` to `NULL`, deletes the CDN object when the stored URL starts with `CDN_URL`, and returns:

```json
{
  "ok": true,
  "previous": "https://cdn.115jon.site/kova-auth/avatars/user_abc123/<uploadId>.webp"
}
```

`previous` is `null` when there was no avatar.

## Webhook

Event name: `user.avatarUpdated` (not `user.updated`).

Upload `data`:

```json
{
  "userId": "user_abc123",
  "actorName": "Test User",
  "actorEmail": "user email",
  "imageUrl": "https://cdn.115jon.site/..."
}
```

Delete `data` uses `"removed": true` and omits `imageUrl`.

The delivery envelope is the normal webhook payload: `id`, `event`, `timestamp`, `data`.

## Related routes

Same CDN key shape, not the self-service API:

- `POST /api/admin/users/:userId/avatar` — admin upload
- `POST /api/admin/apps/:appId/users/:userId/avatar` — app-member upload (also allows `image/gif`)
- `DELETE` counterparts null `user.image`

## Not in this worker

- No `avatar_url` column and no new migration.
- No server-side 512px resize.
- No direct R2 binding. Objects are stored by the CDN worker behind `https://cdn.115jon.site`.

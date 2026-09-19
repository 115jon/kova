-- Migration 0011: User Additional Fields (additionalFields plugin)
--
-- Stores arbitrary, typed metadata per user row.  We keep these out of the
-- core `user` table so that:
--   1. Better Auth's schema remains untouched — upgrades are never blocked.
--   2. Adding/removing a field never requires modifying the base user table.
--   3. The JSON `value` column handles future schema evolution without ALTER.
--
-- The plugin exposes:
--   GET  /api/user/fields                  → current user's field values
--   PATCH /api/user/fields                 → update own field values (validated)
--   GET  /api/admin/users/:id/fields       → read any user (admin)
--   PATCH /api/admin/users/:id/fields      → write any user (admin)
--
-- Index: (userId, fieldKey) unique — one row per user per field.
-- Updated via INSERT OR REPLACE to keep upsert semantics simple.

CREATE TABLE IF NOT EXISTS `user_additional_fields` (
  `id`        TEXT    NOT NULL PRIMARY KEY,             -- ULID / random UUID
  `userId`    TEXT    NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `fieldKey`  TEXT    NOT NULL,                         -- e.g. "timezone", "locale"
  `value`     TEXT    NOT NULL,                         -- JSON-encoded value
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL
);

-- Unique constraint: one value per (user, fieldKey) pair.
CREATE UNIQUE INDEX IF NOT EXISTS `uaf_user_field`
  ON `user_additional_fields` (`userId`, `fieldKey`);

-- Fast lookup of all fields for a user.
CREATE INDEX IF NOT EXISTS `uaf_userId`
  ON `user_additional_fields` (`userId`);

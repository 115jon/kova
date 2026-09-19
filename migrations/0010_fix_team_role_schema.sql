-- Migration 0010: Fix team/role schema to match Better Auth 1.6 exact column layout
--
-- Problems in 0009:
--   1. teamMember had `organizationId NOT NULL` — Better Auth never inserts it (only teamId + userId + createdAt)
--   2. organizationRole had wrong columns (name/description/permissions) — BA uses role/permission (singular)
--
-- Strategy: drop and recreate both tables (dev-only; no data yet).

-- ── Fix teamMember ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `teamMember`;

CREATE TABLE `teamMember` (
  `id`        TEXT    NOT NULL PRIMARY KEY,
  `teamId`    TEXT    NOT NULL REFERENCES `team`(`id`) ON DELETE CASCADE,
  `userId`    TEXT    NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `createdAt` INTEGER
);

CREATE INDEX IF NOT EXISTS `teamMember_teamId` ON `teamMember` (`teamId`);
CREATE INDEX IF NOT EXISTS `teamMember_userId` ON `teamMember` (`userId`);

-- ── Fix organizationRole ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS `organizationRole`;

CREATE TABLE `organizationRole` (
  `id`             TEXT    NOT NULL PRIMARY KEY,
  `organizationId` TEXT    NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `role`           TEXT    NOT NULL,        -- unique role name within the org
  `permission`     TEXT    NOT NULL,        -- JSON object: { resource: [actions] }
  `createdAt`      INTEGER NOT NULL,
  `updatedAt`      INTEGER
);

CREATE INDEX IF NOT EXISTS `organizationRole_organizationId` ON `organizationRole` (`organizationId`);

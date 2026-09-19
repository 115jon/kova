-- Migration: Add organization plugin tables
-- Better Auth organization plugin: organizations, members, invitations
-- Also adds activeOrganizationId to the session table

-- ── Organization ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `organization` (
  `id`        TEXT    NOT NULL PRIMARY KEY,
  `name`      TEXT    NOT NULL,
  `slug`      TEXT    UNIQUE,
  `logo`      TEXT,
  `metadata`  TEXT,
  `createdAt` INTEGER NOT NULL
);

-- ── Member ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `member` (
  `id`             TEXT NOT NULL PRIMARY KEY,
  `organizationId` TEXT NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `userId`         TEXT NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `role`           TEXT NOT NULL DEFAULT 'member',
  `createdAt`      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS `member_organizationId` ON `member` (`organizationId`);
CREATE INDEX IF NOT EXISTS `member_userId` ON `member` (`userId`);

-- ── Invitation ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `invitation` (
  `id`             TEXT    NOT NULL PRIMARY KEY,
  `organizationId` TEXT    NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `email`          TEXT    NOT NULL,
  `role`           TEXT,
  `status`         TEXT    NOT NULL DEFAULT 'pending',
  `expiresAt`      INTEGER NOT NULL,
  `inviterId`      TEXT    NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `invitation_organizationId` ON `invitation` (`organizationId`);

-- ── Session: track active organization ────────────────────────────────────────
ALTER TABLE `session` ADD COLUMN `activeOrganizationId` TEXT;

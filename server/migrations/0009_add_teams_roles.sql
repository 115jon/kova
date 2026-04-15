-- Migration 0009: Teams + Dynamic RBAC
-- Enables:
--   organization({ teams: { enabled: true }, dynamicAccessControl: { enabled: true } })
--
-- New tables:  team, teamMember, organizationRole
-- New columns: session.activeTeamId, invitation.teamId

-- ── Teams ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `team` (
  `id`             TEXT    NOT NULL PRIMARY KEY,
  `name`           TEXT    NOT NULL,
  `organizationId` TEXT    NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `createdAt`      INTEGER NOT NULL,
  `updatedAt`      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS `team_organizationId` ON `team` (`organizationId`);

-- ── Team Members ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `teamMember` (
  `id`             TEXT    NOT NULL PRIMARY KEY,
  `teamId`         TEXT    NOT NULL REFERENCES `team`(`id`) ON DELETE CASCADE,
  `userId`         TEXT    NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `organizationId` TEXT    NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `createdAt`      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS `teamMember_teamId`         ON `teamMember` (`teamId`);
CREATE INDEX IF NOT EXISTS `teamMember_userId`         ON `teamMember` (`userId`);
CREATE INDEX IF NOT EXISTS `teamMember_organizationId` ON `teamMember` (`organizationId`);

-- ── Organization Roles (dynamic RBAC) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `organizationRole` (
  `id`             TEXT    NOT NULL PRIMARY KEY,
  `name`           TEXT    NOT NULL,
  `description`    TEXT,
  `permissions`    TEXT    NOT NULL,   -- JSON object: { "resource": ["action", ...] }
  `organizationId` TEXT    NOT NULL REFERENCES `organization`(`id`) ON DELETE CASCADE,
  `createdAt`      INTEGER NOT NULL,
  `updatedAt`      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS `organizationRole_organizationId` ON `organizationRole` (`organizationId`);

-- ── Session: active team tracking ─────────────────────────────────────────────
-- Better Auth uses this to know which team is currently selected.
ALTER TABLE `session` ADD COLUMN `activeTeamId` TEXT;

-- ── Invitation: optional team assignment on invite ────────────────────────────
ALTER TABLE `invitation` ADD COLUMN `teamId` TEXT;

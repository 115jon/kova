-- Migration: Add apikey table for @better-auth/api-key plugin
-- Generated from plugin schema inspection (see server/src/auth.ts plugins)

CREATE TABLE IF NOT EXISTS `apikey` (
  `id`                 TEXT     NOT NULL PRIMARY KEY,
  `configId`           TEXT     NOT NULL DEFAULT 'default',
  `name`               TEXT,
  `start`              TEXT,
  `referenceId`        TEXT     NOT NULL,
  `prefix`             TEXT,
  `key`                TEXT     NOT NULL UNIQUE,
  `refillInterval`     INTEGER,
  `refillAmount`       INTEGER,
  `lastRefillAt`       INTEGER,
  `enabled`            INTEGER  DEFAULT 1,
  `rateLimitEnabled`   INTEGER  DEFAULT 1,
  `rateLimitTimeWindow` INTEGER DEFAULT 86400000,
  `rateLimitMax`       INTEGER  DEFAULT 10,
  `requestCount`       INTEGER  DEFAULT 0,
  `remaining`          INTEGER,
  `lastRequest`        INTEGER,
  `expiresAt`          INTEGER,
  `createdAt`          INTEGER  NOT NULL,
  `updatedAt`          INTEGER  NOT NULL,
  `permissions`        TEXT,
  `metadata`           TEXT
);

CREATE INDEX IF NOT EXISTS `apikey_configId`    ON `apikey` (`configId`);
CREATE INDEX IF NOT EXISTS `apikey_referenceId` ON `apikey` (`referenceId`);
CREATE INDEX IF NOT EXISTS `apikey_key`         ON `apikey` (`key`);

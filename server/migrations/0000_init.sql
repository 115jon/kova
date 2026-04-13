-- Better Auth schema for Cloudflare D1 (SQLite)
-- Generated for: better-auth 1.6.x + admin plugin
-- Tables: user, session, account, verification

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user` (
    `id`              TEXT NOT NULL PRIMARY KEY,
    `name`            TEXT NOT NULL,
    `email`           TEXT NOT NULL UNIQUE,
    `emailVerified`   INTEGER NOT NULL DEFAULT 0, -- SQLite BOOLEAN
    `image`           TEXT,
    `createdAt`       INTEGER NOT NULL,            -- Unix ms
    `updatedAt`       INTEGER NOT NULL,
    -- admin plugin fields
    `role`            TEXT DEFAULT 'user',
    `banned`          INTEGER DEFAULT 0,
    `banReason`       TEXT,
    `banExpires`      INTEGER
);

-- ── Sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `session` (
    `id`              TEXT NOT NULL PRIMARY KEY,
    `expiresAt`       INTEGER NOT NULL,
    `token`           TEXT NOT NULL UNIQUE,
    `createdAt`       INTEGER NOT NULL,
    `updatedAt`       INTEGER NOT NULL,
    `ipAddress`       TEXT,
    `userAgent`       TEXT,
    `userId`          TEXT NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
    -- better-auth-cloudflare geolocation fields (all 7)
    `timezone`    TEXT,
    `city`        TEXT,
    `country`     TEXT,
    `region`      TEXT,
    `regionCode`  TEXT,
    `colo`        TEXT,
    `latitude`    TEXT,
    `longitude`   TEXT,
    -- admin plugin fields
    `impersonatedBy`  TEXT
);

-- ── Accounts (OAuth + credential links) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `account` (
    `id`                    TEXT NOT NULL PRIMARY KEY,
    `accountId`             TEXT NOT NULL,
    `providerId`            TEXT NOT NULL,
    `userId`                TEXT NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
    `accessToken`           TEXT,
    `refreshToken`          TEXT,
    `idToken`               TEXT,
    `accessTokenExpiresAt`  INTEGER,
    `refreshTokenExpiresAt` INTEGER,
    `scope`                 TEXT,
    `password`              TEXT,
    `createdAt`             INTEGER NOT NULL,
    `updatedAt`             INTEGER NOT NULL
);

-- ── Verification tokens (email verify / password reset) ─────────────────────
CREATE TABLE IF NOT EXISTS `verification` (
    `id`         TEXT NOT NULL PRIMARY KEY,
    `identifier` TEXT NOT NULL,
    `value`      TEXT NOT NULL,
    `expiresAt`  INTEGER NOT NULL,
    `createdAt`  INTEGER,
    `updatedAt`  INTEGER
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS `session_userId_idx`    ON `session`(`userId`);
CREATE INDEX IF NOT EXISTS `account_userId_idx`    ON `account`(`userId`);
CREATE INDEX IF NOT EXISTS `account_provider_idx`  ON `account`(`providerId`, `accountId`);

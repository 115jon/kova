-- Migration 0007: passkey table + username columns
-- Supports: passkey plugin, username plugin

-- ── Passkey (WebAuthn) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "passkey" (
  id                   TEXT PRIMARY KEY,
  name                 TEXT,
  "publicKey"          TEXT NOT NULL,
  "userId"             TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "webauthnUserID"     TEXT NOT NULL,
  counter              INTEGER NOT NULL,
  "deviceType"         TEXT NOT NULL,
  "backedUp"           INTEGER NOT NULL,
  transports           TEXT,
  "createdAt"          INTEGER,
  "aaguid"             TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkey_user ON "passkey"("userId");

-- ── Username plugin columns ───────────────────────────────────────────────────
-- SQLite does NOT support ALTER TABLE ADD COLUMN with a UNIQUE constraint.
-- Add the column plain, then enforce uniqueness via a unique index.
-- These ALTER TABLE statements will fail harmlessly if columns already exist.
ALTER TABLE "user" ADD COLUMN "username"        TEXT;
ALTER TABLE "user" ADD COLUMN "displayUsername" TEXT;

-- Unique index on username (partial: only non-null values must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username
  ON "user"("username")
  WHERE "username" IS NOT NULL;

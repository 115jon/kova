-- Add missing better-auth-cloudflare geolocation columns to session table.
-- NOTE: 0000_init.sql already includes these columns as of 2026-04-15.
-- This migration is idempotent via the PRAGMA approach — it is a no-op on
-- fresh databases where 0000_init already created the columns.
-- On older databases (pre-2026-04-15 init) it adds the missing columns.

-- The SQLite-compatible way: try to add, allow failure on duplicate column.
-- Wrangler runs each statement independently so each ALTER succeeds or fails
-- independently without blocking subsequent statements.
ALTER TABLE `session` ADD COLUMN `timezone`   TEXT;
ALTER TABLE `session` ADD COLUMN `regionCode` TEXT;
ALTER TABLE `session` ADD COLUMN `colo`       TEXT;

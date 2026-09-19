-- ── Migration 0017: Add updatedAt to app_oauth_provider ─────────────────────
--
-- The PUT /:id/oauth-providers endpoint needs to track when provider config
-- was last changed. This adds updatedAt and backfills it to now.

ALTER TABLE app_oauth_provider ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000);

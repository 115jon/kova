-- ════════════════════════════════════════════════════════════════════════════
-- APPLY THIS MIGRATION BEFORE DEPLOYING THE WORKER.
-- The new code selects this column on every app lookup; a worker deployed
-- first fails every request that resolves an application.
--   pnpm migrate:prod   (then)   pnpm deploy
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 0028: legacy publishable key alias for promoted applications
--
-- Promoting an application from development to production
-- (POST /api/admin/apps/:id/promote) issues a new pk_live_* publishable key.
-- Installed clients keep the old pk_dev_* key baked in, so the old key moves
-- here and every lookup by publishable key matches either column.
--
-- Sessions are scoped by session.app_id, never by key, so sessions minted
-- under the old key keep working. POST /api/admin/apps/:id/retire-legacy-key
-- clears the alias once no installed client still sends it.
--
-- ROLLBACK (with the pre-0028 worker build):
--   DROP INDEX IF EXISTS idx_application_legacy_pk;
--   ALTER TABLE application DROP COLUMN legacy_publishable_key;
--   DELETE FROM d1_migrations WHERE name = '0028_application_legacy_publishable_key.sql';
-- A promoted app's old key stops resolving after a rollback.

ALTER TABLE application ADD COLUMN legacy_publishable_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_legacy_pk ON application (legacy_publishable_key);

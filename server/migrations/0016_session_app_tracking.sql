-- ── Migration 0016: Session App Tracking ────────────────────────────────────────
--
-- Adds `app_id` to the `session` table so every login can be traced back to the
-- application whose SDK initiated it. This enables:
--
--   • Per-app "logins in the last 24h" counts (Overview tab stats)
--   • Revoking all sessions for a suspended application in one query
--   • Per-app audit log filtering (already exists; now enriched with app context)
--
-- ON DELETE SET NULL: if an application is deleted, the session rows are NOT
-- deleted (the underlying Better Auth sessions stay valid until expiry) but
-- app_id is cleared so they appear as platform-native sessions.
ALTER TABLE session ADD COLUMN app_id TEXT REFERENCES application(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_session_app ON session (app_id);

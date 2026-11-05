-- ── Migration 0032: Sign-in alerts ────────────────────────────────────────────
--
-- Users get an email when they sign in from a new device or country. Each app
-- can turn that off for sign-ins that happen in it (application.sign_in_alerts
-- = 0); on by default. Sign-ins with no app are always eligible.
--
-- idx_audit_country backs the admin audit log's country filter and facet.
ALTER TABLE application ADD COLUMN sign_in_alerts INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_audit_country
  ON audit_log (country, createdAt DESC);

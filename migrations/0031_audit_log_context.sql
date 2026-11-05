-- ── Migration 0031: Audit log context ─────────────────────────────────────────
--
-- App sign-ins and sign-outs are now audited, so events need to say which app
-- they happened in, and where. appId is the application.id the event belongs to
-- (NULL for platform/dashboard events). country and city come from Cloudflare's
-- request.cf and are denormalised like the actor columns; the rest of the
-- context (method, client, geo detail) stays in the metadata JSON.
--
-- Additive only. idx_audit_userId and idx_audit_action (0006) already cover
-- per-user and per-action timelines.
ALTER TABLE audit_log ADD COLUMN appId   TEXT;
ALTER TABLE audit_log ADD COLUMN country TEXT;
ALTER TABLE audit_log ADD COLUMN city    TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_appId
  ON audit_log (appId, createdAt DESC);

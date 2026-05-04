-- Migration 0019: Application hide-branding flag
--
-- Stores the per-application setting that suppresses the SDK footer badge
-- for paid plans and platform-admin overrides.

ALTER TABLE application ADD COLUMN hide_branding INTEGER NOT NULL DEFAULT 0;

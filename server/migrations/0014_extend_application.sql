-- ── Migration 0014: Application Extended Metadata ──────────────────────────────
--
-- Extends the `application` table with all Clerk-like fields:
--   • Branding / Appearance  — logo, favicon, colors, theme (SDK sign-in card)
--   • Email identity         — from_name, from_email, support_email
--   • Per-app SMTP           — host, port, user, encrypted password (Pro+)
--   • Billing                — Stripe customer/subscription IDs, plan, expiry
--   • Platform lifecycle     — suspended_at (no soft-delete; see hard-delete logic)

-- ── Branding ────────────────────────────────────────────────────────────────
ALTER TABLE application ADD COLUMN display_name     TEXT;
ALTER TABLE application ADD COLUMN logo_url         TEXT;
ALTER TABLE application ADD COLUMN favicon_url      TEXT;
ALTER TABLE application ADD COLUMN primary_color    TEXT DEFAULT '#3b82f6';
ALTER TABLE application ADD COLUMN background_color TEXT DEFAULT '#0f172a';
ALTER TABLE application ADD COLUMN theme            TEXT DEFAULT 'dark'
  CHECK (theme IN ('dark','light','auto'));
ALTER TABLE application ADD COLUMN home_url         TEXT;
ALTER TABLE application ADD COLUMN terms_url        TEXT;
ALTER TABLE application ADD COLUMN privacy_url      TEXT;

-- ── Email sender identity ────────────────────────────────────────────────────
ALTER TABLE application ADD COLUMN from_name        TEXT;
ALTER TABLE application ADD COLUMN from_email       TEXT;
ALTER TABLE application ADD COLUMN support_email    TEXT;

-- ── Per-app SMTP (Pro+ plan) ─────────────────────────────────────────────────
-- smtp_pass_enc: AES-GCM(BETTER_AUTH_SECRET, rawPassword) stored as hex
ALTER TABLE application ADD COLUMN smtp_host        TEXT;
ALTER TABLE application ADD COLUMN smtp_port        INTEGER DEFAULT 587;
ALTER TABLE application ADD COLUMN smtp_user        TEXT;
ALTER TABLE application ADD COLUMN smtp_pass_enc    TEXT;
ALTER TABLE application ADD COLUMN smtp_secure      INTEGER DEFAULT 0;

-- ── Billing ──────────────────────────────────────────────────────────────────
ALTER TABLE application ADD COLUMN stripe_customer_id      TEXT;
ALTER TABLE application ADD COLUMN stripe_subscription_id  TEXT;
ALTER TABLE application ADD COLUMN plan             TEXT DEFAULT 'free'
  CHECK (plan IN ('free','starter','pro','enterprise'));
ALTER TABLE application ADD COLUMN plan_expires_at  INTEGER;  -- epoch ms; NULL = perpetual

-- ── Platform lifecycle ───────────────────────────────────────────────────────
-- suspended_at: set by admin to block all SDK requests for this app
-- No soft-delete column — deletion is hard (ON DELETE CASCADE + Queue cleanup)
ALTER TABLE application ADD COLUMN suspended_at     INTEGER;

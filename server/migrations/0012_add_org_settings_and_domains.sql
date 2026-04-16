-- Migration 0012: Organization Settings + Domain Auto-Join
--
-- Adds two tables supporting Tier 2 features:
--
--   1. organization_settings — per-org admin toggles (require_mfa, etc.)
--      Lazily created on first write, so orgs that never change settings
--      have no row (defaults apply).
--
--   2. organization_domain — domain-based auto-join enrollment
--      Stores verified email domains for an org (e.g. "company.com").
--      When a new user signs up whose email domain matches, they are
--      auto-added to the org per the enrollment_mode.
--
-- Both tables reference the `organization` table's `id` column.
-- ON DELETE CASCADE ensures rows are cleaned up if an org is deleted.

-- ── 1. organization_settings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_settings (
  -- One row per org (upsert pattern)
  orgId          TEXT NOT NULL PRIMARY KEY,

  -- Require all members to have 2FA enabled before they can access org resources.
  -- 0 = not required (default), 1 = required.
  require_mfa    INTEGER NOT NULL DEFAULT 0,

  -- Future toggles go here (e.g. require_sso, ip_allowlist_enabled, etc.)

  createdAt      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updatedAt      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  FOREIGN KEY (orgId) REFERENCES organization(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_settings_orgId ON organization_settings(orgId);

-- ── 2. organization_domain ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_domain (
  id             TEXT NOT NULL PRIMARY KEY,   -- ULID generated on insert

  orgId          TEXT NOT NULL,

  -- The verified email domain (e.g. "company.com", lowercase, no "@" prefix).
  domain         TEXT NOT NULL,

  -- How to handle matches:
  --   "automatic_invitation" — send an org invitation email automatically
  --   "automatic_join"       — add to org as a member immediately (no email)
  enrollment_mode TEXT NOT NULL DEFAULT 'automatic_invitation',

  -- DNS TXT verification token + status
  -- Token is a random hex string placed in a TXT record at _ralph-auth.<domain>
  verification_token   TEXT,
  verified             INTEGER NOT NULL DEFAULT 0,  -- 0 = pending, 1 = verified
  verified_at          INTEGER,                      -- Unix ms

  -- Default role assigned to auto-joined members (maps to org role names)
  default_role   TEXT NOT NULL DEFAULT 'member',

  createdAt      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updatedAt      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  UNIQUE(orgId, domain),

  FOREIGN KEY (orgId) REFERENCES organization(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_domain_orgId  ON organization_domain(orgId);
CREATE INDEX IF NOT EXISTS idx_org_domain_domain ON organization_domain(domain);

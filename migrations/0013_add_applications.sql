-- ── Migration 0013: Applications (Publishable Key Registry) ────────────────────
--
-- Introduces the concept of a registered "Application" — analogous to Clerk's
-- application model.  Each app has:
--   • A client-safe publishable key  (pk_live_* / pk_dev_*)
--   • A server-only secret key       (sk_live_* / sk_dev_*)
--   • An allowlist of HTTP origins   (replaces the hardcoded ALLOWED_ORIGINS set)
--   • An allowlist of redirect URIs  (for OAuth callback validation)
--   • Toggle flags per provider      (which OAuth providers are available to this app)
--   • Environment flag               (live | dev)
--
-- The server validates the publishable key on every SDK request and derives
-- dynamic CORS headers + redirect URI allowlist from the row instead of the
-- hard-coded lists in index.ts / auth.ts.
--
-- Design notes:
--   - origins / redirectUris are newline-delimited strings (simple, no JSON)
--   - publishable_key is indexed UNIQUE for fast O(1) lookup on every request
--   - secret_key is stored as bcrypt hash (only raw value is shown once at creation)
--   - createdBy links to the admin user who created the app

CREATE TABLE IF NOT EXISTS application (
  id               TEXT PRIMARY KEY,           -- app_<uuid-hex-8>
  name             TEXT NOT NULL,
  environment      TEXT NOT NULL DEFAULT 'development' CHECK (environment IN ('development','production')),
  publishable_key  TEXT NOT NULL UNIQUE,        -- pk_dev_* or pk_live_*
  secret_key_hash  TEXT NOT NULL,              -- bcrypt(sk_live_*)
  -- Allowlists (newline-separated)
  allowed_origins  TEXT NOT NULL DEFAULT '',   -- "http://localhost:5180\nhttps://app.example.com"
  redirect_uris    TEXT NOT NULL DEFAULT '',   -- "https://app.example.com/api/auth/callback\n..."
  -- Metadata
  createdBy        TEXT,                        -- userId of admin who created it
  createdAt        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updatedAt        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_application_pk ON application (publishable_key);
CREATE INDEX IF NOT EXISTS idx_application_created ON application (createdAt DESC);

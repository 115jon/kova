-- ── Migration 0015: Application Membership + OAuth + Email + Plan Tables ────────
--
-- Introduces the core per-application tenant boundary tables:
--   • app_user           — links global Better Auth users to a specific application
--   • app_oauth_provider — per-app OAuth client_id/secret overrides
--   • app_email_template — per-app Handlebars email templates
--   • app_plan_feature   — feature flags synced from Stripe webhook
--   • organization.app_id — scopes existing orgs to an application

-- ── app_user: per-app user membership ────────────────────────────────────────
--
-- The Better Auth `user` table is global (same row for the same email across
-- any number of apps). `app_user` is the join that makes a user a "member" of
-- a specific application without duplicating the user row.
--
-- Populated automatically by the session.create.after databaseHook when a user
-- authenticates via an SDK request carrying a valid X-Publishable-Key.
--
-- ON DELETE CASCADE on both FKs means:
--   - Deleting an application removes all its app_user rows automatically.
--   - Deleting a user removes their membership from all apps.
CREATE TABLE IF NOT EXISTS app_user (
  id        TEXT    NOT NULL PRIMARY KEY,   -- "apu_" + 12 hex chars
  app_id    TEXT    NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  user_id   TEXT    NOT NULL REFERENCES "user"(id)      ON DELETE CASCADE,
  role      TEXT    NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','admin','member')),
  joined_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (app_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_app_user_app  ON app_user (app_id);
CREATE INDEX IF NOT EXISTS idx_app_user_user ON app_user (user_id);

-- ── app_oauth_provider: per-app OAuth provider overrides ─────────────────────
--
-- Allows an application to supply its own GitHub/Google/etc. client_id +
-- client_secret, overriding the platform defaults. When client_id is NULL,
-- the platform-level credentials are used.
--
-- client_secret_enc: AES-GCM(BETTER_AUTH_SECRET, rawSecret) stored as hex.
CREATE TABLE IF NOT EXISTS app_oauth_provider (
  id                TEXT    NOT NULL PRIMARY KEY,  -- "aop_" + 12 hex
  app_id            TEXT    NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,   -- 'github'|'google'|'discord'|'microsoft'|'apple'|'facebook'
  enabled           INTEGER NOT NULL DEFAULT 1,
  client_id         TEXT,              -- NULL = use platform default
  client_secret_enc TEXT,             -- AES-GCM encrypted; NULL = use platform default
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (app_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_app_oauth_app ON app_oauth_provider (app_id);

-- ── app_email_template: per-app transactional email templates ─────────────────
--
-- Handlebars HTML templates. Variables: {{app.name}}, {{app.logoUrl}},
-- {{user.email}}, {{user.name}}, {{link}}, {{expiresIn}}.
--
-- When no override exists for a given (app_id, type) pair, the platform-default
-- template is used (defined in server/src/email.ts).
CREATE TABLE IF NOT EXISTS app_email_template (
  id         TEXT    NOT NULL PRIMARY KEY,  -- "aet_" + 12 hex
  app_id     TEXT    NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL
    CHECK (type IN ('verify_email','magic_link','reset_password','org_invite')),
  subject    TEXT,
  html_body  TEXT,
  text_body  TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (app_id, type)
);
CREATE INDEX IF NOT EXISTS idx_app_template_app ON app_email_template (app_id);

-- ── app_plan_feature: feature flags written by Stripe webhook handler ──────────
--
-- Maintained in sync with application.plan. Written by the queue consumer when
-- a `plan.updated` event arrives from Stripe. Allows fine-grained feature
-- gating without re-querying D1 for the plan name every time.
CREATE TABLE IF NOT EXISTS app_plan_feature (
  app_id  TEXT    NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  feature TEXT    NOT NULL
    CHECK (feature IN ('branding','custom_smtp','orgs','audit_logs','sso','api_keys')),
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, feature)
);

-- ── organization.app_id: scope existing orgs to an application ────────────────
--
-- Added to the Better Auth `organization` table. NULL = legacy org created before
-- this migration (admin-platform org, not scoped to a client application).
ALTER TABLE organization ADD COLUMN app_id TEXT REFERENCES application(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_organization_app ON organization (app_id);

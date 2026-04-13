-- Migration 0006: Audit log
-- Tracks every security-relevant event: sign-ins, key operations, org changes, admin actions.
-- Uses ULID-style text IDs for natural time-ordering without resorting to an auto-increment.
-- createdAt is stored as INTEGER (Unix ms) so we can do cursor pagination with a simple WHERE.

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT    NOT NULL PRIMARY KEY,
  userId      TEXT    NOT NULL,               -- subject of the action (the affected user)
  orgId       TEXT,                           -- NULL for global events, set for org-scoped events
  actor       TEXT    NOT NULL,               -- who triggered it (same as userId for self-actions)
  actorName   TEXT,                           -- denormalised display name at event time
  actorEmail  TEXT,                           -- denormalised email at event time
  action      TEXT    NOT NULL,               -- dot-notation event name, e.g. "user.signIn"
  targetType  TEXT,                           -- "session" | "apiKey" | "member" | "user" | null
  targetId    TEXT,                           -- ID of the affected secondary entity
  targetLabel TEXT,                           -- human-readable label (email, key prefix, org name)
  ipAddress   TEXT,
  userAgent   TEXT,
  metadata    TEXT,                           -- JSON blob for extra structured context
  createdAt   INTEGER NOT NULL               -- Unix ms timestamp
);

-- Efficient per-user timeline (most common query)
CREATE INDEX IF NOT EXISTS idx_audit_userId
  ON audit_log (userId, createdAt DESC);

-- Efficient per-org timeline
CREATE INDEX IF NOT EXISTS idx_audit_orgId
  ON audit_log (orgId, createdAt DESC);

-- Admin global timeline
CREATE INDEX IF NOT EXISTS idx_audit_createdAt
  ON audit_log (createdAt DESC);

-- Filter by action category
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON audit_log (action, createdAt DESC);

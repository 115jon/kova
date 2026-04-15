-- Migration 0008: Webhook endpoints
-- Stores registered HTTP endpoints that receive signed event payloads.
-- Secrets are stored as HMAC-SHA256 hex digests — raw secret shown once at creation time only.
-- Events column is a JSON array of subscribed AuditAction names (e.g. '["user.signIn","apiKey.created"]').
-- failureCount is reset to 0 on any successful delivery.

CREATE TABLE IF NOT EXISTS webhook_endpoint (
  id            TEXT    NOT NULL PRIMARY KEY,   -- ULID-style: ${ts}_${uuid}
  userId        TEXT    NOT NULL,               -- owner (superadmin who created it)
  orgId         TEXT,                           -- NULL = global, set = org-scoped
  url           TEXT    NOT NULL,               -- target HTTPS URL
  secret        TEXT    NOT NULL,               -- HMAC-SHA256 hex of the raw signing secret
  events        TEXT    NOT NULL,               -- JSON array of subscribed event names
  enabled       INTEGER NOT NULL DEFAULT 1,     -- 0 = disabled (won't receive deliveries)
  createdAt     INTEGER NOT NULL,               -- Unix ms
  lastSuccess   INTEGER,                        -- Unix ms of most recent successful delivery
  lastFailure   INTEGER,                        -- Unix ms of most recent failed delivery
  failureCount  INTEGER NOT NULL DEFAULT 0      -- consecutive failures since last success
);

-- Efficient per-owner lookup (admin managing their endpoints)
CREATE INDEX IF NOT EXISTS idx_webhook_userId
  ON webhook_endpoint (userId, createdAt DESC);

-- Efficient per-org lookup (org-scoped endpoints)
CREATE INDEX IF NOT EXISTS idx_webhook_orgId
  ON webhook_endpoint (orgId, createdAt DESC);

-- Fan-out query: find all enabled endpoints — used by deliverEvent()
CREATE INDEX IF NOT EXISTS idx_webhook_enabled
  ON webhook_endpoint (enabled);

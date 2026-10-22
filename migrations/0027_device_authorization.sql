-- Migration 0027: device sign-in on Better Auth's device-authorization plugin
--
-- Replaces the KV device-login:* records (they expire on their own within
-- 10 minutes; nothing to clean up). Columns through "scope" are the plugin's;
-- the rest are Kova's grant fields (lib/device-authorization.ts): the owning
-- app and display-only device context for the hosted /device page.
--
-- Rows live for the 10-minute code lifetime. A redeemed code is deleted by
-- the plugin's atomic claim; expired and denied codes are deleted when polled.
-- Codes the device stops polling are swept by POST /api/pub/apps/:pk/device/start,
-- which deletes every expired row in the background (waitUntil).
--
-- ROLLBACK (with the pre-0027 worker build): DROP TABLE IF EXISTS "deviceCode";
--   DELETE FROM d1_migrations WHERE name = '0027_device_authorization.sql';

CREATE TABLE IF NOT EXISTS "deviceCode" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "deviceCode"       TEXT NOT NULL,
  "userCode"         TEXT NOT NULL,
  "userId"           TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "expiresAt"        DATE NOT NULL,
  "status"           TEXT NOT NULL,           -- pending | approved | denied
  "lastPolledAt"     DATE,
  "pollingInterval"  INTEGER,                 -- ms
  "clientId"         TEXT,                    -- the app's publishable key
  "scope"            TEXT,
  -- Kova grant fields
  "appId"            TEXT REFERENCES application(id) ON DELETE CASCADE,
  "deviceHostname"   TEXT,
  "devicePlatform"   TEXT,
  "deviceLabel"      TEXT,
  "requesterIp"      TEXT,
  "requesterCountry" TEXT,
  "requesterCity"    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_deviceCode_uidx" ON "deviceCode"("deviceCode");
CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_userCode_uidx" ON "deviceCode"("userCode");

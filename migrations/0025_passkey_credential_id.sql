-- Migration 0025: bring the passkey table in line with @better-auth/passkey.
--
-- 0007 created the table for the old in-core passkey plugin: it has no
-- credentialID column and requires webauthnUserID. @better-auth/passkey
-- (the package this worker uses) stores the credential id in credentialID and
-- has no webauthnUserID, so every registration failed with
-- "table passkey has no column named credentialID" and passkey sign-in could
-- not look credentials up.
--
-- Rebuilt rather than altered because SQLite cannot drop a NOT NULL constraint.
-- The old table had nowhere else to keep the credential id, so it lived in
-- `id`; existing rows keep working with credentialID = id.

CREATE TABLE "passkey_new" (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  "publicKey"    TEXT NOT NULL,
  "userId"       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  counter        INTEGER NOT NULL,
  "deviceType"   TEXT NOT NULL,
  "backedUp"     INTEGER NOT NULL,
  transports     TEXT,
  "createdAt"    INTEGER,
  "aaguid"       TEXT
);

INSERT INTO "passkey_new" (id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", transports, "createdAt", "aaguid")
SELECT id, name, "publicKey", "userId", id, counter, "deviceType", "backedUp", transports, "createdAt", "aaguid"
FROM "passkey";

DROP TABLE "passkey";
ALTER TABLE "passkey_new" RENAME TO "passkey";

CREATE INDEX idx_passkey_user ON "passkey"("userId");
-- A credential id names one passkey; sign-in looks it up and must find one row.
CREATE UNIQUE INDEX idx_passkey_credential ON "passkey"("credentialID");

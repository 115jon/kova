-- Migration 0026: Better Auth 1.7 — oidcProvider → @better-auth/oauth-provider
--
-- Better Auth 1.7 removed the oidcProvider plugin. Its replacement keeps the
-- same issuer, discovery path and authorize/token/userinfo endpoints, but a
-- different schema:
--   * oauthApplication (unused since clients came from config) is left alone.
--   * oauthAccessToken / oauthConsent keep their names with new columns, so the
--     legacy tables are RENAMED, not dropped. Outstanding Forgejo/LiteLLM
--     access and refresh tokens stop working once; both clients sign in again.
--   * New: oauthClient, oauthResource, oauthClientResource, oauthRefreshToken,
--     oauthClientAssertion. Trusted clients are not seeded here: their secrets
--     are env secrets, so the worker upserts them on first OIDC request
--     (lib/oidc-provider.ts ensureTrustedOidcClients).
--
-- The rest of the 1.7 upgrade's schema delta rides along:
--   * rateLimit: counters move from KV to D1 (1.7 needs an atomic increment).
--   * team.memberCount (backfilled), teamMember.membershipKey (NULL for
--     existing rows; Better Auth falls back to teamId+userId), invitation.createdAt.
--   * jwks.alg / jwks.crv: backfilled from each stored public JWK so existing
--     signing keys are used exactly as before.
--
-- ROLLBACK (only together with redeploying the pre-1.7 worker build):
--   DROP TABLE IF EXISTS "oauthAccessToken";
--   DROP TABLE IF EXISTS "oauthConsent";
--   DROP TABLE IF EXISTS "oauthRefreshToken";
--   DROP TABLE IF EXISTS "oauthClientResource";
--   DROP TABLE IF EXISTS "oauthResource";
--   DROP TABLE IF EXISTS "oauthClientAssertion";
--   DROP TABLE IF EXISTS "oauthClient";
--   ALTER TABLE "oauthAccessToken_legacy_oidc" RENAME TO "oauthAccessToken";
--   ALTER TABLE "oauthConsent_legacy_oidc" RENAME TO "oauthConsent";
--   DROP TABLE IF EXISTS "rateLimit";
--   -- The added team/teamMember/invitation/jwks columns are harmless to 1.6
--   -- and can stay. Then delete this file's row from d1_migrations:
--   DELETE FROM d1_migrations WHERE name = '0026_oauth_provider.sql';

-- ── Legacy oidcProvider tables (kept for rollback) ───────────────────────────
ALTER TABLE "oauthAccessToken" RENAME TO "oauthAccessToken_legacy_oidc";
ALTER TABLE "oauthConsent" RENAME TO "oauthConsent_legacy_oidc";

-- ── OAuth clients ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "oauthClient" (
  "id"                               TEXT NOT NULL PRIMARY KEY,
  "clientId"                         TEXT NOT NULL UNIQUE,
  "clientSecret"                     TEXT,
  "clientDiscoveryId"                TEXT,
  "disabled"                         INTEGER,
  "skipConsent"                      INTEGER,
  "enableEndSession"                 INTEGER,
  "subjectType"                      TEXT,
  "scopes"                           TEXT,
  "clientCredentialsScopes"          TEXT,
  "userId"                           TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt"                        DATE,
  "updatedAt"                        DATE,
  "name"                             TEXT,
  "uri"                              TEXT,
  "icon"                             TEXT,
  "contacts"                         TEXT,
  "tos"                              TEXT,
  "policy"                           TEXT,
  "softwareId"                       TEXT,
  "softwareVersion"                  TEXT,
  "softwareStatement"                TEXT,
  "redirectUris"                     TEXT NOT NULL,
  "postLogoutRedirectUris"           TEXT,
  "backchannelLogoutUri"             TEXT,
  "backchannelLogoutSessionRequired" INTEGER,
  "tokenEndpointAuthMethod"          TEXT,
  "applicationType"                  TEXT,
  "jwks"                             TEXT,
  "jwksUri"                          TEXT,
  "grantTypes"                       TEXT,
  "responseTypes"                    TEXT,
  "requirePKCE"                      INTEGER,
  "dpopBoundAccessTokens"            INTEGER,
  "referenceId"                      TEXT,
  "metadata"                         TEXT
);
CREATE INDEX IF NOT EXISTS "oauthClient_userId_idx" ON "oauthClient"("userId");

-- ── Protected resources (none configured; RFC 8707 checks are off) ───────────
CREATE TABLE IF NOT EXISTS "oauthResource" (
  "id"                            TEXT NOT NULL PRIMARY KEY,
  "identifier"                    TEXT NOT NULL UNIQUE,
  "name"                          TEXT NOT NULL,
  "accessTokenTtl"                INTEGER,
  "refreshTokenTtl"               INTEGER,
  "signingAlgorithm"              TEXT,
  "signingKeyId"                  TEXT,
  "allowedScopes"                 TEXT,
  "customClaims"                  TEXT,
  "dpopBoundAccessTokensRequired" INTEGER,
  "disabled"                      INTEGER,
  "createdAt"                     DATE,
  "updatedAt"                     DATE,
  "policyVersion"                 INTEGER,
  "metadata"                      TEXT
);

CREATE TABLE IF NOT EXISTS "oauthClientResource" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "clientId"   TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "resourceId" TEXT NOT NULL REFERENCES "oauthResource"("identifier") ON DELETE CASCADE,
  "metadata"   TEXT,
  "createdAt"  DATE
);
CREATE INDEX IF NOT EXISTS "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");
CREATE INDEX IF NOT EXISTS "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");
CREATE UNIQUE INDEX IF NOT EXISTS "oauthClientResource_clientId_resourceId_uidx" ON "oauthClientResource"("clientId", "resourceId");

-- ── Tokens (opaque values are stored hashed) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
  "id"                      TEXT NOT NULL PRIMARY KEY,
  "token"                   TEXT NOT NULL UNIQUE,
  "clientId"                TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId"               TEXT REFERENCES "session"("id") ON DELETE SET NULL,
  "userId"                  TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId"             TEXT,
  "authorizationCodeId"     TEXT,
  "resources"               TEXT,
  "requestedUserInfoClaims" TEXT,
  "expiresAt"               DATE NOT NULL,
  "createdAt"               DATE NOT NULL,
  "revoked"                 DATE,
  "rotatedAt"               DATE,
  "rotationReplayResponse"  TEXT,
  "rotationReplayExpiresAt" DATE,
  "authTime"                DATE,
  "confirmation"            TEXT,
  "scopes"                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
  "id"                      TEXT NOT NULL PRIMARY KEY,
  "token"                   TEXT UNIQUE,
  "clientId"                TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId"               TEXT REFERENCES "session"("id") ON DELETE SET NULL,
  "userId"                  TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId"             TEXT,
  "authorizationCodeId"     TEXT,
  "resources"               TEXT,
  "requestedUserInfoClaims" TEXT,
  "refreshId"               TEXT REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE,
  "expiresAt"               DATE,
  "createdAt"               DATE,
  "revoked"                 DATE,
  "confirmation"            TEXT,
  "scopes"                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");

CREATE TABLE IF NOT EXISTS "oauthConsent" (
  "id"                      TEXT NOT NULL PRIMARY KEY,
  "clientId"                TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "userId"                  TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId"             TEXT,
  "resources"               TEXT,
  "requestedUserInfoClaims" TEXT,
  "scopes"                  TEXT NOT NULL,
  "createdAt"               DATE,
  "updatedAt"               DATE
);
CREATE INDEX IF NOT EXISTS "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx" ON "oauthConsent"("userId");

-- private_key_jwt replay guard. Unused by the seeded clients (client secrets).
CREATE TABLE IF NOT EXISTS "oauthClientAssertion" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL
);

-- ── Rate limit counters (were KV) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "key"         TEXT NOT NULL UNIQUE,
  "count"       INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

-- ── Organization plugin (1.7) ────────────────────────────────────────────────
ALTER TABLE "team" ADD COLUMN "memberCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "team" SET "memberCount" = (SELECT COUNT(*) FROM "teamMember" WHERE "teamMember"."teamId" = "team"."id");

ALTER TABLE "teamMember" ADD COLUMN "membershipKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "teamMember_membershipKey_uidx" ON "teamMember"("membershipKey");

-- Existing invitations get "sent at" = expiry minus the default 48h lifetime.
ALTER TABLE "invitation" ADD COLUMN "createdAt" INTEGER NOT NULL DEFAULT 0;
UPDATE "invitation" SET "createdAt" = (
  CASE WHEN typeof("expiresAt") = 'text'
    THEN CAST(strftime('%s', "expiresAt") AS INTEGER) * 1000
    ELSE "expiresAt"
  END
) - 172800000;

-- ── JWT plugin (1.7) ─────────────────────────────────────────────────────────
-- A NULL alg would inherit keyPairConfig.alg (RS256). Pin each existing key to
-- what it actually is, read from its public JWK, so no key changes meaning.
ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;
UPDATE "jwks" SET
  "alg" = CASE json_extract("publicKey", '$.kty')
    WHEN 'RSA' THEN COALESCE(json_extract("publicKey", '$.alg'), 'RS256')
    WHEN 'OKP' THEN 'EdDSA'
    WHEN 'EC' THEN CASE json_extract("publicKey", '$.crv') WHEN 'P-384' THEN 'ES384' WHEN 'P-521' THEN 'ES512' ELSE 'ES256' END
  END,
  "crv" = json_extract("publicKey", '$.crv')
WHERE "alg" IS NULL AND json_valid("publicKey");

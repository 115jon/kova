-- Migration 0020: OIDC issuer tables (jwt + oidcProvider plugins)
-- Discovery: /api/auth/.well-known/openid-configuration
-- Root alias: /.well-known/openid-configuration (Hono rewrite)

CREATE TABLE IF NOT EXISTS "jwks" (
  id          TEXT NOT NULL PRIMARY KEY,
  "publicKey"  TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt"  INTEGER NOT NULL,
  "expiresAt"  INTEGER
);

CREATE TABLE IF NOT EXISTS "oauthApplication" (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  icon            TEXT,
  metadata        TEXT,
  "clientId"      TEXT NOT NULL UNIQUE,
  "clientSecret"  TEXT,
  "redirectUrls"  TEXT NOT NULL,
  type            TEXT NOT NULL,
  disabled        INTEGER NOT NULL DEFAULT 0,
  "userId"        TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  "createdAt"     INTEGER NOT NULL,
  "updatedAt"     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_application_user ON "oauthApplication"("userId");

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
  id                       TEXT NOT NULL PRIMARY KEY,
  "accessToken"            TEXT NOT NULL UNIQUE,
  "refreshToken"           TEXT NOT NULL UNIQUE,
  "accessTokenExpiresAt"   INTEGER NOT NULL,
  "refreshTokenExpiresAt"  INTEGER NOT NULL,
  "clientId"               TEXT NOT NULL,
  "userId"                 TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  scopes                   TEXT NOT NULL,
  "createdAt"              INTEGER NOT NULL,
  "updatedAt"              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_token_client ON "oauthAccessToken"("clientId");
CREATE INDEX IF NOT EXISTS idx_oauth_access_token_user ON "oauthAccessToken"("userId");

CREATE TABLE IF NOT EXISTS "oauthConsent" (
  id              TEXT NOT NULL PRIMARY KEY,
  "clientId"      TEXT NOT NULL,
  "userId"        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scopes          TEXT NOT NULL,
  "consentGiven"  INTEGER NOT NULL,
  "createdAt"     INTEGER NOT NULL,
  "updatedAt"     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_consent_client ON "oauthConsent"("clientId");
CREATE INDEX IF NOT EXISTS idx_oauth_consent_user ON "oauthConsent"("userId");

-- ── Migration 0018: Auth Subdomain Slug ─────────────────────────────────────────
--
-- Each application gets a unique, URL-safe slug used as the hostname component
-- of its isolated authentication subdomain: {slug}.auth.115jon.site
--
-- auth_slug rules:
--   - URL-safe characters only: [a-z0-9-]
--   - Max 63 characters (DNS label limit, RFC 1035)
--   - Auto-generated at creation time: slugify(name) + '-' + 6 random chars
--   - Globally UNIQUE across all applications
--   - IMMUTABLE after creation — changing it breaks bookmarked auth flows,
--     OAuth callback URIs, and redirect_uri allowlists in client apps.
--     (Same model as Clerk. No rename without a grace-period redirect — see Tier 3 backlog.)
--
-- custom_domain (optional):
--   - Production apps may CNAME their own domain to auth.115jon.site
--   - e.g. login.mycompany.com → auth.115jon.site
--   - Worker resolves: slug lookup first, custom_domain fallback
--   - Requires customer to add the CNAME record; we store it for Host-header matching
--
-- Session isolation:
--   - Better Auth does NOT set a Domain= cookie attribute by default (RFC 6265 §5.2)
--   - Cookies are scoped to the exact hostname that set them:
--       auth.115jon.site      → dashboard session (never bleeds into subdomains)
--       sdk-demo.auth.115jon.site → app session (never bleeds peer subdomains or parent)
--   - The Worker calls createAuth() with baseURL = subdomain URL to ensure
--     Better Auth's cookie emitter targets the correct origin.

ALTER TABLE application ADD COLUMN auth_slug     TEXT;
ALTER TABLE application ADD COLUMN custom_domain TEXT;

-- Unique constraints — enforced at the DB level to prevent race conditions
-- during concurrent application creation. NULL values are excluded from
-- UNIQUE constraints in SQLite (multiple NULLs are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_application_auth_slug    ON application (auth_slug)    WHERE auth_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_application_custom_domain ON application (custom_domain) WHERE custom_domain IS NOT NULL;

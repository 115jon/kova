# OIDC issuer: Better Auth 1.7 migration

Better Auth 1.7.0 removed the `oidcProvider` plugin. That is the plugin that makes Kova the
OIDC issuer for 1:15 Forgejo (git.115jon.com) and LiteLLM SSO. Kova now runs
`@better-auth/oauth-provider` 1.7.12 instead. Neither client needs to be reconfigured.

## What stays the same

| | Value |
| --- | --- |
| Issuer | `${AUTH_URL}/api/auth`, for example `https://auth.115jon.site/api/auth` |
| Discovery | `/.well-known/openid-configuration` and `/api/auth/.well-known/openid-configuration` |
| Authorize / token / userinfo | `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo` (LiteLLM hard-codes these) |
| JWKS | `/api/auth/jwks`, with the same RS256 keys. Existing `jwks` rows are reused, and migration 0026 sets each row's `alg` from its public JWK. |
| Client ids, secrets, redirect URIs | Taken from the same env vars as before (see below) |
| `sub` | The Kova user id (public subject, not pairwise). Forgejo links accounts by this value. |
| ID token claims | `given_name`, `family_name`, `name`, `profile` (avatar URL), `updated_at` (profile scope); `email`, `email_verified` (email scope); `preferred_username` (always) |
| UserInfo claims | `sub`, `email`, `email_verified`, `name`, `picture`, `given_name`, `family_name`, `preferred_username` |
| Token lifetimes | 1h access token and ID token, 7d refresh token, 10m authorization code |
| Consent | Skipped for both clients |
| Account picker | Forgejo is still routed through `/oauth/continue` before authorize. `/oauth/continue` is also the login page. |
| Client auth | `client_secret_post`, `client_secret_basic`, and both at once (the body credentials win). JSON token bodies are still accepted. |

## What changed

- Clients now live in the `oauthClient` table. The worker upserts the two trusted clients from env
  on the first `/api/auth/oauth2/*` request handled by each isolate
  (`src/worker/lib/oidc-provider.ts`, `ensureTrustedOidcClients`). Secrets are stored
  SHA-256-hashed. Rotating an env secret takes effect on the next request. Removing an env var does
  **not** disable the row: set `disabled = 1` on it by hand.
- Opaque access and refresh tokens are stored hashed and are tied to the Kova session that
  authorized them. Signing out of that session invalidates them at `/oauth2/userinfo`.
- ID tokens carry `acr: "0"`. The old plugin sent `urn:mace:incommon:iap:silver`; the new plugin
  owns this claim and it can't be overridden. Neither client reads it.
- PKCE is S256 only. The old config set `allowPlainCodeChallengeMethod: true`; the new plugin has
  no such option and rejects `code_challenge_method=plain`. Neither client is known to send PKCE,
  but confirm on the first production login of each (a plain-PKCE client would fail at authorize
  with `invalid_request`).
- `end_session_endpoint` is now `/api/auth/oauth2/end-session`. The old `/oauth2/endsession` path
  is aliased to it.
- If one of these clients asks for `offline_access` without PKCE and without an OIDC `nonce`, Kova
  drops `offline_access` instead of failing the sign-in. In that case no refresh token is issued.
  The old plugin issued one.
- Client and consent management endpoints under `/api/auth/oauth2/*` only accept platform
  sessions, and creating a client requires the `admin` role. Dynamic registration is off.
- The token endpoint's rate limit is 200 requests per minute per IP, and so is UserInfo's. This
  matches the old global ceiling.

Other Better Auth 1.7 changes that ship in the same deploy:

- Verification values (magic links, email verification, password reset, OAuth codes) moved from KV
  to the D1 `verification` table (`verification.storeInDatabase`). Links issued **before** the
  deploy stop working.
- Rate-limit counters moved from KV to the new D1 `rateLimit` table. Better Auth 1.7 needs an atomic
  increment, which KV can't provide. Counters reset at deploy.
- `session.storeSessionInDatabase: true` is now set explicitly. Production already behaved this way.
- Migration 0026 adds `team.memberCount` (backfilled from existing rows),
  `teamMember.membershipKey`, and `invitation.createdAt` (backfilled as expiry minus 48h).

## Env vars

These are unchanged; keep the current values.

- `AUTH_URL`: determines the issuer string.
- `BETTER_AUTH_SECRET`: the JWKS private keys are encrypted with it, and changing it breaks
  signing.
- `FORGEJO_OIDC_CLIENT_ID`, `FORGEJO_OIDC_CLIENT_SECRET`
- `LITELLM_OIDC_CLIENT_ID`, `LITELLM_OIDC_CLIENT_SECRET`

A client is registered only when both its id and its secret are set.

## Deploy order

1. **Apply the migration**: `pnpm migrate:prod`, which applies `0026_oauth_provider.sql` (and
   `0027_device_authorization.sql` if it ships in the same release; that one only adds a table). This
   renames the old `oauthAccessToken` and `oauthConsent` tables, so OIDC on the *old* worker is
   down until step 2. Do steps 1 and 2 back to back.
2. **Deploy**: `pnpm deploy`.
3. **Verify discovery**: `curl -s https://auth.115jon.site/.well-known/openid-configuration`
   must show `issuer` = `https://auth.115jon.site/api/auth` and the
   `/api/auth/oauth2/{authorize,token,userinfo}` endpoints. Also check that
   `curl -s https://auth.115jon.site/api/auth/jwks` still lists the old `kid`.
4. **Test a Forgejo login** (this also confirms S256-only PKCE is fine for it): sign out of git.115jon.com, then sign in with Kova. You should get
   the account picker, then your existing Forgejo account, not a new-account prompt. Then check
   `SELECT clientId FROM oauthClient` shows both clients.
5. **Test a LiteLLM login** (same PKCE check): open the LiteLLM SSO login and confirm you land as the same user.

Access tokens and refresh tokens issued before the migration are invalidated once. Both clients
recover with a normal sign-in.

## Rollback

1. Redeploy the last pre-1.7 worker build.
2. Run the SQL in the header comment of `migrations/0026_oauth_provider.sql`. It drops the new
   OAuth tables and `rateLimit`, renames `oauthAccessToken_legacy_oidc` and
   `oauthConsent_legacy_oidc` back, and deletes the `d1_migrations` row. The added
   team, invitation and jwks columns are harmless to 1.6 and can stay.
3. Verification links and rate-limit counters created on 1.7 live in D1 and are ignored by 1.6,
   which reads them from KV again.

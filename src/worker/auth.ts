import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { APIError } from "better-auth/api";
import { oauthProvider } from "@better-auth/oauth-provider";
import { admin, bearer, genericOAuth, jwt, magicLink, multiSession, organization, twoFactor, username } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { logAudit } from "./audit";
import {
  devEmailCaptureEnabled,
  invitationEmail,
  magicLinkEmail,
  resetPasswordEmail,
  sendEmail,
  twoFactorOtpEmail,
  verificationEmail,
} from "./email";
import { getAppId } from "./lib/app-context";
import { kovaDeviceGrant, kovaDeviceRedemption } from "./lib/device-authorization";
import { DEVICE_CODE_INTERVAL_SECONDS, DEVICE_CODE_TTL_SECONDS, generateDeviceCode } from "./lib/device-code";
import { passkeyOrigins } from "./lib/passkey-origins";
import {
  legacyIdTokenClaims,
  legacyUserInfoClaims,
  OIDC_ACCESS_TOKEN_TTL_SECONDS,
  OIDC_CLAIMS_SUPPORTED,
  OIDC_CODE_TTL_SECONDS,
  OIDC_REFRESH_TOKEN_TTL_SECONDS,
  OIDC_SCOPES,
} from "./lib/oidc-provider";
import { hasAdminRole, isAllowlistedAdminEmail, parseEmailAllowlist } from "./lib/roles";
import { resolveOrigin, staticOrigins } from "./middleware/cors";
import {
  findAutoJoinDomainForEmail,
  findMFAEnforcedOrgBlockingUser,
} from "./org-settings";
import { ac, member, admin as orgAdmin, owner } from "./permissions";
import { deliverEvent } from "./webhook";


/**
 * Factory — called once per request inside the fetch() handler.
 *
 * IMPORTANT: Do NOT call this at module level. Workers share module
 * scope across requests in the same isolate, so a module-level
 * `betterAuth({ database: env.DB })` would fail (env is undefined
 * at import time) and could leak state between concurrent requests.
 *
 * withCloudflare(cloudflareOptions, betterAuthOptions) signature:
 *   - First arg: Cloudflare-specific (d1Native, kv, r2, cf, geo...)
 *   - Second arg: standard BetterAuth config (providers, plugins, etc.)
 *   withCloudflare sets `database` internally from d1Native — don't
 *   set it again in the second arg or it will conflict.
 */
export function createAuth(env: Env, cf?: IncomingRequestCfProperties, req?: Request, baseURLOverride?: string) {
  const capture = devEmailCaptureEnabled(env);
  const send = (mail: { to: string; subject: string; html: string }) =>
    sendEmail({ ...mail, apiKey: env.RESEND_API_KEY, capture, from: env.EMAIL_FROM });

  return betterAuth(
    withCloudflare(
      // ── First arg: Cloudflare bindings + options ──────────────
      {
        // Native D1 binding — no Drizzle adapter needed
        d1Native: env.DB,

        // KV for session secondary storage + rate limit counters
        kv: env.KV,

        // Pass `cf` from the incoming request for geo + IP detection.
        // If cf is undefined (local dev without --remote), disable geo.
        cf: cf,
        geolocationTracking: !!cf,
        autoDetectIpAddress: !!cf,
      },

      // ── Second arg: Better Auth config ────────────────────────
      {
        secret: env.BETTER_AUTH_SECRET,
        // When baseURLOverride is provided (by hostedAuthRouter for subdomain requests),
        // cookies are scoped to that exact hostname (RFC 6265 §5.2 exact-hostname rule).
        // NEVER set advanced.crossSubDomainCookies on these instances.
        baseURL: baseURLOverride ?? env.AUTH_URL,
        basePath: "/api/auth",

        // ── Cross-origin cookie policy ────────────────────────────
        //
        // Better Auth issues session cookies at auth.115jon.site (the auth
        // server's own domain).  SDK consumers run on different origins
        // (e.g., *.workers.dev, *.115jon.site sub-apps).
        //
        // Problem: browsers default to SameSite=Lax for cookies.
        // SameSite=Lax blocks cookie attachment on cross-origin subresource
        // requests (XMLHttpRequest, fetch) even when `credentials: "include"`
        // is set, so get-session always returns `null` for consumers on a
        // different origin than the auth server.
        //
        // Solution: SameSite=None; Secure — the W3C-specified cookie
        // attribute that allows cross-origin credentialed requests.  This
        // is the same configuration used by Clerk, Auth0, Kinde, and every
        // other multi-tenant auth service that issues cookies.
        //
        // Security posture: the cookie is still HttpOnly (no JS access),
        // Secure (HTTPS only), and the CORS layer already enforces per-app
        // origin allowlists via the X-Publishable-Key mechanism, so the
        // only new attack surface is CSRF from an unregistered origin — which
        // is already prevented because (a) state-mutating endpoints require
        // JSON bodies (not HTML-form-submittable) and (b) the CORS preflight
        // blocks unregistered origins before any request body is consumed.
        advanced: {
          // SameSite=None; Secure — the W3C-specified cookie attribute that
          // allows browsers to send cookies on cross-origin credentialed fetch()
          // requests (the fundamental requirement for any multi-tenant auth
          // service such as Clerk, Auth0, Kinde, etc.).
          //
          // DO NOT add `partitioned: true` (CHIPS) here.
          // CHIPS keys the cookie by (top-level-site × cookie-domain), so a
          // session cookie issued when the user was at auth.115jon.site would
          // have partition key auth.115jon.site.  When the SDK demo at
          // kova-auth-sdk-demo.jontitor.workers.dev later fetches
          // auth.115jon.site/api/auth/get-session, the browser uses the NEW
          // partition key workers.dev — which has no stored cookie — so the
          // session is never sent.  CHIPS is designed for tracker isolation,
          // not cross-site session sharing.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
          // Already the production default. Spelled out because Better Auth
          // turns the origin/CSRF check off under test runners, and the route
          // tests must see the same check production runs.
          disableOriginCheck: false,
        },


        // ── Account linking ───────────────────────────────────────
        //
        // Prevents duplicate accounts when the same email is used with
        // different providers. All active social providers are trusted so that
        // e.g. a user who signed up with Google can later sign in with GitHub
        // (same verified email) and get one unified account.
        //
        // "trusted" means: if the provider has verified the email, auto-link.
        // Untrusted providers would require the user to confirm via a challenge.
        // We mark all six social providers as trusted because each performs
        // email-ownership verification in their OAuth flow.
        account: {
          // ── Account linking ─────────────────────────────────────
          //
          // Prevents duplicate accounts when the same email is used with
          // different providers. All active social providers are trusted so that
          // e.g. a user who signed up with Google can later sign in with GitHub
          // (same verified email) and get one unified account.
          accountLinking: {
            enabled: true,
            trustedProviders: [
              "google",
              "discord",
              "github",
              "microsoft",
              "apple",
              "facebook",
              "email",          // credential accounts (email+password / magic-link)
            ],
          },

          // The OAuth state cookie check stays on. Every provider flow starts from a
          // same-origin page on this host (/api/pub/apps/:pk/oauth/start,
          // /api/hosted/oauth-start, the dashboard), so the cookie is set where the
          // callback lands. Skipping it would let anyone replay their own callback
          // URL into another browser and sign it in as them.
        },

        // ── Error page ───────────────────────────────────────────
        onAPIError: {
          errorURL: `${env.DASHBOARD_URL}/auth-error`,
        },

        // ── Verification values ───────────────────────────────────
        // Better Auth 1.7 consumes verification values (magic links, reset
        // and email-verification tokens, OAuth codes) atomically. KV has no
        // atomic get-and-delete, so they live in D1's verification table.
        verification: {
          storeInDatabase: true,
        },

        // ── Rate limiting ─────────────────────────────────────────
        // Counters live in D1 (`rateLimit` table): Better Auth 1.7 needs an
        // atomic increment, which KV cannot do. Costs a D1 read + write per
        // accepted request.
        // Global ceiling is high (200/min) since the admin dashboard makes
        // multiple requests per page (get-session, list-users, list-sessions).
        // Tight limits only on credential endpoints that need brute-force protection.
        rateLimit: {
          enabled: true,
          window: 60,   // 60-second sliding window
          max: 200,     // global ceiling — plenty for normal admin dashboard use
          storage: "database",
          customRules: {
            "/sign-in/email": { window: 60, max: 5 },          // brute-force protection
            "/sign-in/magic-link": { window: 60, max: 3 },      // magic link send throttle
            "/two-factor/verify-totp": { window: 60, max: 5 }, // TOTP guessing protection
            "/two-factor/send-otp": { window: 60, max: 3 },    // email OTP send throttle
            "/request-password-reset": { window: 60, max: 3 }, // reset email throttle
          },
        },

        emailVerification: {
          // Whoever opens the emailed link owns the mailbox, so verifying also
          // signs them in. Without it the app page sends them back signed out
          // (or, with another account's cookie in the browser, as that account).
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
            const { subject, html } = verificationEmail(url);
            await send({ to: user.email, subject, html });
          },
        },

        // ── Email + Password ──────────────────────────────────────
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          minPasswordLength: 12,

          sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
            const { subject, html } = resetPasswordEmail(url);
            await send({ to: user.email, subject, html });
          },
        },

        // ── Auto-promote admin email ──────────────────────────────
        // Runs BEFORE the user row is inserted in D1. Any account
        // (Google, Discord, email/password) whose email matches
        // DASHBOARD_ADMIN_EMAIL gets role:"admin" at creation time.
        databaseHooks: {
          user: {
            create: {
              before: async (user: { email?: string;[key: string]: unknown }) => {
                if (isAllowlistedAdminEmail(user.email, env.DASHBOARD_ADMIN_EMAIL)
                  && parseEmailAllowlist(env.DASHBOARD_ADMIN_EMAIL).length > 0) {
                  return { data: { ...user, role: "admin" } };
                }
              },
              after: async (user: { id: string; name?: string | null; email?: string }) => {
                // ── 1. Audit + webhook fan-out ─────────────────────
                await logAudit(env.DB, {
                  userId: user.id,
                  actor: user.id,
                  actorName: user.name ?? null,
                  actorEmail: user.email ?? null,
                  action: "user.signUp",
                }).catch(() => { }); // non-fatal

                deliverEvent(env.DB, "user.signUp", {
                  userId: user.id,
                  actorName: user.name ?? null,
                  actorEmail: user.email ?? null,
                }).catch(() => { });

                // ── 2. Domain-based org auto-join ──────────────────
                // If the user's email domain matches a verified org domain,
                // either send an invitation or directly add them as a member
                // depending on the org's enrollment_mode setting.
                if (!user.email) return;

                const domainRecord = await findAutoJoinDomainForEmail(
                  env.DB,
                  user.email
                ).catch(() => null);

                if (!domainRecord) return; // no matching domain configured

                if (domainRecord.enrollment_mode === "automatic_join") {
                  // Direct insert into org as a member — fire-and-forget
                  const { generateId } = await import("better-auth");
                  env.DB
                    .prepare(`
                      INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt)
                      VALUES (?, ?, ?, ?, ?)
                    `)
                    .bind(
                      generateId(),
                      domainRecord.orgId,
                      user.id,
                      domainRecord.default_role,
                      Date.now()
                    )
                    .run()
                    .catch(() => { });

                  // Log the auto-join event
                  logAudit(env.DB, {
                    userId: user.id,
                    actor: user.id,
                    actorName: user.name ?? null,
                    actorEmail: user.email,
                    action: "member.autoJoined",
                    metadata: { orgId: domainRecord.orgId, domain: domainRecord.domain },
                  }).catch(() => { });

                } else {
                  // automatic_invitation — look up org name, then send an email invite
                  const org = await env.DB
                    .prepare('SELECT name FROM organization WHERE id = ? LIMIT 1')
                    .bind(domainRecord.orgId)
                    .first<{ name: string }>()
                    .catch(() => null);

                  if (org && env.RESEND_API_KEY) {
                    const inviteLink = `${env.DASHBOARD_URL}/accept-invitation/domain-join?orgId=${domainRecord.orgId}&userId=${user.id}`;
                    const { subject, html } = invitationEmail({
                      inviterName: "kova-auth",
                      inviterEmail: "noreply@auto-join",
                      orgName: org.name,
                      inviteLink,
                      role: domainRecord.default_role,
                    });
                    send({
                      to: user.email,
                      subject,
                      html,
                    }).catch(() => { });
                  }
                }
              },
            },
          },
          session: {
            create: {
              // ── MFA enforcement: block session creation if the user belongs ──
              // to an org with require_mfa = 1 and has not set up 2FA yet.
              //
              // This fires BEFORE the session row is inserted in D1, so the
              // login is hard-blocked. The APIError FORBIDDEN propagates back
              // to the client as a 403 with { code: "MFA_REQUIRED", orgId }.
              //
              // The client SDK / sign-in form should detect this code and redirect
              // the user to the 2FA setup flow before they can proceed.
              before: async (session: { userId: string }) => {
                const blockingOrgId = await findMFAEnforcedOrgBlockingUser(
                  env.DB,
                  session.userId
                ).catch(() => null); // never block on lookup failure

                if (blockingOrgId) {
                  throw new APIError("FORBIDDEN", {
                    message:
                      "Your organization requires two-factor authentication. " +
                      "Please enable 2FA on your account before signing in.",
                    code: "MFA_REQUIRED",
                    orgId: blockingOrgId,
                  });
                }
              },
              after: async (session: {
                userId: string;
                id: string;
                ipAddress?: string | null;
                userAgent?: string | null;
              }) => {
                // The session object only carries userId — look up name+email to
                // populate the actor columns so the audit log shows a real name.
                const user = await env.DB
                  .prepare('SELECT name, email FROM "user" WHERE id = ? LIMIT 1')
                  .bind(session.userId)
                  .first<{ name: string; email: string }>()
                  .catch(() => null);

                await logAudit(env.DB, {
                  userId: session.userId,
                  actor: session.userId,
                  actorName: user?.name ?? null,
                  actorEmail: user?.email ?? null,
                  action: "user.signIn",
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                }).catch(() => { }); // non-fatal — never block login
                // Webhook fan-out
                deliverEvent(env.DB, "user.signIn", {
                  userId: session.userId,
                  actorName: user?.name ?? null,
                  actorEmail: user?.email ?? null,
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                }).catch(() => { });

                // ── Per-app membership + counter tracking ─────────────────
                // Resolve app_id from the request that triggered this session
                // via the WeakMap set by the CORS middleware's PK lookup.
                const appId = req ? getAppId(req) : undefined;
                if (appId) {
                  const { generateId } = await import("better-auth");

                  // 1. Upsert app_user — first time this user touches this app
                  env.DB.prepare(
                    `INSERT OR IGNORE INTO app_user (id, app_id, user_id, role)
                     VALUES (?, ?, ?, 'member')`
                  ).bind(`apu_${generateId(12)}`, appId, session.userId)
                    .run()
                    .catch(() => { });

                  // Do not stamp app_id onto this session. The auth-domain cookie
                  // is SSO; SDK apps mint a sibling bearer row instead.

                  // 3. Increment AppCounter DO — atomic, no D1 COUNT(*) needed
                  try {
                    const doId = env.APP_COUNTER.idFromName(appId);
                    env.APP_COUNTER.get(doId).fetch(
                      "https://do/increment",
                      { method: "POST", body: JSON.stringify({ counter: "logins_24h" }) }
                    ).catch(() => { });
                  } catch { /* DO not available in local dev without --remote */ }
                }
              },
            },
            delete: {
              after: async (session: {
                userId: string;
                ipAddress?: string | null;
                userAgent?: string | null;
              }) => {
                // Look up user — may still exist after session deletion
                const user = await env.DB
                  .prepare('SELECT name, email FROM "user" WHERE id = ? LIMIT 1')
                  .bind(session.userId)
                  .first<{ name: string; email: string }>()
                  .catch(() => null);

                await logAudit(env.DB, {
                  userId: session.userId,
                  actor: session.userId,
                  actorName: user?.name ?? null,
                  actorEmail: user?.email ?? null,
                  action: "user.signOut",
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                }).catch(() => { }); // non-fatal
                // Webhook fan-out
                deliverEvent(env.DB, "user.signOut", {
                  userId: session.userId,
                  actorName: user?.name ?? null,
                  actorEmail: user?.email ?? null,
                  ipAddress: session.ipAddress ?? null,
                  userAgent: session.userAgent ?? null,
                }).catch(() => { });
              },
            },
          },
        },

        // ── Social providers ──────────────────────────────────────
        //
        // All providers are conditional on env vars being set.
        // In local dev, set them in .dev.vars. In production, use `wrangler secret put`.
        // Required always:  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
        // Optional:         DISCORD_*, GITHUB_*, MICROSOFT_*, APPLE_*, FACEBOOK_*
        socialProviders: {
          // ── Google (always required) ────────────────────────────
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },

          // ── Discord (conditional) ───────────────────────────────
          ...(env.DISCORD_CLIENT_ID
            ? {
              discord: {
                clientId: env.DISCORD_CLIENT_ID,
                clientSecret: env.DISCORD_CLIENT_SECRET,
              },
            }
            : {}),

          // ── GitHub ─────────────────────────────────────────────
          ...(env.GITHUB_CLIENT_ID
            ? {
              github: {
                clientId: env.GITHUB_CLIENT_ID,
                clientSecret: env.GITHUB_CLIENT_SECRET,
              },
            }
            : {}),

          // ── Microsoft / Azure Entra ID ─────────────────────────
          // tenantId: "common" allows both personal + work/school accounts.
          // Change to a specific tenant GUID to restrict to one Azure AD tenant.
          ...(env.MICROSOFT_CLIENT_ID
            ? {
              microsoft: {
                clientId: env.MICROSOFT_CLIENT_ID,
                clientSecret: env.MICROSOFT_CLIENT_SECRET,
                tenantId: "common",
              },
            }
            : {}),

          // ── Apple Sign In ──────────────────────────────────────
          // Required by Apple's App Store guidelines when any social login is offered.
          // The client secret is a JWT signed with a .p8 private key;
          // Better Auth generates this automatically from APPLE_PRIVATE_KEY.
          ...(env.APPLE_CLIENT_ID
            ? {
              apple: {
                clientId: env.APPLE_CLIENT_ID,
                clientSecret: env.APPLE_CLIENT_SECRET,
              },
            }
            : {}),

          // ── Facebook ───────────────────────────────────────────
          ...(env.FACEBOOK_CLIENT_ID
            ? {
              facebook: {
                clientId: env.FACEBOOK_CLIENT_ID,
                clientSecret: env.FACEBOOK_CLIENT_SECRET,
              },
            }
            : {}),
        },

        // ── Plugins ───────────────────────────────────────────────
        plugins: [
          admin(),   // /api/auth/admin/* management endpoints

          // API Key CRUD endpoints. Personal + org-scoped keys.
          apiKey([
            { configId: "personal", references: "user" },
            { configId: "organization", references: "organization" }
          ]),

          // TOTP + email OTP 2FA
          twoFactor({
            issuer: "kova-auth",
            // OAuth-only users have no credential password. Requiring one
            // made twoFactor.enable always return INVALID_PASSWORD.
            allowPasswordless: true,
            otpOptions: {
              sendOTP: async ({ user, otp }: { user: { email: string }; otp: string }) => {
                const { subject, html } = twoFactorOtpEmail(otp);
                await send({ to: user.email, subject, html });
              },
            },
          }),

          // Organizations — multi-tenancy (orgs = apps, members, invites, roles)
          organization({
            // ── Access controller (shared with dynamic RBAC)
            ac,
            roles: { owner, admin: orgAdmin, member },

            // ── Teams: group members within an org (adds team + teamMember tables)
            teams: {
              enabled: true,
              maximumTeams: 20,          // per-org ceiling
              allowRemovingAllTeams: true,
            },

            // ── Dynamic RBAC: create/edit/delete roles per-org at runtime
            // Stores roles + permissions in the `organizationRole` table.
            dynamicAccessControl: {
              enabled: true,
            },

            async sendInvitationEmail(data) {
              const inviteLink = `${env.DASHBOARD_URL}/accept-invitation/${data.id}`;
              const { subject, html } = invitationEmail({
                inviterName: data.inviter.user.name,
                inviterEmail: data.inviter.user.email,
                orgName: data.organization.name,
                inviteLink,
                role: data.role,
              });
              await send({ to: data.email, subject, html });
            },
          }),

          // ── Feature 6: Easy Plugin Drop-ins ──────────────────────

          // Bearer — allows Authorization: Bearer <token> auth for API consumers.
          // Zero config — Better Auth auto-detects the header.
          bearer(),

          // Multi-Session — simultaneous sign-in with multiple accounts.
          // Default max = 5 sessions; we keep the default.
          multiSession(),

          // Username — adds `username` + `displayUsername` fields to the user.
          // Min 3 chars, max 32 chars. Usernames normalised to lowercase.
          username({
            minUsernameLength: 3,
            maxUsernameLength: 32,
          }),

          // Magic Link — passwordless sign-in via email URL.
          // Links expire after 10 minutes; one attempt allowed per token.
          magicLink({
            expiresIn: 60 * 10, // 10 minutes
            sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
              const { subject, html } = magicLinkEmail(url);
              await send({ to: email, subject, html });
            },
          }),

          // Passkey (WebAuthn) — biometric / hardware key sign-in.
          //
          // rpID = the "relying party" identifier, tied to the auth server's
          //   registered domain (not the dashboard). Browsers require rpID to
          //   be a suffix of the page's effective domain, and both
          //   localhost:8787 and localhost:5174 share rpID "localhost", so
          //   this is fine for local dev.
          //
          // origin = the page origin where window.navigator.credentials is
          //   called. The browser embeds it in the signed response and the
          //   server must match it exactly. See passkeyOrigins.
          // Passkey (WebAuthn) — biometric / hardware key sign-in.
          passkey({
            rpName: "kova-auth",
            rpID: (() => {
              try {
                return new URL(env.AUTH_URL).hostname;
              } catch {
                return "localhost";
              }
            })(),
            origin: passkeyOrigins(env),
          }),

          // Generic OAuth / OIDC — allows custom identity providers (Keycloak,
          // Auth0, Okta, any OIDC-compatible IdP) to be configured at runtime.
          // Per-org OIDC connection UI in the dashboard populates the config array
          // via the API; the empty default means no custom providers are loaded
          // unless explicitly configured.
          genericOAuth({
            config: [],
          }),

          jwt({
            disableSettingJwtHeader: true,
            jwks: {
              keyPairConfig: { alg: "RS256" },
            },
            jwt: {
              issuer: `${String(env.AUTH_URL ?? "").replace(/\/$/, "")}/api/auth`,
            },
          }),

          // OIDC issuer for 1:15 Forgejo and LiteLLM. Clients live in
          // oauthClient, seeded from env by ensureTrustedOidcClients; the claim
          // callbacks reproduce what the pre-1.7 oidcProvider emitted, since
          // Forgejo links accounts by sub and reads these claims.
          oauthProvider({
            loginPage: "/oauth/continue",
            // Only the seeded first-party clients exist and they skip consent.
            // There is no consent UI, so anything else lands on the error page.
            consentPage: "/auth-error",
            scopes: [...OIDC_SCOPES],
            grantTypes: ["authorization_code", "refresh_token"],
            allowDynamicClientRegistration: false,
            // No resources are configured; tokens without `resource` stay valid.
            enforcePerClientResources: false,
            accessTokenExpiresIn: OIDC_ACCESS_TOKEN_TTL_SECONDS,
            idTokenExpiresIn: OIDC_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresIn: OIDC_REFRESH_TOKEN_TTL_SECONDS,
            codeExpiresIn: OIDC_CODE_TTL_SECONDS,
            advertisedMetadata: { claims_supported: OIDC_CLAIMS_SUPPORTED },
            // Token and UserInfo calls come from the Forgejo / LiteLLM servers,
            // one IP for every user. The plugin's 20/min and 60/min per-IP
            // defaults would throttle a busy minute; keep the old global ceiling.
            rateLimit: {
              token: { window: 60, max: 200 },
              userinfo: { window: 60, max: 200 },
            },
            // Client CRUD is for platform admins; the endpoints are also
            // platform-session-only (lib/platform-session.ts).
            clientPrivileges: ({ user }) => hasAdminRole(typeof user?.role === "string" ? user.role : null),
            customIdTokenClaims: ({ user, scopes }) => legacyIdTokenClaims(user, scopes),
            customUserInfoClaims: ({ user, scopes }) => legacyUserInfoClaims(user, scopes),
          }),

          // Device sign-in (RFC 8628) for SDK apps: Ralph Meet desktop, Zeron.
          // App-owned codes only, issued and redeemed through
          // /api/pub/apps/:pk/device/*; see lib/device-authorization.ts.
          deviceAuthorization({
            expiresIn: `${DEVICE_CODE_TTL_SECONDS}s`,
            interval: `${DEVICE_CODE_INTERVAL_SECONDS}s`,
            userCodeLength: 8,
            generateDeviceCode,
            grant: kovaDeviceGrant(env),
          }),
          kovaDeviceRedemption(env),
        ],

        // ── Session ───────────────────────────────────────────────
        //
        // Architecture: hybrid stateful + JWE cookie cache
        //
        //  • D1 is source of truth — enables immediate revocation (ban user,
        //    revoke session, password change) which pure stateless JWT can't do.
        //  • JWE cookie cache acts as a short-lived encrypted "access token":
        //    the server validates the cookie without a DB round-trip for the
        //    vast majority of requests, hitting D1 only when the cookie expires.
        //  • "jwe" strategy = fully encrypted (A256CBC-HS512 + HKDF).
        //    Neither the user nor a network observer can read the session data.
        //  • 5-minute cache means a revoked session is invalid within 5 minutes
        //    on all devices — a good balance between performance and security.
        //
        // Why not fully stateless (no DB)?
        //   We need instant ban/revoke for admin users. Stateless JWTs cannot
        //   be invalidated before their TTL expires. The JWE cache gives us
        //   JWT-equivalent performance while preserving the revocation guarantee.
        session: {
          // D1 is the source of truth (see above). withCloudflare only turns
          // this on when a `cf` object is present; oauth-provider refuses to
          // start with KV secondary storage unless it is set explicitly.
          storeSessionInDatabase: true,
          expiresIn: 60 * 60 * 24 * 30,  // 30-day cap; use slides it forward
          updateAge: 60 * 60 * 24,       // refresh at most once a day when used
          disableSessionRefresh: false,  // keep the chosen Kova session alive
          freshAge: 60 * 10,              // re-auth required for sensitive ops within 10 min

          cookieCache: {
            enabled: true,
            maxAge: 5 * 60,              // 5-minute encrypted cookie = JWT access token
            strategy: "jwe",             // fully encrypted — session data hidden from client
            // refreshCache is intentionally omitted: it's stateless-only and
            // conflicts with D1 + KV secondary storage (Better Auth would warn).
          },
        },


        // ── Trusted origins (CORS) ────────────────────────────────
        //
        // Delegates to `resolveOrigin` — the single authoritative resolver
        // shared with the Hono corsMiddleware.  resolveOrigin implements the
        // full three-tier waterfall:
        //
        //   Tier 0  KV write-through cache (60 s TTL, ~1 ms)
        //   Tier 1  X-Publishable-Key → per-app D1 row (actual requests)
        //   Tier 2  STATIC_ORIGINS in-process Set
        //   Tier 3  Full application-table scan via char(10)+instr (preflight)
        //
        // Better Auth calls trustedOrigins with the raw Request and expects
        // an array of trusted origin strings (or a truthy indicator).  We
        // resolve the requesting origin: if allowed we return a single-element
        // array containing it (satisfies Better Auth's allowlist check); if
        // denied we return only STATIC_ORIGINS so Better Auth's own guard
        // still protects first-party routes.
        trustedOrigins: async (request?: Request) => {
          const firstParty = [...staticOrigins(env)];
          if (!request) return firstParty;

          const resolved = await resolveOrigin(request, env.DB, env.KV, env).catch(
            () => ""
          );

          if (resolved) {
            // The origin is allowed — include it so Better Auth's internal
            // CORS logic also accepts it for /api/auth/* responses.
            return [resolved, ...firstParty];
          }

          // Origin not allowed — restrict to first-party origins only.
          return firstParty;
        },
      }
    )
  );
}

export type Auth = ReturnType<typeof createAuth>;

import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { APIError } from "better-auth/api";
import { admin, bearer, genericOAuth, magicLink, multiSession, organization, twoFactor, username } from "better-auth/plugins";
import { logAudit } from "./audit";
import {
  invitationEmail,
  magicLinkEmail,
  resetPasswordEmail,
  sendEmail,
  twoFactorOtpEmail,
  verificationEmail,
} from "./email";
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
export function createAuth(env: Env, cf?: IncomingRequestCfProperties) {
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
        baseURL: env.AUTH_URL,
        basePath: "/api/auth",

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
        },

        // ── Error page ───────────────────────────────────────────
        onAPIError: {
          errorURL: `${env.DASHBOARD_URL}/auth-error`,
        },

        // ── Rate limiting ─────────────────────────────────────────
        // Uses KV for distributed counters across Worker instances.
        // Global ceiling is high (200/min) since the admin dashboard makes
        // multiple requests per page (get-session, list-users, list-sessions).
        // Tight limits only on credential endpoints that need brute-force protection.
        rateLimit: {
          enabled: true,
          window: 60,   // 60-second sliding window
          max: 200,     // global ceiling — plenty for normal admin dashboard use
          storage: "secondary-storage", // stored in KV
          customRules: {
            "/sign-in/email": { window: 60, max: 5 },          // brute-force protection
            "/sign-in/magic-link": { window: 60, max: 3 },      // magic link send throttle
            "/two-factor/verify-totp": { window: 60, max: 5 }, // TOTP guessing protection
            "/two-factor/send-otp": { window: 60, max: 3 },    // email OTP send throttle
            "/forget-password": { window: 60, max: 3 },         // reset email throttle
          },
        },

        // ── Email + Password ──────────────────────────────────────
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,

          sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
            const { subject, html } = verificationEmail(url);
            await sendEmail({ to: user.email, subject, html, apiKey: env.RESEND_API_KEY });
          },

          sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
            const { subject, html } = resetPasswordEmail(url);
            await sendEmail({ to: user.email, subject, html, apiKey: env.RESEND_API_KEY });
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
                const adminEmails = (env.DASHBOARD_ADMIN_EMAIL ?? "")
                  .split(",")
                  .map((e) => e.trim().toLowerCase())
                  .filter(Boolean);
                if (adminEmails.length && adminEmails.includes((user.email ?? "").toLowerCase())) {
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
                      inviterName: "ralph-auth",
                      inviterEmail: "noreply@auto-join",
                      orgName: org.name,
                      inviteLink,
                      role: domainRecord.default_role,
                    });
                    sendEmail({
                      to: user.email,
                      subject,
                      html,
                      apiKey: env.RESEND_API_KEY,
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
            issuer: "ralph-auth",
            otpOptions: {
              sendOTP: async ({ user, otp }: { user: { email: string }; otp: string }) => {
                const { subject, html } = twoFactorOtpEmail(otp);
                await sendEmail({ to: user.email, subject, html, apiKey: env.RESEND_API_KEY });
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
              await sendEmail({ to: data.email, subject, html, apiKey: env.RESEND_API_KEY });
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
              await sendEmail({ to: email, subject, html, apiKey: env.RESEND_API_KEY });
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
          //   called. Because the WebAuthn UI runs inside the DASHBOARD (port
          //   5174 in dev, custom domain in prod), this must be DASHBOARD_URL
          //   — NOT AUTH_URL. The browser embeds the page's origin in the
          //   authenticator data and the server must match it exactly.
          // Passkey (WebAuthn) — biometric / hardware key sign-in.
          passkey({
            rpName: "ralph-auth",
            rpID: (() => {
              try {
                return new URL(env.AUTH_URL).hostname;
              } catch {
                return "localhost";
              }
            })(),
            origin: env.DASHBOARD_URL,
          }),

          // Generic OAuth / OIDC — allows custom identity providers (Keycloak,
          // Auth0, Okta, any OIDC-compatible IdP) to be configured at runtime.
          // Per-org OIDC connection UI in the dashboard populates the config array
          // via the API; the empty default means no custom providers are loaded
          // unless explicitly configured.
          genericOAuth({
            config: [],
          }),
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
          expiresIn: 60 * 60 * 24 * 7,   // 7-day hard cap (was 30 days)
          updateAge: 0,                    // disable sliding window — no auto-extend
          disableSessionRefresh: true,     // sessions are fixed-duration, not rolling
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
        // ⚠️  PRODUCTION NOTE: Also update ALLOWED_ORIGINS in index.ts.
        //     Auth server will be reachable at:
        //       https://auth.115jon.site
        //       https://ralph-auth.jontitor.workers.dev
        //     TODO: add production dashboard Pages URL once deployed, e.g.:
        //       "https://ralph-auth-dashboard.pages.dev"
        // ────────────────────────────────────────────────────────
        trustedOrigins: [
          // Dev
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:5174",  // dashboard dev server
          "http://localhost:8787",  // wrangler dev server itself
          "http://localhost:8888",  // ralph-meet dev port
          // Production — auth server self (needed for server-side calls)
          "https://auth.115jon.site",
          "https://ralph-auth.jontitor.workers.dev",
          // Production — external consumers
          "https://meet.115jon.site",
          "https://ralph-meet.jontitor.workers.dev",
          // Production dashboard
          "https://ralph-auth-dashboard.jontitor.workers.dev",
          // "https://dash.115jon.site",  // uncomment if you add a custom domain
        ],
      }
    )
  );
}

export type Auth = ReturnType<typeof createAuth>;

import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { admin, twoFactor } from "better-auth/plugins";
import { resetPasswordEmail, sendEmail, twoFactorOtpEmail, verificationEmail } from "./email";

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

        // R2 for avatar/file uploads — must be { bucket } shaped, not bare R2Bucket
        r2: { bucket: env.BUCKET },

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

        // ── Error page ───────────────────────────────────────────
        onAPIError: {
          errorURL: `${env.DASHBOARD_URL}/auth-error`,
        },

        // ── Rate limiting ─────────────────────────────────────────
        // Uses KV for distributed counters — protection against
        // brute-force on /sign-in/email and OAuth endpoints.
        rateLimit: {
          enabled: true,
          window: 60,   // 60-second sliding window
          max: 10,      // max 10 requests per window per IP globally
          storage: "secondary-storage", // stored in KV
          customRules: {
            // Tighter limit specifically on password sign-in
            "/sign-in/email": { window: 60, max: 5 },
            // Also protect 2FA verification endpoint
            "/two-factor/verify-totp": { window: 60, max: 5 },
            "/two-factor/send-otp": { window: 60, max: 3 },
          },
        },

        // ── Email + Password ──────────────────────────────────────
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true, // enforced — Resend sends the link

          sendVerificationEmail: async ({ user, url }) => {
            const { subject, html } = verificationEmail(url);
            await sendEmail({ to: user.email, subject, html, apiKey: env.RESEND_API_KEY });
          },

          sendResetPassword: async ({ user, url }) => {
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
              before: async (user) => {
                // Support comma-separated list: "a@x.com,b@y.com"
                const adminEmails = (env.DASHBOARD_ADMIN_EMAIL ?? "")
                  .split(",")
                  .map((e) => e.trim().toLowerCase())
                  .filter(Boolean);
                if (adminEmails.length && adminEmails.includes(user.email?.toLowerCase())) {
                  return { data: { ...user, role: "admin" } };
                }
              },
            },
          },
        },

        // ── Social providers ──────────────────────────────────────
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
          // Discord is optional — only enabled if secrets are provided
          ...(env.DISCORD_CLIENT_ID
            ? {
              discord: {
                clientId: env.DISCORD_CLIENT_ID,
                clientSecret: env.DISCORD_CLIENT_SECRET,
              },
            }
            : {}),
        },

        // ── Plugins ───────────────────────────────────────────────
        plugins: [
          admin(),   // /api/auth/admin/* management endpoints
          apiKey(),  // /api/auth/api-key/* CRUD + verify endpoints

          // TOTP + email OTP 2FA
          // Admin can enable in Settings → Security → Two-Factor Auth
          twoFactor({
            issuer: "ralph-auth",      // shown in authenticator apps
            otpOptions: {
              // Email OTP: send a code instead of / as fallback to TOTP
              sendOTP: async ({ user, otp }) => {
                const { subject, html } = twoFactorOtpEmail(otp);
                await sendEmail({ to: user.email, subject, html, apiKey: env.RESEND_API_KEY });
              },
            },
          }),
        ],

        // ── Session ───────────────────────────────────────────────
        session: {
          expiresIn: 60 * 60 * 24 * 30, // 30 days
          updateAge: 60 * 60 * 24,       // refresh if > 1 day old
          cookieCache: {
            enabled: true,
            maxAge: 60 * 5, // 5 min client-side cache reduces D1 reads
          },
        },

        // ── Trusted origins (CORS) ────────────────────────────────
        trustedOrigins: [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:5174",  // dashboard dev server
          "http://localhost:8787",  // wrangler dev server itself
          "http://localhost:8888",  // ralph-meet dev port
          "https://ralph-meet.workers.dev",
        ],
      }
    )
  );
}

export type Auth = ReturnType<typeof createAuth>;

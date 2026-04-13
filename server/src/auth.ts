import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { admin } from "better-auth/plugins";

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
 *
 * NOTE on hooks — the top-level hooks.after API in Better Auth 1.6.x
 * expects a plain createAuthMiddleware fn, NOT the { matcher, handler }
 * plugin-pattern. Admin role promotion is done via the admin plugin's
 * REST API (/api/auth/admin/set-role) after the first sign-up, which
 * is more reliable and avoids runtime type mismatches entirely.
 * See: server/src/admin-setup.ts for the one-time promotion helper.
 */
export function createAuth(env: Env, cf?: IncomingRequestCfProperties) {
  return betterAuth(
    withCloudflare(
      // ── First arg: Cloudflare bindings + options ──────────────
      {
        // Native D1 binding — no Drizzle adapter needed
        d1Native: env.DB,

        // KV for session secondary storage (reduces D1 reads)
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

        // ── Email + Password ──────────────────────────────────────
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: false, // flip to true once email is wired
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
          admin(), // adds /api/auth/admin/* management endpoints
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

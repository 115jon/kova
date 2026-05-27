import { Hono } from "hono";
import { getApplicationByPublishableKey, isApplicationSuspended, isOriginAllowed, isRedirectUriAllowed } from "../applications";
import { createAuth } from "../auth";
import { withHeaders } from "../middleware/cors";

const authRouter = new Hono<{ Bindings: Env }>();

// -- Auth routes -- with per-app enforcement when X-Publishable-Key is set --
//
// Requests carrying X-Publishable-Key are validated against the registered
// application's allowlists BEFORE reaching Better Auth (which has no concept
// of per-app config). Two checks:
//
//   1. Origin enforcement  -- request Origin must be in the app's allowed_origins
//      (non-empty list). Blocks unauthorized domains from calling auth APIs.
//
//   2. callbackURL enforcement -- for sign-in / sign-up flows, the callbackURL
//      in the JSON body must start with one of the app's redirect_uris.
//      Prevents open-redirect attacks.
//
// Requests without a publishable key (admin dashboard, server-to-server)
// pass through unchanged -- Better Auth's trustedOrigins applies.
authRouter.all("/*", async (c) => {
  const { req, env } = c;
  const db = env.DB;
  const request = req.raw;

  const pk = req.header("X-Publishable-Key");
  const app = pk ? await getApplicationByPublishableKey(db, pk).catch(() => null) : null;
  const isAuthServerOrigin = (origin: string) => {
    if (!origin) return false;
    try {
      return origin === new URL(c.req.url).origin;
    } catch {
      return false;
    }
  };

  if (req.method === "GET" && req.path.endsWith("/get-session")) {
    const bearerToken = req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearerToken && pk && app && !isApplicationSuspended(app)) {
      const origin = req.header("Origin") ?? "";
      if (origin && !isAuthServerOrigin(origin) && !isOriginAllowed(app, origin)) {
        return withHeaders(
          Response.json(
            {
              error: "origin_not_allowed",
              message: `Origin '${origin}' is not in the allowed origins list for application '${app.name}'. Update the application's allowed origins in the kova-auth dashboard.`,
            },
            { status: 403 }
          ),
          request,
          db,
          env.KV
        );
      }

      const now = Date.now();
      const sessionRow = await db
        .prepare(
          `SELECT id, userId, token, expiresAt, createdAt, updatedAt, ipAddress, userAgent, activeOrganizationId, app_id
           FROM session
           WHERE token = ? AND app_id = ? AND expiresAt > ?
           LIMIT 1`
        )
        .bind(bearerToken, app.id, now)
        .first<Record<string, unknown>>()
        .catch(() => null);

      if (!sessionRow?.["userId"]) {
        return withHeaders(Response.json(null), request, db, env.KV);
      }

      const userRow = await db
        .prepare("SELECT id, name, email, emailVerified, image, role, banned, createdAt, updatedAt, username, twoFactorEnabled FROM user WHERE id = ? LIMIT 1")
        .bind(sessionRow["userId"])
        .first<Record<string, unknown>>()
        .catch(() => null);

      if (!userRow?.["id"]) {
        return withHeaders(Response.json(null), request, db, env.KV);
      }

      return withHeaders(
        Response.json({
          session: sessionRow,
          user: userRow,
        }),
        request,
        db,
        env.KV
      );
    }

    const auth = createAuth(env, req.raw.cf as IncomingRequestCfProperties | undefined);
    const sessionData = await auth.api.getSession({ headers: req.raw.headers }).catch(() => null);

    if (!sessionData?.session?.id) {
      return withHeaders(Response.json(null), request, db, env.KV);
    }

    const row = await db
      .prepare("SELECT app_id FROM session WHERE id = ? LIMIT 1")
      .bind(sessionData.session.id)
      .first<{ app_id: string | null }>()
      .catch(() => null);

    if (pk) {
      if (!app || isApplicationSuspended(app)) {
        return withHeaders(Response.json(null), request, db, env.KV);
      }

      const origin = req.header("Origin") ?? "";
      if (origin && !isAuthServerOrigin(origin) && !isOriginAllowed(app, origin)) {
        return withHeaders(
          Response.json(
            {
              error: "origin_not_allowed",
              message: `Origin '${origin}' is not in the allowed origins list for application '${app.name}'. Update the application's allowed origins in the kova-auth dashboard.`,
            },
            { status: 403 }
          ),
          request,
          db,
          env.KV
        );
      }

      return withHeaders(Response.json(row?.app_id === app.id ? sessionData : null), request, db, env.KV);
    }

    return withHeaders(Response.json(row?.app_id ? null : sessionData), request, db, env.KV);
  }

  if (pk) {
    if (app) {
      if (isApplicationSuspended(app)) {
        return withHeaders(
          Response.json(
            { error: "application_suspended", message: "This application is suspended." },
            { status: 403 }
          ),
          request,
          db,
          env.KV
        );
      }

      // -- 1. Origin check --
      const origin = req.header("Origin") ?? "";
      if (origin && !isAuthServerOrigin(origin) && !isOriginAllowed(app, origin)) {
        return withHeaders(
          Response.json(
            {
              error: "origin_not_allowed",
              message: `Origin '${origin}' is not in the allowed origins list for application '${app.name}'. Update the application's allowed origins in the kova-auth dashboard.`,
            },
            { status: 403 }
          ),
          request,
          db,
          env.KV
        );
      }

      // -- 2. callbackURL / redirect URI check --
      const isAuthFlow =
        req.method === "POST" &&
        (req.path.includes("/sign-in/") ||
          req.path.includes("/sign-up/") ||
          req.path.includes("/magic-link"));

      if (isAuthFlow) {
        try {
          const bodyClone = request.clone();
          const body = (await bodyClone.json()) as Record<string, unknown>;
          const callbackURL =
            typeof body["callbackURL"] === "string" ? body["callbackURL"] : null;
          // Allow the auth server's own /api/hosted/* bounce endpoints as callbackURL
          // without requiring them in the app's redirect_uris. These are internal
          // handlers (oauth-complete) that we control — they validate redirect_uri
          // against the app allowlist before forwarding to the actual consumer app.
          const isInternalBounce = callbackURL?.startsWith(`${env.AUTH_URL}/api/hosted/`) ?? false;
          if (callbackURL && !isInternalBounce && !isRedirectUriAllowed(app, callbackURL)) {
            return withHeaders(
              Response.json(
                {
                  error: "redirect_uri_not_allowed",
                  message: `callbackURL '${callbackURL}' is not in the allowed redirect URIs for application '${app.name}'. Update the application's redirect URIs in the kova-auth dashboard.`,
                },
                { status: 403 }
              ),
              request,
              db,
              env.KV
            );
          }
        } catch {
          // Body not JSON or missing — non-standard flow, pass through.
        }
      }
      // NOTE: SDK UI enforcement is intentionally NOT implemented via a
      // request header check here. Headers are trivially spoofable and provide
      // no real protection.
      //
      // The correct enforcement model — used by Clerk — is a HOSTED REDIRECT
      // FLOW: apps redirect to auth.115jon.site/sign-in?pk=...&redirect_uri=...
      // Our server renders the sign-in page (always with our branding) and mints
      // a short-lived auth ticket. Since we control the hosted page's HTML,
      // branding cannot be removed. This is the planned "dynamic domains" feature.
    }
  }

  const auth = createAuth(env, req.raw.cf as IncomingRequestCfProperties | undefined);
  // Wrap auth.handler() response with CORS + security headers.
  //
  // withHeaders() does `new Headers(response.headers)` first, so all headers
  // emitted by Better Auth — including Retry-After on 429, Set-Cookie on
  // successful sign-in, and X-RateLimit-* counters — are preserved. Only
  // the CORS access-control and security (X-Frame-Options, etc.) headers are
  // added on top. Without this, cross-origin clients receive a CORS failure
  // on every 429, preventing the JS from reading Retry-After.
  return withHeaders(await auth.handler(request), request, db, env.KV);
});

export { authRouter };

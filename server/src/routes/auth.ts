import { Hono } from "hono";
import { getApplicationByPublishableKey, isOriginAllowed, isRedirectUriAllowed } from "../applications";
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
  if (pk) {
    const app = await getApplicationByPublishableKey(db, pk).catch(() => null);
    if (app) {
      // -- 1. Origin check --
      const origin = req.header("Origin") ?? "";
      if (origin && !isOriginAllowed(app, origin)) {
        return withHeaders(
          Response.json(
            {
              error: "origin_not_allowed",
              message: `Origin '${origin}' is not in the allowed origins list for application '${app.name}'. Update the application's allowed origins in the ralph-auth dashboard.`,
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
          if (callbackURL && !isRedirectUriAllowed(app, callbackURL)) {
            return withHeaders(
              Response.json(
                {
                  error: "redirect_uri_not_allowed",
                  message: `callbackURL '${callbackURL}' is not in the allowed redirect URIs for application '${app.name}'. Update the application's redirect URIs in the ralph-auth dashboard.`,
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


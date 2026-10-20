import { type Application, isOriginAllowed } from "../applications";

/**
 * Guard for endpoints that act for one application and read the user's session
 * from a cookie or bearer. CORS only stops a page from reading the answer; the
 * request still runs, so another app's registered origin could otherwise make
 * this one issue tokens for the path's app.
 *
 * A request without an Origin (native, server-to-server) passes. Otherwise the
 * Origin must be the auth server, one of `alsoTrusted`, or registered by `app`.
 */
export function rejectDisallowedOrigin(
  env: Pick<Env, "AUTH_URL">,
  app: Application,
  origin: string | null | undefined,
  ...alsoTrusted: string[]
): Response | null {
  if (!origin) return null;

  let authOrigin: string | null = null;
  try {
    authOrigin = new URL(env.AUTH_URL).origin;
  } catch {
    // Without a valid AUTH_URL only the app's own origins can pass.
  }
  if (origin === authOrigin || alsoTrusted.includes(origin) || isOriginAllowed(app, origin)) return null;

  return Response.json(
    {
      error: "origin_not_allowed",
      message: `Origin '${origin}' is not in the allowed origins list for application '${app.name}'. Update the application's allowed origins in the kova-auth dashboard.`,
    },
    { status: 403 },
  );
}

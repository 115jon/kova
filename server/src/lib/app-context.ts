/**
 * app-context.ts — Per-request app_id propagation for Cloudflare Workers.
 *
 * Problem: The Hono CORS middleware resolves the app_id from the
 * X-Publishable-Key header *before* Better Auth runs. The Better Auth
 * `databaseHooks` then need that app_id to record app_user membership and
 * stamp session.app_id — but Better Auth's hook callbacks receive no
 * request context at all.
 *
 * Solution: WeakMap<Request, string> keyed on the raw Request object.
 *
 * Why not AsyncLocalStorage?
 *   ALS requires `@types/node` (or `nodejs_compat_v2` + experimental types).
 *   The tsconfig only includes `@cloudflare/workers-types`. Rather than
 *   introducing a new type dependency, we use the Workers-idiomatic approach:
 *   a WeakMap is keyed on the Request object (which is unique per request),
 *   so there is zero risk of cross-request bleeding. The Request is
 *   automatically GC'd when the isolate finishes handling the request,
 *   making this fully safe in Cloudflare's shared-isolate model.
 *
 * Usage:
 *   // In CORS middleware (after resolving publishable key):
 *   setAppId(c.req.raw, app.id);
 *
 *   // In auth.ts databaseHooks:
 *   const appId = getAppId(currentRequest);
 */

const appIdMap = new WeakMap<Request, string>();

/**
 * Associates an app_id with a specific Request for the duration of that
 * request. Call this immediately after resolving the publishable key in
 * the CORS middleware.
 */
export function setAppId(request: Request, appId: string): void {
  appIdMap.set(request, appId);
}

/**
 * Retrieves the app_id previously associated with the given Request.
 * Returns `undefined` if no publishable key was resolved for this request
 * (i.e., the request came from the admin dashboard directly, not the SDK).
 */
export function getAppId(request: Request): string | undefined {
  return appIdMap.get(request);
}

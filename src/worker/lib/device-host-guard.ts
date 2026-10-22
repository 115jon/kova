/**
 * Who may reach Better Auth's device endpoints, and where.
 *
 * Platform host: none of them (routes/auth.ts answers 404).
 *
 * An app's hosted host ({slug}.auth…): only the verify/approve/deny steps the
 * hosted /device page uses, and only
 *   - from that host's own pages. The global trustedOrigins accepts any origin
 *     registered by any app, so Better Auth's own origin check alone would let
 *     another app's page approve a code with this host's cookie;
 *   - with the host's cookie session, never a bearer. An app holds its users'
 *     bearer tokens and must not approve codes on their behalf;
 *   - with no session minted for another app;
 *   - for codes this app issued. A code for app A shown on app B's host would
 *     read "Sign in to B" while signing into A.
 * Issue (/device/code) and redemption (/device/token) stay closed: those go
 * through /api/pub/apps/:pk/device/*.
 */
import { requestSessionTokens } from "./platform-session";

const DEVICE_PATH = /^\/api\/auth\/device(?:\/(.*))?$/;

function canonicalPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** True for any path under the plugin's /device prefix. Over-matches undecodable paths. */
export function isDeviceAuthPath(pathname: string): boolean {
  const path = canonicalPath(pathname);
  return path === null || DEVICE_PATH.test(path);
}

/** "", "approve", "deny", or anything else (refused). */
function deviceStep(pathname: string): string | null {
  const path = canonicalPath(pathname);
  if (path === null) return null;
  const match = DEVICE_PATH.exec(path);
  return match ? (match[1] ?? "") : null;
}

/** Plugin-compatible user-code forms to look up: as typed, and normalized. */
function userCodeCandidates(input: unknown): string[] {
  if (typeof input !== "string" || !input) return [];
  return [...new Set([input, input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()])].filter(Boolean);
}

function refuse(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * A response to return instead of handing the request to Better Auth, or null
 * to let it through. `userCode` comes from the query (verify) or JSON body
 * (approve/deny); pass the request and it is read here.
 */
export async function guardHostedDeviceRequest(input: {
  request: Request;
  db: D1Database;
  appId: string;
  hostOrigin: string;
  /** Server-side callers (the /device page) pass the code they verify. */
  userCode?: string | null;
}): Promise<Response | null> {
  const { request, db, appId, hostOrigin } = input;
  const url = new URL(request.url);
  const step = deviceStep(url.pathname);
  const isServerPage = input.userCode !== undefined;
  if (!isServerPage) {
    if (step === "" && request.method !== "GET") return refuse(405, "invalid_request", "Method not allowed");
    if ((step === "approve" || step === "deny") && request.method !== "POST") return refuse(405, "invalid_request", "Method not allowed");
    if (step !== "" && step !== "approve" && step !== "deny") return refuse(404, "not_found", "Not found");
  }

  if (request.headers.get("authorization")) {
    return refuse(401, "unauthorized", "Device approval needs the hosted sign-in cookie, not a bearer token");
  }

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const writes = request.method !== "GET" && request.method !== "HEAD";
  // The /device page itself is a top-level navigation, often from a link
  // another site shows; only the API calls must come from this host's pages.
  const crossOrigin = (origin && origin !== hostOrigin) || (writes && !origin) || fetchSite === "cross-site" || fetchSite === "same-site";
  if (!isServerPage && crossOrigin) {
    return refuse(403, "origin_not_allowed", "Device approval is only accepted from this sign-in page");
  }

  const tokens = requestSessionTokens(request.headers);
  if (tokens.length > 0) {
    try {
      const foreign = await db
        .prepare(
          `SELECT 1 AS foreign_app FROM session
           WHERE token IN (${tokens.map(() => "?").join(", ")})
             AND app_id IS NOT NULL AND app_id != '' AND app_id != ?
           LIMIT 1`,
        )
        .bind(...tokens, appId)
        .first();
      if (foreign) return refuse(403, "session_not_allowed", "This session belongs to another application");
    } catch {
      return refuse(503, "session_check_failed", "Try again");
    }
  }

  let userCode = input.userCode;
  if (userCode === undefined) {
    if (step === "") {
      userCode = url.searchParams.get("user_code");
    } else {
      const body = (await request.clone().json().catch(() => null)) as { userCode?: unknown } | null;
      userCode = typeof body?.userCode === "string" ? body.userCode : null;
    }
  }
  const candidates = userCodeCandidates(userCode);
  if (candidates.length > 0) {
    const row = await db
      .prepare(`SELECT "appId" FROM "deviceCode" WHERE "userCode" IN (${candidates.map(() => "?").join(", ")}) LIMIT 1`)
      .bind(...candidates)
      .first<{ appId: string | null }>()
      .catch(() => null);
    // Same answer the plugin gives an unknown code.
    if (row && row.appId !== appId) return refuse(400, "invalid_request", "Invalid user code");
  }
  return null;
}

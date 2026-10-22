/**
 * Hosted device approval (RFC 8628 user step) on {slug}.auth…/device.
 *
 * Data and decisions only; markup is hosted-device-view.ts. The page:
 *   - without a code: shows the manual entry form;
 *   - signed out: renders the hosted sign-in, which returns to /device?code=…;
 *   - signed in: calls Better Auth's device verify server-side (which claims
 *     the code for this account) and shows app, device context, code, and
 *     account, with Approve / Deny posting to /api/auth/device/approve|deny.
 *
 * The verify call is made in-process, so the plugin's HTTP limit on
 * /api/auth/device (5 per IP per code lifetime) does not lock out someone
 * fixing a typo. It is limited per account + IP here instead.
 */
import type { Context } from "hono";
import type { Application } from "../applications";
import { createAuth } from "../auth";
import { sessionMayActForApp } from "../lib/app-session";
import type { KovaDeviceVerificationContext } from "../lib/device-authorization";
import { deviceErrorCode } from "../lib/device-authorization";
import { deviceReturnPath, formatUserCode, normalizeUserCode } from "../lib/device-code";
import { guardHostedDeviceRequest } from "../lib/device-host-guard";
import { consumeRateLimit, requestIp } from "../lib/rate-limit";
import { resolveHostedAppearance } from "../../shared/hosted-brand";
import { renderDevicePage } from "./hosted-device-view";

const VERIFY_LIMIT = { windowSeconds: 600, max: 30 };

/** Branding as the hosted sign-in page resolves it (resolveHostedAppearance). */
export type DevicePageApp = {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  backgroundColor: string;
  /** Built-in mark to show when there is no logo (Ralph's radio). */
  brandMark?: "ralph-radio";
  /** Hide the "Secured by Kova" footer, as the sign-in page does. */
  hideBranding: boolean;
};

export type DevicePageModel =
  | { state: "enter"; app: DevicePageApp; code?: string; error?: "invalid_format" }
  | {
      state: "review";
      app: DevicePageApp;
      /** Display form, XXXX-XXXX. */
      userCode: string;
      device: { hostname?: string; platform?: string; label?: string };
      requester: { ip?: string; country?: string; city?: string };
      account: { name: string; email: string; image: string | null };
      /** Sign out, then sign back in and return here. */
      switchAccountPath: string;
    }
  | { state: "rate_limited"; app: DevicePageApp; /** Seconds until the limit resets. */ retryAfterSeconds?: number }
  | { state: "approved" | "denied" | "expired" | "invalid" | "used" | "claimed" | "unavailable"; app: DevicePageApp };

type DeviceVerifyResponse = {
  user_code: string;
  status: string;
  client_id?: string;
} & Partial<KovaDeviceVerificationContext>;

export function devicePageApp(app: Application): DevicePageApp {
  // Same inputs and resolver as buildHostedPage, so /device matches sign-in.
  const appearance = resolveHostedAppearance(app, {
    primaryColor: app.primary_color ?? "#3b82f6",
    backgroundColor: app.background_color ?? "#0a0a0a",
    theme: app.theme ?? "dark",
    logoUrl: app.logo_url ?? null,
    faviconUrl: app.favicon_url ?? null,
  });
  return {
    id: app.id,
    name: app.display_name ?? app.name,
    logoUrl: appearance.logoUrl,
    faviconUrl: appearance.faviconUrl,
    primaryColor: appearance.primaryColor,
    backgroundColor: appearance.backgroundColor,
    ...(appearance.brandMark ? { brandMark: appearance.brandMark } : {}),
    hideBranding: !!app.hide_branding,
  };
}

/**
 * Hosted pages must never render inside a frame: the cookie is SameSite=None,
 * so a framing site could walk a signed-in user into approving. The device
 * view's own nonce CSP is a <meta>, which cannot carry frame-ancestors; this
 * header policy combines with it.
 */
export const NO_FRAMING_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

const STATUS_FOR_STATE: Partial<Record<DevicePageModel["state"], number>> = {
  enter: 200,
  invalid: 400,
  expired: 410,
  rate_limited: 429,
  unavailable: 503,
};

export function devicePageResponse(model: DevicePageModel, status?: number): Response {
  return new Response(renderDevicePage(model), {
    status: status ?? STATUS_FOR_STATE[model.state] ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...NO_FRAMING_HEADERS,
    },
  });
}

/**
 * Builds the model for GET /device. Returns `{ signIn: returnPath }` when the
 * visitor must sign in first; the router renders the hosted sign-in for that.
 */
export async function loadDevicePage(input: {
  request: Request;
  env: Env;
  app: Application;
  hostOrigin: string;
}): Promise<DevicePageModel | { signIn: string }> {
  const { request, env, app, hostOrigin } = input;
  const view = devicePageApp(app);
  const url = new URL(request.url);
  const raw = url.searchParams.get("code") ?? url.searchParams.get("user_code");
  if (raw === null || raw.trim() === "") return { state: "enter", app: view };

  const normalized = normalizeUserCode(raw);
  const returnPath = normalized ? deviceReturnPath(normalized) : null;
  if (!normalized || !returnPath) return { state: "enter", app: view, code: raw.slice(0, 12), error: "invalid_format" };

  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined, request, hostOrigin);
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id || !(await sessionMayActForApp(env.DB, session.session.id, app.id))) {
    return { signIn: returnPath };
  }

  const refused = await guardHostedDeviceRequest({ request, db: env.DB, appId: app.id, hostOrigin, userCode: normalized });
  if (refused) return { state: refused.status === 400 ? "invalid" : "unavailable", app: view };

  const limit = await consumeRateLimit(env.DB, `device-verify:${session.user.id}:${requestIp(request) ?? "unknown"}`, VERIFY_LIMIT)
    .catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
  if (!limit.allowed) return { state: "rate_limited", app: view, retryAfterSeconds: limit.retryAfterSeconds };

  let verified: DeviceVerifyResponse;
  try {
    verified = (await auth.api.deviceVerify({ query: { user_code: normalized }, headers: request.headers })) as DeviceVerifyResponse;
  } catch (error) {
    const code = deviceErrorCode(error);
    if (code === "expired_token") return { state: "expired", app: view };
    if (code === "invalid_request") return { state: "invalid", app: view };
    console.error("[kova-auth] device verify failed", error);
    return { state: "unavailable", app: view };
  }

  // Owner-only fields are missing when another account claimed the code first.
  if (!verified.client_id) return { state: "claimed", app: view };
  if (verified.app_id !== app.id) return { state: "invalid", app: view };
  if (verified.status !== "pending") return { state: "used", app: view };

  return {
    state: "review",
    app: view,
    userCode: formatUserCode(normalized),
    device: { hostname: verified.device_hostname, platform: verified.device_platform, label: verified.device_label },
    requester: { ip: verified.requester_ip, country: verified.requester_country, city: verified.requester_city },
    account: {
      name: session.user.name ?? "",
      email: session.user.email,
      image: session.user.image ?? null,
    },
    switchAccountPath: `/sign-in?device_return=${encodeURIComponent(returnPath)}`,
  };
}

/**
 * POST /api/hosted/device/release {userCode}: the signed-in account gives up
 * its claim on a still-pending code (the "use another account" path), so the
 * next account can review it. Nothing else about the code changes.
 */
export async function releaseDeviceClaim(c: Context, input: { env: Env; app: Application; hostOrigin: string }): Promise<Response> {
  const { env, app, hostOrigin } = input;
  const request = c.req.raw;
  const refused = await guardHostedDeviceRequest({
    // Same checks as approve/deny: this host's page, cookie session, this app's code.
    request: new Request(new URL("/api/auth/device/deny", request.url), request.clone() as Request),
    db: env.DB,
    appId: app.id,
    hostOrigin,
  });
  if (refused) return refused;

  const auth = createAuth(env, request.cf as IncomingRequestCfProperties | undefined, request, hostOrigin);
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) return c.body(null, 204);

  const body = (await request.json().catch(() => null)) as { userCode?: unknown } | null;
  const normalized = normalizeUserCode(body?.userCode);
  if (normalized) {
    await env.DB
      .prepare(`UPDATE "deviceCode" SET "userId" = NULL WHERE "userCode" = ? AND "appId" = ? AND "userId" = ? AND "status" = 'pending'`)
      .bind(normalized, app.id, session.user.id)
      .run()
      .catch(() => { /* best effort */ });
  }
  return c.body(null, 204);
}

/**
 * Per-app device sign-in on Better Auth's device-authorization plugin.
 *
 * The plugin owns the RFC 8628 state machine: code issue, the hosted
 * verify/approve/deny endpoints, polling, slow_down, expiry, denial, and the
 * atomic one-time claim. Kova adds an app-owned grant on top:
 *
 *   - client_id is the app's publishable key. `authorizeRequest` resolves the
 *     app and stores its id plus display-only device context on the code.
 *     The app id is what owns the code: a promoted app answers to its current
 *     and its legacy key, and clientId records whichever key was current at
 *     issue, so ownership is never compared by key.
 *   - Codes are only issued through POST /api/pub/apps/:pk/device/start, which
 *     calls the plugin from the server. A direct /api/auth/device/code call
 *     (one that carries an HTTP request) is refused.
 *   - The stock /api/auth/device/token would mint a platform session (no
 *     app_id, admin/org reach). `assertSessionRedemption` refuses it for every
 *     app-owned code. Redemption goes through the server-only
 *     `kovaRedeemDeviceCode` endpoint instead, which runs the plugin's own
 *     `redeemDeviceCode` and then mints an app-scoped session for that app.
 *
 * Note: the plugin does not move `lastPolledAt` forward on a slow_down, so a
 * client that keeps polling too fast keeps getting slow_down until it backs
 * off. RFC 8628 has the client add 5s per slow_down; the SDK does.
 */
import { APIError, createAuthEndpoint } from "better-auth/api";
import { redeemDeviceCode, type DeviceAuthorizationGrant } from "better-auth/plugins/device-authorization";
import type { BetterAuthPlugin } from "better-auth";
import * as z from "zod";
import { getApplicationByPublishableKey } from "../applications";
import { findMFAEnforcedOrgBlockingUser } from "../org-settings";
import { insertAppScopedSession } from "./app-session";
import { clipDeviceLabel } from "./device-code";

/** What a code row carries beyond the plugin's own columns. */
export type KovaDeviceCodeFields = {
  appId?: string | null;
  deviceHostname?: string | null;
  devicePlatform?: string | null;
  deviceLabel?: string | null;
  requesterIp?: string | null;
  requesterCountry?: string | null;
  requesterCity?: string | null;
};

/** Owner-only additions to GET /api/auth/device (the hosted page reads these). */
export type KovaDeviceVerificationContext = {
  app_id: string;
  device_hostname?: string;
  device_platform?: string;
  device_label?: string;
  requester_ip?: string;
  requester_country?: string;
  requester_city?: string;
};

const optionalText = z.string().max(4096).optional();

const requestSchemaFields = {
  hostname: optionalText,
  platform: optionalText,
  label: optionalText,
  // Set by the start wrapper from the incoming request, never by the device.
  requester_ip: optionalText,
  requester_country: optionalText,
  requester_city: optionalText,
};

const text = { type: "string", required: false } as const;

function present(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function kovaDeviceGrant(env: Pick<Env, "DB">): DeviceAuthorizationGrant<typeof requestSchemaFields, KovaDeviceVerificationContext> {
  return {
    requestSchemaFields,
    deviceCodeSchemaFields: {
      appId: text,
      deviceHostname: text,
      devicePlatform: text,
      deviceLabel: text,
      requesterIp: text,
      requesterCountry: text,
      requesterCity: text,
    },
    async authorizeRequest({ ctx, request }) {
      if (ctx.request) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description: "Start device sign-in at POST /api/pub/apps/{publishableKey}/device/start",
        });
      }
      const app = request.client_id
        ? await getApplicationByPublishableKey(env.DB, request.client_id).catch(() => null)
        : null;
      // Somewhere to approve the code: the app's own page or its hosted host.
      if (!app || app.suspended_at || (!app.auth_slug && !app.device_verification_uri)) {
        throw new APIError("BAD_REQUEST", { error: "invalid_client", error_description: "Device sign-in is not available for this application" });
      }
      return {
        clientId: app.publishable_key,
        deviceCodeFields: {
          appId: app.id,
          deviceHostname: clipDeviceLabel(request.hostname),
          devicePlatform: clipDeviceLabel(request.platform),
          deviceLabel: clipDeviceLabel(request.label),
          requesterIp: clipDeviceLabel(request.requester_ip),
          requesterCountry: clipDeviceLabel(request.requester_country),
          requesterCity: clipDeviceLabel(request.requester_city),
        },
      };
    },
    assertSessionRedemption({ deviceCode }) {
      if ((deviceCode as KovaDeviceCodeFields).appId) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_grant",
          error_description: "App device codes are redeemed at POST /api/pub/apps/{publishableKey}/device/poll",
        });
      }
    },
    getVerificationContext(deviceCode) {
      const row = deviceCode as KovaDeviceCodeFields;
      if (!row.appId) return undefined;
      return {
        app_id: row.appId,
        device_hostname: present(row.deviceHostname),
        device_platform: present(row.devicePlatform),
        device_label: present(row.deviceLabel),
        requester_ip: present(row.requesterIp),
        requester_country: present(row.requesterCountry),
        requester_city: present(row.requesterCity),
      };
    },
    verificationOpenAPIProperties: {
      app_id: { type: "string", description: "Kova application that requested sign-in" },
      device_hostname: { type: "string" },
      device_platform: { type: "string" },
      device_label: { type: "string" },
      requester_ip: { type: "string" },
      requester_country: { type: "string" },
      requester_city: { type: "string" },
    },
  };
}

/**
 * Server-only redemption for app device codes. Runs the plugin's polling and
 * one-time claim, then mints the app-scoped session. Nothing is minted before
 * this point, so an approved code that is never polled leaves no session.
 */
export function kovaDeviceRedemption(env: Pick<Env, "DB">) {
  return {
    id: "kova-device-redemption",
    endpoints: {
      kovaRedeemDeviceCode: createAuthEndpoint(
        "/kova/device/redeem",
        {
          method: "POST",
          body: z.object({
            deviceCode: z.string().min(1),
            /** The app resolved from the poll's publishable key (current or legacy). */
            appId: z.string().min(1),
            ipAddress: z.string().nullable().optional(),
            userAgent: z.string().nullable().optional(),
          }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const { deviceCode, appId } = ctx.body;
          const { user } = await redeemDeviceCode<KovaDeviceCodeFields, undefined, undefined>({
            ctx,
            deviceCode,
            authorizeRedemption(record) {
              // Another app's code is indistinguishable from an unknown one.
              if (!record.appId || record.appId !== appId) {
                throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "Invalid device code" });
              }
              return { ownershipWhere: { field: "appId", value: appId }, context: undefined };
            },
            async prepareRedemption(record) {
              // Same gate the session-create hook applies to every other sign-in.
              if (record.userId && (await findMFAEnforcedOrgBlockingUser(env.DB, record.userId).catch(() => null))) {
                throw new APIError("FORBIDDEN", { error: "mfa_required", error_description: "Two-factor authentication is required" });
              }
              return undefined;
            },
          });

          const { generateId } = await import("better-auth");
          const sessionToken = generateId(32);
          await insertAppScopedSession(env.DB, {
            sessionId: generateId(),
            userId: user.id,
            token: sessionToken,
            appId,
            ipAddress: ctx.body.ipAddress ?? null,
            userAgent: ctx.body.userAgent ?? null,
          });
          await env.DB
            .prepare("INSERT OR IGNORE INTO app_user (id, app_id, user_id, role) VALUES (?, ?, ?, 'member')")
            .bind(`apu_${generateId(12)}`, appId, user.id)
            .run()
            .catch(() => { /* best-effort */ });

          return ctx.json({ sessionToken, userId: user.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

export type DeviceClaimRelease =
  | "released"
  | "unknown"       // no such code, or another app's
  | "expired"
  | "not_pending"   // already approved or denied
  | "not_claimed"
  | "not_claimer";  // claimed by another account

function expired(value: unknown, now: number): boolean {
  if (value === null || value === undefined) return true;
  const at = value instanceof Date ? value.getTime() : new Date(typeof value === "number" ? value : String(value)).getTime();
  return Number.isNaN(at) || at < now;
}

/**
 * Gives up `userId`'s claim on a code (the "use another account" path), so the
 * next account that verifies it can claim it. Nothing else about the code
 * changes. Only the account holding the claim can release, only while the
 * code is pending and unexpired, and only for `appId`'s own codes. The update
 * repeats every condition, so a code approved, denied, or re-claimed after
 * the read is left alone. Shared by the hosted /device page and the
 * app-session /device/release endpoint. `userCode` is normalized.
 */
export async function releaseDeviceCodeClaim(
  db: D1Database,
  input: { userCode: string; appId: string; userId: string; now?: number },
): Promise<DeviceClaimRelease> {
  const { userCode, appId, userId } = input;
  const row = await db
    .prepare(`SELECT "appId", "status", "userId", "expiresAt" FROM "deviceCode" WHERE "userCode" = ? LIMIT 1`)
    .bind(userCode)
    .first<{ appId: string | null; status: string; userId: string | null; expiresAt: unknown }>();
  if (!row || row.appId !== appId) return "unknown";
  if (expired(row.expiresAt, input.now ?? Date.now())) return "expired";
  if (row.status !== "pending") return "not_pending";
  if (!row.userId) return "not_claimed";
  if (row.userId !== userId) return "not_claimer";

  const result = await db
    .prepare(`UPDATE "deviceCode" SET "userId" = NULL WHERE "userCode" = ? AND "appId" = ? AND "userId" = ? AND "status" = 'pending'`)
    .bind(userCode, appId, userId)
    .run();
  // Changed between the read and the write: decided, or no longer ours.
  return result.meta?.changes ? "released" : "not_claimer";
}

/** The RFC 8628 error a plugin APIError carries, if any. */
export function deviceErrorCode(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  const body = error.body as { error?: unknown; code?: unknown } | undefined;
  if (typeof body?.error === "string") return body.error;
  return null;
}

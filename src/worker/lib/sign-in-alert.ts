/**
 * Sign-in alert emails: after a real sign-in (Better Auth's session.create
 * hook, auth.ts), email the user when the device (browser + OS + platform) or
 * the country has not signed in to their account in the last 90 days.
 *
 * Not sent: for the sign-in right after sign-up (account < 10 minutes old), when
 * the account has never signed in before, when the app the sign-in happened in
 * turned alerts off (application.sign_in_alerts = 0), or more than once per
 * user per 10 minutes. Callers run this in the background; it never affects
 * the sign-in.
 */
import { logAudit } from "../audit";
import { devEmailCaptureEnabled, type EmailBrand, fromWithDisplayName, sendEmail, signInAlertEmail } from "../email";
import { sessionExpiryMs } from "./app-session";
import type { ClientDescription } from "./audit-context";
import { NOT_ME_TOKEN_TTL_MS, signNotMeToken } from "./not-me-token";

export const ALERT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
export const NEW_ACCOUNT_GRACE_MS = 10 * 60 * 1000;
export const ALERT_COOLDOWN_SECONDS = 10 * 60;

export type AlertEnv = Pick<
  Env,
  "DB" | "KV" | "AUTH_URL" | "BETTER_AUTH_SECRET" | "RESEND_API_KEY" | "EMAIL_FROM" | "KOVA_DEV_EMAIL_CAPTURE"
>;

export interface SignInAlertEvent {
  userId: string;
  appId: string | null;
  client: ClientDescription | null;
  country: string | null;
  city: string | null;
  /** When the sign-in happened (its audit row's createdAt), epoch ms. */
  at: number;
}

export type AlertReason = "new_device" | "new_country";
export type SkipReason = "no_user" | "new_account" | "app_disabled" | "no_history" | "known" | "rate_limited";

interface AlertUser { id: string; name: string | null; email: string }
interface AlertApp { id: string; name: string; logoUrl: string | null; primaryColor: string | null }

export type SignInAlertDecision =
  | { send: true; reasons: AlertReason[]; user: AlertUser; app: AlertApp | null }
  | { send: false; reason: SkipReason };

/** Browser family + OS family + platform, lower-cased: what "the same device" means here. */
export function deviceFingerprint(client: Pick<ClientDescription, "browser" | "os" | "platform"> | null | undefined): string {
  return [client?.browser, client?.os, client?.platform].map((part) => (part ?? "").trim().toLowerCase()).join("|");
}

const SIGN_IN_ACTIONS = "('user.signIn', 'app.signIn')";
// Rows written for a session the 2FA plugin discards before the second factor
// (auth.ts marks them) are not sign-ins the user completed.
/** SQL: the row is not a 2FA-pending sign-in. `column` is the metadata column. */
export function notTwoFactorPendingSql(column = "metadata"): string {
  return `COALESCE(CASE WHEN json_valid(${column}) THEN json_extract(${column}, '$.twoFactorPending') END, 0) = 0`;
}
const COMPLETED = notTwoFactorPendingSql();
const clientField = (field: string) =>
  `LOWER(COALESCE(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.client.${field}') END, ''))`;

const cooldownKey = (userId: string) => `signin-alert:${userId}`;

export async function decideSignInAlert(
  env: Pick<Env, "DB" | "KV">,
  event: SignInAlertEvent,
): Promise<SignInAlertDecision> {
  const user = await env.DB
    .prepare('SELECT id, name, email, createdAt FROM "user" WHERE id = ? LIMIT 1')
    .bind(event.userId)
    .first<{ id: string; name: string | null; email: string | null; createdAt: unknown }>();
  if (!user?.email) return { send: false, reason: "no_user" };
  const createdAt = sessionExpiryMs(user.createdAt);
  if (createdAt === null || event.at - createdAt < NEW_ACCOUNT_GRACE_MS) return { send: false, reason: "new_account" };

  let app: AlertApp | null = null;
  if (event.appId) {
    const row = await env.DB
      .prepare("SELECT id, name, display_name, logo_url, primary_color, sign_in_alerts FROM application WHERE id = ? LIMIT 1")
      .bind(event.appId)
      .first<{ id: string; name: string; display_name: string | null; logo_url: string | null; primary_color: string | null; sign_in_alerts: number | null }>();
    if (row && row.sign_in_alerts === 0) return { send: false, reason: "app_disabled" };
    if (row) app = { id: row.id, name: row.display_name ?? row.name, logoUrl: row.logo_url, primaryColor: row.primary_color };
  }

  const seen = await env.DB
    .prepare(
      `SELECT DISTINCT country, ${clientField("browser")} AS browser, ${clientField("os")} AS os, ${clientField("platform")} AS platform
       FROM audit_log
       WHERE userId = ? AND action IN ${SIGN_IN_ACTIONS} AND createdAt >= ? AND createdAt < ? AND ${COMPLETED}
       LIMIT 500`,
    )
    .bind(event.userId, event.at - ALERT_LOOKBACK_MS, event.at)
    .all<{ country: string | null; browser: string; os: string; platform: string }>()
    .then((result) => result.results ?? []);
  if (!seen.length) {
    const earlier = await env.DB
      .prepare(`SELECT 1 AS found FROM audit_log WHERE userId = ? AND action IN ${SIGN_IN_ACTIONS} AND createdAt < ? AND ${COMPLETED} LIMIT 1`)
      .bind(event.userId, event.at)
      .first<{ found: number }>();
    if (!earlier) return { send: false, reason: "no_history" };
  }

  // Rows from before client and country were recorded (migration 0031) say
  // nothing about either; with only those, the sign-in is not "new".
  const fingerprint = deviceFingerprint(event.client);
  const devices = new Set(seen.map(deviceFingerprint).filter((value) => value !== "||"));
  const countries = new Set(seen.map((row) => row.country).filter(Boolean));
  // No sign-in at all in the window: everything about this one is new.
  const quiet = seen.length === 0;
  const reasons: AlertReason[] = [];
  if (fingerprint !== "||" && (quiet || (devices.size > 0 && !devices.has(fingerprint)))) reasons.push("new_device");
  if (event.country && (quiet || (countries.size > 0 && !countries.has(event.country)))) reasons.push("new_country");
  if (!reasons.length) return { send: false, reason: "known" };

  // Set by sendSignInAlert once an email has gone out. KV has no atomic
  // check-and-set; a rare duplicate under a race is acceptable.
  if (await env.KV.get(cooldownKey(event.userId))) return { send: false, reason: "rate_limited" };

  return { send: true, reasons, user: { id: user.id, name: user.name, email: user.email }, app };
}

/** "Safari on iOS", "Chrome", "Android", or null. */
export function describeDevice(client: ClientDescription | null | undefined): string | null {
  const browser = client?.browser?.trim();
  const os = client?.os?.trim();
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || null;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function inAppBrowserName(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export async function sendSignInAlert(
  env: AlertEnv,
  event: SignInAlertEvent,
  decision: Extract<SignInAlertDecision, { send: true }>,
  now = Date.now(),
): Promise<void> {
  const alertId = crypto.randomUUID();
  const token = await signNotMeToken(env.BETTER_AUTH_SECRET, {
    u: event.userId,
    a: alertId,
    e: now + NOT_ME_TOKEN_TTL_MS,
    app: decision.app?.id ?? null,
    t: event.at,
  });
  const notMeUrl = `${env.AUTH_URL.replace(/\/+$/, "")}/api/security/not-me?token=${encodeURIComponent(token)}`;
  const location = [event.city, event.country ? countryName(event.country) : null].filter(Boolean).join(", ") || null;
  const brand: EmailBrand | undefined = decision.app
    ? { name: decision.app.name, logoUrl: decision.app.logoUrl, accent: decision.app.primaryColor }
    : undefined;
  const { subject, html } = signInAlertEmail({
    appName: decision.app?.name ?? null,
    device: describeDevice(event.client),
    inAppBrowser: inAppBrowserName(event.client?.inApp),
    location,
    at: event.at,
    notMeUrl,
  }, brand);

  await sendEmail({
    to: decision.user.email,
    subject,
    html,
    apiKey: env.RESEND_API_KEY,
    capture: devEmailCaptureEnabled(env),
    from: decision.app ? fromWithDisplayName(env.EMAIL_FROM, `${decision.app.name} via Kova`) : env.EMAIL_FROM,
  });
  // Only a sent email starts the cooldown; a failed send can be retried by the next sign-in.
  await env.KV.put(cooldownKey(event.userId), String(event.at), { expirationTtl: ALERT_COOLDOWN_SECONDS });

  await logAudit(env.DB, {
    userId: event.userId,
    actor: event.userId,
    actorName: decision.user.name,
    actorEmail: decision.user.email,
    action: "security.signInAlertSent",
    appId: event.appId,
    country: event.country,
    city: event.city,
    metadata: { alertId, reasons: decision.reasons, client: event.client },
  });
}

/** Decide, then send. Never throws; returns the decision for logging and tests. */
export async function maybeSendSignInAlert(env: AlertEnv, event: SignInAlertEvent): Promise<SignInAlertDecision | null> {
  try {
    const decision = await decideSignInAlert(env, event);
    if (decision.send) await sendSignInAlert(env, event, decision);
    return decision;
  } catch (error) {
    console.error("[kova-auth] sign-in alert failed", error);
    return null;
  }
}

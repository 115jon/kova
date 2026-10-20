/**
 * Per-app device-code sign-in (RFC 8628 shape, Kova session delivery).
 *
 * This is not the admin machine-bootstrap in device-challenge.ts. A Mira
 * client polls with a high-entropy device code. The person approves a short
 * user code on the hosted app origin. The session token is written onto the
 * device record and returned to the poller exactly once.
 *
 * Never put the device code in a URL, an HTML page, or a log line.
 */

import type { KVNamespace } from "@cloudflare/workers-types";

export const DEVICE_LOGIN_TTL_SECONDS = 600;
export const DEVICE_LOGIN_INTERVAL_SECONDS = 5;

const INTERVAL_MS = DEVICE_LOGIN_INTERVAL_SECONDS * 1000;
const MAX_LABEL = 128;
const USER_CODE_ATTEMPTS = 5;
const DEVICE_KEY_PREFIX = "device-login:";
const USER_KEY_PREFIX = "device-login-user:";
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE_RE = /^dvc_[A-Za-z0-9_-]{43}$/;
const DISPLAY_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export type DeviceLoginStatus = "pending" | "approved" | "denied" | "consumed";

export interface DeviceLoginRecord {
  deviceCode: string;
  /** Eight-character user code, no dash. */
  userCode: string;
  publishableKey: string;
  appId: string;
  createdAt: number;
  expiresAt: number;
  status: DeviceLoginStatus;
  /** Empty until approval. Cleared when the poller claims it. */
  sessionToken: string | null;
  lastPollAt: number;
  hostname: string | null;
  platform: string | null;
  label: string | null;
  approverUserId: string | null;
}

export interface DeviceLoginStartBody {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: 5;
  expiresIn: 600;
}

export type DeviceLoginPollResult =
  | { error: "invalid_device_code" }
  | { error: "expired_token" }
  | { error: "slow_down"; interval: 5 }
  | { status: "pending"; interval: 5 }
  | { status: "denied" }
  | { status: "approved"; sessionToken: string };

export type DeviceLoginDecisionResult =
  | { error: "invalid_code" }
  | { error: "not_pending"; status: DeviceLoginStatus }
  | { status: "approved" | "denied" };

type RandomSource = {
  deviceCode?: () => string;
  userCode?: () => string;
};

function clipLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_LABEL);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function randomDeviceCode(): string {
  return `dvc_${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) out += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return out;
}

export function isDeviceCode(value: string): boolean {
  return DEVICE_CODE_RE.test(value);
}

/** Strip dashes and uppercase. Rejects anything outside the issued alphabet. */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/-/g, "").toUpperCase();
  if (compact.length !== 8) return null;
  for (const char of compact) {
    if (!USER_CODE_ALPHABET.includes(char)) return null;
  }
  return compact;
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;
}

/**
 * Same-origin approval return. Path only, under /device, one code query.
 * Rejects schemes, protocol-relative URLs, and extra parameters.
 */
export function isSafeDeviceReturnPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!/^\/device\?code=[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(path)) return false;
  if (path.length > 80) return false;
  if (path.includes("\\") || path.includes("//") || path.includes("@")) return false;
  let url: URL;
  try {
    url = new URL(path, "https://device.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://device.invalid") return false;
  if (url.pathname !== "/device") return false;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "code") return false;
  const code = url.searchParams.get("code");
  return code !== null && DISPLAY_CODE_RE.test(code);
}

export function deviceReturnPath(userCode: string): string | null {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) return null;
  const path = `/device?code=${formatUserCode(normalized)}`;
  return isSafeDeviceReturnPath(path) ? path : null;
}

export function hostedVerificationUri(authUrl: string, slug: string | null | undefined): string | null {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  let base: URL;
  try {
    base = new URL(authUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return `${base.protocol}//${slug}.${base.hostname}/device`;
}

function deviceKey(deviceCode: string): string {
  return `${DEVICE_KEY_PREFIX}${deviceCode}`;
}

function userKey(userCode: string): string {
  return `${USER_KEY_PREFIX}${userCode}`;
}

async function writeRecord(kv: KVNamespace, record: DeviceLoginRecord): Promise<void> {
  const remainingMs = record.expiresAt - Date.now();
  if (remainingMs <= 0) return;
  const ttl = Math.max(60, Math.floor(remainingMs / 1000));
  const json = JSON.stringify(record);
  await kv.put(deviceKey(record.deviceCode), json, { expirationTtl: ttl });
  await kv.put(userKey(record.userCode), record.deviceCode, { expirationTtl: ttl });
}

function parseRecord(raw: string): DeviceLoginRecord | null {
  try {
    const parsed = JSON.parse(raw) as DeviceLoginRecord;
    if (!parsed || typeof parsed.deviceCode !== "string" || typeof parsed.userCode !== "string") return null;
    if (typeof parsed.publishableKey !== "string" || typeof parsed.appId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getDeviceLogin(kv: KVNamespace, deviceCode: string): Promise<DeviceLoginRecord | null> {
  if (!isDeviceCode(deviceCode)) return null;
  const raw = await kv.get(deviceKey(deviceCode)).catch(() => null);
  if (!raw) return null;
  return parseRecord(raw);
}

export async function findDeviceLoginByUserCode(
  kv: KVNamespace,
  userCode: unknown,
): Promise<DeviceLoginRecord | null> {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) return null;
  const deviceCode = await kv.get(userKey(normalized)).catch(() => null);
  if (!deviceCode) return null;
  const record = await getDeviceLogin(kv, deviceCode);
  if (!record || record.userCode !== normalized) return null;
  return record;
}

function boundToApp(record: DeviceLoginRecord, publishableKey: string, appId: string): boolean {
  return record.publishableKey === publishableKey && record.appId === appId;
}

export async function startDeviceLogin(
  kv: KVNamespace,
  input: {
    publishableKey: string;
    appId: string;
    authUrl: string;
    authSlug: string | null;
    hostname?: unknown;
    platform?: unknown;
    label?: unknown;
    now?: number;
  },
  random: RandomSource = {},
): Promise<{ error: "device_flow_unavailable" } | { body: DeviceLoginStartBody }> {
  const verificationUri = hostedVerificationUri(input.authUrl, input.authSlug);
  if (!verificationUri) return { error: "device_flow_unavailable" };

  const now = input.now ?? Date.now();
  const nextDeviceCode = random.deviceCode ?? randomDeviceCode;
  const nextUserCode = random.userCode ?? randomUserCode;

  for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt += 1) {
    const userCode = nextUserCode();
    if (!normalizeUserCode(userCode)) continue;
    const existing = await kv.get(userKey(userCode)).catch(() => null);
    if (existing) continue;

    const deviceCode = nextDeviceCode();
    if (!isDeviceCode(deviceCode)) continue;
    const display = formatUserCode(userCode);
    const record: DeviceLoginRecord = {
      deviceCode,
      userCode,
      publishableKey: input.publishableKey,
      appId: input.appId,
      createdAt: now,
      expiresAt: now + DEVICE_LOGIN_TTL_SECONDS * 1000,
      status: "pending",
      sessionToken: null,
      lastPollAt: now,
      hostname: clipLabel(input.hostname),
      platform: clipLabel(input.platform),
      label: clipLabel(input.label),
      approverUserId: null,
    };
    await writeRecord(kv, record);
    return {
      body: {
        deviceCode,
        userCode: display,
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${display}`,
        interval: DEVICE_LOGIN_INTERVAL_SECONDS,
        expiresIn: DEVICE_LOGIN_TTL_SECONDS,
      },
    };
  }

  return { error: "device_flow_unavailable" };
}

export async function pollDeviceLogin(
  kv: KVNamespace,
  input: {
    publishableKey: string;
    appId: string;
    deviceCode: string;
    now?: number;
  },
): Promise<DeviceLoginPollResult> {
  if (!isDeviceCode(input.deviceCode)) return { error: "invalid_device_code" };
  const record = await getDeviceLogin(kv, input.deviceCode);
  if (!record) return { error: "expired_token" };
  if (!boundToApp(record, input.publishableKey, input.appId)) return { error: "invalid_device_code" };

  const now = input.now ?? Date.now();
  if (now >= record.expiresAt) return { error: "expired_token" };
  if (record.status === "consumed" || (record.status === "approved" && !record.sessionToken)) {
    return { error: "expired_token" };
  }
  if (now - record.lastPollAt < INTERVAL_MS) {
    return { error: "slow_down", interval: DEVICE_LOGIN_INTERVAL_SECONDS };
  }

  if (record.status === "pending") {
    record.lastPollAt = now;
    await writeRecord(kv, record);
    return { status: "pending", interval: DEVICE_LOGIN_INTERVAL_SECONDS };
  }

  if (record.status === "denied") {
    record.lastPollAt = now;
    await writeRecord(kv, record);
    return { status: "denied" };
  }

  const sessionToken = record.sessionToken;
  if (!sessionToken) return { error: "expired_token" };
  record.status = "consumed";
  record.sessionToken = null;
  record.lastPollAt = now;
  await writeRecord(kv, record);
  return { status: "approved", sessionToken };
}

export async function decideDeviceLogin(
  kv: KVNamespace,
  input: {
    publishableKey: string;
    appId: string;
    userCode: unknown;
    decision: "approved" | "denied";
    sessionToken?: string | null;
    approverUserId: string;
    now?: number;
  },
): Promise<DeviceLoginDecisionResult> {
  const now = input.now ?? Date.now();
  const record = await findDeviceLoginByUserCode(kv, input.userCode);
  if (!record || !boundToApp(record, input.publishableKey, input.appId) || now >= record.expiresAt) {
    return { error: "invalid_code" };
  }
  if (record.status !== "pending") return { error: "not_pending", status: record.status };
  if (input.decision === "approved") {
    if (typeof input.sessionToken !== "string" || !input.sessionToken) return { error: "invalid_code" };
    record.status = "approved";
    record.sessionToken = input.sessionToken;
  } else {
    record.status = "denied";
    record.sessionToken = null;
  }
  record.approverUserId = input.approverUserId;
  await writeRecord(kv, record);
  return { status: record.status };
}

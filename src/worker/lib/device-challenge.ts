import type { KVNamespace } from "@cloudflare/workers-types";

export const DEVICE_CHALLENGE_TTL_SECONDS = 600;
export const DEVICE_CHALLENGE_ID_PREFIX = "dc_";
export const DEVICE_APPROVAL_TOKEN_PREFIX = "dat_";

const KEY_PREFIX = "device-challenge:";
const MAX_LABEL = 128;

export type DeviceChallengeStatus = "pending" | "approved" | "denied" | "claimed";

export interface DeviceChallenge {
  id: string;
  createdAt: number;
  expiresAt: number;
  hostname: string | null;
  platform: string | null;
  label: string | null;
  status: DeviceChallengeStatus;
  approverUserId: string | null;
  approvalToken: string | null;
}

export interface DeviceChallengePublicView {
  id: string;
  status: DeviceChallengeStatus;
  hostname: string | null;
  platform: string | null;
  label: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface CreateDeviceChallengeInput {
  hostname?: string | null;
  platform?: string | null;
  label?: string | null;
}

function randomPrefixed(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${prefix}${b64}`;
}

export function isDeviceChallengeId(id: string): boolean {
  return (
    id.startsWith(DEVICE_CHALLENGE_ID_PREFIX)
    && id.length > DEVICE_CHALLENGE_ID_PREFIX.length + 20
    && /^[A-Za-z0-9_-]+$/.test(id)
  );
}

export function clipLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_LABEL);
}

function challengeKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export function toPublicView(challenge: DeviceChallenge): DeviceChallengePublicView {
  return {
    id: challenge.id,
    status: challenge.status,
    hostname: challenge.hostname,
    platform: challenge.platform,
    label: challenge.label,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
  };
}

export async function createDeviceChallenge(
  kv: KVNamespace,
  input: CreateDeviceChallengeInput = {},
): Promise<DeviceChallenge> {
  const now = Date.now();
  const challenge: DeviceChallenge = {
    id: randomPrefixed(DEVICE_CHALLENGE_ID_PREFIX),
    createdAt: now,
    expiresAt: now + DEVICE_CHALLENGE_TTL_SECONDS * 1000,
    hostname: clipLabel(input.hostname),
    platform: clipLabel(input.platform),
    label: clipLabel(input.label),
    status: "pending",
    approverUserId: null,
    approvalToken: null,
  };

  await kv.put(challengeKey(challenge.id), JSON.stringify(challenge), {
    expirationTtl: DEVICE_CHALLENGE_TTL_SECONDS,
  });

  return challenge;
}

export async function getDeviceChallenge(
  kv: KVNamespace,
  id: string,
): Promise<DeviceChallenge | null> {
  if (!isDeviceChallengeId(id)) return null;
  const raw = await kv.get(challengeKey(id)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceChallenge;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function putChallenge(kv: KVNamespace, challenge: DeviceChallenge): Promise<void> {
  const remaining = Math.floor((challenge.expiresAt - Date.now()) / 1000);
  if (remaining < 60) return;
  await kv.put(challengeKey(challenge.id), JSON.stringify(challenge), {
    expirationTtl: remaining,
  });
}

export async function approveDeviceChallenge(
  kv: KVNamespace,
  id: string,
  approverUserId: string,
): Promise<DeviceChallenge | null> {
  const current = await getDeviceChallenge(kv, id);
  if (!current || current.status !== "pending") return null;

  const next: DeviceChallenge = {
    ...current,
    status: "approved",
    approverUserId,
    approvalToken: randomPrefixed(DEVICE_APPROVAL_TOKEN_PREFIX),
  };
  await putChallenge(kv, next);
  return next;
}

export async function denyDeviceChallenge(
  kv: KVNamespace,
  id: string,
  approverUserId: string,
): Promise<DeviceChallenge | null> {
  const current = await getDeviceChallenge(kv, id);
  if (!current || current.status !== "pending") return null;

  const next: DeviceChallenge = {
    ...current,
    status: "denied",
    approverUserId,
    approvalToken: null,
  };
  await putChallenge(kv, next);
  return next;
}

export async function claimDeviceChallenge(
  kv: KVNamespace,
  id: string,
): Promise<string | null> {
  const current = await getDeviceChallenge(kv, id);
  if (!current || current.status !== "approved" || !current.approvalToken) return null;

  const token = current.approvalToken;
  const next: DeviceChallenge = {
    ...current,
    status: "claimed",
    approvalToken: null,
  };
  await putChallenge(kv, next);
  return token;
}

/**
 * Vanilla Kova device-challenge client.
 * No React. No Better Auth. Safe from Electron main, a CLI, or a web app.
 */

export const DEFAULT_KOVA_URL = "https://auth.115jon.site";

const CHALLENGE_ID = /^dc_[A-Za-z0-9_-]{20,}$/;

export function isDeviceChallengeId(id: string): boolean {
  return CHALLENGE_ID.test(id);
}

export type DeviceChallengeStatus = "pending" | "approved" | "denied" | "claimed";

export type DeviceChallenge = {
  id: string;
  status: DeviceChallengeStatus;
  approveUrl?: string;
  hostname?: string | null;
  platform?: string | null;
  label?: string | null;
};

export type CreateDeviceChallengeInput = {
  hostname?: string;
  platform?: string;
  label?: string;
};

function trimBase(kovaUrl: string): string {
  return kovaUrl.replace(/\/$/, "");
}

export function challengeCreateUrl(kovaUrl: string): string {
  return `${trimBase(kovaUrl)}/api/device-challenges`;
}

export function challengePollUrl(kovaUrl: string, id: string): string {
  return `${trimBase(kovaUrl)}/api/device-challenges/${id}`;
}

export function approveUrl(kovaUrl: string, id: string): string {
  return `${trimBase(kovaUrl)}/approve/${id}`;
}

export function resolveApproveUrl(challenge: DeviceChallenge, kovaUrl = DEFAULT_KOVA_URL): string {
  return challenge.approveUrl ?? approveUrl(kovaUrl, challenge.id);
}

export async function createDeviceChallenge(
  kovaUrl: string,
  input: CreateDeviceChallengeInput = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceChallenge> {
  const res = await fetchImpl(challengeCreateUrl(kovaUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hostname: input.hostname ?? null,
      platform: input.platform ?? null,
      label: input.label ?? input.hostname ?? null,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as DeviceChallenge;
  if (!res.ok || !isDeviceChallengeId(body.id)) {
    throw new Error(`could not create challenge (${res.status})`);
  }
  return body;
}

export async function pollDeviceChallenge(
  kovaUrl: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceChallenge> {
  if (!isDeviceChallengeId(id)) {
    throw new Error("bad_challenge");
  }
  const res = await fetchImpl(challengePollUrl(kovaUrl, id));
  if (res.status === 404) {
    throw new Error("This approval expired or was never created.");
  }
  if (!res.ok) {
    throw new Error(`could not poll challenge (${res.status})`);
  }
  return (await res.json()) as DeviceChallenge;
}

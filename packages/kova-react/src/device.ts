/**
 * Vanilla Kova device-challenge client.
 * No React. No Better Auth. Safe from Electron main, a CLI, or a web app.
 */

/** Last-resort Kova host. Every function here takes the configured URL first. */
export const DEFAULT_KOVA_URL = "https://auth.115jon.site";

// Per-app device sign-in for desktop/CLI apps; same entry, no React.
export { startDeviceSignIn } from "./device-sign-in";
export type { DeviceSignIn, DeviceSignInOptions, DeviceSignInState } from "./device-sign-in";

// Approving a device code from the app's own /activate page; same entry, no React.
export { approveDeviceRequest, denyDeviceRequest, getDeviceRequest, releaseDeviceRequest } from "./device-approval";
export type {
  DeviceApprovalError,
  DeviceApprovalErrorCode,
  DeviceApprovalOptions,
  DeviceDecisionResult,
  DeviceReleaseResult,
  DeviceRequest,
  DeviceRequestResult,
} from "./device-approval";

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

/**
 * Where the user approves a challenge: the server's `approveUrl` (built from
 * its own configured dashboard host), else `/approve/:id` on the configured
 * `kovaUrl`. Pass your `authUrl`; the {@link DEFAULT_KOVA_URL} default is a
 * last resort for callers that configure nothing.
 */
export function resolveApproveUrl(challenge: DeviceChallenge, kovaUrl?: string | null): string {
  return challenge.approveUrl ?? approveUrl(kovaUrl || DEFAULT_KOVA_URL, challenge.id);
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

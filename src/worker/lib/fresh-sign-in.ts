/**
 * A session this young was created by the sign-in that led to this handoff.
 * Shared by the SDK bounce (authoritative) and the hosted sign-in page, which
 * uses it only to decide whether to skip the account chooser.
 */
export const FRESH_SIGN_IN_MS = 2 * 60 * 1000;

export function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.NaN;
}

export function isFreshSignInSession(createdAt: unknown, now = Date.now()): boolean {
  const created = timestampMs(createdAt);
  return Number.isFinite(created) && now - created <= FRESH_SIGN_IN_MS;
}

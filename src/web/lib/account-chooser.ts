import { timestampMs } from "../../worker/lib/fresh-sign-in";

/** One entry of Better Auth's multi-session list-device-sessions. */
export type DeviceSession = {
  session: { id: string; token: string; createdAt?: unknown; updatedAt?: unknown };
  user: { id: string; name?: string | null; email: string; image?: string | null };
};

export type ChooserAccount = {
  sessionId: string;
  sessionToken: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * Accounts the chooser offers: one per user, the active session first, then
 * the most recently used. A user signed in twice keeps the active session, or
 * else the newer one.
 */
export function chooserAccounts(sessions: readonly DeviceSession[], activeSessionId: string | null): ChooserAccount[] {
  const recency = (entry: DeviceSession) => {
    if (entry.session.id === activeSessionId) return Number.POSITIVE_INFINITY;
    const used = timestampMs(entry.session.updatedAt ?? entry.session.createdAt);
    return Number.isFinite(used) ? used : 0;
  };
  const byUser = new Map<string, DeviceSession>();
  for (const entry of sessions) {
    if (!entry?.session?.id || !entry.session.token || !entry.user?.id) continue;
    const kept = byUser.get(entry.user.id);
    if (!kept || recency(entry) > recency(kept)) byUser.set(entry.user.id, entry);
  }
  return [...byUser.values()]
    .sort((a, b) => recency(b) - recency(a))
    .map(({ session, user }) => ({
      sessionId: session.id,
      sessionToken: session.token,
      userId: user.id,
      name: user.name?.trim() || user.email,
      email: user.email,
      image: user.image || null,
    }));
}

/**
 * Deletes a user's session rows outright. D1 is the source of truth, but
 * Better Auth also mirrors the sessions it creates into KV secondary storage
 * (better-auth-cloudflare's `kv`): one key per token plus an
 * `active-sessions-<userId>` list, and it trusts a KV hit without reading D1.
 * Both go here too, or a revoked session keeps working until its KV TTL.
 *
 * Raw SQL on purpose: Better Auth's session.delete hooks would write one
 * `session.ended` row per session; callers log the one event that describes
 * what the user did. A browser's encrypted session cookie cache (5 minutes,
 * auth.ts) can still vouch for a revoked session until it expires.
 */
export async function revokeUserSessions(
  env: Pick<Env, "DB" | "KV">,
  userId: string,
  filter: { only?: string; except?: string } = {},
): Promise<number> {
  const rows = await env.DB
    .prepare("SELECT id, token FROM session WHERE userId = ?")
    .bind(userId)
    .all<{ id: string; token: string }>()
    .then((result) => result.results ?? []);
  const targets = rows.filter((row) =>
    (filter.only === undefined || row.id === filter.only) && (filter.except === undefined || row.id !== filter.except));
  if (!targets.length) return 0;

  const results = await env.DB.batch(
    targets.map((row) => env.DB.prepare("DELETE FROM session WHERE id = ? AND userId = ?").bind(row.id, userId)),
  );
  const revoked = results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);

  const tokens = new Set(targets.map((row) => row.token));
  await Promise.all([...tokens].map((token) => env.KV.delete(token).catch(() => undefined)));
  await pruneActiveSessionList(env.KV, userId, tokens).catch(() => undefined);
  return revoked;
}

async function pruneActiveSessionList(kv: Env["KV"], userId: string, tokens: Set<string>): Promise<void> {
  const key = `active-sessions-${userId}`;
  const raw = await kv.get(key);
  if (!raw) return;
  let list: Array<{ token?: unknown; expiresAt?: unknown }> = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed as typeof list;
  } catch {
    // Unreadable: drop it; Better Auth rebuilds it on the next sign-in.
  }
  const now = Date.now();
  const kept = list.filter((entry) =>
    typeof entry.token === "string" && !tokens.has(entry.token) && typeof entry.expiresAt === "number" && entry.expiresAt > now);
  if (!kept.length) {
    await kv.delete(key);
    return;
  }
  const furthest = Math.max(...kept.map((entry) => entry.expiresAt as number));
  await kv.put(key, JSON.stringify(kept), { expirationTtl: Math.max(60, Math.ceil((furthest - now) / 1000)) });
}

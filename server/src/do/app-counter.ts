/**
 * app-counter.ts — Durable Object for per-app atomic stat counters.
 *
 * Each application gets one AppCounter DO instance (keyed by app_id).
 * The DO maintains three counters in SQLite storage:
 *
 *   total_users  — incremented when a new app_user row is inserted.
 *                  Decremented on user removal.
 *   total_orgs   — incremented when an org is created for this app.
 *                  Decremented on org deletion.
 *   logins_24h   — incremented on every session.create; auto-reset via alarm.
 *
 * These counters power the Overview tab stats without requiring D1 COUNT(*)
 * queries on every page load. The DO guarantees atomicity — no race conditions
 * if multiple simultaneous sign-ins hit the same app.
 *
 * Why not KV?
 *   KV is eventually consistent — concurrent writes from multiple Workers
 *   can silently drop increments (last-writer-wins). DOs are strongly
 *   consistent (single-threaded execution per instance), making them the
 *   correct primitive for atomic counters.
 */

export class AppCounter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    // SQLite storage is used internally by the runtime when
    // new_sqlite_classes is set in wrangler.toml. The DO's get/put API
    // works the same regardless of whether KV or SQLite is the backing store.
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── POST /increment  { counter: 'logins_24h' | 'total_users' | 'total_orgs', delta?: number }
    if (url.pathname === "/increment" && request.method === "POST") {
      const body = await request.json<{ counter: string; delta?: number }>();
      const delta = body.delta ?? 1;
      const current = (await this.state.storage.get<number>(body.counter)) ?? 0;
      const next = Math.max(0, current + delta);
      await this.state.storage.put(body.counter, next);

      // Set a 24-hour alarm if this is the first logins_24h write today.
      if (body.counter === "logins_24h") {
        const alarm = await this.state.storage.getAlarm();
        if (!alarm) {
          await this.state.storage.setAlarm(Date.now() + 86_400_000);
        }
      }
      return Response.json({ ok: true, value: next });
    }

    // ── GET /stats → { total_users, total_orgs, logins_24h }
    if (url.pathname === "/stats" && request.method === "GET") {
      const [users, orgs, logins] = await Promise.all([
        this.state.storage.get<number>("total_users"),
        this.state.storage.get<number>("total_orgs"),
        this.state.storage.get<number>("logins_24h"),
      ]);
      return Response.json({
        total_users: users ?? 0,
        total_orgs: orgs ?? 0,
        logins_24h: logins ?? 0,
      });
    }

    // ── POST /set  { total_users: N, total_orgs: N }
    // Called once after app creation to seed counters from a D1 snapshot.
    if (url.pathname === "/set" && request.method === "POST") {
      const body = await request.json<Record<string, number>>();
      await this.state.storage.put(body);
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  /** Alarm handler — resets logins_24h and reschedules for next day. */
  async alarm(): Promise<void> {
    await this.state.storage.put("logins_24h", 0);
    await this.state.storage.setAlarm(Date.now() + 86_400_000);
  }
}

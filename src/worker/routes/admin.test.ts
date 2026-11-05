import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryD1, migrationSql } from "../test-support/d1";
import { adminRouter } from "./admin";

type Caller = { user: { id: string; role: string; name: string; email: string }; session: { id: string } } | null;

const admin: NonNullable<Caller> = {
  user: { id: "admin-1", role: "admin", name: "Admin", email: "admin@example.com" },
  session: { id: "s_admin" },
};
const getSession = vi.fn(async (): Promise<Caller> => admin);

vi.mock("../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));
vi.mock("../audit", async (original) => ({
  ...await original<typeof import("../audit")>(),
  logAudit: async () => undefined,
}));
vi.mock("../webhook", () => ({ deliverEvent: async () => undefined }));

const HOUR = 60 * 60 * 1000;

/**
 * The real session table, with the two formats expiresAt really holds:
 * Better Auth writes integer milliseconds, insertAppScopedSession writes ISO text.
 */
function seededEnv() {
  const now = Date.now();
  const { sqlite, db } = memoryD1((sqlite) => {
    sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY, name TEXT)");
    for (const name of ["0000_init.sql", "0006_add_audit_log.sql", "0007_add_plugins.sql", "0016_session_app_tracking.sql", "0031_audit_log_context.sql"]) {
      sqlite.exec(migrationSql(name));
    }
    sqlite.exec("INSERT INTO application (id) VALUES ('app_1')");
    const user = sqlite.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt, banned) VALUES (?, ?, ?, ?, ?, ?)");
    user.run("admin-1", "Admin", "admin@example.com", now, now, 0);
    user.run("user-2", "Grace", "grace@example.com", now, now, 0);
    user.run("user-3", "Banned", "banned@example.com", now, now, 1);

    const session = sqlite.prepare(
      "INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const row = (id: string, userId: string, expiresAt: number | string, appId: string | null = null) =>
      session.run(id, userId, `tok_${id}`, expiresAt, now, now, appId);
    row("s_admin", "admin-1", now + HOUR);
    row("s_int_live", "user-2", now + HOUR);
    row("s_int_dead", "user-2", now - HOUR);
    row("s_iso_live", "user-2", new Date(now + HOUR).toISOString(), "app_1");
    row("s_iso_dead", "user-2", new Date(now - HOUR).toISOString(), "app_1");
  });
  return { sqlite, env: { DB: db } as unknown as Env };
}

const sessionIds = (sqlite: ReturnType<typeof seededEnv>["sqlite"]) =>
  (sqlite.prepare("SELECT id FROM session ORDER BY id").all() as { id: string }[]).map((r) => r.id);

beforeEach(() => getSession.mockReset().mockResolvedValue(admin));

describe("test database", () => {
  it("keeps ISO expiries as text next to integer ones, as production does", () => {
    const { sqlite } = seededEnv();
    const types = sqlite.prepare("SELECT id, typeof(expiresAt) AS t FROM session ORDER BY id").all();
    expect(types).toEqual([
      { id: "s_admin", t: "integer" },
      { id: "s_int_dead", t: "integer" },
      { id: "s_int_live", t: "integer" },
      { id: "s_iso_dead", t: "text" },
      { id: "s_iso_live", t: "text" },
    ]);
    // The bug this guards: a bare comparison counts the expired ISO row as live.
    const naive = sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE expiresAt > ?").get(Date.now()) as { n: number };
    expect(naive.n).toBe(4);
  });
});

describe("GET /api/admin/stats", () => {
  it("rejects callers without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await adminRouter.request("/stats", {}, seededEnv().env)).status).toBe(401);
  });

  it("rejects signed-in users who are not admins", async () => {
    getSession.mockResolvedValueOnce({ ...admin, user: { ...admin.user, role: "user" } });
    expect((await adminRouter.request("/stats", {}, seededEnv().env)).status).toBe(403);
  });

  it("counts live sessions in both expiry formats, and not the expired ones", async () => {
    const response = await adminRouter.request("/stats", {}, seededEnv().env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // s_admin, s_int_live and s_iso_live. The expired integer and ISO rows are out.
    expect(await response.json()).toEqual({ activeSessions: 3, bannedUsers: 1 });
  });

  it("answers 0 on an empty table", async () => {
    const { sqlite, env } = seededEnv();
    sqlite.exec("DELETE FROM session");
    expect(await (await adminRouter.request("/stats", {}, env)).json()).toEqual({ activeSessions: 0, bannedUsers: 1 });
  });
});

describe("GET /api/admin/sessions", () => {
  it("lists live sessions of either format, platform-wide", async () => {
    const { env } = seededEnv();
    const body = await (await adminRouter.request("/sessions", {}, env)).json() as { sessions: { id: string }[] };
    expect(body.sessions.map((s) => s.id).sort()).toEqual(["s_admin", "s_int_live", "s_iso_live"]);
  });

  it("returns every expiresAt as epoch milliseconds, whatever format the row is stored in", async () => {
    const { env } = seededEnv();
    const body = await (await adminRouter.request("/sessions", {}, env)).json() as { sessions: { id: string; expiresAt: unknown }[] };
    const byId = Object.fromEntries(body.sessions.map((s) => [s.id, s.expiresAt]));

    expect(byId["s_int_live"]).toEqual(expect.any(Number));
    expect(byId["s_iso_live"]).toEqual(expect.any(Number));
    // The ISO row is a live hour out, read to the second.
    expect(byId["s_iso_live"] as number - Date.now()).toBeGreaterThan(HOUR - 5000);
    expect(byId["s_iso_live"] as number - Date.now()).toBeLessThanOrEqual(HOUR);
  });

  it("filters by user without bringing back that user's expired rows", async () => {
    const { env } = seededEnv();
    const body = await (await adminRouter.request("/sessions?userId=user-2", {}, env)).json() as { sessions: { id: string }[] };
    expect(body.sessions.map((s) => s.id).sort()).toEqual(["s_int_live", "s_iso_live"]);
  });
});

describe("POST /api/admin/sessions/revoke-all-others", () => {
  it("revokes live sessions of either format and leaves the kept and expired ones", async () => {
    const { sqlite, env } = seededEnv();
    const response = await adminRouter.request(
      "/sessions/revoke-all-others",
      { method: "POST", body: JSON.stringify({ exceptSessionId: "s_admin" }) },
      env,
    );

    expect(await response.json()).toEqual({ success: true, revokedCount: 2 });
    expect(sessionIds(sqlite)).toEqual(["s_admin", "s_int_dead", "s_iso_dead"]);
  });
});

describe("GET /api/admin/users/:userId", () => {
  it("counts only the user's live sessions", async () => {
    const { env } = seededEnv();
    const response = await adminRouter.request("/users/user-2", {}, env);
    expect(response.status).toBe(200);
    expect((await response.json() as { sessionCount: number }).sessionCount).toBe(2);
  });
});

describe("GET /api/admin/audit/logs filters", () => {
  const T = Date.UTC(2026, 10, 1);
  function auditEnv() {
    const { sqlite, env } = seededEnv();
    sqlite.exec("UPDATE application SET name = 'Ralph Meet' WHERE id = 'app_1'");
    const insert = sqlite.prepare(
      "INSERT INTO audit_log (id, userId, actor, actorName, actorEmail, action, targetLabel, metadata, appId, country, city, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const row = (id: string, fields: { userId?: string; name?: string; email?: string; action?: string; target?: string | null; appId?: string | null; country?: string | null; at?: number }) =>
      insert.run(
        `${fields.at ?? T}_${id}`, fields.userId ?? "user-2", fields.userId ?? "user-2", fields.name ?? "Grace", fields.email ?? "grace@example.com",
        fields.action ?? "user.signIn", fields.target ?? null, JSON.stringify({ client: { browser: "Safari" } }), fields.appId ?? null,
        fields.country === undefined ? "US" : fields.country, "Austin", fields.at ?? T,
      );
    // Five rows in the same millisecond: the cursor must page through them exactly once.
    for (const id of ["a", "b", "c", "d", "e"]) row(id, {});
    row("fail", { action: "user.signInFailed", country: "BR", at: T - 1000 });
    row("2fa", { action: "twoFactor.challengeFailed", country: "BR", at: T - 2000 });
    row("app", { action: "app.signIn", appId: "app_1", country: "DE", at: T - 3000 });
    row("admin", { userId: "admin-1", name: "Admin", email: "Admin@Example.com", action: "admin.userBanned", target: "Banned User", country: null, at: T - 4000 });
    return env;
  }
  const get = async (env: Env, query: string) =>
    (await (await adminRouter.request(`/audit/logs?${query}`, {}, env)).json()) as {
      logs: Array<{ id: string; action: string; appName: string | null; country: string | null; city: string | null; metadata: unknown }>;
      nextCursor: string | null;
    };

  it("pages through rows sharing a createdAt without skipping or repeating", async () => {
    const env = auditEnv();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof get>> = await get(env, `limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...page.logs.map((log) => log.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
  });

  it("matches q case-insensitively on actor email, name, userId and target label", async () => {
    const env = auditEnv();
    expect((await get(env, "q=ADMIN%40example")).logs.map((l) => l.action)).toEqual(["admin.userBanned"]);
    expect((await get(env, "q=banned%20user")).logs.map((l) => l.action)).toEqual(["admin.userBanned"]);
    expect((await get(env, "q=user-2")).logs).toHaveLength(8);
    expect((await get(env, "q=%25")).logs).toHaveLength(0);
  });

  it("filters by country, outcome=failure, and a from/to window", async () => {
    const env = auditEnv();
    expect((await get(env, "country=br")).logs.map((l) => l.action).sort()).toEqual(["twoFactor.challengeFailed", "user.signInFailed"]);
    expect((await get(env, "outcome=failure")).logs.map((l) => l.action).sort()).toEqual(["twoFactor.challengeFailed", "user.signInFailed"]);
    expect((await get(env, `from=${T - 3000}&to=${T - 1000}`)).logs.map((l) => l.action)).toEqual(["twoFactor.challengeFailed", "app.signIn"]);
    expect((await adminRouter.request("/audit/logs?country=USA", {}, env)).status).toBe(400);
    expect((await adminRouter.request("/audit/logs?from=yesterday", {}, env)).status).toBe(400);
  });

  it("returns appName, country, city and parsed metadata", async () => {
    const env = auditEnv();
    const [log] = (await get(env, "action=app.signIn")).logs;
    expect(log).toMatchObject({ appName: "Ralph Meet", country: "DE", city: "Austin", metadata: { client: { browser: "Safari" } } });
  });

  it("serves facets: all apps, and the countries and actions in the log", async () => {
    const env = auditEnv();
    const response = await adminRouter.request("/audit/facets", {}, env);
    expect(response.status).toBe(200);
    const facets = await response.json() as { apps: unknown[]; countries: string[]; actions: string[] };
    expect(facets.apps).toEqual([{ id: "app_1", name: "Ralph Meet" }]);
    expect(facets.countries).toEqual(["BR", "DE", "US"]);
    expect(facets.actions).toEqual(["admin.userBanned", "app.signIn", "twoFactor.challengeFailed", "user.signIn", "user.signInFailed"]);
  });

  it("requires an admin for facets", async () => {
    getSession.mockResolvedValueOnce({ ...admin, user: { ...admin.user, role: "user" } });
    expect((await adminRouter.request("/audit/facets", {}, auditEnv())).status).toBe(403);
  });
});

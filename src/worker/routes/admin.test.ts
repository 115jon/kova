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
    sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY)");
    for (const name of ["0000_init.sql", "0006_add_audit_log.sql", "0007_add_plugins.sql", "0016_session_app_tracking.sql"]) {
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

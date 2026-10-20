import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryD1, migrationSql } from "../../test-support/d1";
import { appUsersRouter } from "./users";

const getSession = vi.fn(async () => ({ user: { id: "admin-1", role: "admin" } }) as { user: { id: string; role: string } } | null);
vi.mock("../../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));

const HOUR = 60 * 60 * 1000;

// The router is mounted under /:appId/users in production; its handlers read :appId from the parent.
const router = new Hono<{ Bindings: Env }>().route("/:appId/users", appUsersRouter);

/**
 * user-2 is a member of app_1 with sessions in both expiry formats (integer
 * milliseconds from Better Auth, ISO text from insertAppScopedSession), expired
 * and live, plus a live platform session that belongs to no app.
 */
function seededEnv() {
  const now = Date.now();
  const { db } = memoryD1((sqlite) => {
    sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY)");
    for (const name of ["0000_init.sql", "0006_add_audit_log.sql", "0007_add_plugins.sql", "0016_session_app_tracking.sql"]) {
      sqlite.exec(migrationSql(name));
    }
    sqlite.exec(`CREATE TABLE app_user (
      id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL DEFAULT 0
    )`);
    sqlite.exec("INSERT INTO application (id) VALUES ('app_1'), ('app_2')");
    sqlite
      .prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run("user-2", "Grace", "grace@example.com", now, now);
    sqlite.exec("INSERT INTO app_user (id, app_id, user_id) VALUES ('apu_1', 'app_1', 'user-2')");

    const session = sqlite.prepare(
      "INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const row = (id: string, expiresAt: number | string, appId: string | null) =>
      session.run(id, "user-2", `tok_${id}`, expiresAt, now, now, appId);
    row("int_live", now + HOUR, "app_1");
    row("int_dead", now - HOUR, "app_1");
    row("iso_live", new Date(now + HOUR).toISOString(), "app_1");
    row("iso_dead", new Date(now - HOUR).toISOString(), "app_1");
    row("other_app_live", now + HOUR, "app_2");
    row("platform_live", now + HOUR, null);
  });
  return { DB: db } as unknown as Env;
}

beforeEach(() => getSession.mockReset().mockResolvedValue({ user: { id: "admin-1", role: "admin" } }));

describe("per-app member session counts", () => {
  it("detail counts this app's live sessions in both expiry formats", async () => {
    const response = await router.request("/app_1/users/user-2", {}, seededEnv());
    const { member } = await response.json() as { member: { sessionCount: number; activeSessions: number } };

    expect(response.status).toBe(200);
    // All four of this app's rows exist; only the two unexpired ones are active.
    expect(member.sessionCount).toBe(4);
    expect(member.activeSessions).toBe(2);
  });

  it("rich detail reports the same live count", async () => {
    const response = await router.request("/app_1/users/user-2/detail", {}, seededEnv());
    expect(response.status).toBe(200);
    expect((await response.json() as { activeSessionCount: number }).activeSessionCount).toBe(2);
  });

  it("is admin only", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u", role: "user" } });
    expect((await router.request("/app_1/users/user-2", {}, seededEnv())).status).toBe(403);
  });
});

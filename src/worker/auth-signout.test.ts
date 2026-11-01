/**
 * Sign-out is per app. Better Auth's session delete hook runs for a cookie
 * sign-out; it must not touch the app sessions that browser minted.
 */
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth";
import { memoryD1, migrationSql } from "./test-support/d1";

vi.mock("better-auth", async (original) => ({
  ...(await original<typeof import("better-auth")>()),
  betterAuth: (options: unknown) => ({ options }),
}));
vi.mock("./audit", async (original) => ({ ...await original<typeof import("./audit")>(), logAudit: async () => undefined }));
vi.mock("./webhook", () => ({ deliverEvent: async () => undefined }));

type DeleteHook = (session: { id: string; userId: string }, context: { path: string }) => Promise<void>;

describe("cookie sign-out", () => {
  it.each(["/sign-out", "/revoke-session", "/multi-session/revoke", "/sign-in/email"])(
    "via %s leaves the browser's app sessions alone",
    async (path) => {
      const now = Date.now();
      const { sqlite, db } = memoryD1((sqlite) => {
        sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY)");
        for (const name of ["0000_init.sql", "0016_session_app_tracking.sql", "0030_session_parent.sql"]) {
          sqlite.exec(migrationSql(name));
        }
        sqlite.exec("INSERT INTO application (id) VALUES ('app_1')");
        sqlite.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run("user_1", "Jon", "jon@example.com", now, now);
        sqlite
          .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id, parent_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run("app_child", "user_1", "child_token", new Date(now + 60_000).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "app_1", "browser_a");
      });
      const env = {
        AUTH_URL: "https://auth.example", DASHBOARD_URL: "https://auth.example",
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
        GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "g", RESEND_API_KEY: "re_unused",
        DB: db, KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      } as unknown as Env;
      const { options } = createAuth(env) as unknown as {
        options: { databaseHooks: { session: { delete: { after: DeleteHook } } } };
      };

      await options.databaseHooks.session.delete.after({ id: "browser_a", userId: "user_1" }, { path });

      expect(sqlite.prepare("SELECT id FROM session WHERE app_id = 'app_1'").all()).toEqual([{ id: "app_child" }]);
    },
  );
});

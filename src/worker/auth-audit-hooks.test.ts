/**
 * The audit trail has to say what actually happened. Better Auth deletes session
 * rows from many endpoints; only an actual sign-out may produce `user.signOut`
 * (and its webhook). Failures are logged only when the target user is known.
 */
import { describe, expect, it, vi } from "vitest";
import type { AuditPayload } from "./audit";
import { createAuth } from "./auth";
import { memoryD1, migrationSql } from "./test-support/d1";

const logged: AuditPayload[] = [];
const delivered: string[] = [];

vi.mock("better-auth", async (original) => ({
  ...(await original<typeof import("better-auth")>()),
  betterAuth: (options: unknown) => ({ options }),
}));
vi.mock("./audit", async (original) => ({
  ...await original<typeof import("./audit")>(),
  logAudit: async (_db: unknown, payload: AuditPayload) => { logged.push(payload); },
}));
vi.mock("./webhook", () => ({ deliverEvent: async (_db: unknown, event: string) => { delivered.push(event); } }));

type SessionRow = { id: string; userId: string; expiresAt?: Date; app_id?: string | null };
type HookContext = { path?: string; params?: Record<string, string>; request?: Request } | null;
type Hooks = {
  databaseHooks: {
    session: {
      create: { after: (session: SessionRow, context: HookContext) => Promise<void> };
      delete: { before: (session: SessionRow) => Promise<void>; after: (session: SessionRow, context: HookContext) => Promise<void> };
    };
  };
};

function setup() {
  const now = Date.now();
  const { sqlite, db } = memoryD1((sqlite) => {
    sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY)");
    for (const name of ["0000_init.sql", "0016_session_app_tracking.sql", "0030_session_parent.sql"]) {
      sqlite.exec(migrationSql(name));
    }
    sqlite.exec("INSERT INTO application (id) VALUES ('app_1')");
    sqlite.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run("user_1", "Jon", "jon@example.com", now, now);
    sqlite
      .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("app_session", "user_1", "tok", now + 60_000, now, now, "app_1");
  });
  const env = {
    AUTH_URL: "https://auth.example", DASHBOARD_URL: "https://auth.example",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12345",
    GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "g", RESEND_API_KEY: "re_unused",
    DB: db, KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
  } as unknown as Env;
  const cf = { country: "US", city: "Austin" } as unknown as IncomingRequestCfProperties;
  const { options } = createAuth(env, cf) as unknown as { options: Hooks };
  logged.length = 0;
  delivered.length = 0;
  return { sqlite, hooks: options.databaseHooks.session };
}

describe("session.delete audit hook", () => {
  it.each(["/sign-out", "/multi-session/revoke"])("logs user.signOut and delivers the webhook for %s", async (path) => {
    const { hooks } = setup();
    await hooks.delete.after({ id: "s1", userId: "user_1" }, { path });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "user.signOut", userId: "user_1", actorName: "Jon", metadata: { endpoint: path, reason: "signed_out" } });
    expect(delivered).toEqual(["user.signOut"]);
  });

  it.each([
    ["/get-session", "expired"],
    ["/revoke-other-sessions", "revoked"],
    ["/callback/:id", "replaced"],
  ] as const)("logs session.ended with the endpoint for %s and sends no sign-out webhook", async (path, reason) => {
    const { hooks } = setup();
    await hooks.delete.after({ id: "s1", userId: "user_1" }, { path });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "session.ended", metadata: { endpoint: path, sessionId: "s1", reason } });
    expect(delivered).toEqual([]);
  });

  it("records the endpoint as null when the delete happens outside a request", async () => {
    const { hooks } = setup();
    await hooks.delete.after({ id: "s1", userId: "user_1" }, null);

    expect(logged[0]).toMatchObject({ action: "session.ended", metadata: { endpoint: null, reason: "unknown" } });
  });

  it("attributes an app session's end to its app, via the row looked up in delete.before", async () => {
    const { hooks } = setup();
    const row: SessionRow = { id: "app_session", userId: "user_1" };
    await hooks.delete.before(row);
    await hooks.delete.after(row, { path: "/get-session" });

    expect(logged[0]).toMatchObject({ action: "session.ended", appId: "app_1", metadata: { appId: "app_1", reason: "expired" } });
  });

  it("reads the actor's name and email in delete.before, with the app id, in one query", async () => {
    const { sqlite, hooks } = setup();
    const row: SessionRow = { id: "app_session", userId: "user_1" };
    await hooks.delete.before(row);
    // Whatever happens to the user row afterwards, .after already has it.
    sqlite.prepare('DELETE FROM "user" WHERE id = ?').run("user_1");
    await hooks.delete.after(row, { path: "/sign-out" });

    expect(logged[0]).toMatchObject({ actorName: "Jon", actorEmail: "jon@example.com", appId: "app_1" });
  });

  it("uses the request's IP, user agent and geo for the event", async () => {
    const { hooks } = setup();
    const request = new Request("https://auth.example/api/auth/sign-out", { headers: { "CF-Connecting-IP": "203.0.113.9", "User-Agent": "UA/1" } });
    await hooks.delete.after({ id: "s1", userId: "user_1" }, { path: "/sign-out", request });

    expect(logged[0]).toMatchObject({ ipAddress: "203.0.113.9", userAgent: "UA/1", country: "US", city: "Austin" });
  });
});

describe("session.create audit hook", () => {
  it("records how the user signed in", async () => {
    const { hooks } = setup();
    await hooks.create.after({ id: "s1", userId: "user_1" }, { path: "/callback/:id", params: { id: "google" } });

    expect(logged[0]).toMatchObject({
      action: "user.signIn",
      country: "US",
      city: "Austin",
      metadata: { method: "oauth", provider: "google" },
    });
  });
});

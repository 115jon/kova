/**
 * App sessions are per browser. Runs the real routes and SQL against the real
 * session schema: each "browser" is an auth-domain cookie session row, and
 * getSession resolves whichever one the request's cookie names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../../applications";
import { memoryD1, migrationSql } from "../../test-support/d1";

const HOUR = 60 * 60 * 1000;

const getSession = vi.fn(async (input: { headers: Headers }) => {
  const id = /kova_test_session=([\w-]+)/.exec(input.headers.get("cookie") ?? "")?.[1];
  const row = id ? sessions.get(id) : undefined;
  return row ? { user: { id: row.userId }, session: { id, token: `cookie_${id}` } } : null;
});
vi.mock("../../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));
vi.mock("../../applications", async (original) => ({
  ...await original<typeof import("../../applications")>(),
  getApplicationByPublishableKey: async (_db: unknown, pk: string) => (pk === "pk_test" ? application : null),
}));

const application: Application = {
  id: "app_1", name: "Ralph Meet", environment: "production", publishable_key: "pk_test",
  allowed_origins: ["https://meet.example"], redirect_uris: ["https://meet.example/callback"],
  createdBy: "user_1", createdAt: 1, updatedAt: 1, display_name: null, logo_url: null,
  favicon_url: null, primary_color: "#3b82f6", background_color: "#0f172a", theme: "dark",
  home_url: null, terms_url: null, privacy_url: null, hide_branding: false,
  from_name: null, from_email: null, support_email: null, smtp_host: null, smtp_port: 587,
  smtp_user: null, smtp_secure: false, stripe_customer_id: null, stripe_subscription_id: null,
  plan: "free", plan_expires_at: null, suspended_at: null, auth_slug: "meet", custom_domain: null,
  legacy_publishable_key: null, device_verification_uri: null,
};

/** The cookie sessions getSession will accept, as its cookie cache would. */
let sessions: Map<string, { userId: string }>;

function seeded() {
  const now = Date.now();
  sessions = new Map();
  const { sqlite, db } = memoryD1((sqlite) => {
    sqlite.exec("CREATE TABLE application (id TEXT PRIMARY KEY)");
    for (const name of ["0000_init.sql", "0003_add_two_factor.sql", "0005_add_organizations.sql", "0007_add_plugins.sql", "0016_session_app_tracking.sql", "0030_session_parent.sql"]) {
      sqlite.exec(migrationSql(name));
    }
    sqlite.exec("INSERT INTO application (id) VALUES ('app_1'), ('app_2')");
    const user = sqlite.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)");
    user.run("user_1", "Jon", "jon@example.com", now, now);
    user.run("user_2", "Grace", "grace@example.com", now, now);
  });
  /** A browser signed in to the auth domain: Better Auth's integer-ms row. */
  const browser = (id: string, userId = "user_1") => {
    sqlite
      .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, `cookie_${id}`, now + 24 * HOUR, now, now);
    sessions.set(id, { userId });
    return id;
  };
  return { sqlite, env: { AUTH_URL: "https://auth.example", DB: db, KV: {} } as unknown as Env, browser };
}

type Env0 = ReturnType<typeof seeded>;

async function sessionToken({ env }: Env0, browserId: string) {
  const { pubAppsRouter } = await import("./apps");
  return pubAppsRouter.request("/pk_test/session-token", {
    method: "POST",
    headers: { cookie: `kova_test_session=${browserId}`, Origin: "https://meet.example" },
  }, env);
}

async function tokenFor(db: Env0, browserId: string): Promise<string> {
  const response = await sessionToken(db, browserId);
  expect(response.status).toBe(200);
  const { sessionToken: token } = (await response.json()) as { sessionToken: string };
  expect(token).toEqual(expect.any(String));
  return token;
}

async function revoke({ env }: Env0, token: string) {
  const { pubAppsRouter } = await import("./apps");
  const response = await pubAppsRouter.request("/pk_test/revoke-session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }, env);
  expect(response.status).toBe(200);
}

const appRows = ({ sqlite }: Env0) =>
  sqlite.prepare("SELECT id, token, parent_session_id AS parent FROM session WHERE app_id IS NOT NULL ORDER BY id").all() as {
    id: string; token: string; parent: string | null;
  }[];
const tokenExists = ({ sqlite }: Env0, token: string) =>
  sqlite.prepare("SELECT 1 FROM session WHERE token = ?").get(token) !== undefined;

beforeEach(() => {
  getSession.mockClear();
});

describe("POST /:pk/session-token is per browser", () => {
  it("gives two browsers of the same user different app tokens", async () => {
    const db = seeded();
    const chromeA = db.browser("chrome_machine_a");
    const chromeB = db.browser("chrome_machine_b");

    const a = await tokenFor(db, chromeA);
    const b = await tokenFor(db, chromeB);

    expect(a).not.toBe(b);
    expect(appRows(db).map((row) => row.parent).sort()).toEqual([chromeA, chromeB]);
  });

  it("gives the same browser the same token on every call, minting once", async () => {
    const db = seeded();
    const tab = db.browser("chrome_machine_a");

    const first = await tokenFor(db, tab);
    expect(await tokenFor(db, tab)).toBe(first);
    expect(await tokenFor(db, tab)).toBe(first);
    expect(appRows(db)).toHaveLength(1);
  });

  it("revoking one browser's token leaves the other browser signed in", async () => {
    const db = seeded();
    const chromeA = db.browser("chrome_machine_a");
    const chromeB = db.browser("chrome_machine_b");
    const a = await tokenFor(db, chromeA);
    const b = await tokenFor(db, chromeB);

    await revoke(db, a);

    expect(tokenExists(db, a)).toBe(false);
    expect(tokenExists(db, b)).toBe(true);
    // Machine B keeps its token, and is not handed a replacement.
    expect(await tokenFor(db, chromeB)).toBe(b);
    // Machine A, still signed in to the auth domain, gets a fresh one.
    const again = await tokenFor(db, chromeA);
    expect(again).not.toBe(a);
    expect(again).not.toBe(b);
  });

  it("never hands a pre-migration shared token (no parent) to a browser", async () => {
    const db = seeded();
    const now = Date.now();
    db.sqlite
      .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("legacy", "user_1", "legacy_shared_token", new Date(now + 24 * HOUR).toISOString(), new Date(now + 1000).toISOString(), new Date(now).toISOString(), "app_1");
    const browser = db.browser("chrome_machine_a");

    const token = await tokenFor(db, browser);

    expect(token).not.toBe("legacy_shared_token");
    // Whoever already holds the legacy token keeps it.
    expect(tokenExists(db, "legacy_shared_token")).toBe(true);
  });

  it("does not reuse another user's, another app's, or an expired session for this browser", async () => {
    const db = seeded();
    const browser = db.browser("chrome_machine_a");
    const now = Date.now();
    const child = db.sqlite.prepare(
      "INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id, parent_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    child.run("other_app", "user_1", "other_app_token", new Date(now + HOUR).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "app_2", browser);
    child.run("expired", "user_1", "expired_token", new Date(now - HOUR).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "app_1", browser);
    child.run("other_user", "user_2", "other_user_token", new Date(now + HOUR).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "app_1", browser);

    const token = await tokenFor(db, browser);

    expect(["other_app_token", "expired_token", "other_user_token"]).not.toContain(token);
  });

  it("hands a caller already holding this app's session that same session", async () => {
    const db = seeded();
    const now = Date.now();
    db.sqlite
      .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("app_bearer", "user_1", "held_token", new Date(now + HOUR).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(), "app_1");
    sessions.set("app_bearer", { userId: "user_1" });

    expect(await tokenFor(db, "app_bearer")).toBe("held_token");
    expect(appRows(db)).toHaveLength(1);
  });

  it("mints nothing for a browser session that was revoked but is still in a cookie cache", async () => {
    const db = seeded();
    const browser = db.browser("chrome_machine_a");
    db.sqlite.prepare("DELETE FROM session WHERE id = ?").run(browser);

    const response = await sessionToken(db, browser);

    expect(response.status).toBe(401);
    expect(appRows(db)).toHaveLength(0);
  });
});

describe("signing a browser out of the auth domain", () => {
  /** The SDK's Bearer check: routes/auth.ts get-session, app-scoped branch. */
  async function bearerSession({ env }: Env0, token: string) {
    const { authRouter } = await import("../auth");
    const response = await authRouter.request("https://auth.example/api/auth/get-session", {
      headers: { Authorization: `Bearer ${token}`, "X-Publishable-Key": "pk_test" },
    }, env);
    expect(response.status).toBe(200);
    return (await response.json()) as { user: { id: string } } | null;
  }

  it("leaves that browser's app tokens signed in: sign-out is per app", async () => {
    const db = seeded();
    const chromeA = db.browser("chrome_machine_a");
    const a = await tokenFor(db, chromeA);
    expect((await bearerSession(db, a))?.user.id).toBe("user_1");

    // Better Auth's sign-out deletes the cookie row by token.
    db.sqlite.prepare("DELETE FROM session WHERE token = ?").run(`cookie_${chromeA}`);
    sessions.delete(chromeA);

    expect(tokenExists(db, a)).toBe(true);
    expect((await bearerSession(db, a))?.user.id).toBe("user_1");
  });
});

describe("GET /api/auth/get-session with a publishable key and a cookie", () => {
  async function getAppSession({ env }: Env0, browserId: string) {
    const { authRouter } = await import("../auth");
    const response = await authRouter.request("https://auth.example/api/auth/get-session", {
      headers: { cookie: `kova_test_session=${browserId}`, "X-Publishable-Key": "pk_test" },
    }, env);
    expect(response.status).toBe(200);
    return (await response.json()) as { session: { token: string; parent_session_id?: unknown } } | null;
  }

  it("mints per browser too, and does not expose the parent session", async () => {
    const db = seeded();
    const chromeA = db.browser("chrome_machine_a");
    const chromeB = db.browser("chrome_machine_b");

    const a = await getAppSession(db, chromeA);
    const b = await getAppSession(db, chromeB);
    const aAgain = await getAppSession(db, chromeA);

    expect(a?.session.token).toEqual(expect.any(String));
    expect(a?.session.token).not.toBe(b?.session.token);
    expect(aAgain?.session.token).toBe(a?.session.token);
    expect(a?.session).not.toHaveProperty("parent_session_id");
    // session-token and get-session agree on this browser's token.
    expect(await tokenFor(db, chromeA)).toBe(a?.session.token);
  });
});

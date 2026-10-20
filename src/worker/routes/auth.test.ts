import { describe, expect, it, vi } from "vitest";

const { authHandler } = vi.hoisted(() => ({
  authHandler: vi.fn(async () => new Response("handled")),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({ handler: authHandler }),
}));

vi.mock("../applications", async (original) => ({
  ...await original<typeof import("../applications")>(),
  getApplicationByPublishableKey: async () => ({
    id: "app-1",
    name: "Ralph Meet",
    environment: "development",
    publishable_key: "pk_test",
    allowed_origins: ["https://meet.example"],
    redirect_uris: [],
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    display_name: null,
    logo_url: null,
    favicon_url: null,
    primary_color: "#3b82f6",
    background_color: "#0f172a",
    theme: "dark",
    home_url: null,
    terms_url: null,
    privacy_url: null,
    hide_branding: false,
    from_name: null,
    from_email: null,
    support_email: null,
    smtp_host: null,
    smtp_port: 587,
    smtp_user: null,
    smtp_secure: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: "free",
    plan_expires_at: null,
    suspended_at: null,
    auth_slug: null,
    custom_domain: null,
  }),
}));

const env = {
  AUTH_URL: "https://auth.lvh.me",
  DB: {},
  KV: {
    get: async () => null,
    put: async () => undefined,
  },
} as unknown as Env;

describe("auth route origin enforcement", () => {
  it("accepts the configured auth origin when the proxy supplies an internal request URL", async () => {
    const { authRouter } = await import("./auth");
    const response = await authRouter.request(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          Origin: "https://auth.lvh.me",
          "Content-Type": "application/json",
          "X-Publishable-Key": "pk_test",
        },
        body: JSON.stringify({ provider: "google" }),
      }),
      {},
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("handled");
    expect(authHandler).toHaveBeenCalledOnce();
  });
});

type Row = Record<string, unknown> | null;

/** D1 stand-in that answers by table, so the routes' own SQL needs no parsing. */
function tableDb(tables: { appScopedTokens?: string[]; session?: Row; user?: Row }) {
  const run = (sql: string, args: unknown[]): Row => {
    if (sql.includes("FROM user_wallpapers")) return null;
    if (sql.includes("FROM user ")) return tables.user ?? null;
    if (sql.includes("app_id IS NOT NULL")) {
      return args.some(token => tables.appScopedTokens?.includes(token as string)) ? { scoped: 1 } : null;
    }
    if (sql.includes("FROM session")) return tables.session ?? null;
    return null;
  };
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ first: async () => run(sql, args) }),
    }),
  } as unknown as D1Database;
}

const withDb = (db: D1Database) => ({ ...env, DB: db }) as Env;

async function call(path: string, db: D1Database, headers: Record<string, string>) {
  const { authRouter } = await import("./auth");
  return authRouter.request(new Request(`https://auth.lvh.me${path}`, { headers }), {}, withDb(db));
}

describe("app-scoped sessions on Better Auth endpoints", () => {
  const db = tableDb({ appScopedTokens: ["app-token"] });

  it.each([
    "/api/auth/admin/list-users",
    "/api/auth/organization/delete",
    "/api/auth/api-key/create",
    "/api/auth/change-password",
    "/api/auth/list-sessions",
  ])("refuses %s", async (path) => {
    authHandler.mockClear();
    const response = await call(path, db, { authorization: "Bearer app-token" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "platform_session_required" });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it.each([
    "/api/auth/update-user",
    "/api/auth/sign-out",
    "/api/auth/organization/list",
    "/api/auth/list-accounts",
  ])("still serves %s", async (path) => {
    authHandler.mockClear();
    const response = await call(path, db, { authorization: "Bearer app-token" });
    expect(await response.text()).toBe("handled");
    expect(authHandler).toHaveBeenCalledOnce();
  });

  it("leaves the dashboard's platform session alone", async () => {
    authHandler.mockClear();
    const response = await call("/api/auth/admin/list-users", db, { authorization: "Bearer platform-token" });
    expect(await response.text()).toBe("handled");
    expect(authHandler).toHaveBeenCalledOnce();
  });

  it("does not let an unrelated pk header change the outcome", async () => {
    authHandler.mockClear();
    const response = await call("/api/auth/admin/list-users", db, {
      authorization: "Bearer app-token",
      "x-publishable-key": "pk_test",
    });
    expect(response.status).toBe(403);
    expect(authHandler).not.toHaveBeenCalled();
  });
});

describe("get-session bearer fast path", () => {
  const session = { id: "sess-1", userId: "user-1", token: "app-token", expiresAt: new Date(Date.now() + 60_000).toISOString(), app_id: "app-1" };
  const user = { id: "user-1", name: "Ada", email: "ada@example.com", emailVerified: 1, banned: 0, twoFactorEnabled: null, role: "user" };
  const fetchSession = (row: Row) => call("/api/auth/get-session", tableDb({ session, user: row }), {
    authorization: "Bearer app-token",
    "x-publishable-key": "pk_test",
  });

  it("returns booleans where D1 stores integers", async () => {
    const body = await (await fetchSession(user)).json() as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ id: "user-1", emailVerified: true, banned: false, twoFactorEnabled: false });
    const verified = await (await fetchSession({ ...user, emailVerified: 0, twoFactorEnabled: 1 })).json() as { user: Record<string, unknown> };
    expect(verified.user).toMatchObject({ emailVerified: false, twoFactorEnabled: true });
  });

  it("answers null for a banned user", async () => {
    const response = await fetchSession({ ...user, banned: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
});

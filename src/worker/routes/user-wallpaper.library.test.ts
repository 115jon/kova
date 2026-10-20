import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "hono";
import { userRouter } from "./user";

const harness = vi.hoisted(() => ({
  user: { id: "user_library", email: "library@example.test", name: "Library User" } as {
    id: string;
    email: string;
    name: string;
  } | null,
  events: [] as Array<{ event: string; data: Record<string, unknown> }>,
}));
const fetchState = { uploadFails: false, scanSafe: true };

vi.mock("../auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => (harness.user ? { user: harness.user } : null),
    },
  }),
}));

vi.mock("../webhook", () => ({
  deliverEvent: async (_db: unknown, event: string, data: Record<string, unknown>) => {
    harness.events.push({ event, data });
  },
}));

function migration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)), "utf8");
}

function png(width = 8, height = 8): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

type SqliteStatement = {
  bind(...args: unknown[]): SqliteStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: true }>;
};

function sqliteD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string): SqliteStatement => {
    let args: SQLInputValue[] = [];
    const statement = database.prepare(sql);
    const bound = (): ReturnType<typeof database.prepare> => statement;
    return {
      bind(...nextArgs: unknown[]) {
        args = nextArgs as SQLInputValue[];
        return this;
      },
      async first<T>() {
        return (bound().get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: bound().all(...args) as T[] };
      },
      async run() {
        if (/^\s*select\b/i.test(sql) || /returning/i.test(sql)) {
          return { success: true, results: bound().all(...args) };
        }
        bound().run(...args);
        return { success: true, results: [] };
      },
    };
  };

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      database.exec("BEGIN");
      try {
        const results: D1Result[] = [];
        for (const statement of statements) {
          const result = await statement.run();
          results.push(result as D1Result);
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

function testDatabase(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
  sqlite.exec("INSERT INTO user (id) VALUES ('user_library'), ('other_user')");
  sqlite.exec(migration("0022_user_wallpapers.sql"));
  sqlite.exec(migration("0023_user_wallpaper_uploads.sql"));
  sqlite.exec(migration("0024_user_wallpaper_haze.sql"));
  return { db: sqliteD1(sqlite), sqlite };
}

function envFor(db: D1Database) {
  return {
    DB: db,
    CDN_URL: "https://cdn.115jon.site",
    CDN_API_KEY: "test-key",
  } as unknown as Env;
}

function executionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  };
}

  async function upload(env: Env, effect?: string, type = "image/png"): Promise<Response> {
  const form = new FormData();
  form.append("image", new File([png()], "wall.png", { type }));
  if (effect !== undefined) form.append("effect", effect);
  return userRouter.request("/wallpapers", { method: "POST", body: form }, env, executionContext());
}

const uploads: string[] = [];
const deletes: string[] = [];

afterEach(() => {
  harness.user = { id: "user_library", email: "library@example.test", name: "Library User" };
  harness.events.length = 0;
  uploads.length = 0;
  deletes.length = 0;
  fetchState.uploadFails = false;
  fetchState.scanSafe = true;
  vi.unstubAllGlobals();
});

function installFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/upload")) {
      if (fetchState.uploadFails) return Response.json({ internal: "provider detail" }, { status: 503 });
      const key = (init?.body as FormData).get("key");
      uploads.push(String(key));
      return Response.json({ url: `https://cdn.115jon.site/kova-auth/${key}` });
    }
    if (url.includes("/scan/")) return Response.json({ safe: fetchState.scanSafe });
    if (init?.method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 500 });
  });
}

describe("wallpaper library", () => {
  it("backfills the existing active wallpaper with stable metadata", () => {
    const { sqlite } = testDatabase();
    sqlite.prepare(
      `INSERT INTO user_wallpapers (user_id, wallpaper_url, effect, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("user_library", "https://cdn.115jon.site/kova-auth/wallpapers/user_library/old.jpg", "dither", 1700000000000);
    sqlite.exec(migration("0023_user_wallpaper_uploads.sql"));

    const row = sqlite.prepare("SELECT id, content_type, created_at FROM user_wallpaper_uploads").get() as {
      id: string;
      content_type: string;
      created_at: number;
    };
    expect(row).toEqual({ id: "legacy-757365725f6c696272617279", content_type: "image/jpeg", created_at: 1700000000000 });
  });

  it("persists six uploads, keeps the active entry while trimming, and reselects without uploading", async () => {
    installFetch();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);
    const { db, sqlite } = testDatabase();
    const env = envFor(db);
    const urls: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await upload(env, index === 0 ? "dither" : "ascii");
      expect(response.status).toBe(200);
      urls.push(((await response.json()) as { wallpaperUrl: string }).wallpaperUrl);
    }
    expect(uploads).toHaveLength(7);

    const library = await userRouter.request("/wallpapers", { method: "GET" }, env);
    expect(library.status).toBe(200);
    const body = (await library.json()) as { items: Array<{ id: string; url: string; createdAt: string }>; activeUrl: string | null };
    expect(body.items).toHaveLength(6);
    expect(body.activeUrl).toBe(urls[6]);
    expect(body.items[0]?.url).toBe(urls[6]);
    expect(body.items.every((item) => !Number.isNaN(Date.parse(item.createdAt)))).toBe(true);

    const selectedId = body.items[1]?.id;
    expect(selectedId).toBeTruthy();
    const selected = await userRouter.request(
      "/wallpapers/select",
      { method: "POST", body: JSON.stringify({ id: selectedId }), headers: { "Content-Type": "application/json" } },
      env,
      executionContext(),
    );
    expect(selected.status).toBe(200);
    const selectedBody = (await selected.json()) as { wallpaperUrl: string; effect: string };
    expect(selectedBody.effect).toBe("ascii");
    expect(harness.events.at(-1)).toMatchObject({
      event: "user.wallpaperUpdated",
      data: { wallpaperUrl: selectedBody.wallpaperUrl, effect: "ascii", removed: false },
    });
    expect(uploads).toHaveLength(7);
    expect(deletes).toEqual([
      `https://cdn.115jon.site/files/kova-auth/${urls[0]?.replace("https://cdn.115jon.site/kova-auth/", "")}`,
    ]);

    const cleared = await userRouter.request("/wallpaper", { method: "DELETE" }, env, executionContext());
    expect(cleared.status).toBe(200);
    const afterClear = await userRouter.request("/wallpapers", { method: "GET" }, env);
    expect((await afterClear.json() as { items: unknown[]; activeUrl: string | null }).activeUrl).toBeNull();
    expect((sqlite.prepare("SELECT count(*) AS count FROM user_wallpaper_uploads").get() as { count: number }).count).toBe(6);

    const restored = await userRouter.request(
      "/wallpapers/select",
      { method: "POST", body: JSON.stringify({ id: selectedId }), headers: { "Content-Type": "application/json" } },
      env,
      executionContext(),
    );
    expect(restored.status).toBe(200);
    expect((await restored.json() as { wallpaperUrl: string }).wallpaperUrl).toBe(body.items[1]?.url);
  });

  it("keeps a same-millisecond upload visible when its id sorts last", async () => {
    installFetch();
    const stamp = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(stamp);
    const lowId = "00000000-0000-4000-8000-000000000001";
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(lowId as ReturnType<typeof crypto.randomUUID>);
    try {
      const { db, sqlite } = testDatabase();
      const env = envFor(db);
      for (let index = 1; index <= 6; index += 1) {
        sqlite.prepare(
          `INSERT INTO user_wallpaper_uploads (id, user_id, url, content_type, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(
          `ffffffff${index}`,
          "user_library",
          `https://cdn.115jon.site/kova-auth/wallpapers/user_library/old-${index}.png`,
          "image/png",
          stamp,
        );
      }
      const response = await upload(env, "none");
      expect(response.status).toBe(200);
      const activeUrl = ((await response.json()) as { wallpaperUrl: string }).wallpaperUrl;
      const library = await userRouter.request("/wallpapers", { method: "GET" }, env);
      const body = (await library.json()) as { items: Array<{ url: string }>; activeUrl: string | null };
      expect(body.items).toHaveLength(6);
      expect(body.activeUrl).toBe(activeUrl);
      expect(body.items.map((item) => item.url)).toContain(activeUrl);
      expect((sqlite.prepare("SELECT count(*) AS count FROM user_wallpaper_uploads").get() as { count: number }).count).toBe(6);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).not.toContain(lowId.replaceAll("-", ""));
    } finally {
      now.mockRestore();
      uuid.mockRestore();
    }
  });

  it("changes the effect without storing another upload", async () => {
    installFetch();
    const { db, sqlite } = testDatabase();
    const env = envFor(db);
    const created = await upload(env, "none");
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { wallpaperUrl: string };
    const effect = await userRouter.request(
      "/wallpaper/effect",
      { method: "POST", body: JSON.stringify({ effect: "dither" }), headers: { "Content-Type": "application/json" } },
      env,
      executionContext(),
    );
    expect(effect.status).toBe(200);
    expect(await effect.json()).toMatchObject({ wallpaperUrl: createdBody.wallpaperUrl, effect: "dither" });
    expect(uploads).toHaveLength(1);
    expect((sqlite.prepare("SELECT count(*) AS count FROM user_wallpaper_uploads").get() as { count: number }).count).toBe(1);
    expect(harness.events.at(-1)).toMatchObject({
      event: "user.wallpaperUpdated",
      data: { wallpaperUrl: createdBody.wallpaperUrl, effect: "dither", removed: false },
    });
  });

  it("updates and reads the haze effect", async () => {
    installFetch();
    const { db } = testDatabase();
    const env = envFor(db);
    const created = await upload(env, "none");
    expect(created.status).toBe(200);

    const updated = await userRouter.request(
      "/wallpaper/effect",
      { method: "POST", body: JSON.stringify({ effect: "haze" }), headers: { "Content-Type": "application/json" } },
      env,
      executionContext(),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ effect: "haze" });

    const read = await userRouter.request("/wallpaper", { method: "GET" }, env);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ effect: "haze" });
  });

  it("does not expose another user's upload and rejects deleting the active one", async () => {
    installFetch();
    const { db, sqlite } = testDatabase();
    sqlite.prepare(
      `INSERT INTO user_wallpaper_uploads (id, user_id, url, content_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("other-upload", "other_user", "https://cdn.115jon.site/kova-auth/wallpapers/other_user/a.png", "image/png", 1700000000000);
    sqlite.prepare(
      `INSERT INTO user_wallpapers (user_id, wallpaper_url, effect, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("user_library", "https://cdn.115jon.site/kova-auth/wallpapers/user_library/a.png", "none", 1700000000000);
    sqlite.prepare(
      `INSERT INTO user_wallpaper_uploads (id, user_id, url, content_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("active-upload", "user_library", "https://cdn.115jon.site/kova-auth/wallpapers/user_library/a.png", "image/png", 1700000000000);

    const env = envFor(db);
    const otherDelete = await userRouter.request("/wallpapers/other-upload", { method: "DELETE" }, env);
    expect(otherDelete.status).toBe(404);
    const activeDelete = await userRouter.request("/wallpapers/active-upload", { method: "DELETE" }, env);
    expect(activeDelete.status).toBe(409);
    expect(deletes).toHaveLength(0);
  });

  it("accepts a sniffed image when the desktop client omits a specific type", async () => {
    installFetch();
    const { db } = testDatabase();
    const response = await upload(envFor(db), "none", "application/octet-stream");
    expect(response.status).toBe(200);
    expect(uploads).toHaveLength(1);
  });

  it("requires authentication, hides provider failures, and compensates scan rejection", async () => {
    installFetch();
    const { db } = testDatabase();
    const env = envFor(db);
    harness.user = null;
    const anonymous = await upload(env);
    expect(anonymous.status).toBe(401);

    harness.user = { id: "user_library", email: "library@example.test", name: "Library User" };
    fetchState.uploadFails = true;
    const failed = await upload(env);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "CDN upload failed" });

    fetchState.uploadFails = false;
    fetchState.scanSafe = false;
    const rejected = await upload(env);
    expect(rejected.status).toBe(422);
    expect(deletes).toHaveLength(1);
    const count = await db.prepare("SELECT count(*) AS count FROM user_wallpaper_uploads").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("compensates the uploaded object when the database batch rolls back", async () => {
    installFetch();
    const { db, sqlite } = testDatabase();
    const broken = {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        if (!sql.includes("INSERT INTO user_wallpaper_uploads")) return statement;
        return {
          bind(...args: unknown[]) {
            const bound = statement.bind(...args);
            return {
              run: async () => { throw new Error("private database error"); },
              first: bound.first.bind(bound),
              all: bound.all.bind(bound),
            } as unknown as D1PreparedStatement;
          },
        } as unknown as D1PreparedStatement;
      },
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    const response = await upload(envFor(broken));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not save wallpaper" });
    expect(deletes).toHaveLength(1);
    expect((sqlite.prepare("SELECT count(*) AS count FROM user_wallpaper_uploads").get() as { count: number }).count).toBe(0);
  });
});

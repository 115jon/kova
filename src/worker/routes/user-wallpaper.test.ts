import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ExecutionContext } from "hono";
import { WALLPAPER_MAX_BYTES } from "./user-wallpaper";
import { userRouter } from "./user";

const harness = vi.hoisted(() => ({
  user: { id: "user_abc", email: "ada@example.com", name: "Ada" } as {
    id: string;
    email: string;
    name: string;
  } | null,
  events: [] as Array<{ event: string; data: Record<string, unknown> }>,
}));

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

function migration(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)), "utf8");
}

function memoryDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
  sqlite.exec("INSERT INTO user (id) VALUES ('user_abc')");
  sqlite.exec(migration("0022_user_wallpapers.sql"));
  sqlite.exec(migration("0023_user_wallpaper_uploads.sql"));
  sqlite.exec(migration("0024_user_wallpaper_haze.sql"));
  const audits: string[] = [];
  const prepare = (sql: string): D1PreparedStatement => {
    let args: SQLInputValue[] = [];
    const statement = sqlite.prepare(sql);
    const prepared = {
      bind(...next: unknown[]) { args = next as SQLInputValue[]; return prepared as unknown as D1PreparedStatement; },
      async first<T>() { return (statement.get(...args) as T | undefined) ?? null; },
      async all<T>() { return { results: statement.all(...args) as T[] }; },
      async run() { statement.run(...args); return { success: true, meta: {} } as D1Result; },
      async raw<T>() { return statement.all(...args) as T[]; },
    };
    return prepared as unknown as D1PreparedStatement;
  };
  const db = {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results: D1Result[] = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return {
    db,
    audits,
    row() { return sqlite.prepare("SELECT user_id AS userId, wallpaper_url AS wallpaperUrl, effect, updated_at AS updatedAt FROM user_wallpapers WHERE user_id = 'user_abc'").get() as { userId: string; wallpaperUrl: string; effect: string; updatedAt: number } | undefined ?? null; },
  };
}

const uploads: string[] = [];
const deletes: string[] = [];
let safe = true;

function installFetch() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/upload")) {
      const key = (init?.body as FormData).get("key");
      uploads.push(String(key));
      return Response.json({ url: `https://cdn.115jon.site/kova-auth/${key}` });
    }
    if (url.includes("/scan/")) return Response.json({ safe });
    if (init?.method === "DELETE") {
      deletes.push(url);
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 500 });
  });
}

function envFor(memory: ReturnType<typeof memoryDb>) {
  return {
    DB: memory.db,
    CDN_URL: "https://cdn.115jon.site",
    CDN_API_KEY: "test-key",
  } as unknown as Env;
}

function executionContext() {
  const waits: Promise<unknown>[] = [];
  const context: ExecutionContext = {
    waitUntil(promise) {
      waits.push(promise);
    },
    passThroughOnException() {},
    props: {},
  };
  return { context, waits };
}

async function postWallpaper(
  env: Env,
  bytes: Uint8Array,
  effect?: string,
  type = "image/png",
  context = executionContext().context,
) {
  const form = new FormData();
  form.append("image", new File([bytes], "wall.png", { type }));
  if (effect !== undefined) form.append("effect", effect);
  return userRouter.request("/wallpaper", { method: "POST", body: form }, env, context);
}

describe("user wallpaper", () => {
  afterEach(() => {
    harness.user = { id: "user_abc", email: "ada@example.com", name: "Ada" };
    harness.events.length = 0;
    uploads.length = 0;
    deletes.length = 0;
    safe = true;
    vi.unstubAllGlobals();
  });

  it("rejects anonymous reads and uploads", async () => {
    harness.user = null;
    const db = memoryDb();
    const env = envFor(db);
    const getRes = await userRouter.request("/wallpaper", { method: "GET" }, env);
    const postRes = await postWallpaper(env, png());
    expect(getRes.status).toBe(401);
    expect(postRes.status).toBe(401);
    expect(db.row()).toBeNull();
  });

  it("stores, replaces, and clears a wallpaper", async () => {
    installFetch();
    const db = memoryDb();
    const env = envFor(db);
    const { context, waits } = executionContext();

    const missing = await userRouter.request("/wallpaper", { method: "GET" }, env);
    expect(missing.status).toBe(404);

    const created = await postWallpaper(env, png(), "dither", "image/png", context);
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      wallpaperUrl: string;
      effect: string;
      updatedAt: number;
    };
    expect(createdBody.effect).toBe("dither");
    expect(createdBody.wallpaperUrl).toMatch(
      /^https:\/\/cdn\.115jon\.site\/kova-auth\/wallpapers\/user_abc\/[a-f0-9]+\.png$/,
    );
    expect(createdBody.updatedAt).toBeGreaterThan(1_000_000_000_000);
    expect(uploads).toHaveLength(1);

    const fetched = await userRouter.request("/wallpaper", { method: "GET" }, env);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(createdBody);

    const replaced = await postWallpaper(env, png(32, 16), "ascii", "image/png", context);
    expect(replaced.status).toBe(200);
    const replacedBody = (await replaced.json()) as { wallpaperUrl: string; effect: string };
    expect(replacedBody.effect).toBe("ascii");
    expect(replacedBody.wallpaperUrl).not.toBe(createdBody.wallpaperUrl);
    expect(deletes).toHaveLength(0);
    const library = await userRouter.request("/wallpapers", { method: "GET" }, env);
    expect((await library.json() as { items: Array<{ url: string }> }).items.map((item) => item.url)).toContain(replacedBody.wallpaperUrl);

    const removed = await userRouter.request("/wallpaper", { method: "DELETE" }, env, context);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect(db.row()).toBeNull();
    const gone = await userRouter.request("/wallpaper", { method: "GET" }, env);
    expect(gone.status).toBe(404);

    expect(harness.events.map((event) => event.event)).toEqual([
      "user.wallpaperUpdated",
      "user.wallpaperUpdated",
      "user.wallpaperUpdated",
    ]);
    expect(harness.events[0]?.data["effect"]).toBe("dither");
    expect(harness.events[2]?.data["removed"]).toBe(true);
    expect(harness.events[2]?.data["wallpaperUrl"]).toBeNull();
    expect(waits).toHaveLength(3);
    expect(db.audits).toEqual([]);
  });

  it("rejects a bad effect, a mismatched type, an oversized file, and a 4K-plus image", async () => {
    installFetch();
    const db = memoryDb();
    const env = envFor(db);

    const badEffect = await postWallpaper(env, png(), "sparkle");
    expect(badEffect.status).toBe(400);

    const mismatched = await postWallpaper(env, png(), "none", "image/jpeg");
    expect(mismatched.status).toBe(400);

    const huge = new Uint8Array(WALLPAPER_MAX_BYTES + 1);
    const tooBig = await postWallpaper(env, huge, "none");
    expect(tooBig.status).toBe(400);

    const over4k = await postWallpaper(env, png(4000, 3000), "none");
    expect(over4k.status).toBe(400);

    expect(uploads).toHaveLength(0);
    expect(db.row()).toBeNull();
  });

  it("drops a policy rejection and leaves the previous wallpaper", async () => {
    installFetch();
    const db = memoryDb();
    const env = envFor(db);
    const created = await postWallpaper(env, png(), "halftone");
    expect(created.status).toBe(200);

    safe = false;
    deletes.length = 0;
    const rejected = await postWallpaper(env, png(4, 4), "scanlines");
    expect(rejected.status).toBe(422);
    expect(db.row()?.effect).toBe("halftone");
    expect(deletes.some((url) => url.includes("/files/kova-auth/wallpapers/"))).toBe(true);
  });
});

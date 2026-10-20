import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../applications";
import { appsRouter } from "./apps";

const getSession = vi.fn(async (): Promise<{ user: { id: string; role: string } } | null> => ({
  user: { id: "admin-1", role: "admin" },
}));
const updateApplication = vi.fn(async (_db: unknown, _id: string, _input: Record<string, unknown>) => application);
let application: Application;

vi.mock("../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));
vi.mock("../applications", async (original) => ({
  ...await original<typeof import("../applications")>(),
  getApplicationById: async () => application,
  updateApplication: (db: unknown, id: string, input: Record<string, unknown>) => updateApplication(db, id, input),
}));

const CDN = "https://cdn.test";
const env = {
  DB: {},
  KV: { delete: async () => undefined },
  CDN_URL: CDN,
  CDN_API_KEY: "cdn-key",
} as unknown as Env;

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1", name: "Test", environment: "production", publishable_key: "pk_test",
    allowed_origins: [], redirect_uris: [], logo_url: null, ...overrides,
  } as Application;
}

type CdnCall = { url: string; method: string; headers: Headers; body: BodyInit | null | undefined };
let cdnCalls: CdnCall[];

/** Stands in for the CDN: uploads answer with the direct URL for the requested key, scans and deletes succeed. */
function stubCdn({ uploadStatus = 201, safe = true } = {}) {
  cdnCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    cdnCalls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body });
    if (url.includes("/scan/")) return Response.json({ safe });
    if (url.endsWith("/upload")) {
      if (uploadStatus !== 201) return new Response("nope", { status: uploadStatus });
      const key = `kova-auth/${(init!.body as FormData).get("key")}`;
      return Response.json({ url: `${CDN}/${key}`, key }, { status: 201 });
    }
    return Response.json({ deleted: true });
  });
}

const uploads = () => cdnCalls.filter((call) => call.url.endsWith("/upload"));
const scans = () => cdnCalls.filter((call) => call.url.includes("/scan/"));
const deletes = () => cdnCalls.filter((call) => call.method === "DELETE");

/** Records what the route hands to waitUntil, so tests can wait for the background work. */
let background: Promise<unknown>[];
const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
  passThroughOnException: () => { },
} as unknown as ExecutionContext;
const settle = () => Promise.all(background);

async function send(path: string, init: RequestInit) {
  const response = await appsRouter.request(path, init, env, executionCtx);
  await settle();
  return response;
}

function uploadLogo(file: FormDataEntryValue | null = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" })) {
  const form = new FormData();
  if (file) form.append("file", file);
  return send("/app-1/logo", { method: "POST", body: form });
}

beforeEach(() => {
  application = app();
  updateApplication.mockClear();
  getSession.mockClear();
  background = [];
  stubCdn();
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/apps", () => {
  function listEnv(rows: Record<string, unknown>[]) {
    const statements: string[] = [];
    const DB = { prepare: (sql: string) => { statements.push(sql); return { all: async () => ({ results: rows }) }; } };
    return { env: { ...env, DB } as unknown as Env, statements };
  }

  it("returns each app's logo_url in the one list response", async () => {
    const { env: listed, statements } = listEnv([
      { id: "app_a", name: "A", environment: "production", publishable_key: "pk_a", logo_url: `${CDN}/kova-auth/apps/app_a/logo-0a1b2c3d4e5f.webp` },
      { id: "app_b", name: "B", environment: "development", publishable_key: "pk_b", logo_url: null },
    ]);

    const response = await appsRouter.request("/", {}, listed);
    const body = await response.json() as { apps: { id: string; logo_url: string | null }[] };

    expect(response.status).toBe(200);
    expect(body.apps.map((a) => [a.id, a.logo_url])).toEqual([
      ["app_a", `${CDN}/kova-auth/apps/app_a/logo-0a1b2c3d4e5f.webp`],
      ["app_b", null],
    ]);
    // One query for the whole list; no per-app lookups.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("logo_url");
  });

  it("is admin only", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "user" } });
    expect((await appsRouter.request("/", {}, listEnv([]).env)).status).toBe(403);
  });
});

describe("POST /api/admin/apps/:id/logo", () => {
  it("uploads under a new immutable key and stores the direct CDN URL", async () => {
    const response = await uploadLogo();
    const [upload] = uploads();
    const form = upload!.body as FormData;

    expect(response.status).toBe(200);
    expect(upload!.url).toBe(`${CDN}/upload`);
    expect(upload!.headers.get("CDN-API-Key")).toBe("cdn-key");
    expect(form.get("app")).toBe("kova-auth");
    // The CDN turns this into `public, max-age=31536000, immutable`.
    expect(form.get("cacheControl")).toBe("immutable");
    expect(form.get("key")).toMatch(/^apps\/app-1\/logo-[0-9a-f]{12}\.webp$/);

    const { logoUrl } = await response.json() as { logoUrl: string };
    expect(logoUrl).toBe(`${CDN}/kova-auth/${form.get("key")}`);
    expect(updateApplication).toHaveBeenCalledWith(env.DB, "app-1", { logo_url: logoUrl });
  });

  it("gives every upload its own URL, so a new logo busts every cache", async () => {
    const first = await (await uploadLogo()).json() as { logoUrl: string };
    const second = await (await uploadLogo()).json() as { logoUrl: string };
    expect(second.logoUrl).not.toBe(first.logoUrl);
  });

  it("removes the logo it replaces, but only when it knows the key", async () => {
    application = app({ logo_url: `${CDN}/kova-auth/apps/app-1/logo-aaaaaaaaaaaa.webp` });
    await uploadLogo();
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/apps/app-1/logo-aaaaaaaaaaaa.webp`]);
    expect(deletes()[0]!.headers.get("CDN-API-Key")).toBe("cdn-key");

    // Logos stored as share links have no key to delete.
    stubCdn();
    application = app({ logo_url: `${CDN}/s/0123456789abcdef` });
    await uploadLogo();
    expect(deletes()).toHaveLength(0);
  });

  it("keeps the old logo when the CDN refuses the upload", async () => {
    application = app({ logo_url: `${CDN}/kova-auth/apps/app-1/logo-aaaaaaaaaaaa.webp` });
    stubCdn({ uploadStatus: 500 });
    const response = await uploadLogo();
    expect(response.status).toBe(502);
    expect(updateApplication).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it.each([
    ["an SVG", new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "logo.svg", { type: "image/svg+xml" })],
    ["a GIF", new File([new Uint8Array([0x47, 0x49, 0x46])], "logo.gif", { type: "image/gif" })],
    ["a document", new File(["hello"], "logo.txt", { type: "text/plain" })],
    ["a file with no type", new File([new Uint8Array([0x89, 0x50])], "logo")],
  ])("rejects %s before it reaches the CDN", async (_label, file) => {
    const response = await uploadLogo(file);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Only JPEG, PNG and WebP images are accepted" });
    expect(cdnCalls).toHaveLength(0);
    expect(updateApplication).not.toHaveBeenCalled();
  });

  it("decides on the bytes, not the Content-Type the client claims", async () => {
    // Text posing as a PNG is refused...
    const spoofed = await uploadLogo(new File(["<html>not an image</html>"], "logo.png", { type: "image/png" }));
    expect(spoofed.status).toBe(400);
    expect(cdnCalls).toHaveLength(0);

    // ...and a real image with a wrong or missing type is stored under its true type.
    for (const [bytes, claimed, actual] of [
      [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a], "text/plain", "image/png"],
      [[0xff, 0xd8, 0xff, 0xe0], "", "image/jpeg"],
      [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "application/octet-stream", "image/webp"],
    ] as const) {
      stubCdn();
      const response = await uploadLogo(new File([new Uint8Array(bytes)], "logo", { type: claimed }));
      expect(response.status, actual).toBe(200);
      expect(((uploads()[0]!.body as FormData).get("file") as File).type).toBe(actual);
    }
  });

  it("refuses RIFF files that are not WebP", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const response = await uploadLogo(new File([wav], "logo.webp", { type: "image/webp" }));
    expect(response.status).toBe(400);
    expect(cdnCalls).toHaveLength(0);
  });

  it("rejects a form field that is not a file", async () => {
    const response = await uploadLogo("just text");
    expect(response.status).toBe(400);
    expect(cdnCalls).toHaveLength(0);
  });

  it("rejects an oversized logo", async () => {
    const response = await uploadLogo(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" }));
    expect(response.status).toBe(400);
    expect(cdnCalls).toHaveLength(0);
  });

  it("scans the upload and, when it is rejected, deletes it and keeps the old logo", async () => {
    application = app({ logo_url: `${CDN}/kova-auth/apps/app-1/logo-aaaaaaaaaaaa.webp` });
    stubCdn({ safe: false });

    const response = await uploadLogo();
    const form = uploads()[0]!.body as FormData;

    expect(response.status).toBe(422);
    expect(scans().map((call) => call.url)).toEqual([`${CDN}/scan/kova-auth/${form.get("key")}`]);
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/${form.get("key")}`]);
    expect(updateApplication).not.toHaveBeenCalled();
  });

  it("scans uploads that pass before storing them", async () => {
    await uploadLogo();
    expect(scans()).toHaveLength(1);
    expect(updateApplication).toHaveBeenCalledTimes(1);
  });

  it("never deletes outside the app's folder, whatever the stored URL says", async () => {
    for (const logo_url of [
      `${CDN}/kova-auth/apps/app-2/logo-aaaaaaaaaaaa.webp`,
      `${CDN}/kova-auth/apps/app-1/../app-2/logo.webp`,
      `${CDN}/kova-auth/apps/app-1/%2e%2e/app-2/logo.webp`,
      `${CDN}/kova-auth/org-logos/org_1/logo.webp`,
      `${CDN}/kova-auth/avatars/user_1/me.webp`,
    ]) {
      stubCdn();
      application = app({ logo_url });
      await uploadLogo();
      expect(deletes(), logo_url).toHaveLength(0);
    }
  });

  it("answers before the old logo is removed", async () => {
    application = app({ logo_url: `${CDN}/kova-auth/apps/app-1/logo-aaaaaaaaaaaa.webp` });
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" }));

    const response = await appsRouter.request("/app-1/logo", { method: "POST", body: form }, env, executionCtx);

    expect(response.status).toBe(200);
    expect(background).toHaveLength(1);
    await settle();
    expect(deletes()).toHaveLength(1);
  });

  it("is admin only", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await uploadLogo()).status).toBe(403);
    expect(cdnCalls).toHaveLength(0);
  });
});

describe("DELETE /api/admin/apps/:id/logo", () => {
  it("clears the URL and deletes the stored image", async () => {
    application = app({ logo_url: `${CDN}/kova-auth/apps/app-1/logo-bbbbbbbbbbbb.webp` });
    const response = await send("/app-1/logo", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(updateApplication).toHaveBeenCalledWith(env.DB, "app-1", { logo_url: null });
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/apps/app-1/logo-bbbbbbbbbbbb.webp`]);
  });
});

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
    allowed_origins: [], redirect_uris: [], logo_url: null, favicon_url: null, ...overrides,
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
const deletes = () => cdnCalls.filter((call) => call.method === "DELETE");

let background: Promise<unknown>[];
const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
  passThroughOnException: () => { },
} as unknown as ExecutionContext;

async function send(path: string, init: RequestInit) {
  const response = await appsRouter.request(path, init, env, executionCtx);
  await Promise.all(background);
  return response;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
const ICO = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00];

function uploadFavicon(file: FormDataEntryValue | null = new File([new Uint8Array(PNG)], "favicon.png", { type: "image/png" })) {
  const form = new FormData();
  if (file) form.append("file", file);
  return send("/app-1/favicon", { method: "POST", body: form });
}

beforeEach(() => {
  application = app();
  updateApplication.mockClear();
  getSession.mockClear();
  background = [];
  stubCdn();
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/admin/apps/:id/favicon", () => {
  it("uploads under a versioned immutable key and stores the direct CDN URL", async () => {
    const response = await uploadFavicon();
    const [upload] = uploads();
    const form = upload!.body as FormData;

    expect(response.status).toBe(200);
    expect(upload!.headers.get("CDN-API-Key")).toBe("cdn-key");
    expect(form.get("app")).toBe("kova-auth");
    expect(form.get("cacheControl")).toBe("immutable");
    expect(form.get("tags")).toBe("app-favicon");
    expect(form.get("uploader")).toBe("admin-1");
    expect(form.get("key")).toMatch(/^apps\/app-1\/favicon-[0-9a-f]{12}\.png$/);

    const { faviconUrl } = await response.json() as { faviconUrl: string };
    expect(faviconUrl).toBe(`${CDN}/kova-auth/${form.get("key")}`);
    expect(updateApplication).toHaveBeenCalledWith(env.DB, "app-1", { favicon_url: faviconUrl });
    expect(cdnCalls.some((call) => call.url.includes("/api/shares"))).toBe(false);
  });

  it.each([
    ["an SVG", new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "f.svg", { type: "image/svg+xml" })],
    ["a JPEG", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "f.jpg", { type: "image/jpeg" })],
    ["a document", new File(["hello"], "f.txt", { type: "text/plain" })],
    ["text posing as a PNG", new File(["<html>not an image</html>"], "f.png", { type: "image/png" })],
  ])("rejects %s before it reaches the CDN", async (_label, file) => {
    const response = await uploadFavicon(file);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Only PNG, ICO and WebP favicons are accepted" });
    expect(cdnCalls).toHaveLength(0);
    expect(updateApplication).not.toHaveBeenCalled();
  });

  it("accepts real ICO bytes even when the browser sends no type", async () => {
    const response = await uploadFavicon(new File([new Uint8Array(ICO)], "favicon.ico", { type: "" }));
    const form = uploads()[0]!.body as FormData;

    expect(response.status).toBe(200);
    expect(form.get("key")).toMatch(/^apps\/app-1\/favicon-[0-9a-f]{12}\.ico$/);
    expect((form.get("file") as File).type).toBe("image/x-icon");
  });

  it("rejects an oversized favicon", async () => {
    const response = await uploadFavicon(new File([new Uint8Array(512 * 1024 + 1)], "f.png", { type: "image/png" }));
    expect(response.status).toBe(400);
    expect(cdnCalls).toHaveLength(0);
  });

  it("removes the favicon it replaces, but only inside the app folder", async () => {
    application = app({ favicon_url: `${CDN}/kova-auth/apps/app-1/favicon-aaaaaaaaaaaa.png` });
    await uploadFavicon();
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/apps/app-1/favicon-aaaaaaaaaaaa.png`]);
    expect(deletes()[0]!.headers.get("CDN-API-Key")).toBe("cdn-key");

    stubCdn();
    application = app({ favicon_url: `${CDN}/kova-auth/apps/app-2/favicon-aaaaaaaaaaaa.png` });
    await uploadFavicon();
    expect(deletes()).toHaveLength(0);
  });

  it("leaves a share-link favicon alone", async () => {
    application = app({ favicon_url: `${CDN}/s/0123456789abcdef` });
    await uploadFavicon();
    expect(deletes()).toHaveLength(0);
  });

  it("deletes a rejected scan and keeps the old favicon", async () => {
    application = app({ favicon_url: `${CDN}/kova-auth/apps/app-1/favicon-aaaaaaaaaaaa.png` });
    stubCdn({ safe: false });
    const response = await uploadFavicon();
    const form = uploads()[0]!.body as FormData;

    expect(response.status).toBe(422);
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/${form.get("key")}`]);
    expect(updateApplication).not.toHaveBeenCalled();
  });

  it("is admin only", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await uploadFavicon()).status).toBe(403);
    expect(cdnCalls).toHaveLength(0);
  });
});

describe("DELETE /api/admin/apps/:id/favicon", () => {
  it("clears the URL and deletes the stored image", async () => {
    application = app({ favicon_url: `${CDN}/kova-auth/apps/app-1/favicon-bbbbbbbbbbbb.ico` });
    const response = await send("/app-1/favicon", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(updateApplication).toHaveBeenCalledWith(env.DB, "app-1", { favicon_url: null });
    expect(deletes().map((call) => call.url)).toEqual([`${CDN}/files/kova-auth/apps/app-1/favicon-bbbbbbbbbbbb.ico`]);
  });

  it("is admin only", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", role: "user" } });
    expect((await send("/app-1/favicon", { method: "DELETE" })).status).toBe(403);
    expect(updateApplication).not.toHaveBeenCalled();
  });
});

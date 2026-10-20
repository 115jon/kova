import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleQueueBatch, type AppEventMessage } from "./queue-consumer";

const CDN = "https://cdn.test";
const kvDelete = vi.fn(async (_key: string) => undefined);
const env = { KV: { delete: kvDelete }, CDN_URL: CDN, CDN_API_KEY: "cdn-key" } as unknown as Env;

let calls: { url: string; method: string; headers: Headers }[];

beforeEach(() => {
  calls = [];
  kvDelete.mockClear();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    return Response.json({ deleted: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function run(body: AppEventMessage) {
  const ack = vi.fn();
  const retry = vi.fn();
  await handleQueueBatch({ messages: [{ body, ack, retry }] } as unknown as MessageBatch<AppEventMessage>, env);
  return { ack, retry };
}

describe("app.deleted", () => {
  it("deletes the app's own CDN logo and skips a share-link favicon", async () => {
    const { ack } = await run({
      type: "app.deleted",
      appId: "app_1",
      publishableKey: "pk_test",
      logoUrl: `${CDN}/kova-auth/apps/app_1/logo-0a1b2c3d4e5f.webp`,
      faviconUrl: `${CDN}/s/0123456789abcdef`,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    expect(ack).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`${CDN}/files/kova-auth/apps/app_1/logo-0a1b2c3d4e5f.webp`);
    expect(calls[0]!.headers.get("CDN-API-Key")).toBe("cdn-key");
    expect(kvDelete).toHaveBeenCalledWith("appearance:pk_test");
  });

  it("deletes both assets when both are the app's own", async () => {
    await run({
      type: "app.deleted",
      appId: "app_1",
      publishableKey: "pk_test",
      logoUrl: `${CDN}/kova-auth/apps/app_1/logo-a.webp`,
      faviconUrl: `${CDN}/kova-auth/apps/app_1/favicon-b.ico`,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    expect(calls.map((call) => call.url).sort()).toEqual([
      `${CDN}/files/kova-auth/apps/app_1/favicon-b.ico`,
      `${CDN}/files/kova-auth/apps/app_1/logo-a.webp`,
    ]);
  });
});

describe("other messages", () => {
  it("leaves email.smtp away from the CDN", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => { });
    const { ack } = await run({
      type: "email.smtp", to: "a@b.c", subject: "s", html: "", smtp: { host: "h", port: 25, user: "u", pass: "p", secure: false },
    });
    expect(ack).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    log.mockRestore();
  });
});

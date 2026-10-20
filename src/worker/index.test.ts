import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATIC_ORIGINS } from "./middleware/cors";
import worker, { AppCounter, createWorker } from "./index";

const env = { AUTH_URL: "https://auth.lvh.me" } as Env;
const ctx = {} as ExecutionContext;

function handler(body: string) {
  return async () => new Response(body);
}

describe("composed Worker boundary", () => {
  it("delegates API requests to Hono", async () => {
    const composed = createWorker(handler("start"), handler("hono"));

    const response = await composed.fetch(
      new Request("https://auth.lvh.me/api/auth/get-session"),
      env,
      ctx,
    );
    const oauthResponse = await composed.fetch(
      new Request("https://auth.lvh.me/api/hosted/oauth-complete"),
      env,
      ctx,
    );

    expect(await response.text()).toBe("hono");
    expect(await oauthResponse.text()).toBe("hono");
  });

  it("delegates OIDC discovery to Hono", async () => {
    const composed = createWorker(handler("start"), handler("hono"));

    const rooted = await composed.fetch(
      new Request("https://auth.lvh.me/.well-known/openid-configuration"),
      env,
      ctx,
    );
    const nested = await composed.fetch(
      new Request("https://auth.lvh.me/api/auth/.well-known/openid-configuration"),
      env,
      ctx,
    );

    expect(await rooted.text()).toBe("hono");
    expect(await nested.text()).toBe("hono");
  });

  it("allows the 1:15 Forgejo origin", () => {
    expect(STATIC_ORIGINS.has("https://git.115jon.com")).toBe(true);
    expect(STATIC_ORIGINS.has("https://oci-a1.tail91a4f4.ts.net")).toBe(true);
    expect(STATIC_ORIGINS.has("https://joi.tail91a4f4.ts.net:5174")).toBe(true);
  });

  it("delegates dashboard requests to TanStack Start", async () => {
    const composed = createWorker(handler("start"), handler("hono"));

    const response = await composed.fetch(
      new Request("https://auth.lvh.me/applications"),
      env,
      ctx,
    );
    expect(await response.text()).toBe("start");
  });

  it("serves dashboard assets through Workers Assets", async () => {
    const composed = createWorker(handler("start"), handler("hono"), handler("asset"));

    const response = await composed.fetch(
      new Request("https://auth.lvh.me/_build/app.js"),
      env,
      ctx,
    );

    expect(await response.text()).toBe("asset");
  });

  it("serves hosted-auth assets instead of routing them through Hono", async () => {
    const composed = createWorker(handler("start"), handler("hono"), handler("asset"));

    const bundle = await composed.fetch(
      new Request("https://tenant.auth.lvh.me/assets/hosted-auth.js"),
      env,
      ctx,
    );
    const page = await composed.fetch(
      new Request("https://tenant.auth.lvh.me/sign-in"),
      env,
      ctx,
    );

    expect(await bundle.text()).toBe("asset");
    expect(await page.text()).toBe("hono");
  });

  it("points the hosted page at the bundle the hosted-auth build emits", () => {
    const page = readFileSync(new URL("./routes/hosted-auth.ts", import.meta.url), "utf8");
    const bundle = readFileSync(new URL("../../dist/client/assets/hosted-auth.js", import.meta.url), "utf8");

    expect(page).toContain('src="/assets/hosted-auth.js"');
    expect(bundle).toContain("__KOVA_AUTH_HOSTED__");
    expect(bundle).not.toMatch(/^import /m);
  });

  it("delegates hosted-auth and custom-host requests to Hono", async () => {
    const composed = createWorker(handler("start"), handler("hono"));

    const hostedResponse = await composed.fetch(
      new Request("https://tenant.auth.lvh.me/sign-in"),
      env,
      ctx,
    );
    const customHostResponse = await composed.fetch(
      new Request("https://login.customer.example/sign-in"),
      env,
      ctx,
    );

    expect(await hostedResponse.text()).toBe("hono");
    expect(await customHostResponse.text()).toBe("hono");
  });

  it("keeps app-scoped session tokens off the platform routes", async () => {
    const composed = createWorker(handler("start"));
    const db = {
      prepare: () => ({
        bind: (...tokens: string[]) => ({ first: async () => (tokens.includes("app-token") ? { scoped: 1 } : null) }),
      }),
    };
    const platformEnv = { ...env, DB: db, KV: {} } as unknown as Env;
    const call = (path: string, token: string) =>
      composed.fetch(
        new Request(`https://auth.lvh.me${path}`, { headers: { authorization: `Bearer ${token}` } }),
        platformEnv,
        ctx,
      );

    for (const path of [
      "/api/admin/apps",
      "/api/admin/apps/app-1/users",
      "/api/admin/users/user-1",
      "/api/org/avatar/org-1",
      "/api/webhooks/endpoints",
      "/api/device-challenges/dc_abc/approve",
      "/api/user/set-initial-password",
    ]) {
      expect((await call(path, "app-token")).status, path).toBe(403);
    }

    // Profile routes stay reachable for the SDK, and platform tokens are untouched.
    expect((await call("/api/user/fields/schema", "app-token")).status).toBe(200);
    expect((await call("/api/admin/apps", "platform-token")).status).not.toBe(403);
  });

  it("keeps the queue handler and AppCounter export on the Worker", () => {
    expect(worker.queue).toBeTypeOf("function");
    expect(AppCounter).toBeTypeOf("function");
  });
});

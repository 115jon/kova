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

  it("keeps the queue handler and AppCounter export on the Worker", () => {
    expect(worker.queue).toBeTypeOf("function");
    expect(AppCounter).toBeTypeOf("function");
  });
});

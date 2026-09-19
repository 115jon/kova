import { describe, expect, it } from "vitest";
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

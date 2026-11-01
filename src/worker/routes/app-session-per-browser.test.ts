/**
 * App sessions are per browser, end to end: the composed worker, Better Auth,
 * and every migration. Each browser is its own signed auth-domain cookie.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createHarness, TEST_AUTH_URL, type Harness } from "../test-support/auth-harness";

const WEB = "https://meet.example";

describe("app sessions per browser", () => {
  let h: Harness;
  let app: ReturnType<Harness["createApp"]>;
  let user: { id: string };

  beforeEach(() => {
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: [WEB] });
    user = h.createUser();
  });

  async function sessionToken(cookie: string): Promise<string> {
    const response = await h.fetch(`/api/pub/apps/${app.publishableKey}/session-token`, {
      method: "POST",
      headers: { cookie, origin: WEB, "x-publishable-key": app.publishableKey },
    });
    expect(response.status).toBe(200);
    const { sessionToken: token } = (await response.json()) as { sessionToken: string };
    expect(token).toEqual(expect.any(String));
    return token;
  }

  /** The SDK's check that its Bearer token still signs it in. */
  async function signedInAs(token: string): Promise<string | null> {
    const response = await h.fetch("/api/auth/get-session", {
      headers: { authorization: `Bearer ${token}`, origin: WEB, "x-publishable-key": app.publishableKey },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user?: { id: string } } | null;
    return body?.user?.id ?? null;
  }

  async function revoke(token: string) {
    const response = await h.fetch(`/api/pub/apps/${app.publishableKey}/revoke-session`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: WEB },
    });
    expect(response.status).toBe(200);
  }

  it("gives two browsers different tokens, and each browser the same token every time", async () => {
    const machineA = await h.createSession(user.id);
    const machineB = await h.createSession(user.id);

    const a = await sessionToken(machineA.cookie);
    const b = await sessionToken(machineB.cookie);

    expect(a).not.toBe(b);
    expect(await sessionToken(machineA.cookie)).toBe(a);
    expect(await sessionToken(machineB.cookie)).toBe(b);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE app_id = ?").get(app.id)).toEqual({ n: 2 });
  });

  it("revoking one browser's token leaves the other browser signed in", async () => {
    const machineA = await h.createSession(user.id);
    const machineB = await h.createSession(user.id);
    const a = await sessionToken(machineA.cookie);
    const b = await sessionToken(machineB.cookie);

    await revoke(a);

    expect(await signedInAs(a)).toBeNull();
    expect(await signedInAs(b)).toBe(user.id);
  });

  it("never hands a token minted before parent tracking to a browser", async () => {
    const legacy = await h.createSession(user.id, { appId: app.id });
    const browser = await h.createSession(user.id);

    const token = await sessionToken(browser.cookie);

    expect(token).not.toBe(legacy.token);
    expect(await signedInAs(legacy.token)).toBe(user.id);
  });

  it("keeps a browser's app token after that browser signs out of the auth domain: sign-out is per app", async () => {
    const machineA = await h.createSession(user.id);
    const machineB = await h.createSession(user.id);
    const a = await sessionToken(machineA.cookie);
    const b = await sessionToken(machineB.cookie);

    const signOut = await h.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: machineA.cookie, origin: TEST_AUTH_URL, "content-type": "application/json" },
      body: "{}",
    });
    expect(signOut.status).toBe(200);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE id = ?").get(machineA.id)).toEqual({ n: 0 });

    expect(await signedInAs(a)).toBe(user.id);
    expect(await signedInAs(b)).toBe(user.id);
  });
});

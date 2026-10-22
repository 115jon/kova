/**
 * Device sign-in end to end: the legacy /api/pub/apps/:pk/device/* contract
 * over Better Auth's device-authorization plugin, the hosted /device page,
 * and the guards that keep app codes app-scoped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../auth";
import { RALPH_PUBLISHABLE_KEY } from "../../shared/hosted-brand";
import { createHarness, TEST_AUTH_URL, type Harness } from "../test-support/auth-harness";

type App = ReturnType<Harness["createApp"]>;
type Started = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
};

const T0 = new Date("2026-10-21T12:00:00.000Z").getTime();

function hostOf(app: App) {
  return `https://${app.authSlug}.auth.115jon.site`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

describe("device sign-in", () => {
  let h: Harness;
  let app: App;
  let user: { id: string };
  let hostedCookie: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: ["http://tauri.localhost"] });
    user = h.createUser({ name: "Ada Lovelace", email: "ada@example.com" });
    // The hosted cookie session minted by /oauth-complete is scoped to the app.
    hostedCookie = (await h.createSession(user.id, { appId: app.id })).cookie;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function start(target: App = app, body: Record<string, unknown> = { hostname: "ada-laptop", platform: "Windows", label: "Ralph Meet" }) {
    const response = await h.fetch(`/api/pub/apps/${target.publishableKey}/device/start`, json(body, { "CF-Connecting-IP": "203.0.113.7" }));
    return { response, body: (await response.json()) as Started };
  }

  async function poll(deviceCode: string, target: App = app) {
    const response = await h.fetch(`/api/pub/apps/${target.publishableKey}/device/poll`, json({ deviceCode }));
    return { status: response.status, body: (await response.json()) as Record<string, unknown>, response };
  }

  function later(ms: number) {
    vi.setSystemTime(Date.now() + ms);
  }

  async function page(code: string, cookie = hostedCookie, target: App = app) {
    const response = await h.fetch(`${hostOf(target)}/device?code=${encodeURIComponent(code)}`, { headers: cookie ? { cookie } : {} });
    return { status: response.status, html: await response.text() };
  }

  async function decide(action: "approve" | "deny", userCode: string, options: { cookie?: string; origin?: string; target?: App; authorization?: string } = {}) {
    const target = options.target ?? app;
    const headers: Record<string, string> = { origin: options.origin ?? hostOf(target) };
    if (options.cookie ?? hostedCookie) headers.cookie = options.cookie ?? hostedCookie;
    if (options.authorization) headers.authorization = options.authorization;
    return h.fetch(`${hostOf(target)}/api/auth/device/${action}`, json({ userCode }, headers));
  }

  async function approveFlow(started: Started, cookie = hostedCookie) {
    expect((await page(started.userCode, cookie)).status).toBe(200);
    const approved = await decide("approve", started.userCode, { cookie });
    expect(approved.status, await approved.clone().text()).toBe(200);
  }

  describe("POST /:pk/device/start", () => {
    it("keeps the legacy camelCase shape, the per-app verification URL, and no-store", async () => {
      const { response, body } = await start();
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.deviceCode).toMatch(/^dvc_[A-Za-z0-9_-]{43}$/);
      expect(body.userCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      expect(body.verificationUri).toBe(`${hostOf(app)}/device`);
      expect(body.verificationUriComplete).toBe(`${hostOf(app)}/device?code=${body.userCode}`);
      expect(body.interval).toBe(5);
      expect(body.expiresIn).toBe(600);
      expect(Object.keys(body).sort()).toEqual(["deviceCode", "expiresIn", "interval", "userCode", "verificationUri", "verificationUriComplete"]);
    });

    it("stores clean device context against the app", async () => {
      const { body } = await start(app, { hostname: "ada\u0000-laptop\n", platform: "x".repeat(300), label: 42 });
      const row = h.sqlite.prepare(`SELECT clientId, appId, deviceHostname, devicePlatform, deviceLabel, requesterIp, userId, status FROM deviceCode WHERE deviceCode = ?`).get(body.deviceCode) as Record<string, unknown>;
      expect(row).toMatchObject({ clientId: app.publishableKey, appId: app.id, deviceHostname: "ada-laptop", deviceLabel: null, requesterIp: "203.0.113.7", userId: null, status: "pending" });
      expect(String(row.devicePlatform)).toHaveLength(128);
    });

    it("answers CORS for the app's desktop webview origin", async () => {
      const response = await h.fetch(`/api/pub/apps/${app.publishableKey}/device/start`, json({}, { origin: "http://tauri.localhost", "X-Publishable-Key": app.publishableKey }));
      expect(response.status).toBe(201);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    });

    it("refuses unknown, suspended, and slug-less apps the old way", async () => {
      expect((await h.fetch(`/api/pub/apps/pk_dev_nope/device/start`, json({}))).status).toBe(404);
      expect((await start(h.createApp({ suspended: true }))).response.status).toBe(403);
      const slugless = await start(h.createApp({ authSlug: null }));
      expect(slugless.response.status).toBe(409);
      expect(slugless.body).toEqual({ error: "device_flow_unavailable" });
    });

    it("sweeps expired codes nobody finished polling, without holding up the response", async () => {
      const { body: stale } = await start();
      later(601_000);
      const { response } = await start();
      expect(response.status).toBe(201);
      await h.settle();
      const left = h.sqlite.prepare(`SELECT deviceCode FROM deviceCode`).all() as Array<{ deviceCode: string }>;
      expect(left).toHaveLength(1);
      expect(left[0]!.deviceCode).not.toBe(stale.deviceCode);
    });

    it("fails closed when its rate limit cannot be checked", async () => {
      h.sqlite.exec(`DROP TABLE "rateLimit"`);
      const { response, body } = await start();
      expect([response.status, body]).toEqual([503, { error: "temporarily_unavailable" }]);
    });

    it("rate-limits starts per IP and key", async () => {
      for (let i = 0; i < 20; i += 1) expect((await start()).response.status).toBe(201);
      const limited = await start();
      expect(limited.response.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).toBeTruthy();
      expect((await start(h.createApp())).response.status).toBe(201);
    });

    it("closes Better Auth's own /device/code to direct callers on every host", async () => {
      const body = json({ client_id: app.publishableKey });
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/device/code`, body)).status).toBe(404);
      expect((await h.fetch(`${hostOf(app)}/api/auth/device/code`, json({ client_id: app.publishableKey }, { origin: hostOf(app) }))).status).toBe(404);
      // Even reached directly, the grant refuses a request that came over HTTP.
      const auth = createAuth(h.env);
      const viaHandler = await auth.handler(new Request(`${TEST_AUTH_URL}/api/auth/device/code`, json({ client_id: app.publishableKey })));
      expect(viaHandler.status).toBe(400);
      expect(((await viaHandler.json()) as { error: string }).error).toBe("invalid_request");
    });
  });

  describe("POST /:pk/device/poll", () => {
    it("goes pending → slow_down → approved once, then refuses the code", async () => {
      const { body: started } = await start();

      expect(await poll(started.deviceCode).then((r) => [r.status, r.body])).toEqual([200, { status: "pending", interval: 5 }]);
      const slow = await poll(started.deviceCode);
      expect([slow.status, slow.body]).toEqual([429, { error: "slow_down", interval: 5 }]);
      expect(slow.response.headers.get("cache-control")).toBe("no-store");

      await approveFlow(started);
      // Approval mints nothing; the session appears at redemption.
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM session WHERE app_id = ?`).get(app.id)).toEqual({ n: 1 });

      later(5_000);
      const approved = await poll(started.deviceCode);
      expect(approved.status).toBe(200);
      expect(approved.body).toEqual({ status: "approved", sessionToken: expect.any(String) });
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM session WHERE app_id = ?`).get(app.id)).toEqual({ n: 2 });

      later(5_000);
      expect(await poll(started.deviceCode).then((r) => [r.status, r.body])).toEqual([400, { error: "invalid_device_code" }]);
    });

    it("redeems once when two polls race on an approved code", async () => {
      const { body: started } = await start();
      await approveFlow(started);
      later(5_000);
      const results = await Promise.all([poll(started.deviceCode), poll(started.deviceCode)]);
      const approved = results.filter((r) => r.body.status === "approved");
      expect(approved).toHaveLength(1);
      expect(results.find((r) => r !== approved[0])!.status).toBeGreaterThanOrEqual(400);
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM session WHERE app_id = ?`).get(app.id)).toEqual({ n: 2 });
    });

    it("does not expose the server-only redeem endpoint over HTTP on any host", async () => {
      const { body: started } = await start();
      const body = { deviceCode: started.deviceCode, publishableKey: app.publishableKey };
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/kova/device/redeem`, json(body))).status).toBe(404);
      expect((await h.fetch(`${hostOf(app)}/api/auth/kova/device/redeem`, json(body, { origin: hostOf(app) }))).status).toBe(404);
    });

    it("reports denied", async () => {
      const { body: started } = await start();
      await page(started.userCode);
      expect((await decide("deny", started.userCode)).status).toBe(200);
      expect(await poll(started.deviceCode).then((r) => [r.status, r.body])).toEqual([200, { status: "denied" }]);
    });

    it("reports expired after the 10-minute lifetime", async () => {
      const { body: started } = await start();
      later(601_000);
      expect(await poll(started.deviceCode).then((r) => [r.status, r.body])).toEqual([400, { error: "expired_token" }]);
    });

    it("rejects malformed bodies and user codes as poll secrets", async () => {
      const { body: started } = await start();
      expect((await poll("dvc_unknown")).body).toEqual({ error: "invalid_device_code" });
      const withUserCode = await h.fetch(`/api/pub/apps/${app.publishableKey}/device/poll`, json({ deviceCode: started.deviceCode, userCode: started.userCode }));
      expect([withUserCode.status, await withUserCode.json()]).toEqual([400, { error: "invalid_device_code" }]);
      const noBody = await h.fetch(`/api/pub/apps/${app.publishableKey}/device/poll`, { method: "POST" });
      expect(noBody.status).toBe(400);
    });

    it("never lets app B redeem app A's code", async () => {
      const appB = h.createApp({ name: "Other" });
      const { body: started } = await start();
      await approveFlow(started);
      later(5_000);
      expect(await poll(started.deviceCode, appB).then((r) => [r.status, r.body])).toEqual([400, { error: "invalid_device_code" }]);
      // B's attempt neither consumed the code nor counted as A's poll.
      expect((await poll(started.deviceCode)).body).toMatchObject({ status: "approved" });
    });

    it("mints an app-scoped session that works with the key and not on platform routes", async () => {
      const { body: started } = await start();
      await approveFlow(started);
      later(5_000);
      const { body } = await poll(started.deviceCode);
      const token = String(body.sessionToken);

      expect(h.sqlite.prepare(`SELECT app_id, userId FROM session WHERE token = ?`).get(token)).toEqual({ app_id: app.id, userId: user.id });
      expect(h.sqlite.prepare(`SELECT 1 AS member FROM app_user WHERE app_id = ? AND user_id = ?`).get(app.id, user.id)).toEqual({ member: 1 });

      const session = await h.fetch(`/api/auth/get-session`, { headers: { authorization: `Bearer ${token}`, "X-Publishable-Key": app.publishableKey } });
      expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id);

      const admin = await h.fetch(`/api/admin/users`, { headers: { authorization: `Bearer ${token}` } });
      expect(admin.status).toBe(403);
      const apiKeys = await h.fetch(`/api/auth/api-key/list`, { headers: { authorization: `Bearer ${token}` } });
      expect(apiKeys.status).toBe(403);
    });

    it("refuses the stock /device/token for app codes, so no platform session can be minted", async () => {
      const { body: started } = await start();
      await approveFlow(started);
      later(5_000);
      const auth = createAuth(h.env);
      await expect(auth.api.deviceToken({
        body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: started.deviceCode, client_id: app.publishableKey },
      })).rejects.toMatchObject({ body: expect.objectContaining({ error: "invalid_grant" }) });
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM session WHERE app_id IS NULL`).get()).toEqual({ n: 0 });

      const tokenBody = json({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: started.deviceCode, client_id: app.publishableKey });
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/device/token`, tokenBody)).status).toBe(404);
      expect((await h.fetch(`${hostOf(app)}/api/auth/device/token`, json({ device_code: started.deviceCode }, { origin: hostOf(app) }))).status).toBe(404);
      // The code is untouched and still redeems the right way.
      expect((await poll(started.deviceCode)).body).toMatchObject({ status: "approved" });
    });
  });

  describe("POST /:pk/device/cancel", () => {
    it("drops the caller's own code and nobody else's", async () => {
      const appB = h.createApp();
      const { body: started } = await start();
      const otherKey = await h.fetch(`/api/pub/apps/${appB.publishableKey}/device/cancel`, json({ deviceCode: started.deviceCode }));
      expect(otherKey.status).toBe(204);
      expect((await poll(started.deviceCode)).body).toEqual({ status: "pending", interval: 5 });

      const cancelled = await h.fetch(`/api/pub/apps/${app.publishableKey}/device/cancel`, json({ deviceCode: started.deviceCode }));
      expect(cancelled.status).toBe(204);
      later(5_000);
      expect((await poll(started.deviceCode)).body).toEqual({ error: "invalid_device_code" });
      expect((await page(started.userCode)).html).toContain("Code not recognized");
    });
  });

  describe("hosted /device page", () => {
    it("shows the manual entry form without a code, and a format error for a bad one", async () => {
      const empty = await h.fetch(`${hostOf(app)}/device`);
      const html = await empty.text();
      expect(empty.status).toBe(200);
      expect(html).toContain('action="/device"');
      expect(html).toContain('name="code"');
      const bad = await page("NOPE");
      expect(bad.html).toContain("Codes are 8 letters and numbers");
    });

    it("refuses to be framed: device page, its sign-in step, and the switch-account sign-in", async () => {
      const { body: started } = await start();
      const urls = [
        [`${hostOf(app)}/device?code=${started.userCode}`, hostedCookie],
        [`${hostOf(app)}/device`, hostedCookie],
        [`${hostOf(app)}/device?code=${started.userCode}`, ""],
        [`${hostOf(app)}/sign-in?device_return=${encodeURIComponent(`/device?code=${started.userCode}`)}`, ""],
      ] as const;
      for (const [url, cookie] of urls) {
        const response = await h.fetch(url, { headers: cookie ? { cookie } : {} });
        expect(response.headers.get("x-frame-options"), url).toBe("DENY");
        expect(response.headers.get("content-security-policy"), url).toBe("frame-ancestors 'none'");
      }
    });

    it("brands the page the way the hosted sign-in does", async () => {
      const ralph = h.createApp({ name: "Ralph", publishableKey: RALPH_PUBLISHABLE_KEY });
      const html = await (await h.fetch(`${hostOf(ralph)}/device`)).text();
      expect(html).toContain("--primary: #5865f2;");
      expect(html).toContain("--bg: #070709;");
      expect(html).toContain('class="logo mark"');
      expect(html).toContain("Secured by Kova");
      h.sqlite.prepare(`UPDATE application SET hide_branding = 1 WHERE id = ?`).run(app.id);
      expect(await (await h.fetch(`${hostOf(app)}/device`)).text()).not.toContain("Secured by Kova");
    });

    it("sends a signed-out visitor through hosted sign-in that returns to this code", async () => {
      const { body: started } = await start();
      const { status, html } = await page(started.userCode, "");
      expect(status).toBe(200);
      expect(html).toContain("__KOVA_AUTH_HOSTED__");
      expect(html).toContain(`"returnPath":"/device?code=${started.userCode}"`);
    });

    it("claims the code and shows app, device, requester, code, and account; accepts lowercase without the dash", async () => {
      const { body: started } = await start();
      const { status, html } = await page(started.userCode.replace("-", "").toLowerCase());
      expect(status).toBe(200);
      expect(html).toContain("<title>Sign in to Ralph Meet?</title>");
      expect(html).toContain("Ralph Meet · Windows");
      expect(html).toContain("ada-laptop");
      expect(html).toContain("Reported by the device");
      expect(html).toContain(started.userCode);
      expect(html).toContain("ada@example.com");
      expect(html).toContain("203.0.113.7");
      expect(html).toContain("/sign-in?device_return=");
      expect(html).not.toContain(started.deviceCode);
      expect(h.sqlite.prepare(`SELECT userId FROM deviceCode WHERE deviceCode = ?`).get(started.deviceCode)).toEqual({ userId: user.id });
    });

    it("shows used, expired, and claimed-elsewhere states", async () => {
      const { body: used } = await start();
      await approveFlow(used);
      expect((await page(used.userCode)).html).toContain("Code already used");

      const { body: other } = await start();
      const otherUser = h.createUser({ email: "bob@example.com" });
      const bobCookie = (await h.createSession(otherUser.id)).cookie;
      await page(other.userCode, bobCookie);
      expect((await page(other.userCode)).html).toContain("Code in use");

      // Bob steps aside ("use another account"); Ada can then review it.
      const release = await h.fetch(`${hostOf(app)}/api/hosted/device/release`, json({ userCode: other.userCode }, { cookie: bobCookie, origin: hostOf(app) }));
      expect(release.status).toBe(204);
      expect((await page(other.userCode)).html).toContain("Approve");

      const { body: stale } = await start();
      later(601_000);
      const expired = await page(stale.userCode);
      expect(expired.status).toBe(410);
      expect(expired.html).toContain("Code expired");
    });

    it("refuses approve and deny from an account that did not claim the code", async () => {
      const { body: started } = await start();
      await page(started.userCode); // Ada claims it
      const bob = h.createUser({ email: "bob@example.com" });
      const bobCookie = (await h.createSession(bob.id)).cookie;
      expect((await decide("approve", started.userCode, { cookie: bobCookie })).status).toBe(403);
      expect((await decide("deny", started.userCode, { cookie: bobCookie })).status).toBe(403);
      expect((await poll(started.deviceCode)).body).toEqual({ status: "pending", interval: 5 });
    });

    it("does not show or approve app A's code on app B's host", async () => {
      const appB = h.createApp({ name: "Other App" });
      const bCookie = (await h.createSession(user.id, { appId: appB.id })).cookie;
      const { body: started } = await start();
      const onB = await page(started.userCode, bCookie, appB);
      expect(onB.html).toContain("Code not recognized");
      expect(onB.html).not.toContain("Ralph Meet");
      expect((await decide("approve", started.userCode, { cookie: bCookie, target: appB })).status).toBe(400);
    });
  });

  describe("hosted /api/auth/device* guard", () => {
    let started: Started;
    beforeEach(async () => {
      started = (await start()).body;
      await page(started.userCode);
    });

    it("rejects a cross-origin approve, even from an origin another app registered", async () => {
      h.createApp({ name: "Evil", allowedOrigins: ["https://evil.example"] });
      const registeredElsewhere = await decide("approve", started.userCode, { origin: "https://evil.example" });
      expect(registeredElsewhere.status).toBe(403);
      const sibling = await decide("approve", started.userCode, { origin: "https://other.auth.115jon.site" });
      expect(sibling.status).toBe(403);
      const noOrigin = await h.fetch(`${hostOf(app)}/api/auth/device/approve`, json({ userCode: started.userCode }, { cookie: hostedCookie }));
      expect(noOrigin.status).toBe(403);
      expect((await poll(started.deviceCode)).body).toEqual({ status: "pending", interval: 5 });
    });

    it("needs the host guard: Better Auth's own origin check trusts any app's registered origin", async () => {
      h.createApp({ name: "Evil", allowedOrigins: ["https://evil.example"] });
      const auth = createAuth(h.env, undefined, undefined, hostOf(app));
      const direct = (origin: string) => auth.handler(new Request(`${hostOf(app)}/api/auth/device/deny`, json({ userCode: started.userCode }, { cookie: hostedCookie, origin })));
      // Unregistered origins are refused by Better Auth itself...
      expect((await direct("https://unknown.example")).status).toBe(403);
      // ...but trustedOrigins accepts an origin registered by any app, which is
      // why device-host-guard pins approve/deny to this host's own origin.
      expect((await direct("https://evil.example")).status).toBe(200);
    });

    it("rejects bearer sessions", async () => {
      const appToken = h.sqlite.prepare(`SELECT token FROM session WHERE app_id = ? LIMIT 1`).get(app.id) as { token: string };
      const response = await decide("approve", started.userCode, { cookie: "", authorization: `Bearer ${appToken.token}` });
      expect(response.status).toBe(401);
    });

    it("rejects a session minted for another app", async () => {
      const appB = h.createApp();
      const foreign = (await h.createSession(user.id, { appId: appB.id })).cookie;
      expect((await decide("approve", started.userCode, { cookie: foreign })).status).toBe(403);
    });

    it("lets this app's own hosted session and a plain hosted session through", async () => {
      const plain = (await h.createSession(user.id)).cookie;
      expect((await decide("approve", started.userCode, { cookie: plain })).status).toBe(200);
    });

    it("serves no device endpoint on the platform host", async () => {
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/device?user_code=${started.userCode}`, { headers: { cookie: hostedCookie } })).status).toBe(404);
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/device/approve`, json({ userCode: started.userCode }, { cookie: hostedCookie, origin: TEST_AUTH_URL }))).status).toBe(404);
      expect((await h.fetch(`${TEST_AUTH_URL}/api/auth/%64evice/approve`, json({ userCode: started.userCode }, { cookie: hostedCookie, origin: TEST_AUTH_URL }))).status).toBe(404);
    });
  });
});

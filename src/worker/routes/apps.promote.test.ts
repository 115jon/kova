/**
 * Promoting an app to production end to end: the new pk_live_ key, the old
 * key kept as a legacy alias everywhere a publishable key is accepted, the
 * secret rotation, refusal when already production, and retiring the alias.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApplicationByPublishableKey, validateSecretKey } from "../applications";
import { RALPH_APP_ID, RALPH_PUBLISHABLE_KEY, resolveHostedAppearance } from "../../shared/hosted-brand";
import { createHarness, TEST_SECRET, type Harness } from "../test-support/auth-harness";

type App = ReturnType<Harness["createApp"]>;

const T0 = new Date("2026-10-22T12:00:00.000Z").getTime();
const DESKTOP = "http://tauri.localhost";
const WEB = "https://meet.example";

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

function hostOf(app: App) {
  return `https://${app.authSlug}.auth.115jon.site`;
}

describe("promote to production", () => {
  let h: Harness;
  let app: App;
  let adminCookie: string;
  let user: { id: string };
  let hostedCookie: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: [DESKTOP, WEB] });
    h.sqlite.prepare(`UPDATE application SET redirect_uris = ?, environment = 'development' WHERE id = ?`).run(`${WEB}/`, app.id);
    const admin = h.createUser({ name: "Admin", email: "admin@example.com", role: "admin" });
    adminCookie = (await h.createSession(admin.id)).cookie;
    user = h.createUser({ name: "Ada Lovelace", email: "ada@example.com" });
    hostedCookie = (await h.createSession(user.id, { appId: app.id })).cookie;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function later(ms: number) {
    vi.setSystemTime(Date.now() + ms);
  }

  async function promote(id = app.id, cookie = adminCookie) {
    const response = await h.fetch(`/api/admin/apps/${id}/promote`, { method: "POST", headers: cookie ? { cookie } : {} });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  async function retire(id = app.id, cookie = adminCookie) {
    const response = await h.fetch(`/api/admin/apps/${id}/retire-legacy-key`, { method: "POST", headers: cookie ? { cookie } : {} });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  function row() {
    return h.sqlite.prepare(`SELECT environment, publishable_key, legacy_publishable_key, secret_key_hash FROM application WHERE id = ?`).get(app.id) as {
      environment: string; publishable_key: string; legacy_publishable_key: string | null; secret_key_hash: string;
    };
  }

  async function startDevice(pk: string) {
    const response = await h.fetch(`/api/pub/apps/${pk}/device/start`, json({ hostname: "ada-pc" }, { "CF-Connecting-IP": "203.0.113.7" }));
    expect(response.status).toBe(201);
    return (await response.json()) as { deviceCode: string; userCode: string };
  }

  async function pollDevice(pk: string, deviceCode: string) {
    const response = await h.fetch(`/api/pub/apps/${pk}/device/poll`, json({ deviceCode }));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function approveDevice(userCode: string) {
    expect((await h.fetch(`${hostOf(app)}/device?code=${encodeURIComponent(userCode)}`, { headers: { cookie: hostedCookie } })).status).toBe(200);
    const approved = await h.fetch(`${hostOf(app)}/api/auth/device/approve`, json({ userCode }, { origin: hostOf(app), cookie: hostedCookie }));
    expect(approved.status, await approved.clone().text()).toBe(200);
  }

  async function getSession(pk: string, token: string, origin?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, "X-Publishable-Key": pk };
    if (origin) headers.origin = origin;
    const response = await h.fetch(`/api/auth/get-session`, { headers });
    return { response, body: (await response.json()) as { user?: { id: string } } | null };
  }

  describe("POST /:id/promote", () => {
    it("issues a pk_live_ key, keeps the old key as legacy, and rotates the secret to sk_live_ once", async () => {
      const before = row();
      const { status, body } = await promote();
      expect(status).toBe(200);
      expect(body.app.environment).toBe("production");
      expect(body.app.publishable_key).toMatch(/^pk_live_[A-Za-z0-9_-]{43}$/);
      expect(body.app.legacy_publishable_key).toBe(app.publishableKey);
      expect(body.rawSecretKey).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);

      const after = row();
      expect(after).toMatchObject({ environment: "production", publishable_key: body.app.publishable_key, legacy_publishable_key: app.publishableKey });
      expect(after.secret_key_hash).not.toBe(before.secret_key_hash);
      expect(await validateSecretKey(h.db, app.id, body.rawSecretKey, TEST_SECRET)).toBe(true);
      // The raw secret is never stored.
      expect(JSON.stringify(after)).not.toContain(body.rawSecretKey);
    });

    it("clears the cached appearance under both keys", async () => {
      await h.kv.put(`appearance:${app.publishableKey}`, "{}");
      const { body } = await promote();
      await h.settle();
      expect(await h.kv.get(`appearance:${app.publishableKey}`)).toBeNull();
      expect(await h.kv.get(`appearance:${body.app.publishable_key}`)).toBeNull();
    });

    it("refuses an app that is already production, and changes nothing", async () => {
      await promote();
      const promoted = row();
      const again = await promote();
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("already_production");
      expect(row()).toEqual(promoted);
    });

    it("refuses an app whose origins or redirects a production app may not have", async () => {
      h.sqlite.prepare(`UPDATE application SET allowed_origins = ? WHERE id = ?`).run(["http://localhost:3000", DESKTOP].join("\n"), app.id);
      const refused = await promote();
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ code: "invalid_policy", error: expect.stringContaining("http://localhost:3000") });
      expect(row()).toMatchObject({ environment: "development", publishable_key: app.publishableKey, legacy_publishable_key: null });

      h.sqlite.prepare(`UPDATE application SET allowed_origins = ?, redirect_uris = '' WHERE id = ?`).run(DESKTOP, app.id);
      expect((await promote()).body.code).toBe("invalid_policy");
    });

    it("keeps the desktop webview origin valid in production", async () => {
      expect((await promote()).status).toBe(200);
      // A later settings save re-validates the whole list against production.
      const saved = await h.fetch(`/api/admin/apps/${app.id}`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Ralph Meet" }),
      });
      expect(saved.status).toBe(200);
    });

    it("is admin-only", async () => {
      const member = h.createUser({ email: "member@example.com" });
      const memberCookie = (await h.createSession(member.id)).cookie;
      expect((await promote(app.id, memberCookie)).status).toBe(403);
      expect((await promote(app.id, "")).status).toBe(403);
      expect((await retire(app.id, memberCookie)).status).toBe(403);
      expect(row().environment).toBe("development");
    });

    it("404s an unknown app", async () => {
      expect((await promote("app_nope")).status).toBe(404);
    });
  });

  describe("the legacy key", () => {
    it("resolves to the same app as the live key", async () => {
      const { body } = await promote();
      const byLegacy = await getApplicationByPublishableKey(h.db, app.publishableKey);
      const byLive = await getApplicationByPublishableKey(h.db, body.app.publishable_key);
      expect(byLegacy?.id).toBe(app.id);
      expect(byLive?.id).toBe(app.id);
      expect(byLegacy?.publishable_key).toBe(body.app.publishable_key);
    });

    it("serves the public appearance and redirect check", async () => {
      await promote();
      const appearance = await h.fetch(`/api/pub/apps/${app.publishableKey}/appearance`);
      expect(appearance.status).toBe(200);
      expect(((await appearance.json()) as { displayName: string }).displayName).toBe("Ralph Meet");
      const check = await h.fetch(`/api/pub/apps/${app.publishableKey}/redirect-check?redirect_uri=${encodeURIComponent(`${WEB}/chat`)}`);
      expect(await check.json()).toEqual({ allowed: true });
    });

    it("passes the CORS origin check under either key", async () => {
      const { body } = await promote();
      for (const pk of [app.publishableKey, body.app.publishable_key]) {
        const response = await h.fetch(`/api/pub/apps/${pk}/plan`, { headers: { origin: DESKTOP, "X-Publishable-Key": pk } });
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(DESKTOP);
      }
    });

    it("keeps a session minted before promotion working with either key", async () => {
      const started = await startDevice(app.publishableKey);
      await approveDevice(started.userCode);
      later(5_000);
      const { body: approved } = await pollDevice(app.publishableKey, started.deviceCode);
      const token = String(approved.sessionToken);

      const { body } = await promote();
      for (const pk of [app.publishableKey, body.app.publishable_key]) {
        const session = await getSession(pk, token, DESKTOP);
        expect(session.response.status).toBe(200);
        expect(session.body?.user?.id).toBe(user.id);
      }
    });

    it("redeems a device code started with the old key before promotion, from either key", async () => {
      const first = await startDevice(app.publishableKey);
      const second = await startDevice(app.publishableKey);
      const { body } = await promote();
      const live = body.app.publishable_key as string;

      await approveDevice(first.userCode);
      await approveDevice(second.userCode);
      later(5_000);

      const viaLegacy = await pollDevice(app.publishableKey, first.deviceCode);
      expect(viaLegacy.body).toEqual({ status: "approved", sessionToken: expect.any(String) });
      const viaLive = await pollDevice(live, second.deviceCode);
      expect(viaLive.body).toEqual({ status: "approved", sessionToken: expect.any(String) });
      expect(h.sqlite.prepare(`SELECT app_id FROM session WHERE token = ?`).get(String(viaLive.body.sessionToken))).toEqual({ app_id: app.id });

      // Still one redemption per code.
      later(5_000);
      expect((await pollDevice(live, first.deviceCode)).body).toEqual({ error: "invalid_device_code" });
    });

    it("starts, approves, and redeems a device code under the legacy key after promotion", async () => {
      const { body } = await promote();
      const started = await startDevice(app.publishableKey);
      const stored = h.sqlite.prepare(`SELECT clientId, appId FROM deviceCode WHERE deviceCode = ?`).get(started.deviceCode);
      expect(stored).toEqual({ clientId: body.app.publishable_key, appId: app.id });

      expect((await pollDevice(app.publishableKey, started.deviceCode)).body).toEqual({ status: "pending", interval: 5 });
      await approveDevice(started.userCode);
      later(5_000);
      const approved = await pollDevice(app.publishableKey, started.deviceCode);
      expect(approved.body).toMatchObject({ status: "approved" });
      const session = await getSession(app.publishableKey, String(approved.body.sessionToken));
      expect(session.body?.user?.id).toBe(user.id);
    });

    it("never lets another app redeem or cancel the promoted app's codes", async () => {
      const other = h.createApp({ name: "Other" });
      const started = await startDevice(app.publishableKey);
      await promote();
      await approveDevice(started.userCode);
      later(5_000);
      expect((await h.fetch(`/api/pub/apps/${other.publishableKey}/device/cancel`, json({ deviceCode: started.deviceCode }))).status).toBe(204);
      expect((await pollDevice(other.publishableKey, started.deviceCode)).body).toEqual({ error: "invalid_device_code" });
      expect((await pollDevice(app.publishableKey, started.deviceCode)).body).toMatchObject({ status: "approved" });
    });

    it("cancels a code from either key", async () => {
      const a = await startDevice(app.publishableKey);
      const { body } = await promote();
      const b = await startDevice(body.app.publishable_key);
      expect((await h.fetch(`/api/pub/apps/${body.app.publishable_key}/device/cancel`, json({ deviceCode: a.deviceCode }))).status).toBe(204);
      expect((await h.fetch(`/api/pub/apps/${app.publishableKey}/device/cancel`, json({ deviceCode: b.deviceCode }))).status).toBe(204);
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM deviceCode`).get()).toEqual({ n: 0 });
    });

    it("exchanges an SDK transfer code minted under one key at the other", async () => {
      const { body } = await promote();
      const live = body.app.publishable_key as string;
      const platform = (await h.createSession(user.id)).cookie;
      const bounce = await h.fetch(
        `/api/hosted/oauth-complete?mode=sdk&pk=${encodeURIComponent(app.publishableKey)}&redirect_uri=${encodeURIComponent(`${WEB}/chat`)}`,
        { headers: { cookie: platform } },
      );
      expect(bounce.status, await bounce.clone().text()).toBe(302);
      const code = new URL(bounce.headers.get("location")!).searchParams.get("kova_auth_code")!;
      expect(code).toMatch(/^xfr_/);

      const exchanged = await h.fetch(`/api/pub/apps/${live}/exchange-code`, json({ code }, { origin: WEB }));
      expect(exchanged.status).toBe(200);
      const { sessionToken } = (await exchanged.json()) as { sessionToken: string };
      expect((await getSession(live, sessionToken, WEB)).body?.user?.id).toBe(user.id);
    });
  });

  describe("POST /:id/retire-legacy-key", () => {
    it("stops accepting the old key and keeps the live one", async () => {
      const { body } = await promote();
      const live = body.app.publishable_key as string;
      await h.kv.put(`appearance:${app.publishableKey}`, "{}");

      const retired = await retire();
      expect(retired.status).toBe(200);
      expect(retired.body.app).toMatchObject({ publishable_key: live, legacy_publishable_key: null, environment: "production" });
      await h.settle();
      expect(await h.kv.get(`appearance:${app.publishableKey}`)).toBeNull();

      expect(await getApplicationByPublishableKey(h.db, app.publishableKey)).toBeNull();
      expect((await h.fetch(`/api/pub/apps/${app.publishableKey}/appearance`)).status).toBe(404);
      expect((await h.fetch(`/api/pub/apps/${app.publishableKey}/device/start`, json({}))).status).toBe(404);
      expect((await h.fetch(`/api/pub/apps/${live}/device/start`, json({}))).status).toBe(201);
    });

    it("409s when there is no legacy key, and 404s an unknown app", async () => {
      expect((await retire()).status).toBe(409);
      expect((await retire("app_nope")).status).toBe(404);
    });
  });
});

describe("Ralph brand defaults", () => {
  const input = { primaryColor: "#3b82f6", backgroundColor: "#0a0a0a", theme: "dark", logoUrl: null, faviconUrl: null };

  it("match Ralph by app id or by either key, before and after promotion", () => {
    const ralph = (subject: Parameters<typeof resolveHostedAppearance>[0]) => resolveHostedAppearance(subject, input).brandMark;
    expect(ralph(RALPH_PUBLISHABLE_KEY)).toBe("ralph-radio");
    expect(ralph({ id: RALPH_APP_ID, publishable_key: RALPH_PUBLISHABLE_KEY, legacy_publishable_key: null })).toBe("ralph-radio");
    expect(ralph({ id: RALPH_APP_ID, publishable_key: "pk_live_new", legacy_publishable_key: RALPH_PUBLISHABLE_KEY })).toBe("ralph-radio");
    expect(ralph({ id: RALPH_APP_ID, publishable_key: "pk_live_new", legacy_publishable_key: null })).toBe("ralph-radio");
  });

  it("leave other apps alone", () => {
    expect(resolveHostedAppearance("pk_live_other", input)).toEqual(input);
    expect(resolveHostedAppearance({ id: "app_other", publishable_key: "pk_live_other", legacy_publishable_key: "pk_dev_other" }, input)).toEqual(input);
  });

  it("let an uploaded logo win over the radio mark", () => {
    const out = resolveHostedAppearance({ id: RALPH_APP_ID, publishable_key: "pk_live_new" }, { ...input, logoUrl: "https://cdn.example/logo.svg" });
    expect(out.brandMark).toBeUndefined();
    expect(out.logoUrl).toBe("https://cdn.example/logo.svg");
    expect(out.primaryColor).toBe("#5865f2");
  });

  it("brand the hosted device page for the promoted Ralph app by id", async () => {
    const h = createHarness();
    const ralph = h.createApp({ id: RALPH_APP_ID, name: "Ralph", publishableKey: "pk_live_promoted" });
    const html = await (await h.fetch(`https://${ralph.authSlug}.auth.115jon.site/device`)).text();
    expect(html).toContain("--primary: #5865f2;");
  });
});

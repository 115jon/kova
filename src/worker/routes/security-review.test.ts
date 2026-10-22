/**
 * Fixes from the security review of promotion and device approval:
 *   1. get-session never turns a cookie into an app token for the desktop shell's origin
 *   3. PATCH /:id cannot land settings validated under the old environment after a promotion
 *   4. device verification URLs: never tauri.localhost, no loopback in production
 *   5. suspend / retire clear the per-key CORS decisions in KV
 */
import { describe, expect, it } from "vitest";
import { ApplicationConflictError, isValidDeviceVerificationUri, updateApplication } from "../applications";
import { createHarness } from "../test-support/auth-harness";

const WEB = "https://meet.example";
const DESKTOP = "http://tauri.localhost";

describe("get-session with a publishable key", () => {
  async function setup() {
    const h = createHarness();
    const app = h.createApp({ allowedOrigins: [WEB, DESKTOP, "https://tauri.localhost"] });
    const user = h.createUser();
    return { h, app, user };
  }

  it("does not mint an app token from a cookie for the desktop shell origin, on either scheme", async () => {
    const { h, app, user } = await setup();
    const { cookie } = await h.createSession(user.id);
    for (const origin of [DESKTOP, "https://tauri.localhost"]) {
      const response = await h.fetch(`/api/auth/get-session`, { headers: { cookie, origin, "X-Publishable-Key": app.publishableKey } });
      expect([origin, response.status, await response.json()]).toEqual([origin, 200, null]);
    }
    expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM session WHERE app_id = ?`).get(app.id)).toEqual({ n: 0 });

    // The same cookie from the app's web origin still gets its app session.
    const web = await h.fetch(`/api/auth/get-session`, { headers: { cookie, origin: WEB, "X-Publishable-Key": app.publishableKey } });
    expect(((await web.json()) as { user: { id: string } }).user.id).toBe(user.id);
  });

  it("still answers the desktop shell's bearer", async () => {
    const { h, app, user } = await setup();
    const { token } = await h.createSession(user.id, { appId: app.id });
    const response = await h.fetch(`/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}`, origin: DESKTOP, "X-Publishable-Key": app.publishableKey },
    });
    expect(((await response.json()) as { user: { id: string } }).user.id).toBe(user.id);
  });
});

describe("PATCH racing a promotion", () => {
  it("refuses a write when the environment changed after validation", async () => {
    const h = createHarness();
    const app = h.createApp({ allowedOrigins: [WEB] });
    h.sqlite.prepare(`UPDATE application SET environment = 'production' WHERE id = ?`).run(app.id);
    await expect(updateApplication(h.db, app.id, { name: "X" }, undefined, "development")).rejects.toBeInstanceOf(ApplicationConflictError);
    expect(h.sqlite.prepare(`SELECT name FROM application WHERE id = ?`).get(app.id)).toEqual({ name: "Ralph Meet" });
    expect(await updateApplication(h.db, "app_missing", { name: "X" }, undefined, "development")).toBeNull();
    expect((await updateApplication(h.db, app.id, { name: "Y" }, undefined, "production"))?.name).toBe("Y");
  });

  it("answers 409 conflict when a promotion lands between validation and write", async () => {
    const h = createHarness();
    const app = h.createApp({ allowedOrigins: [WEB, "http://localhost:3000"] });
    h.sqlite.prepare(`UPDATE application SET environment = 'development', redirect_uris = ? WHERE id = ?`).run(`${WEB}/`, app.id);
    const admin = h.createUser({ email: "admin@example.com", role: "admin" });
    const { cookie } = await h.createSession(admin.id);

    // Promote right before the settings UPDATE runs, after the route validated under development.
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = ((sql: string) => {
      if (/^UPDATE application SET updatedAt/.test(sql.trim())) {
        h.sqlite.prepare(`UPDATE application SET environment = 'production' WHERE id = ?`).run(app.id);
      }
      return prepare(sql);
    }) as typeof h.db.prepare;

    const response = await h.fetch(`/api/admin/apps/${app.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ device_verification_uri: "http://localhost:3000/activate" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", message: expect.stringContaining("promoted") });
    expect(h.sqlite.prepare(`SELECT device_verification_uri FROM application WHERE id = ?`).get(app.id)).toEqual({ device_verification_uri: null });
  });
});

describe("device verification URL hosts", () => {
  it("never accepts the desktop shell", () => {
    for (const environment of ["development", "production"] as const) {
      expect(isValidDeviceVerificationUri("https://tauri.localhost/activate", environment)).toBe(false);
      expect(isValidDeviceVerificationUri("http://tauri.localhost/activate", environment)).toBe(false);
      expect(isValidDeviceVerificationUri("https://TAURI.localhost/activate", environment)).toBe(false);
    }
  });

  it("refuses loopback hosts for production apps", () => {
    for (const uri of ["https://localhost/activate", "https://app.localhost/activate", "https://127.0.0.1/activate", "https://127.1.2.3:8443/activate", "https://[::1]/activate", "http://localhost:3000/activate"]) {
      expect([uri, isValidDeviceVerificationUri(uri, "production")]).toEqual([uri, false]);
    }
    expect(isValidDeviceVerificationUri("https://meet.example/activate", "production")).toBe(true);
  });

  it("keeps localhost for development apps", () => {
    expect(isValidDeviceVerificationUri("http://localhost:3000/activate", "development")).toBe(true);
    expect(isValidDeviceVerificationUri("https://localhost:3000/activate", "development")).toBe(true);
    expect(isValidDeviceVerificationUri("http://127.0.0.1:3000/activate", "development")).toBe(false);
  });
});

describe("CORS cache invalidation", () => {
  async function setup() {
    const h = createHarness();
    const app = h.createApp({ allowedOrigins: [WEB, DESKTOP] });
    h.sqlite.prepare(`UPDATE application SET legacy_publishable_key = 'pk_dev_legacy' WHERE id = ?`).run(app.id);
    const admin = h.createUser({ email: "admin@example.com", role: "admin" });
    const { cookie } = await h.createSession(admin.id);
    const keys = [app.publishableKey, "pk_dev_legacy"].flatMap((pk) => [WEB, DESKTOP].map((origin) => `cors:pk-origin:${pk}:${origin}`));
    for (const key of keys) await h.kv.put(key, "1");
    await h.kv.put("cors:pk-origin:pk_other:https://meet.example", "1");
    return { h, app, cookie, keys };
  }

  it("suspend deletes the per-key decisions for every key and allowed origin", async () => {
    const { h, app, cookie, keys } = await setup();
    expect((await h.fetch(`/api/admin/apps/${app.id}/suspend`, { method: "POST", headers: { cookie } })).status).toBe(200);
    await h.settle();
    for (const key of keys) expect([key, await h.kv.get(key)]).toEqual([key, null]);
    expect(await h.kv.get("cors:pk-origin:pk_other:https://meet.example")).toBe("1");
  });

  it("retiring the legacy key deletes its decisions too", async () => {
    const { h, app, cookie, keys } = await setup();
    expect((await h.fetch(`/api/admin/apps/${app.id}/retire-legacy-key`, { method: "POST", headers: { cookie } })).status).toBe(200);
    await h.settle();
    for (const key of keys) expect([key, await h.kv.get(key)]).toEqual([key, null]);
  });
});

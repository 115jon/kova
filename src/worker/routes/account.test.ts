/**
 * The end-user account API on both mounts, end to end through the worker:
 * a user sees and revokes only their own sessions, and never tokens or IPs.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test-support/auth-harness";
import type { AccountEvent, AccountSession } from "./account";

const WEB = "https://meet.example";

describe("account API", () => {
  let h: Harness;
  let app: ReturnType<Harness["createApp"]>;
  let user: { id: string };
  let other: { id: string };

  beforeEach(() => {
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: [WEB] });
    user = h.createUser({ email: "ada@example.com" });
    other = h.createUser({ email: "grace@example.com" });
  });

  const pub = (path: string, token: string, init: RequestInit = {}) =>
    h.fetch(`/api/pub/apps/${app.publishableKey}/account${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, origin: WEB, "content-type": "application/json", ...init.headers },
    });

  const sessionIds = (userId: string) =>
    (h.sqlite.prepare("SELECT id FROM session WHERE userId = ? ORDER BY id").all(userId) as { id: string }[]).map((row) => row.id);

  function audit(userId: string, action: string, createdAt: number, extra: { ip?: string; appId?: string } = {}) {
    h.sqlite.prepare(
      "INSERT INTO audit_log (id, userId, actor, action, ipAddress, userAgent, metadata, appId, country, city, createdAt) VALUES (?, ?, ?, ?, ?, 'UA', ?, ?, 'US', 'Austin', ?)",
    ).run(
      `${createdAt}_${crypto.randomUUID()}`, userId, userId, action, extra.ip ?? "203.0.113.7",
      JSON.stringify({ client: { browser: "Safari", os: "iOS", platform: "mobile", inApp: null, browserVersion: "18" }, geo: { colo: "DFW" } }),
      extra.appId ?? null, createdAt,
    );
  }

  it("lists only the caller's own unexpired sessions, without tokens or IPs, marking the current one", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const browser = await h.createSession(user.id);
    await h.createSession(other.id);
    h.sqlite.prepare("UPDATE session SET ipAddress = '203.0.113.7', userAgent = ?, country = 'US', city = 'Austin' WHERE id = ?")
      .run("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", browser.id);
    h.sqlite.prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES ('expired', ?, 'tok_expired', ?, ?, ?)")
      .run(user.id, new Date(Date.now() - 1000).toISOString(), new Date().toISOString(), new Date().toISOString());

    const response = await pub("/sessions", appSession.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("tok_");
    expect(text).not.toContain("203.0.113.7");
    const { sessions } = JSON.parse(text) as { sessions: AccountSession[] };
    expect(sessions.map((s) => s.id).sort()).toEqual([appSession.id, browser.id].sort());
    expect(sessions.find((s) => s.id === appSession.id)).toMatchObject({ current: true, appName: "Ralph Meet" });
    expect(sessions.find((s) => s.id === browser.id)).toMatchObject({
      current: false, appName: null, country: "US", city: "Austin", client: { browser: "Safari", os: "macOS" },
    });
  });

  it("returns the caller's own security activity only, paged, without IPs or extra metadata", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const t = Date.now() - 10_000;
    audit(user.id, "user.signIn", t, { appId: app.id });
    audit(user.id, "apiKey.created", t + 1);
    audit(user.id, "session.revoked", t + 2);
    audit(user.id, "security.signInAlertSent", t + 2);
    audit(other.id, "user.signIn", t + 3);

    const first = await pub("/activity?limit=2", appSession.token);
    const page1 = (await first.json()) as { events: AccountEvent[]; nextCursor: string | null };
    expect(page1.events.map((e) => e.action).sort()).toEqual(["security.signInAlertSent", "session.revoked"]);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const second = await pub(`/activity?limit=2&before=${encodeURIComponent(page1.nextCursor!)}`, appSession.token);
    const page2 = (await second.json()) as { events: AccountEvent[]; nextCursor: string | null };
    expect(page2.events).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(page2.events[0]).toEqual({
      id: expect.any(String),
      action: "user.signIn",
      createdAt: t,
      appName: "Ralph Meet",
      country: "US",
      city: "Austin",
      client: { browser: "Safari", os: "iOS", platform: "mobile", inApp: null },
    });
    expect(JSON.stringify(page2)).not.toContain("203.0.113.7");
  });

  it("leaves out sign-ins still waiting on the second factor", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const t = Date.now() - 10_000;
    audit(user.id, "user.signIn", t);
    h.sqlite.prepare("INSERT INTO audit_log (id, userId, actor, action, metadata, createdAt) VALUES (?, ?, ?, 'user.signIn', ?, ?)")
      .run(`${t + 1}_pending`, user.id, user.id, JSON.stringify({ method: "password", twoFactorPending: true }), t + 1);

    const { events } = (await (await pub("/activity", appSession.token)).json()) as { events: AccountEvent[] };

    expect(events.map((e) => e.createdAt)).toEqual([t]);
  });

  it("cannot revoke another user's session", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const victim = await h.createSession(other.id);

    const response = await pub("/sessions/revoke", appSession.token, { method: "POST", body: JSON.stringify({ sessionId: victim.id }) });

    expect(response.status).toBe(404);
    expect(sessionIds(other.id)).toEqual([victim.id]);
  });

  it("revokes one of the caller's sessions and logs session.revoked by the user", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const browser = await h.createSession(user.id);
    await h.kv.put(browser.token, "{}");

    const response = await pub("/sessions/revoke", appSession.token, { method: "POST", body: JSON.stringify({ sessionId: browser.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sessionIds(user.id)).toEqual([appSession.id]);
    expect(await h.kv.get(browser.token)).toBeNull();
    const row = h.sqlite.prepare("SELECT actor, targetId, metadata FROM audit_log WHERE action = 'session.revoked'").get() as { actor: string; targetId: string; metadata: string };
    expect(row).toMatchObject({ actor: user.id, targetId: browser.id });
    expect(JSON.parse(row.metadata)).toMatchObject({ by: "user" });
  });

  it("revokes every other session of the caller and keeps the current one", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    await h.createSession(user.id);
    await h.createSession(user.id);
    const bystander = await h.createSession(other.id);

    const response = await pub("/sessions/revoke-others", appSession.token, { method: "POST" });

    expect(await response.json()).toEqual({ ok: true, revoked: 2 });
    expect(sessionIds(user.id)).toEqual([appSession.id]);
    expect(sessionIds(other.id)).toEqual([bystander.id]);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.revokeAll'").get()).toEqual({ n: 1 });
  });

  it("refuses unauthenticated callers, other apps' tokens, and foreign origins", async () => {
    const otherApp = h.createApp({ name: "Other", allowedOrigins: ["https://other.example"] });
    const foreignToken = await h.createSession(user.id, { appId: otherApp.id });
    const appSession = await h.createSession(user.id, { appId: app.id });

    expect((await pub("/sessions", "not-a-token")).status).toBe(401);
    expect((await pub("/sessions", foreignToken.token)).status).toBe(401);
    expect((await pub("/sessions", appSession.token, { headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("passes CORS preflight for the SDK's bearer + publishable-key POST from the app's origin", async () => {
    const response = await h.fetch(`/api/pub/apps/${app.publishableKey}/account/sessions/revoke`, {
      method: "OPTIONS",
      headers: {
        origin: WEB,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, x-publishable-key",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    const allowed = response.headers.get("access-control-allow-headers")!.toLowerCase();
    for (const header of ["authorization", "content-type", "x-publishable-key"]) expect(allowed).toContain(header);
  });

  it("answers an omit-credentials bearer request from the app's origin with CORS headers", async () => {
    const appSession = await h.createSession(user.id, { appId: app.id });
    const response = await pub("/sessions", appSession.token, { headers: { "x-publishable-key": app.publishableKey } });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  describe("hosted mount", () => {
    const hosted = (path: string, init: RequestInit = {}) =>
      h.fetch(`https://${app.authSlug}.auth.115jon.site${path}`, init);

    it("serves the same API from the subdomain session cookie", async () => {
      const session = await h.createSession(user.id, { appId: app.id });
      await h.createSession(other.id);

      const response = await hosted("/api/account/sessions", { headers: { cookie: session.cookie } });

      expect(response.status).toBe(200);
      const { sessions } = (await response.json()) as { sessions: AccountSession[] };
      expect(sessions).toEqual([expect.objectContaining({ id: session.id, current: true })]);
      expect((await hosted("/api/account/sessions")).status).toBe(401);
    });

    it("/account sends a signed-out visitor to sign in and back", async () => {
      const response = await hosted("/account", { redirect: "manual" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/sign-in?device_return=%2Faccount");
      const signIn = await hosted("/sign-in?device_return=%2Faccount");
      expect(signIn.status).toBe(200);
      expect(await signIn.text()).toContain('"returnPath":"/account"');
    });

    it("/account renders the hosted shell in account mode with the user", async () => {
      h.sqlite.prepare("UPDATE application SET home_url = 'https://meet.example/home' WHERE id = ?").run(app.id);
      const session = await h.createSession(user.id, { appId: app.id });

      const response = await hosted("/account", { headers: { cookie: session.cookie } });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('"page":"account"');
      expect(html).toContain("<title>Account — Ralph Meet</title>");
      expect(html).toContain("load your account");
      expect(html).toContain('"accountApiBase":"/api/account"');
      expect(html).toContain('"email":"ada@example.com"');
      expect(html).toContain('"homeUrl":"https://meet.example/home"');
      expect(html).not.toContain('"homeUrl":"/account"');
    });
  });
});

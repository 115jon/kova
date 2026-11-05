/**
 * /api/auth/* through the real worker and Better Auth: sliding refresh of app
 * bearer sessions, bearer sign-out never touching the browser's SSO session,
 * failed-sign-in auditing, and the sign-in alert wiring.
 */
import { generateSignedCookie } from "hono/cookie";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_SESSION_TTL_MS } from "../lib/app-session";
import { createHarness, type Harness, SESSION_COOKIE, TEST_SECRET } from "../test-support/auth-harness";

const WEB = "https://meet.example";
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "Correct-Horse-9-Battery";

describe("/api/auth through the worker", () => {
  let h: Harness;
  let app: ReturnType<Harness["createApp"]>;
  let user: { id: string };

  beforeEach(() => {
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: [WEB] });
    user = h.createUser({ email: "ada@example.com" });
  });

  afterEach(() => vi.unstubAllGlobals());

  describe("bearer get-session sliding refresh", () => {
    const getSession = (token: string) =>
      h.fetch("/api/auth/get-session", {
        headers: { authorization: `Bearer ${token}`, origin: WEB, "x-publishable-key": app.publishableKey },
      });
    const row = (id: string) => h.sqlite.prepare("SELECT expiresAt, updatedAt FROM session WHERE id = ?").get(id) as { expiresAt: string; updatedAt: string };

    it("extends an app session to 30 days when it was last refreshed a day or more ago", async () => {
      const session = await h.createSession(user.id, { appId: app.id });
      const stale = new Date(Date.now() - 2 * DAY).toISOString();
      h.sqlite.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE id = ?").run(stale, new Date(Date.now() + DAY).toISOString(), session.id);

      const before = Date.now();
      const body = (await (await getSession(session.token)).json()) as { session: { expiresAt: string } };
      await h.settle();

      const stored = row(session.id);
      expect(typeof stored.expiresAt).toBe("string");
      expect(Date.parse(stored.expiresAt)).toBeGreaterThanOrEqual(before + APP_SESSION_TTL_MS);
      expect(Date.parse(stored.updatedAt)).toBeGreaterThanOrEqual(before);
      expect(body.session.expiresAt).toBe(stored.expiresAt);
      expect(APP_SESSION_TTL_MS).toBe(30 * DAY);
    });

    it("leaves a session refreshed within the last day alone", async () => {
      const session = await h.createSession(user.id, { appId: app.id });
      const original = row(session.id);

      await getSession(session.token);
      await h.settle();

      expect(row(session.id)).toEqual(original);
    });
  });

  it("a bearer sign-out carrying the browser's multi-session cookies keeps the browser's session", async () => {
    const browser = await h.createSession(user.id);
    const appToken = await h.fetch(`/api/pub/apps/${app.publishableKey}/session-token`, {
      method: "POST",
      headers: { cookie: browser.cookie, origin: WEB, "x-publishable-key": app.publishableKey },
    }).then((r) => r.json() as Promise<{ sessionToken: string }>);
    const multi = (await generateSignedCookie(`${SESSION_COOKIE}_multi-${browser.token.toLowerCase()}`, browser.token, TEST_SECRET, { secure: true, path: "/" })).split(";")[0]!;

    const response = await h.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: {
        authorization: `Bearer ${appToken.sessionToken}`,
        cookie: `${browser.cookie}; ${multi}`,
        origin: WEB,
        "x-publishable-key": app.publishableKey,
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(h.sqlite.prepare("SELECT id FROM session WHERE id = ?").get(browser.id)).toEqual({ id: browser.id });
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE token = ?").get(appToken.sessionToken)).toEqual({ n: 0 });
  });

  describe("password sign-in auditing", () => {
    beforeEach(async () => {
      const now = new Date().toISOString();
      h.sqlite.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
        .run(`acc_${user.id}`, user.id, user.id, await hashPassword(PASSWORD), now, now);
    });

    const signIn = (email: string, password: string) =>
      h.fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://auth.115jon.site",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({ email, password }),
      });
    const actions = () => (h.sqlite.prepare("SELECT action, userId FROM audit_log ORDER BY createdAt").all() as Array<{ action: string; userId: string }>);

    it("logs user.signInFailed for a wrong password on an existing user", async () => {
      const response = await signIn("ada@example.com", "Wrong-Password-1");

      expect(response.status).toBe(401);
      expect(actions()).toEqual([{ action: "user.signInFailed", userId: user.id }]);
    });

    it("logs nothing for an unknown email", async () => {
      const response = await signIn("nobody@example.com", "Wrong-Password-1");

      expect(response.status).toBe(401);
      expect(actions()).toEqual([]);
    });

    it("attributes a failed 2FA challenge to the signed-in user from the session cookie", async () => {
      h.sqlite.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').run(user.id);
      const browser = await h.createSession(user.id);

      const response = await h.fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://auth.115jon.site", cookie: browser.cookie },
        body: JSON.stringify({ code: "000000" }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(actions()).toEqual([{ action: "twoFactor.challengeFailed", userId: user.id }]);
    });

    describe("users with 2FA", () => {
      let sent: Array<{ to: string }>;
      beforeEach(() => {
        h.sqlite.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').run(user.id);
        h.sqlite.prepare("INSERT INTO audit_log (id, userId, actor, action, metadata, country, createdAt) VALUES (?, ?, ?, 'user.signIn', ?, 'US', ?)")
          .run(`${Date.now() - DAY}_x`, user.id, user.id, JSON.stringify({ client: { browser: "Safari", os: "iOS", platform: "mobile" } }), Date.now() - DAY);
        sent = [];
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
          sent.push(JSON.parse(String(init.body)));
          return Response.json({ id: "email_1" });
        }));
      });
      const latestSignIn = () =>
        JSON.parse((h.sqlite.prepare("SELECT metadata FROM audit_log WHERE action = 'user.signIn' ORDER BY createdAt DESC LIMIT 1").get() as { metadata: string }).metadata) as Record<string, unknown>;

      it("keeps the sign-in pending and sends no alert while the second factor is outstanding", async () => {
        const response = await signIn("ada@example.com", PASSWORD);
        await h.settle();

        expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
        expect(latestSignIn()).toMatchObject({ twoFactorPending: true });
        expect(sent).toEqual([]);
      });

      it("treats a trusted-device sign-in as complete: row not pending, alert considered", async () => {
        const identifier = `trust-device-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        h.sqlite.prepare("INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), identifier, user.id, new Date(Date.now() + DAY).toISOString(), now, now);
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const mac = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${user.id}!${identifier}`))).toString("base64url");
        const trust = (await generateSignedCookie("__Secure-better-auth.trust_device", `${mac}!${identifier}`, TEST_SECRET, { secure: true, path: "/" })).split(";")[0]!;

        const response = await h.fetch("/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://auth.115jon.site",
            cookie: trust,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ email: "ada@example.com", password: PASSWORD }),
        });
        await h.settle();

        const body = (await response.json()) as { twoFactorRedirect?: boolean; token?: string };
        expect(body.twoFactorRedirect).toBeUndefined();
        expect(latestSignIn()).not.toHaveProperty("twoFactorPending");
        expect(latestSignIn()).toMatchObject({ method: "password" });
        expect(sent).toEqual([expect.objectContaining({ to: "ada@example.com" })]);
      });
    });

    it("emails a sign-in alert, in the background, for a device the account has not used", async () => {
      h.sqlite.prepare("INSERT INTO audit_log (id, userId, actor, action, metadata, country, createdAt) VALUES (?, ?, ?, 'user.signIn', ?, 'US', ?)")
        .run(`${Date.now() - DAY}_x`, user.id, user.id, JSON.stringify({ client: { browser: "Safari", os: "iOS", platform: "mobile" } }), Date.now() - DAY);
      const sent: Array<{ to: string; subject: string }> = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ id: "email_1" });
      }));

      const response = await signIn("ada@example.com", PASSWORD);
      expect(response.status).toBe(200);
      await h.settle();

      expect(sent).toEqual([expect.objectContaining({ to: "ada@example.com", subject: "New sign-in to Kova" })]);
      expect(actions().map((row) => row.action)).toEqual(["user.signIn", "user.signIn", "security.signInAlertSent"]);
    });
  });
});

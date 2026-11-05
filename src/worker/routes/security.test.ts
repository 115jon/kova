/**
 * "This wasn't me", end to end through the worker: the GET only shows a page,
 * the POST signs the user out of everything (D1 and the KV session mirror) once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signNotMeToken } from "../lib/not-me-token";
import { createHarness, type Harness, TEST_SECRET } from "../test-support/auth-harness";

describe("/api/security/not-me", () => {
  let h: Harness;
  let user: { id: string };
  let other: { id: string };

  beforeEach(() => {
    h = createHarness();
    user = h.createUser({ email: "ada@example.com" });
    other = h.createUser({ email: "grace@example.com" });
  });

  const token = (fields: { u?: string; a?: string; e?: number } = {}) =>
    signNotMeToken(TEST_SECRET, { u: fields.u ?? user.id, a: fields.a ?? "alert_1", e: fields.e ?? Date.now() + 60_000, app: null, t: Date.now() });

  const sessionsOf = (userId: string) =>
    (h.sqlite.prepare("SELECT id FROM session WHERE userId = ?").all(userId) as { id: string }[]).map((row) => row.id);

  const post = (value: string) =>
    h.fetch("/api/security/not-me", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://auth.115jon.site" },
      body: new URLSearchParams({ token: value }).toString(),
    });

  it("GET shows a confirmation form and revokes nothing", async () => {
    await h.createSession(user.id);
    const value = await token();

    const response = await h.fetch(`/api/security/not-me?token=${encodeURIComponent(value)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('<form method="post" action="/api/security/not-me">');
    expect(html).toContain("Sign out everywhere");
    expect(html).not.toContain("ada@example.com");
    expect(sessionsOf(user.id)).toHaveLength(1);
  });

  it("POST revokes every session of the user, clears the KV mirror, logs it, and links to reset", async () => {
    const browser = await h.createSession(user.id);
    await h.createSession(user.id, { appId: h.createApp().id });
    const bystander = await h.createSession(other.id);
    await h.kv.put(browser.token, JSON.stringify({ session: { userId: user.id } }));
    await h.kv.put(`active-sessions-${user.id}`, JSON.stringify([{ token: browser.token, expiresAt: Date.now() + 60_000 }]));

    const response = await post(await token());

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Signed out everywhere");
    expect(html).toContain("/reset-password");
    expect(sessionsOf(user.id)).toEqual([]);
    expect(sessionsOf(other.id)).toEqual([bystander.id]);
    expect(await h.kv.get(browser.token)).toBeNull();
    expect(await h.kv.get(`active-sessions-${user.id}`)).toBeNull();
    const audit = h.sqlite.prepare("SELECT actor, metadata FROM audit_log WHERE action = 'security.signOutEverywhere'").all() as Array<{ actor: string; metadata: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(user.id);
    expect(JSON.parse(audit[0]!.metadata)).toMatchObject({ via: "alert_email", revoked: 2 });
  });

  it("works once: the same link afterwards gets the generic page and revokes nothing", async () => {
    const value = await token();
    expect((await post(value)).status).toBe(200);
    await h.createSession(user.id);

    const again = await post(value);
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("This link has expired");
    expect((await h.fetch(`/api/security/not-me?token=${encodeURIComponent(value)}`)).status).toBe(400);
    expect(sessionsOf(user.id)).toHaveLength(1);
  });

  it("keeps the link usable when revoking fails", async () => {
    await h.createSession(user.id);
    const value = await token();
    const db = h.db as unknown as { batch: (...args: unknown[]) => Promise<unknown> };
    const batch = db.batch;
    db.batch = async () => { throw new Error("D1 unavailable"); };

    const failed = await post(value);
    db.batch = batch;

    expect(failed.status).toBe(503);
    expect(sessionsOf(user.id)).toHaveLength(1);
    const retry = await post(value);
    expect(retry.status).toBe(200);
    expect(sessionsOf(user.id)).toEqual([]);
  });

  it("sends an app's users straight to its branded forgot-password page", async () => {
    const app = h.createApp({ authSlug: "ralph-meet" });
    const value = await signNotMeToken(TEST_SECRET, { u: user.id, a: "alert_app", e: Date.now() + 60_000, app: app.id, t: Date.now() });

    const html = await (await post(value)).text();

    expect(html).toContain(`href="https://auth.115jon.site/reset-password?pk=${encodeURIComponent(app.publishableKey)}"`);
    expect(html).toContain("Reset your password");
  });

  it("uses Kova's reset page when the alert has no app", async () => {
    const value = await signNotMeToken(TEST_SECRET, { u: user.id, a: "alert_noapp", e: Date.now() + 60_000, app: null, t: Date.now() });

    expect(await (await post(value)).text()).toContain('href="https://auth.115jon.site/reset-password"');
  });

  it("rejects expired and tampered tokens with the same page", async () => {
    await h.createSession(user.id);
    const expired = await token({ e: Date.now() - 1 });
    const valid = await token();
    const tampered = `${Buffer.from(JSON.stringify({ u: other.id, a: "x", e: Date.now() + 60_000, app: null, t: 0 })).toString("base64url")}.${valid.split(".")[1]}`;

    for (const value of [expired, tampered, "garbage"]) {
      const response = await post(value);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("This link has expired");
    }
    expect(sessionsOf(user.id)).toHaveLength(1);
  });
});

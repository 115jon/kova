import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryKV, migratedD1 } from "../test-support/d1";
import type { ClientDescription } from "./audit-context";
import { verifyNotMeToken } from "./not-me-token";
import { type AlertEnv, decideSignInAlert, maybeSendSignInAlert, type SignInAlertEvent } from "./sign-in-alert";

const SECRET = "test-secret-test-secret-test-secret-12345";
const NOW = Date.UTC(2026, 10, 5, 12);
const DAY = 24 * 60 * 60 * 1000;
const SAFARI_IOS: ClientDescription = { browser: "Safari", os: "iOS", platform: "mobile", inApp: null };
const CHROME_MAC: ClientDescription = { browser: "Chrome", os: "macOS", platform: "desktop", inApp: null };

function setup(options: { userAgeMs?: number; alertsOn?: boolean } = {}) {
  const { sqlite, db } = migratedD1();
  const { kv, store } = memoryKV();
  sqlite.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user_1', 'Ada <b>', 'ada@example.com', 1, ?, ?)`)
    .run(new Date(NOW - (options.userAgeMs ?? 30 * DAY)).toISOString(), new Date(NOW).toISOString());
  sqlite.prepare(
    `INSERT INTO application (id, name, display_name, publishable_key, secret_key_hash, allowed_origins, redirect_uris, logo_url, primary_color, sign_in_alerts)
     VALUES ('app_1', 'meet', 'Ralph "Meet"', 'pk_1', 'x', '', '', 'https://cdn.example/logo.png', '#ff0066', ?)`,
  ).run(options.alertsOn === false ? 0 : 1);
  let n = 0;
  const signIn = (ageMs: number, fields: { client?: ClientDescription | null; country?: string | null; action?: string; twoFactorPending?: boolean } = {}) => {
    n += 1;
    const createdAt = NOW - ageMs;
    const metadata = fields.client === null
      ? null
      : JSON.stringify({ method: "password", client: fields.client ?? SAFARI_IOS, ...(fields.twoFactorPending ? { twoFactorPending: true } : {}) });
    sqlite.prepare("INSERT INTO audit_log (id, userId, actor, action, metadata, country, createdAt) VALUES (?, 'user_1', 'user_1', ?, ?, ?, ?)")
      .run(`${createdAt}_${n}`, fields.action ?? "user.signIn", metadata, fields.country === undefined ? "US" : fields.country, createdAt);
  };
  const env = {
    DB: db,
    KV: kv,
    AUTH_URL: "https://auth.example",
    BETTER_AUTH_SECRET: SECRET,
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Kova <noreply@115jon.com>",
  } as unknown as AlertEnv;
  return { sqlite, env, store, signIn };
}

const event = (fields: Partial<SignInAlertEvent> = {}): SignInAlertEvent => ({
  userId: "user_1",
  appId: null,
  client: SAFARI_IOS,
  country: "US",
  city: "Austin",
  at: NOW,
  ...fields,
});

afterEach(() => vi.unstubAllGlobals());

describe("decideSignInAlert", () => {
  it("alerts on a device not seen in 90 days", async () => {
    const { env, signIn } = setup();
    signIn(2 * DAY, { client: SAFARI_IOS });
    signIn(100 * DAY, { client: CHROME_MAC });

    expect(await decideSignInAlert(env, event({ client: CHROME_MAC }))).toMatchObject({ send: true, reasons: ["new_device"] });
  });

  it("alerts on a new country", async () => {
    const { env, signIn } = setup();
    signIn(2 * DAY, { country: "US" });

    expect(await decideSignInAlert(env, event({ country: "BR" }))).toMatchObject({ send: true, reasons: ["new_country"] });
  });

  it("stays quiet for a known device in a known country, app sign-ins included", async () => {
    const { env, signIn } = setup();
    signIn(2 * DAY, { action: "app.signIn" });

    expect(await decideSignInAlert(env, event())).toEqual({ send: false, reason: "known" });
  });

  it("skips the first sign-in after sign-up and accounts with no sign-in history", async () => {
    const fresh = setup({ userAgeMs: 5 * 60 * 1000 });
    fresh.signIn(60 * 1000, { client: CHROME_MAC });
    expect(await decideSignInAlert(fresh.env, event())).toEqual({ send: false, reason: "new_account" });

    const neverSignedIn = setup();
    expect(await decideSignInAlert(neverSignedIn.env, event())).toEqual({ send: false, reason: "no_history" });
  });

  it("does not count the event itself or 2FA-pending rows as history", async () => {
    const { env, signIn } = setup();
    signIn(0, { client: CHROME_MAC }); // the current sign-in's own row (createdAt = at)
    signIn(60 * 1000, { client: CHROME_MAC, twoFactorPending: true });
    signIn(2 * DAY, { client: SAFARI_IOS });

    expect(await decideSignInAlert(env, event({ client: CHROME_MAC }))).toMatchObject({ send: true, reasons: ["new_device"] });
  });

  it("treats everything as new after 90 quiet days", async () => {
    const { env, signIn } = setup();
    signIn(120 * DAY);

    expect(await decideSignInAlert(env, event())).toMatchObject({ send: true, reasons: ["new_device", "new_country"] });
  });

  it("ignores history rows recorded before client and country were kept", async () => {
    const { env, signIn } = setup();
    signIn(2 * DAY, { client: null, country: null });

    expect(await decideSignInAlert(env, event({ client: CHROME_MAC, country: "BR" }))).toEqual({ send: false, reason: "known" });
  });

  it("respects the app's toggle", async () => {
    const { env, signIn } = setup({ alertsOn: false });
    signIn(2 * DAY);

    expect(await decideSignInAlert(env, event({ appId: "app_1", client: CHROME_MAC }))).toEqual({ send: false, reason: "app_disabled" });
  });

  it("sends at most one alert per user per 10 minutes, counting only sent emails", async () => {
    const { env, signIn, store } = setup();
    signIn(2 * DAY);
    let fail = true;
    const fetchMock = vi.fn(async () => (fail ? new Response("down", { status: 500 }) : Response.json({ id: "email_1" })));
    vi.stubGlobal("fetch", fetchMock);

    expect(await maybeSendSignInAlert(env, event({ client: CHROME_MAC }))).toBeNull();
    expect(store.has("signin-alert:user_1")).toBe(false);

    fail = false;
    expect(await maybeSendSignInAlert(env, event({ client: CHROME_MAC, at: NOW + 1000 }))).toMatchObject({ send: true });
    expect(store.get("signin-alert:user_1")?.expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(await decideSignInAlert(env, event({ client: CHROME_MAC, at: NOW + 2000 }))).toEqual({ send: false, reason: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("maybeSendSignInAlert", () => {
  it("emails a branded, escaped alert from '<App> via Kova' and logs it", async () => {
    const { env, signIn, sqlite } = setup();
    signIn(2 * DAY);
    const sent: Array<{ from: string; to: string; subject: string; html: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ id: "email_1" });
    }));

    const decision = await maybeSendSignInAlert(env, event({ appId: "app_1", client: { ...CHROME_MAC, inApp: "instagram" }, country: "BR", city: "<São Paulo>" }));

    expect(decision).toMatchObject({ send: true, reasons: ["new_device", "new_country"] });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.from).toBe('"Ralph Meet via Kova" <noreply@115jon.com>');
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toBe('New sign-in to Ralph "Meet"');
    expect(mail.html).toContain("Ralph &quot;Meet&quot;");
    expect(mail.html).not.toContain('Ralph "Meet"');
    expect(mail.html).toContain("&lt;São Paulo&gt;, Brazil");
    expect(mail.html).toContain("Chrome on macOS");
    expect(mail.html).toContain("Instagram");
    expect(mail.html).toContain("UTC");
    expect(mail.html).toContain("#ff0066");
    expect(mail.html).toContain("https://cdn.example/logo.png");
    expect(mail.html).toContain("If this was you, no action is needed.");

    const link = /href="(https:\/\/auth\.example\/api\/security\/not-me\?token=[^"]+)"/.exec(mail.html)?.[1];
    expect(link).toBeDefined();
    const token = decodeURIComponent(new URL(link!.replace(/&amp;/g, "&")).searchParams.get("token")!);
    expect(await verifyNotMeToken(SECRET, token)).toMatchObject({ u: "user_1", app: "app_1", t: NOW });

    const logged = sqlite.prepare("SELECT action, appId, country, metadata FROM audit_log WHERE action = 'security.signInAlertSent'").all() as Array<{ metadata: string }>;
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.metadata)).toMatchObject({ reasons: ["new_device", "new_country"] });
  });

  it("uses Kova branding without an app and never throws", async () => {
    const { env, signIn } = setup();
    signIn(2 * DAY);
    const sent: Array<{ from: string; html: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("boom", { status: 500 });
    }));

    await expect(maybeSendSignInAlert(env, event({ client: CHROME_MAC }))).resolves.toBeNull();
    expect(sent[0]?.from).toBe("Kova <noreply@115jon.com>");
    expect(sent[0]?.html).toContain("New sign-in to Kova");
  });
});

/**
 * Device approval on the app's own site (device_verification_uri +
 * /api/pub/apps/:pk/device/{lookup,approve,deny}): every caller rule, the
 * plugin's claim semantics, app ownership of codes, the limit, org 2FA, and
 * the admin validation of the URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "../test-support/auth-harness";

type App = ReturnType<Harness["createApp"]>;
type Started = { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string };

const T0 = new Date("2026-10-22T12:00:00.000Z").getTime();
const WEB = "https://meet.example";
const ACTIVATE = `${WEB}/activate`;
const DESKTOP = "http://tauri.localhost";

describe("device approval from the app's own page", () => {
  let h: Harness;
  let app: App;
  let user: { id: string };
  let token: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h = createHarness();
    app = h.createApp({ name: "Ralph Meet", allowedOrigins: [WEB, DESKTOP] });
    h.sqlite.prepare(`UPDATE application SET device_verification_uri = ? WHERE id = ?`).run(ACTIVATE, app.id);
    user = h.createUser({ name: "Ada Lovelace", email: "ada@example.com" });
    token = (await h.createSession(user.id, { appId: app.id })).token;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function later(ms: number) {
    vi.setSystemTime(Date.now() + ms);
  }

  async function start(pk = app.publishableKey) {
    const response = await h.fetch(`/api/pub/apps/${pk}/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: JSON.stringify({ hostname: "ada-pc", platform: "Windows", label: "Ralph Meet" }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Started;
  }

  type CallOptions = {
    token?: string | null;
    origin?: string | null;
    fetchSite?: string;
    pk?: string;
    cookie?: string;
    ip?: string;
    body?: unknown;
  };

  async function call(step: "lookup" | "approve" | "deny" | "release", userCode: string, options: CallOptions = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", "CF-Connecting-IP": options.ip ?? "198.51.100.4" };
    const bearer = options.token === undefined ? token : options.token;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const origin = options.origin === undefined ? WEB : options.origin;
    if (origin) headers.origin = origin;
    if (options.fetchSite) headers["sec-fetch-site"] = options.fetchSite;
    if (options.cookie) headers.cookie = options.cookie;
    const response = await h.fetch(`/api/pub/apps/${options.pk ?? app.publishableKey}/device/${step}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body ?? { userCode }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any>, response };
  }

  async function poll(deviceCode: string, pk = app.publishableKey) {
    const response = await h.fetch(`/api/pub/apps/${pk}/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  function claimOf(userCode: string) {
    return h.sqlite.prepare(`SELECT userId, status FROM deviceCode WHERE userCode = ?`).get(userCode.replace("-", "")) as { userId: string | null; status: string };
  }

  describe("verification URL at start", () => {
    it("points the device at the app's own page with the code filled in", async () => {
      const started = await start();
      expect(started.verificationUri).toBe(ACTIVATE);
      expect(started.verificationUriComplete).toBe(`${ACTIVATE}?code=${started.userCode}`);
    });

    it("keeps an existing query string", async () => {
      h.sqlite.prepare(`UPDATE application SET device_verification_uri = ? WHERE id = ?`).run(`${ACTIVATE}?from=desktop&code=old`, app.id);
      const started = await start();
      expect(started.verificationUri).toBe(`${ACTIVATE}?from=desktop&code=old`);
      expect(started.verificationUriComplete).toBe(`${ACTIVATE}?from=desktop&code=${started.userCode}`);
    });

    it("works for an app without a hosted host", async () => {
      h.sqlite.prepare(`UPDATE application SET auth_slug = NULL WHERE id = ?`).run(app.id);
      expect((await start()).verificationUri).toBe(ACTIVATE);
    });

    it("falls back to the hosted /device page when unset", async () => {
      h.sqlite.prepare(`UPDATE application SET device_verification_uri = NULL WHERE id = ?`).run(app.id);
      const started = await start();
      expect(started.verificationUri).toBe(`https://${app.authSlug}.auth.115jon.site/device`);
      expect(started.verificationUriComplete).toBe(`https://${app.authSlug}.auth.115jon.site/device?code=${started.userCode}`);
    });
  });

  describe("happy path", () => {
    it("looks up and claims, approves, and the device redeems an app session", async () => {
      const started = await start();
      const lookup = await call("lookup", started.userCode);
      expect(lookup.status).toBe(200);
      expect(lookup.body).toEqual({
        userCode: started.userCode,
        status: "pending",
        device: { label: "Ralph Meet", platform: "Windows", hostname: "ada-pc" },
        requester: { city: null, country: null, ip: "203.0.113.7" },
        expiresAt: new Date(T0 + 600_000).toISOString(),
      });
      expect(lookup.response.headers.get("cache-control")).toBe("no-store");
      expect(claimOf(started.userCode)).toEqual({ userId: user.id, status: "pending" });

      const approved = await call("approve", started.userCode);
      expect([approved.status, approved.body]).toEqual([200, { status: "approved" }]);
      expect(approved.response.headers.get("cache-control")).toBe("no-store");

      later(5_000);
      const redeemed = await poll(started.deviceCode);
      expect(redeemed).toMatchObject({ status: "approved", sessionToken: expect.any(String) });
      expect(h.sqlite.prepare(`SELECT app_id, userId FROM session WHERE token = ?`).get(String(redeemed.sessionToken))).toEqual({ app_id: app.id, userId: user.id });
    });

    it("accepts lowercase and unhyphenated codes", async () => {
      const started = await start();
      expect((await call("lookup", started.userCode.replace("-", "").toLowerCase())).status).toBe(200);
    });

    it("denies, and the device sees denied", async () => {
      const started = await start();
      await call("lookup", started.userCode);
      expect((await call("deny", started.userCode)).body).toEqual({ status: "denied" });
      expect(await poll(started.deviceCode)).toEqual({ status: "denied" });
    });

    it("reports the decided status on a later lookup", async () => {
      const started = await start();
      await call("lookup", started.userCode);
      await call("approve", started.userCode);
      expect((await call("lookup", started.userCode)).body.status).toBe("approved");
    });

    it("works under a promoted app's legacy key", async () => {
      h.sqlite.prepare(`UPDATE application SET legacy_publishable_key = publishable_key, publishable_key = 'pk_live_new' WHERE id = ?`).run(app.id);
      const started = await start(app.publishableKey);
      expect((await call("lookup", started.userCode, { pk: app.publishableKey })).status).toBe(200);
      expect((await call("approve", started.userCode, { pk: "pk_live_new" })).status).toBe(200);
    });

    it("answers CORS for the app's web origin, preflight included", async () => {
      const started = await start();
      const preflight = await h.fetch(`/api/pub/apps/${app.publishableKey}/device/approve`, {
        method: "OPTIONS",
        headers: { origin: WEB, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(WEB);
      expect(preflight.headers.get("access-control-allow-headers")).toMatch(/Authorization/i);
      const lookup = await call("lookup", started.userCode);
      expect(lookup.response.headers.get("access-control-allow-origin")).toBe(WEB);
    });
  });

  describe("caller session", () => {
    it("needs a bearer", async () => {
      const started = await start();
      const result = await call("lookup", started.userCode, { token: null });
      expect([result.status, result.body.error]).toEqual([401, "invalid_session"]);
      expect(result.response.headers.get("cache-control")).toBe("no-store");
    });

    it("ignores cookies: an app session cookie alone is refused and never claims", async () => {
      const started = await start();
      const { cookie } = await h.createSession(user.id, { appId: app.id });
      expect((await call("lookup", started.userCode, { token: null, cookie })).status).toBe(401);
      expect(claimOf(started.userCode).userId).toBeNull();
    });

    it("refuses a platform session token", async () => {
      const started = await start();
      const platform = (await h.createSession(user.id)).token;
      expect((await call("lookup", started.userCode, { token: platform })).body.error).toBe("invalid_session");
      expect(claimOf(started.userCode).userId).toBeNull();
    });

    it("refuses another app's session token", async () => {
      const other = h.createApp({ name: "Other", allowedOrigins: [WEB] });
      const started = await start();
      const foreign = (await h.createSession(user.id, { appId: other.id })).token;
      expect((await call("lookup", started.userCode, { token: foreign })).body.error).toBe("invalid_session");
      expect((await call("approve", started.userCode, { token: foreign })).body.error).toBe("invalid_session");
    });

    it("refuses an unknown or expired token", async () => {
      const started = await start();
      expect((await call("lookup", started.userCode, { token: "tok_nope" })).status).toBe(401);
      h.sqlite.prepare(`UPDATE session SET expiresAt = ? WHERE token = ?`).run(new Date(T0 - 1000).toISOString(), token);
      expect((await call("lookup", started.userCode)).status).toBe(401);
    });

    it("refuses a banned user", async () => {
      const started = await start();
      h.sqlite.prepare(`UPDATE "user" SET banned = 1 WHERE id = ?`).run(user.id);
      expect((await call("lookup", started.userCode)).body.error).toBe("invalid_session");
    });

    it("404s an unknown key and refuses a suspended app", async () => {
      expect((await call("lookup", "ABCD-EFGH", { pk: "pk_dev_nope" })).body.error).toBe("app_not_found");
      h.sqlite.prepare(`UPDATE application SET suspended_at = 1 WHERE id = ?`).run(app.id);
      expect((await call("lookup", "ABCD-EFGH")).body.error).toBe("app_suspended");
    });
  });

  describe("request origin", () => {
    it("needs an Origin", async () => {
      const started = await start();
      expect((await call("lookup", started.userCode, { origin: null })).body.error).toBe("origin_not_allowed");
    });

    it("needs one of the app's allowed origins exactly", async () => {
      const started = await start();
      for (const origin of ["https://evil.example", `${WEB}/`, "https://meet.example:444", "null"]) {
        const result = await call("approve", started.userCode, { origin });
        expect([origin, result.status, result.body.error]).toEqual([origin, 403, "origin_not_allowed"]);
      }
    });

    it("refuses the desktop shell even though it is an allowed origin", async () => {
      h.sqlite.prepare(`UPDATE application SET allowed_origins = ? WHERE id = ?`).run([WEB, DESKTOP, "https://tauri.localhost"].join("\n"), app.id);
      const started = await start();
      for (const origin of [DESKTOP, "https://tauri.localhost"]) {
        expect((await call("lookup", started.userCode, { origin })).body.error).toBe("origin_not_allowed");
        expect((await call("approve", started.userCode, { origin })).body.error).toBe("origin_not_allowed");
      }
      expect(claimOf(started.userCode)).toEqual({ userId: null, status: "pending" });
    });

    it("accepts a cross-site page on an allowed origin (another domain, or mid-migration)", async () => {
      const started = await start();
      expect((await call("lookup", started.userCode, { fetchSite: "cross-site" })).status).toBe(200);
      expect((await call("approve", started.userCode, { fetchSite: "cross-site" })).status).toBe(200);
    });

    it("still refuses a cross-site request from a disallowed or desktop origin", async () => {
      const started = await start();
      for (const origin of ["https://evil.example", DESKTOP]) {
        const result = await call("lookup", started.userCode, { origin, fetchSite: "cross-site" });
        expect([origin, result.status, result.body.error]).toEqual([origin, 403, "origin_not_allowed"]);
      }
      expect(claimOf(started.userCode)).toEqual({ userId: null, status: "pending" });
    });
  });

  describe("codes", () => {
    it("answers another app's code exactly like an unknown one", async () => {
      const other = h.createApp({ name: "Other" });
      const theirs = await start(other.publishableKey);
      const foreign = await call("lookup", theirs.userCode);
      const unknown = await call("lookup", "ABCD-EFGH");
      expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
      expect(foreign.body.error).toBe("invalid_code");
      expect((await call("approve", theirs.userCode)).body).toEqual(unknown.body);
      expect(claimOf(theirs.userCode)).toEqual({ userId: null, status: "pending" });
    });

    it("rejects malformed bodies", async () => {
      for (const body of [{}, { userCode: 12345678 }, { userCode: "ABC" }, { userCode: "ABCD-EFG0" }]) {
        expect((await call("lookup", "", { body })).body.error).toBe("invalid_request");
      }
    });

    it("reports an expired code", async () => {
      const started = await start();
      later(601_000);
      expect((await call("lookup", started.userCode)).status).toBe(410);
    });
  });

  describe("claim", () => {
    it("lets only the claiming account review and decide", async () => {
      const started = await start();
      const bob = h.createUser({ name: "Bob", email: "bob@example.com" });
      const bobToken = (await h.createSession(bob.id, { appId: app.id })).token;

      expect((await call("lookup", started.userCode)).status).toBe(200);
      const bobLookup = await call("lookup", started.userCode, { token: bobToken });
      expect([bobLookup.status, bobLookup.body.error]).toEqual([403, "access_denied"]);
      expect(bobLookup.body).not.toHaveProperty("device");
      expect((await call("approve", started.userCode, { token: bobToken })).body.error).toBe("access_denied");
      expect((await call("deny", started.userCode, { token: bobToken })).body.error).toBe("access_denied");
      expect(claimOf(started.userCode)).toEqual({ userId: user.id, status: "pending" });
    });

    it("needs a lookup before approve or deny", async () => {
      const started = await start();
      const result = await call("approve", started.userCode);
      expect([result.status, result.body.error]).toEqual([409, "not_claimed"]);
      expect((await call("deny", started.userCode)).body.error).toBe("not_claimed");
    });

    it("decides once", async () => {
      const started = await start();
      await call("lookup", started.userCode);
      await call("approve", started.userCode);
      const again = await call("deny", started.userCode);
      expect([again.status, again.body.error]).toEqual([409, "already_processed"]);
      expect(claimOf(started.userCode).status).toBe("approved");
    });
  });

  describe("release (\"Not you?\")", () => {
    async function bob() {
      const other = h.createUser({ name: "Bob", email: "bob@example.com" });
      return { id: other.id, token: (await h.createSession(other.id, { appId: app.id })).token };
    }

    it("lets the claimer give the code up, so another account can look it up and approve", async () => {
      const started = await start();
      const b = await bob();
      await call("lookup", started.userCode);
      expect((await call("lookup", started.userCode, { token: b.token })).body.error).toBe("access_denied");

      const released = await call("release", started.userCode);
      expect([released.status, released.body]).toEqual([200, { status: "released" }]);
      expect(released.response.headers.get("cache-control")).toBe("no-store");
      expect(released.response.headers.get("access-control-allow-origin")).toBe(WEB);
      expect(claimOf(started.userCode)).toEqual({ userId: null, status: "pending" });

      expect((await call("lookup", started.userCode, { token: b.token })).status).toBe(200);
      expect(claimOf(started.userCode)).toEqual({ userId: b.id, status: "pending" });
      expect((await call("approve", started.userCode, { token: b.token })).status).toBe(200);
      // The first account can no longer act on it.
      expect((await call("approve", started.userCode)).body.error).toBe("already_processed");

      later(5_000);
      const redeemed = await poll(started.deviceCode);
      expect(h.sqlite.prepare(`SELECT userId FROM session WHERE token = ?`).get(String(redeemed.sessionToken))).toEqual({ userId: b.id });
    });

    it("refuses a non-claimer with 403 and leaves the claim alone", async () => {
      const started = await start();
      const b = await bob();
      await call("lookup", started.userCode);
      const result = await call("release", started.userCode, { token: b.token });
      expect([result.status, result.body.error]).toEqual([403, "access_denied"]);
      expect(claimOf(started.userCode)).toEqual({ userId: user.id, status: "pending" });
    });

    it("answers not_claimed for an unclaimed code", async () => {
      const started = await start();
      const result = await call("release", started.userCode);
      expect([result.status, result.body.error]).toEqual([409, "not_claimed"]);
    });

    it("answers another app's code exactly like an unknown one", async () => {
      const other = h.createApp({ name: "Other" });
      const theirs = await start(other.publishableKey);
      const foreign = await call("release", theirs.userCode);
      const unknown = await call("release", "ABCD-EFGH");
      expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
      expect(foreign.body.error).toBe("invalid_code");
    });

    it("cannot release an approved or denied code", async () => {
      const a = await start();
      await call("lookup", a.userCode);
      await call("approve", a.userCode);
      const approved = await call("release", a.userCode);
      expect([approved.status, approved.body.error]).toEqual([409, "already_processed"]);
      expect(claimOf(a.userCode)).toEqual({ userId: user.id, status: "approved" });

      const d = await start();
      await call("lookup", d.userCode);
      await call("deny", d.userCode);
      expect((await call("release", d.userCode)).body.error).toBe("already_processed");
    });

    it("cannot release an expired code", async () => {
      const started = await start();
      await call("lookup", started.userCode);
      later(601_000);
      const result = await call("release", started.userCode);
      expect([result.status, result.body.error]).toEqual([410, "expired_token"]);
    });

    it("follows the same Origin and bearer rules", async () => {
      const started = await start();
      await call("lookup", started.userCode);
      const { cookie } = await h.createSession(user.id, { appId: app.id });
      const platform = (await h.createSession(user.id)).token;
      expect((await call("release", started.userCode, { origin: null })).body.error).toBe("origin_not_allowed");
      expect((await call("release", started.userCode, { origin: "https://evil.example" })).body.error).toBe("origin_not_allowed");
      expect((await call("release", started.userCode, { origin: DESKTOP })).body.error).toBe("origin_not_allowed");
      expect((await call("release", started.userCode, { token: null, cookie })).body.error).toBe("invalid_session");
      expect((await call("release", started.userCode, { token: platform })).body.error).toBe("invalid_session");
      expect(claimOf(started.userCode)).toEqual({ userId: user.id, status: "pending" });
      // No Sec-Fetch-Site rule: a cross-site page on an allowed origin may release.
      expect((await call("release", started.userCode, { fetchSite: "cross-site" })).status).toBe(200);
    });

    it("shares the rate limit with the other endpoints", async () => {
      for (let i = 0; i < 30; i += 1) await call("release", "ABCD-EFGH");
      const limited = await call("lookup", "ABCD-EFGH");
      expect([limited.status, limited.body.error]).toEqual([429, "rate_limited"]);
    });
  });

  describe("rate limit", () => {
    it("allows 30 per user and IP across all three endpoints, then 429s", async () => {
      const started = await start();
      for (let i = 0; i < 29; i += 1) expect((await call("lookup", "ABCD-EFGH")).status).toBe(400);
      expect((await call("approve", started.userCode)).status).toBe(409);
      const limited = await call("lookup", started.userCode);
      expect([limited.status, limited.body.error]).toEqual([429, "rate_limited"]);
      expect(Number(limited.response.headers.get("retry-after"))).toBeGreaterThan(0);
      // Another IP has its own budget.
      expect((await call("lookup", started.userCode, { ip: "198.51.100.99" })).status).toBe(200);
    });
  });

  describe("org 2FA", () => {
    it("refuses approval for a user an MFA-enforcing org would block, and still allows deny", async () => {
      const now = Date.now();
      h.sqlite.prepare(`INSERT INTO organization (id, name, slug, createdAt) VALUES ('org_1', 'Org', 'org', ?)`).run(now);
      h.sqlite.prepare(`INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('mem_1', 'org_1', ?, 'member', ?)`).run(user.id, now);
      h.sqlite.prepare(`INSERT INTO organization_settings (orgId, require_mfa) VALUES ('org_1', 1)`).run();

      const started = await start();
      expect((await call("lookup", started.userCode)).status).toBe(200);
      const approve = await call("approve", started.userCode);
      expect([approve.status, approve.body.error]).toEqual([403, "mfa_required"]);
      expect(claimOf(started.userCode).status).toBe("pending");
      expect((await call("deny", started.userCode)).status).toBe(200);
    });
  });
});

describe("device_verification_uri validation", () => {
  let h: Harness;
  let adminCookie: string;
  let appId: string;

  beforeEach(async () => {
    h = createHarness();
    appId = h.createApp({ allowedOrigins: [WEB, "http://localhost:3000"] }).id;
    h.sqlite.prepare(`UPDATE application SET environment = 'development', redirect_uris = ? WHERE id = ?`).run(`${WEB}/`, appId);
    const admin = h.createUser({ email: "admin@example.com", role: "admin" });
    adminCookie = (await h.createSession(admin.id)).cookie;
  });

  async function patch(body: Record<string, unknown>) {
    const response = await h.fetch(`/api/admin/apps/${appId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  it("saves an https URL on an allowed origin, and clears with blank or null", async () => {
    const saved = await patch({ device_verification_uri: ` ${ACTIVATE}?x=1 ` });
    expect([saved.status, saved.body.app.device_verification_uri]).toEqual([200, `${ACTIVATE}?x=1`]);
    expect((await patch({ device_verification_uri: "" })).body.app.device_verification_uri).toBeNull();
    await patch({ device_verification_uri: ACTIVATE });
    expect((await patch({ device_verification_uri: null })).body.app.device_verification_uri).toBeNull();
  });

  it("leaves it alone when a save does not mention it", async () => {
    await patch({ device_verification_uri: ACTIVATE });
    expect((await patch({ name: "Renamed" })).body.app.device_verification_uri).toBe(ACTIVATE);
  });

  it("refuses an origin that is not allowed, http other than localhost, and junk", async () => {
    for (const value of ["https://other.example/activate", "http://meet.example/activate", "http://127.0.0.1:3000/activate", "ftp://meet.example/x", "not a url", `${ACTIVATE}#frag`, "https://u:p@meet.example/activate", 42]) {
      const result = await patch({ device_verification_uri: value });
      expect([value, result.status]).toEqual([value, 400]);
    }
  });

  it("allows http://localhost for development apps only", async () => {
    expect((await patch({ device_verification_uri: "http://localhost:3000/activate" })).status).toBe(200);
    h.sqlite.prepare(`UPDATE application SET environment = 'production', device_verification_uri = NULL, allowed_origins = ? WHERE id = ?`).run(WEB, appId);
    const prod = await patch({ allowed_origins: [WEB, "http://localhost:3000"], device_verification_uri: "http://localhost:3000/activate" });
    expect(prod.status).toBe(400);
  });

  it("refuses dropping the allowed origin the URL lives on", async () => {
    await patch({ device_verification_uri: ACTIVATE });
    const result = await patch({ allowed_origins: ["http://localhost:3000"] });
    expect([result.status, result.body.error]).toEqual([400, expect.stringContaining("must be one of the allowed origins")]);
  });

  it("is validated at create too", async () => {
    const create = (body: Record<string, unknown>) => h.fetch(`/api/admin/apps`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "New", environment: "production", allowed_origins: [WEB], redirect_uris: [`${WEB}/`], ...body }),
    });
    expect((await create({ device_verification_uri: "https://elsewhere.example/activate" })).status).toBe(400);
    const created = await create({ device_verification_uri: ACTIVATE });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { app: { device_verification_uri: string } }).app.device_verification_uri).toBe(ACTIVATE);
  });
});

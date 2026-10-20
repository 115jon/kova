import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../applications";

const session = {
  user: { id: "user_1" },
  session: { id: "sess_cookie", token: "cookie_tok" },
};

const getSession = vi.fn(async (): Promise<typeof session | null> => session);
const insertAppScopedSession = vi.fn(async (_db: unknown, _input: unknown) => undefined);
const getApplicationByPublishableKey = vi.fn(async (_db: unknown, pk: string) => {
  if (pk === "pk_live_mira") return mira();
  if (pk === "pk_live_other") {
    return mira({
      id: "app_other",
      name: "Other",
      display_name: "Other",
      publishable_key: "pk_live_other",
      auth_slug: "other",
    });
  }
  if (pk === "pk_suspended") {
    return mira({ id: "app_suspended", publishable_key: "pk_suspended", suspended_at: 1 });
  }
  return null;
});

vi.mock("../auth", () => ({
  createAuth: () => ({ api: { getSession } }),
}));

vi.mock("../lib/app-session", () => ({
  APP_SESSION_TTL_MS: 1,
  insertAppScopedSession: (db: unknown, input: unknown) => insertAppScopedSession(db, input),
  resolveAppScopedSession: vi.fn(),
}));

vi.mock("../applications", () => ({
  getApplicationByPublishableKey: (db: unknown, pk: string) => getApplicationByPublishableKey(db, pk),
  getApplicationById: vi.fn(),
  isRedirectUriAllowed: () => false,
  validateSecretKey: async () => false,
}));

vi.mock("better-auth", () => ({
  generateId: (size?: number) => (size === 32 ? "app_session_token" : "app_session_id"),
}));

function mira(overrides: Partial<Application> = {}): Application {
  return {
    id: "app_mira",
    name: "Mira",
    environment: "production",
    publishable_key: "pk_live_mira",
    allowed_origins: [],
    redirect_uris: [],
    createdBy: "user_1",
    createdAt: 1,
    updatedAt: 1,
    display_name: null,
    logo_url: null,
    favicon_url: null,
    primary_color: "#3b82f6",
    background_color: "#0f172a",
    theme: "dark",
    home_url: null,
    terms_url: null,
    privacy_url: null,
    hide_branding: false,
    from_name: null,
    from_email: null,
    support_email: null,
    smtp_host: null,
    smtp_port: 587,
    smtp_user: null,
    smtp_secure: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: "free",
    plan_expires_at: null,
    suspended_at: null,
    auth_slug: "mira",
    custom_domain: null,
    ...overrides,
  };
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

const base = Date.now();
let now = base;

function env(kv: ReturnType<typeof memoryKv>, hosted = mira()) {
  return {
    __hostedApp: { app: hosted },
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [], success: true }) }) }) },
    KV: kv,
    BETTER_AUTH_SECRET: "test-secret",
    AUTH_URL: "https://auth.115jon.site",
  } as never;
}

async function postPub(kv: ReturnType<typeof memoryKv>, pk: string, action: "start" | "poll", body: unknown) {
  const { pubAppsRouter } = await import("./pub/apps");
  return pubAppsRouter.request(
    new Request(`https://auth.115jon.site/${pk}/device/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {},
    env(kv),
  );
}

async function hosted(
  kv: ReturnType<typeof memoryKv>,
  path: string,
  init: RequestInit = {},
  hostedApp = mira(),
) {
  const { hostedAuthRouter } = await import("./hosted-auth");
  const headers = new Headers(init.headers);
  headers.set("host", "mira.auth.115jon.site");
  return hostedAuthRouter.request(
    new Request(`https://mira.auth.115jon.site${path}`, { ...init, headers }),
    {},
    env(kv, hostedApp),
  );
}

function bootstrap(html: string): Record<string, unknown> | null {
  const marker = "window.__KOVA_AUTH_HOSTED__ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf(";</script>", start);
  return JSON.parse(html.slice(start + marker.length, end)) as Record<string, unknown>;
}

beforeAll(() => {
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

beforeEach(() => {
  now = base;
  getSession.mockReset();
  getSession.mockResolvedValue(session);
  insertAppScopedSession.mockClear();
});

describe("public device login", () => {
  it("starts a login without putting the device code in the verification URL", async () => {
    const kv = memoryKv();
    const response = await postPub(kv, "pk_live_mira", "start", {
      label: "  desk\n",
      hostname: "joi",
      platform: "windows",
      redirect_uri: "https://evil.example/phish",
      sessionToken: "stolen",
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      interval: number;
      expiresIn: number;
    };
    expect(body.deviceCode).toMatch(/^dvc_[A-Za-z0-9_-]{43}$/);
    expect(body.userCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(body.verificationUri).toBe("https://mira.auth.115jon.site/device");
    expect(body.verificationUriComplete).toBe(`${body.verificationUri}?code=${body.userCode}`);
    expect(body.verificationUriComplete).not.toContain(body.deviceCode);
    expect(JSON.stringify(body)).not.toContain("evil.example");
    expect(JSON.stringify(body)).not.toContain("stolen");
    expect(body.interval).toBe(5);
    expect(body.expiresIn).toBe(600);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unknown and suspended apps on start", async () => {
    const kv = memoryKv();
    const missing = await postPub(kv, "pk_missing", "start", {});
    expect(missing.status).toBe(404);
    const suspended = await postPub(kv, "pk_suspended", "start", {});
    expect(suspended.status).toBe(403);
  });

  it("slows down, then approves into a single-use session token", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };

    const fast = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    expect(fast.status).toBe(429);
    await expect(fast.json()).resolves.toEqual({ error: "slow_down", interval: 5 });

    const mixed = await postPub(kv, "pk_live_mira", "poll", {
      deviceCode: startBody.deviceCode,
      userCode: startBody.userCode,
    });
    expect(mixed.status).toBe(400);
    await expect(mixed.json()).resolves.toEqual({ error: "invalid_device_code" });

    now = base + 5000;
    const pending = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({ status: "pending", interval: 5 });

    const approved = await hosted(kv, "/api/hosted/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode.toLowerCase() }),
    });
    expect(approved.status).toBe(200);
    const approvedText = await approved.text();
    expect(JSON.parse(approvedText)).toEqual({ status: "approved" });
    expect(approvedText).not.toContain("app_session_token");
    expect(insertAppScopedSession).toHaveBeenCalledWith(
      expect.objectContaining({ prepare: expect.any(Function) }),
      expect.objectContaining({
        sessionId: "app_session_id",
        userId: "user_1",
        token: "app_session_token",
        appId: "app_mira",
      }),
    );

    now = base + 10_000;
    const claimed = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    expect(claimed.status).toBe(200);
    await expect(claimed.json()).resolves.toEqual({
      status: "approved",
      sessionToken: "app_session_token",
    });
    const again = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    expect(again.status).toBe(400);
    await expect(again.json()).resolves.toEqual({ error: "expired_token" });

    const second = await hosted(kv, "/api/hosted/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode }),
    });
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: "not_pending", status: "consumed" });
  });

  it("denies a pending login without minting a session", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };

    const denied = await hosted(kv, "/api/hosted/device/deny", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode }),
    });
    expect(denied.status).toBe(200);
    await expect(denied.json()).resolves.toEqual({ status: "denied" });
    expect(insertAppScopedSession).not.toHaveBeenCalled();

    now = base + 5000;
    const polled = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    await expect(polled.json()).resolves.toEqual({ status: "denied" });

    const second = await hosted(kv, "/api/hosted/device/deny", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode }),
    });
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ error: "not_pending", status: "denied" });
  });

  it("treats a publishable-key mismatch as an invalid code", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };
    now = base + 5000;

    const polled = await postPub(kv, "pk_live_other", "poll", { deviceCode: startBody.deviceCode });
    expect(polled.status).toBe(400);
    await expect(polled.json()).resolves.toEqual({ error: "invalid_device_code" });

    const other = mira({
      id: "app_other",
      name: "Other",
      publishable_key: "pk_live_other",
      auth_slug: "other",
    });
    const approved = await hosted(kv, "/api/hosted/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode }),
    }, other);
    expect(approved.status).toBe(400);
    await expect(approved.json()).resolves.toEqual({ error: "invalid_code" });
    expect(insertAppScopedSession).not.toHaveBeenCalled();

    const still = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    await expect(still.json()).resolves.toEqual({ status: "pending", interval: 5 });
  });

  it("rejects expired, unknown, and non-device poll secrets", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };

    const userCode = await postPub(kv, "pk_live_mira", "poll", { userCode: startBody.userCode });
    expect(userCode.status).toBe(400);
    await expect(userCode.json()).resolves.toEqual({ error: "invalid_device_code" });

    const malformed = await postPub(kv, "pk_live_mira", "poll", { deviceCode: "dvc_short" });
    await expect(malformed.json()).resolves.toEqual({ error: "invalid_device_code" });

    const unknownPk = await postPub(kv, "pk_missing", "poll", { deviceCode: startBody.deviceCode });
    await expect(unknownPk.json()).resolves.toEqual({ error: "invalid_device_code" });

    const missing = await postPub(kv, "pk_live_mira", "poll", { deviceCode: `dvc_${"z".repeat(43)}` });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: "expired_token" });

    now = base + 600_000;
    const expired = await postPub(kv, "pk_live_mira", "poll", { deviceCode: startBody.deviceCode });
    await expect(expired.json()).resolves.toEqual({ error: "expired_token" });

    const approveExpired = await hosted(kv, "/api/hosted/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: startBody.userCode }),
    });
    expect(approveExpired.status).toBe(400);
    await expect(approveExpired.json()).resolves.toEqual({ error: "invalid_code" });
  });
});

describe("hosted device approval page", () => {
  it("sends a signed-out person back to the same-origin device URL", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };
    getSession.mockResolvedValue(null);

    const page = await hosted(
      kv,
      `/device?code=${encodeURIComponent(startBody.userCode.toLowerCase())}&redirect_uri=${encodeURIComponent("https://evil.example/phish")}`,
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    const config = bootstrap(html);
    expect(config?.returnPath).toBe(`/device?code=${startBody.userCode}`);
    expect(config?.redirectUri).toBe("");
    expect((config?.app as { homeUrl?: string } | undefined)?.homeUrl).toBe(
      `/device?code=${startBody.userCode}`,
    );
    expect(html).toContain("/assets/hosted-auth.js");
    expect(html).not.toContain(startBody.deviceCode);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("app_session_token");
  });

  it("shows approve and deny only after a hosted session exists", async () => {
    const kv = memoryKv();
    const started = await postPub(kv, "pk_live_mira", "start", {});
    const startBody = await started.json() as { deviceCode: string; userCode: string };

    const page = await hosted(kv, `/device?code=${encodeURIComponent(startBody.userCode)}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="approve-device"');
    expect(html).toContain('id="deny-device"');
    expect(html).toContain("Mira");
    expect(html).toContain(startBody.userCode);
    expect(html).not.toContain("__KOVA_AUTH_HOSTED__");
    expect(html).not.toContain(startBody.deviceCode);
    expect(html).not.toContain("sessionToken");
    expect(html).not.toContain("app_session_token");

    const invalid = await hosted(kv, "/device?code=IIII-OOOO&redirect_uri=https://evil.example/phish");
    expect(invalid.status).toBe(400);
    const invalidHtml = await invalid.text();
    expect(invalidHtml).not.toContain("approve-device");
    expect(invalidHtml).not.toContain("evil.example");
  });

  it("keeps a device return on the sign-in page and drops an external redirect", async () => {
    const page = await hosted(
      memoryKv(),
      "/sign-in?device_return=%2Fdevice%3Fcode%3DABCD-EFGH&redirect_uri=https%3A%2F%2Fevil.example%2Fphish",
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    const config = bootstrap(html);
    expect(config?.returnPath).toBe("/device?code=ABCD-EFGH");
    expect(config?.redirectUri).toBe("");
    expect((config?.app as { homeUrl?: string } | undefined)?.homeUrl).toBe("/device?code=ABCD-EFGH");
    expect(html).not.toContain("evil.example");
  });
});

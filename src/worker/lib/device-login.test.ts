import { describe, expect, it } from "vitest";
import {
  decideDeviceLogin,
  deviceReturnPath,
  formatUserCode,
  getDeviceLogin,
  isSafeDeviceReturnPath,
  normalizeUserCode,
  pollDeviceLogin,
  startDeviceLogin,
} from "./device-login";

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
  } as never;
}

const app = {
  publishableKey: "pk_live_mira",
  appId: "app_mira",
  authUrl: "https://auth.115jon.site",
  authSlug: "mira",
};

describe("device login codes", () => {
  it("normalizes a displayed user code and rejects lookalikes", () => {
    expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeUserCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(normalizeUserCode("abcdefgh")).toBe("ABCDEFGH");
    expect(formatUserCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeUserCode("IIII-OOOO")).toBeNull();
    expect(normalizeUserCode("0000-1111")).toBeNull();
    expect(normalizeUserCode("abcd-efg")).toBeNull();
    expect(normalizeUserCode(12)).toBeNull();
  });

  it("only allows a same-origin /device return path", () => {
    expect(deviceReturnPath("ABCD-EFGH")).toBe("/device?code=ABCD-EFGH");
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH")).toBe(true);
    expect(isSafeDeviceReturnPath("https://evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("//evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH&next=https://evil.example")).toBe(false);
    expect(isSafeDeviceReturnPath("/sign-in?code=ABCD-EFGH")).toBe(false);
  });
});

describe("device login", () => {
  it("starts a pending login whose URL carries only the user code", async () => {
    const kv = memoryKv();
    const started = await startDeviceLogin(kv, {
      ...app,
      hostname: "  joi\n",
      platform: "windows",
      label: "work pc",
    });
    expect("body" in started).toBe(true);
    if (!("body" in started)) return;

    expect(started.body.deviceCode).toMatch(/^dvc_[A-Za-z0-9_-]{43}$/);
    expect(started.body.userCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(started.body.verificationUri).toBe("https://mira.auth.115jon.site/device");
    expect(started.body.verificationUriComplete).toBe(
      `https://mira.auth.115jon.site/device?code=${started.body.userCode}`,
    );
    expect(started.body.verificationUriComplete).not.toContain(started.body.deviceCode);
    expect(started.body.interval).toBe(5);
    expect(started.body.expiresIn).toBe(600);

    const stored = await getDeviceLogin(kv, started.body.deviceCode);
    expect(stored?.status).toBe("pending");
    expect(stored?.sessionToken).toBeNull();
    expect(stored?.publishableKey).toBe("pk_live_mira");
    expect(stored?.hostname).toBe("joi");
  });

  it("retries when the user code is already indexed", async () => {
    const kv = memoryKv();
    const first = await startDeviceLogin(kv, app, {
      deviceCode: () => `dvc_${"a".repeat(43)}`,
      userCode: () => "AAAAAAAA",
    });
    expect("body" in first && first.body.userCode).toBe("AAAA-AAAA");

    let calls = 0;
    const second = await startDeviceLogin(kv, app, {
      deviceCode: () => `dvc_${"b".repeat(43)}`,
      userCode: () => {
        calls += 1;
        return calls === 1 ? "AAAAAAAA" : "BBBBBBBB";
      },
    });
    expect(calls).toBeGreaterThan(1);
    expect("body" in second && second.body.userCode).toBe("BBBB-BBBB");
    expect("body" in second && second.body.deviceCode).toBe(`dvc_${"b".repeat(43)}`);
  });

  it("slows down a fast poll without changing the record", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const started = await startDeviceLogin(kv, { ...app, now });
    if (!("body" in started)) throw new Error("start failed");
    const before = await getDeviceLogin(kv, started.body.deviceCode);

    const fast = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 4999,
    });
    expect(fast).toEqual({ error: "slow_down", interval: 5 });
    expect(await getDeviceLogin(kv, started.body.deviceCode)).toEqual(before);

    const pending = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 5000,
    });
    expect(pending).toEqual({ status: "pending", interval: 5 });
  });

  it("approves then returns the session token on exactly one poll", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const started = await startDeviceLogin(kv, { ...app, now });
    if (!("body" in started)) throw new Error("start failed");

    const approved = await decideDeviceLogin(kv, {
      ...app,
      userCode: ` ${started.body.userCode.toLowerCase()} `.trim(),
      decision: "approved",
      sessionToken: "raw_session_token",
      approverUserId: "user_1",
      now: now + 1000,
    });
    expect(approved).toEqual({ status: "approved" });

    const tooSoon = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 1000,
    });
    expect(tooSoon).toEqual({ error: "slow_down", interval: 5 });

    const claimed = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 5000,
    });
    expect(claimed).toEqual({ status: "approved", sessionToken: "raw_session_token" });

    const again = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 11_000,
    });
    expect(again).toEqual({ error: "expired_token" });
    const stored = await getDeviceLogin(kv, started.body.deviceCode);
    expect(stored?.status).toBe("consumed");
    expect(stored?.sessionToken).toBeNull();
  });

  it("denies once and rejects a second decision", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const started = await startDeviceLogin(kv, { ...app, now });
    if (!("body" in started)) throw new Error("start failed");

    expect(await decideDeviceLogin(kv, {
      ...app,
      userCode: started.body.userCode,
      decision: "denied",
      approverUserId: "user_1",
      now,
    })).toEqual({ status: "denied" });

    expect(await decideDeviceLogin(kv, {
      ...app,
      userCode: started.body.userCode,
      decision: "approved",
      sessionToken: "should_not_store",
      approverUserId: "user_1",
      now,
    })).toEqual({ error: "not_pending", status: "denied" });

    const polled = await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 5000,
    });
    expect(polled).toEqual({ status: "denied" });
    expect(await getDeviceLogin(kv, started.body.deviceCode)).toMatchObject({ sessionToken: null });
  });

  it("hides a publishable-key mismatch as an invalid code", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const started = await startDeviceLogin(kv, { ...app, now });
    if (!("body" in started)) throw new Error("start failed");

    expect(await pollDeviceLogin(kv, {
      publishableKey: "pk_live_other",
      appId: "app_other",
      deviceCode: started.body.deviceCode,
      now: now + 5000,
    })).toEqual({ error: "invalid_device_code" });

    expect(await decideDeviceLogin(kv, {
      publishableKey: "pk_live_other",
      appId: "app_other",
      userCode: started.body.userCode,
      decision: "approved",
      sessionToken: "nope",
      approverUserId: "user_2",
      now,
    })).toEqual({ error: "invalid_code" });

    expect(await getDeviceLogin(kv, started.body.deviceCode)).toMatchObject({
      status: "pending",
      sessionToken: null,
    });
  });

  it("does not start a hosted URL without an auth slug", async () => {
    const started = await startDeviceLogin(memoryKv(), { ...app, authSlug: null });
    expect(started).toEqual({ error: "device_flow_unavailable" });
  });

  it("rejects expired, missing, and non-device codes", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const started = await startDeviceLogin(kv, { ...app, now });
    if (!("body" in started)) throw new Error("start failed");

    expect(await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.userCode,
      now: now + 5000,
    })).toEqual({ error: "invalid_device_code" });
    expect(await pollDeviceLogin(kv, {
      ...app,
      deviceCode: "dvc_short",
      now,
    })).toEqual({ error: "invalid_device_code" });
    expect(await pollDeviceLogin(kv, {
      ...app,
      deviceCode: `dvc_${"c".repeat(43)}`,
      now,
    })).toEqual({ error: "expired_token" });
    expect(await pollDeviceLogin(kv, {
      ...app,
      deviceCode: started.body.deviceCode,
      now: now + 600_000,
    })).toEqual({ error: "expired_token" });
    expect(await decideDeviceLogin(kv, {
      ...app,
      userCode: "ZZZZ-ZZZZ",
      decision: "denied",
      approverUserId: "user_1",
      now,
    })).toEqual({ error: "invalid_code" });
  });
});

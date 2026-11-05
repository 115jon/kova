import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountApiError,
  activityLabel,
  deviceLabel,
  getAccountActivity,
  getAccountSessions,
  isFailedActivity,
  locationLabel,
  relativeTime,
  revokeAccountSession,
  revokeOtherAccountSessions,
} from "./account";

const options = { authUrl: "https://auth.example.com/", publishableKey: "pk_test_abc", sessionToken: "tok_123" };
const base = "https://auth.example.com/api/pub/apps/pk_test_abc/account";

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function firstCall(fetchMock: ReturnType<typeof mockFetch>) {
  const [input, init] = fetchMock.mock.calls[0]!;
  return { url: String(input), init: init!, headers: init!.headers as Record<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account fetchers", () => {
  it("lists sessions with bearer and publishable key headers", async () => {
    const session = {
      id: "s1",
      appName: null,
      current: true,
      createdAt: 1,
      lastActiveAt: 2,
      country: "PT",
      city: "Lisbon",
      client: { browser: "Safari", os: "iOS" },
    };
    const fetchMock = mockFetch({ sessions: [session] });

    await expect(getAccountSessions(options)).resolves.toEqual([session]);
    const { url, init, headers } = firstCall(fetchMock);
    expect(url).toBe(`${base}/sessions`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(headers.Authorization).toBe("Bearer tok_123");
    expect(headers["X-Publishable-Key"]).toBe("pk_test_abc");
    expect(init.body).toBeUndefined();
  });

  it("pages activity with before and a clamped limit", async () => {
    const fetchMock = mockFetch({ events: [], nextCursor: "c2" });

    await expect(getAccountActivity(options, { before: "c1", limit: 20 })).resolves.toEqual({
      events: [],
      nextCursor: "c2",
    });
    expect(firstCall(fetchMock).url).toBe(`${base}/activity?before=c1&limit=20`);

    fetchMock.mockClear();
    await getAccountActivity(options, { limit: 500 });
    expect(firstCall(fetchMock).url).toBe(`${base}/activity?limit=50`);

    fetchMock.mockClear();
    await getAccountActivity(options);
    expect(firstCall(fetchMock).url).toBe(`${base}/activity`);
  });

  it("revokes one session with its id in the body", async () => {
    const fetchMock = mockFetch({ ok: true });

    await revokeAccountSession(options, "s2");
    const { url, init, headers } = firstCall(fetchMock);
    expect(url).toBe(`${base}/sessions/revoke`);
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer tok_123");
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: "s2" });
  });

  it("revokes other sessions and returns the count", async () => {
    const fetchMock = mockFetch({ ok: true, revoked: 3 });

    await expect(revokeOtherAccountSessions(options)).resolves.toBe(3);
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe(`${base}/sessions/revoke-others`);
    expect(init.method).toBe("POST");
  });

  it("throws AccountApiError with the server error and status", async () => {
    mockFetch({ error: "invalid_session" }, 401);

    const error = await getAccountSessions(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountApiError);
    expect(error).toMatchObject({ message: "invalid_session", status: 401 });
  });

  it("reports network failures as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(getAccountSessions(options)).rejects.toMatchObject({ status: 0 });
  });
});

describe("account display helpers", () => {
  it("labels devices", () => {
    expect(deviceLabel({ browser: "Safari", os: "iOS" })).toBe("Safari on iOS");
    expect(deviceLabel({ os: "Android" })).toBe("Android");
    expect(deviceLabel(null)).toBe("Unknown device");
  });

  it("labels locations", () => {
    expect(locationLabel("Lisbon", "PT", "en")).toBe("Lisbon, Portugal");
    expect(locationLabel(null, "PT", "en")).toBe("Portugal");
    expect(locationLabel(null, null)).toBeNull();
  });

  it("labels activity", () => {
    expect(activityLabel("user.signIn")).toBe("Signed in");
    expect(activityLabel("user.signInMagicLink")).toBe("Signed in");
    expect(activityLabel("user.signInFailed")).toBe("Failed sign-in");
    expect(activityLabel("app.signIn")).toBe("Signed in to app");
    expect(activityLabel("twoFactor.challengeFailed")).toBe("Failed 2FA");
    expect(activityLabel("org.memberAdded")).toBe("Org member added");
    expect(isFailedActivity("user.signInFailed")).toBe(true);
    expect(isFailedActivity("user.signIn")).toBe(false);
  });

  it("formats relative times", () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(relativeTime(now - 10_000, now, "en")).toBe("Just now");
    expect(relativeTime(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
    expect(relativeTime(now - 3 * 3_600_000, now, "en")).toBe("3 hours ago");
    expect(relativeTime(now - 24 * 3_600_000, now, "en")).toBe("yesterday");
  });
});

import { describe, expect, it, vi } from "vitest";
import { approveDeviceRequest, denyDeviceRequest, getDeviceRequest, releaseDeviceRequest, type DeviceApprovalOptions } from "./device-approval";
import { createDeviceChallenge, DEFAULT_KOVA_URL, pollDeviceChallenge, resolveApproveUrl } from "./device";
import { startDeviceSignIn } from "./device-sign-in";
import { KOVA_HOSTED_AUTH_URL, resolveAuthUrl } from "./key";

const AUTH = "https://auth.example.com/";
const PK = "pk_live_ralph";
const BASE = `https://auth.example.com/api/pub/apps/${PK}/device`;

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function opts(fetchImpl: typeof fetch, overrides: Partial<DeviceApprovalOptions> = {}): DeviceApprovalOptions {
  return { authUrl: AUTH, publishableKey: PK, sessionToken: "tok_app", userCode: "abcd-efgh", fetch: fetchImpl, ...overrides };
}

const REQUEST = {
  userCode: "ABCD-EFGH",
  status: "pending",
  device: { label: "Ralph Meet", platform: "Windows", hostname: "ada-pc" },
  requester: { city: "Lisbon", country: "PT", ip: "203.0.113.7" },
  expiresAt: "2026-10-22T12:10:00.000Z",
};

describe("device approval client", () => {
  it("looks a code up with the bearer, no cookies, and returns the typed request", async () => {
    const { fetchImpl, calls } = fakeFetch([reply(200, REQUEST)]);
    const result = await getDeviceRequest(opts(fetchImpl));
    expect(result).toEqual({ ok: true, request: REQUEST });
    expect(calls[0]!.url).toBe(`${BASE}/lookup`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.credentials).toBe("omit");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer tok_app");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ userCode: "abcd-efgh" });
  });

  it("fills missing device fields with null", async () => {
    const { fetchImpl } = fakeFetch([reply(200, { userCode: "ABCD-EFGH", status: "approved", device: {}, requester: { ip: "" } })]);
    const result = await getDeviceRequest(opts(fetchImpl));
    expect(result).toEqual({
      ok: true,
      request: {
        userCode: "ABCD-EFGH",
        status: "approved",
        device: { label: null, platform: null, hostname: null },
        requester: { city: null, country: null, ip: null },
        expiresAt: null,
      },
    });
  });

  it("approves and denies", async () => {
    const { fetchImpl, calls } = fakeFetch([reply(200, { status: "approved" }), reply(200, { status: "denied" })]);
    expect(await approveDeviceRequest(opts(fetchImpl))).toEqual({ ok: true, status: "approved" });
    expect(await denyDeviceRequest(opts(fetchImpl))).toEqual({ ok: true, status: "denied" });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/approve`, `${BASE}/deny`]);
  });

  it("returns server error codes with status and message", async () => {
    const { fetchImpl } = fakeFetch([
      reply(409, { error: "not_claimed", message: "Look the code up first" }),
      reply(403, { error: "origin_not_allowed", message: "nope" }),
      reply(401, { error: "invalid_session", message: "Sign in again" }),
    ]);
    expect(await approveDeviceRequest(opts(fetchImpl))).toEqual({ ok: false, error: "not_claimed", status: 409, message: "Look the code up first" });
    expect((await getDeviceRequest(opts(fetchImpl))).ok).toBe(false);
    expect(await denyDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "invalid_session", status: 401 });
  });

  it("reads Retry-After on rate_limited", async () => {
    const { fetchImpl } = fakeFetch([reply(429, { error: "rate_limited", message: "slow" }, { "retry-after": "42" })]);
    expect(await getDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "rate_limited", retryAfterSeconds: 42 });
  });

  it("never throws: network failures, unknown errors, and odd bodies", async () => {
    const { fetchImpl } = fakeFetch([
      new TypeError("Failed to fetch"),
      reply(502, "<html>bad gateway</html>"),
      reply(400, { error: "something_new" }),
      reply(200, { status: "weird" }),
      reply(200, { status: "approved" }),
    ]);
    expect(await getDeviceRequest(opts(fetchImpl))).toEqual({ ok: false, error: "network_error", status: 0, message: "Failed to fetch" });
    expect(await getDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "unexpected_response", status: 502 });
    expect(await approveDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "unexpected_response", status: 400 });
    expect(await approveDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "unexpected_response", status: 200 });
    expect(await getDeviceRequest(opts(fetchImpl))).toMatchObject({ error: "unexpected_response" });
  });

  it("releases a claim, with the same request shape and error style", async () => {
    const { fetchImpl, calls } = fakeFetch([
      reply(200, { status: "released" }),
      reply(403, { error: "access_denied", message: "Another account is already reviewing this code" }),
      reply(409, { error: "already_processed", message: "done" }),
      reply(200, { status: "approved" }),
      new TypeError("offline"),
    ]);
    expect(await releaseDeviceRequest(opts(fetchImpl))).toEqual({ ok: true, status: "released" });
    expect(calls[0]!.url).toBe(`${BASE}/release`);
    expect(calls[0]!.init.credentials).toBe("omit");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer tok_app");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ userCode: "abcd-efgh" });
    expect(await releaseDeviceRequest(opts(fetchImpl))).toEqual({ ok: false, error: "access_denied", status: 403, message: "Another account is already reviewing this code" });
    expect(await releaseDeviceRequest(opts(fetchImpl))).toMatchObject({ ok: false, error: "already_processed", status: 409 });
    expect(await releaseDeviceRequest(opts(fetchImpl))).toMatchObject({ ok: false, error: "unexpected_response" });
    expect(await releaseDeviceRequest(opts(fetchImpl))).toMatchObject({ ok: false, error: "network_error", status: 0 });
  });

  it("encodes the publishable key into the path", async () => {
    const { fetchImpl, calls } = fakeFetch([reply(200, { status: "denied" })]);
    await denyDeviceRequest(opts(fetchImpl, { publishableKey: "pk/odd" }));
    expect(calls[0]!.url).toBe("https://auth.example.com/api/pub/apps/pk%2Fodd/device/deny");
  });
});

describe("configured auth host", () => {
  const DEFAULT_HOSTS = [new URL(DEFAULT_KOVA_URL).host, new URL(KOVA_HOSTED_AUTH_URL).host];

  it("sends nothing to the default host when authUrl is set", async () => {
    const { fetchImpl, calls } = fakeFetch([
      reply(200, REQUEST),
      reply(200, { status: "approved" }),
      reply(200, { status: "denied" }),
      reply(200, { status: "released" }),
      reply(200, { id: "dc_aaaaaaaaaaaaaaaaaaaaaaaa", status: "pending" }),
      reply(200, { id: "dc_aaaaaaaaaaaaaaaaaaaaaaaa", status: "pending" }),
      reply(201, {
        deviceCode: "dvc_x",
        userCode: "ABCD-EFGH",
        verificationUri: "https://meet.example.com/activate",
        verificationUriComplete: "https://meet.example.com/activate?code=ABCD-EFGH",
        interval: 5,
        expiresIn: 600,
      }),
      new Response(null, { status: 204 }),
    ]);
    await getDeviceRequest(opts(fetchImpl));
    await approveDeviceRequest(opts(fetchImpl));
    await denyDeviceRequest(opts(fetchImpl));
    await releaseDeviceRequest(opts(fetchImpl));
    const challenge = await createDeviceChallenge(AUTH, {}, fetchImpl);
    await pollDeviceChallenge(AUTH, challenge.id, fetchImpl);
    const signIn = startDeviceSignIn({ authUrl: AUTH, publishableKey: PK, fetch: fetchImpl });
    await vi.waitFor(() => expect(signIn.state.status).toBe("pending"));
    signIn.cancel();
    await signIn.done;

    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) {
      expect(new URL(call.url).host).toBe("auth.example.com");
      expect(DEFAULT_HOSTS).not.toContain(new URL(call.url).host);
    }
  });

  it("builds URLs from the configured host, not the default", () => {
    expect(resolveAuthUrl({ authUrl: "https://auth.example.com/", publishableKey: "pk_live_opaque" })).toBe("https://auth.example.com");
    const challenge = { id: "dc_aaaaaaaaaaaaaaaaaaaaaaaa", status: "pending" as const };
    expect(resolveApproveUrl(challenge, AUTH)).toBe("https://auth.example.com/approve/dc_aaaaaaaaaaaaaaaaaaaaaaaa");
    // The server's own approveUrl still wins; the default host only when nothing is configured.
    expect(resolveApproveUrl({ ...challenge, approveUrl: "https://dash.example.com/approve/x" }, AUTH)).toBe("https://dash.example.com/approve/x");
    expect(resolveApproveUrl(challenge)).toBe(`${DEFAULT_KOVA_URL}/approve/dc_aaaaaaaaaaaaaaaaaaaaaaaa`);
  });
});

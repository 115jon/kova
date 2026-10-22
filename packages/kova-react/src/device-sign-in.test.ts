import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDeviceSignIn, type DeviceSignInState } from "./device-sign-in";

const AUTH = "https://auth.115jon.site/";
const PK = "pk_live_ralph";
const BASE = `https://auth.115jon.site/api/pub/apps/${PK}/device`;
const DEVICE_CODE = "dvc_secret_device_code_never_in_state_xxxxxxxxx";
const T0 = new Date("2026-10-21T12:00:00.000Z").getTime();

const STARTED = {
  deviceCode: DEVICE_CODE,
  userCode: "ABCD-EFGH",
  verificationUri: "https://ralph.auth.115jon.site/device",
  verificationUriComplete: "https://ralph.auth.115jon.site/device?code=ABCD-EFGH",
  interval: 5,
  expiresIn: 600,
};

type Reply = Response | Error | (() => Promise<Response>);

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers from per-endpoint queues and records every call. */
function fakeFetch(queues: { start?: Reply[]; poll?: Reply[]; cancel?: Reply[] }) {
  const calls: Array<{ endpoint: string; at: number; body: unknown; signal?: AbortSignal | null }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const endpoint = url.slice(BASE.length + 1);
    calls.push({ endpoint, at: Date.now() - T0, body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal });
    const next = queues[endpoint as keyof typeof queues]?.shift();
    if (!next) throw new Error(`unexpected ${endpoint}`);
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function run(fetchImpl: typeof fetch) {
  const states: DeviceSignInState[] = [];
  const signIn = startDeviceSignIn({
    authUrl: AUTH,
    publishableKey: PK,
    device: { hostname: "ada-laptop", platform: "Windows" },
    onChange: (state) => states.push(state),
    fetch: fetchImpl,
  });
  return { signIn, states };
}

describe("startDeviceSignIn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts, shows the code, and never exposes the device code", async () => {
    const { fetchImpl, calls } = fakeFetch({ start: [reply(201, STARTED)], poll: [reply(200, { status: "approved", sessionToken: "tok" })] });
    const { signIn, states } = run(fetchImpl);
    expect(signIn.state).toEqual({ status: "starting" });
    await vi.advanceTimersByTimeAsync(0);

    expect(signIn.state).toEqual({
      status: "pending",
      userCode: "ABCD-EFGH",
      verificationUri: STARTED.verificationUri,
      verificationUriComplete: STARTED.verificationUriComplete,
      expiresAt: T0 + 600_000,
      interval: 5,
    });
    expect(calls[0]).toMatchObject({ endpoint: "start", body: { hostname: "ada-laptop", platform: "Windows" } });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(await signIn.done).toEqual({ status: "approved", sessionToken: "tok" });
    expect(JSON.stringify(states)).not.toContain(DEVICE_CODE);
    expect(calls[1]).toMatchObject({ endpoint: "poll", at: 5_000, body: { deviceCode: DEVICE_CODE } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits the interval, adds 5s on slow_down, and settles on approval", async () => {
    const { fetchImpl, calls } = fakeFetch({
      start: [reply(201, STARTED)],
      poll: [
        reply(200, { status: "pending", interval: 5 }),
        reply(429, { error: "slow_down", interval: 5 }),
        reply(200, { status: "pending", interval: 5 }),
        reply(200, { status: "approved", sessionToken: "tok" }),
      ],
    });
    const { signIn, states } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls.map((call) => [call.endpoint, call.at])).toEqual([
      ["start", 0],
      ["poll", 5_000],
      ["poll", 10_000],
      ["poll", 20_000],
      ["poll", 30_000],
    ]);
    expect(states.filter((s) => s.status === "pending").map((s) => (s as { interval: number }).interval)).toEqual([5, 10]);
    expect(signIn.state).toEqual({ status: "approved", sessionToken: "tok" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports denied and expired", async () => {
    const denied = run(fakeFetch({ start: [reply(201, STARTED)], poll: [reply(200, { status: "denied" })] }).fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await denied.signIn.done).toEqual({ status: "denied" });

    const expired = run(fakeFetch({ start: [reply(201, STARTED)], poll: [reply(400, { error: "expired_token" })] }).fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await expired.signIn.done).toEqual({ status: "expired" });
  });

  it("expires at the deadline without polling past it", async () => {
    const pending = Array.from({ length: 200 }, () => reply(200, { status: "pending", interval: 5 }));
    const { fetchImpl, calls } = fakeFetch({ start: [reply(201, { ...STARTED, expiresIn: 12 })], poll: pending });
    const { signIn } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await signIn.done).toEqual({ status: "expired" });
    expect(calls.filter((call) => call.endpoint === "poll").map((call) => call.at)).toEqual([5_000, 10_000, 12_000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries network errors and 5xx with backoff without surfacing an error", async () => {
    const { fetchImpl, calls } = fakeFetch({
      start: [reply(201, STARTED)],
      poll: [new TypeError("offline"), reply(503, { error: "server_error" }), reply(200, { status: "approved", sessionToken: "tok" })],
    });
    const { signIn, states } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states.some((s) => s.status === "error")).toBe(false);
    expect(await signIn.done).toEqual({ status: "approved", sessionToken: "tok" });
    // 5s, then +10s (2× interval), then +20s (4× interval).
    expect(calls.filter((call) => call.endpoint === "poll").map((call) => call.at)).toEqual([5_000, 15_000, 35_000]);
  });

  it("surfaces a failed start as an error, retryable only when transient", async () => {
    const offline = run(fakeFetch({ start: [new TypeError("offline")] }).fetchImpl);
    expect(await offline.signIn.done).toEqual({ status: "error", error: "network_error", retryable: true });

    const missing = run(fakeFetch({ start: [reply(404, { error: "Application not found" })] }).fetchImpl);
    expect(await missing.signIn.done).toEqual({ status: "error", error: "Application not found", retryable: false });

    const unavailable = run(fakeFetch({ start: [reply(409, { error: "device_flow_unavailable" })] }).fetchImpl);
    expect(await unavailable.signIn.done).toEqual({ status: "error", error: "device_flow_unavailable", retryable: false });

    const down = run(fakeFetch({ start: [reply(502, {})] }).fetchImpl);
    expect(await down.signIn.done).toEqual({ status: "error", error: "http_502", retryable: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends with a non-retryable error for a refusal it cannot wait out", async () => {
    const { signIn } = run(fakeFetch({ start: [reply(201, STARTED)], poll: [reply(403, { error: "mfa_required" })] }).fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await signIn.done).toEqual({ status: "error", error: "mfa_required", retryable: false });
  });

  it("cancels: aborts the in-flight poll, drops the code server-side, leaves no timers", async () => {
    let releasePoll!: (response: Response) => void;
    const { fetchImpl, calls } = fakeFetch({
      start: [reply(201, STARTED)],
      poll: [() => new Promise<Response>((resolve) => { releasePoll = resolve; })],
      cancel: [new Response(null, { status: 204 })],
    });
    const { signIn } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    const pollCall = calls.find((call) => call.endpoint === "poll")!;

    signIn.cancel();
    expect(signIn.state).toEqual({ status: "cancelled" });
    expect(pollCall.signal?.aborted).toBe(true);
    expect(calls[calls.length - 1]).toMatchObject({ endpoint: "cancel", body: { deviceCode: DEVICE_CODE } });

    releasePoll(reply(200, { status: "approved", sessionToken: "late" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await signIn.done).toEqual({ status: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels while starting without a server call", async () => {
    const { fetchImpl, calls } = fakeFetch({ start: [() => new Promise<Response>(() => {})] });
    const { signIn } = run(fetchImpl);
    signIn.cancel();
    expect(await signIn.done).toEqual({ status: "cancelled" });
    expect(calls.map((call) => call.endpoint)).toEqual(["start"]);
    expect(calls[0]!.signal?.aborted).toBe(true);
  });

  it("nudge polls early only after a full interval, and never overlaps a request", async () => {
    let releasePoll!: (response: Response) => void;
    const { fetchImpl, calls } = fakeFetch({
      start: [reply(201, STARTED)],
      poll: [
        reply(200, { status: "pending", interval: 5 }),
        () => new Promise<Response>((resolve) => { releasePoll = resolve; }),
      ],
    });
    const { signIn } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(0);

    signIn.nudge(); // too soon after start
    expect(calls.filter((call) => call.endpoint === "poll")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000); // scheduled poll → pending
    await vi.advanceTimersByTimeAsync(2_000);
    signIn.nudge(); // 2s since last poll: ignored
    expect(calls.filter((call) => call.endpoint === "poll")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3_000); // scheduled poll #2 starts and hangs
    expect(calls.filter((call) => call.endpoint === "poll")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    signIn.nudge(); // a request is in flight: ignored
    expect(calls.filter((call) => call.endpoint === "poll")).toHaveLength(2);

    releasePoll(reply(200, { status: "approved", sessionToken: "tok" }));
    expect(await signIn.done).toEqual({ status: "approved", sessionToken: "tok" });
  });

  it("nudge on focus polls right away once the interval has passed", async () => {
    const { fetchImpl, calls } = fakeFetch({
      start: [reply(201, { ...STARTED, interval: 30 })],
      poll: [reply(200, { status: "approved", sessionToken: "tok" })],
    });
    const { signIn } = run(fetchImpl);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(T0 + 31_000); // the tab slept; its timer has not fired yet
    signIn.nudge();
    expect(await signIn.done).toEqual({ status: "approved", sessionToken: "tok" });
    expect(calls.filter((call) => call.endpoint === "poll")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

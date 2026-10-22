/**
 * Device sign-in (RFC 8628) for desktop apps, CLIs, and TVs.
 * No React. Safe from Electron main, a Tauri webview, Node, or a browser.
 *
 * ```ts
 * const signIn = startDeviceSignIn({
 *   authUrl: "https://auth.115jon.site",
 *   publishableKey: "pk_live_…",
 *   device: { hostname: os.hostname(), platform: "Windows" },
 *   onChange(state) {
 *     if (state.status === "pending") show(state.userCode, state.verificationUriComplete);
 *   },
 * });
 * window.addEventListener("focus", () => signIn.nudge());
 * const result = await signIn.done; // approved | denied | expired | cancelled | error
 * ```
 *
 * The device code never leaves this module: state carries only what the user
 * should see. Polling waits `interval` seconds between requests, adds 5s on
 * every slow_down, retries network and 5xx failures quietly until the code
 * expires, and leaves no timer running once it settles.
 */

export type DeviceSignInState =
  | { status: "starting" }
  | {
      status: "pending";
      /** Display form, XXXX-XXXX. */
      userCode: string;
      verificationUri: string;
      /** verificationUri with the code filled in. */
      verificationUriComplete: string;
      /** Epoch milliseconds. */
      expiresAt: number;
      /** Seconds between polls. Grows by 5 on every slow_down. */
      interval: number;
    }
  | { status: "approved"; sessionToken: string }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "cancelled" }
  | { status: "error"; error: string; retryable: boolean };

export interface DeviceSignInOptions {
  authUrl: string;
  publishableKey: string;
  device?: { hostname?: string; platform?: string; label?: string };
  onChange?: (state: DeviceSignInState) => void;
  fetch?: typeof fetch;
}

export interface DeviceSignIn {
  readonly state: DeviceSignInState;
  /** Resolves with the terminal state. Never rejects. */
  done: Promise<DeviceSignInState>;
  /** Stops polling and tells the server to drop the code (best effort). */
  cancel(): void;
  /** Polls now if at least `interval` has passed since the last poll (call on window focus). */
  nudge(): void;
}

type StartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
};

const SLOW_DOWN_STEP_SECONDS = 5;
const MAX_RETRY_DELAY_MS = 30_000;

function isTerminal(state: DeviceSignInState): boolean {
  return state.status !== "starting" && state.status !== "pending";
}

function isStartResponse(value: unknown): value is StartResponse {
  const v = value as Partial<StartResponse> | null;
  return !!v
    && typeof v.deviceCode === "string" && !!v.deviceCode
    && typeof v.userCode === "string"
    && typeof v.verificationUri === "string"
    && typeof v.verificationUriComplete === "string"
    && typeof v.interval === "number" && v.interval > 0
    && typeof v.expiresIn === "number" && v.expiresIn > 0;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function startDeviceSignIn(options: DeviceSignInOptions): DeviceSignIn {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const base = `${options.authUrl.replace(/\/+$/, "")}/api/pub/apps/${encodeURIComponent(options.publishableKey)}/device`;

  let state: DeviceSignInState = { status: "starting" };
  let deviceCode: string | null = null;
  let deadline = 0;
  let intervalMs = 0;
  let lastPollAt = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  const controller = new AbortController();

  let resolveDone!: (state: DeviceSignInState) => void;
  const done = new Promise<DeviceSignInState>((resolve) => {
    resolveDone = resolve;
  });

  function emit(next: DeviceSignInState) {
    if (isTerminal(state)) return;
    state = next;
    try {
      options.onChange?.(next);
    } catch {
      // A throwing listener must not stop the flow.
    }
    if (isTerminal(next)) {
      clearTimer();
      controller.abort();
      resolveDone(next);
    }
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delayMs: number) {
    clearTimer();
    if (isTerminal(state)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      emit({ status: "expired" });
      return;
    }
    // One last poll at the deadline can still catch a late approval.
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, Math.max(0, Math.min(delayMs, remaining)));
  }

  function pendingState(start: StartResponse): DeviceSignInState {
    return {
      status: "pending",
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresAt: deadline,
      interval: intervalMs / 1000,
    };
  }

  let started: StartResponse | null = null;

  async function begin() {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Publishable-Key": options.publishableKey },
        body: JSON.stringify({
          hostname: options.device?.hostname,
          platform: options.device?.platform,
          label: options.device?.label,
        }),
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted) emit({ status: "error", error: "network_error", retryable: true });
      return;
    }
    if (isTerminal(state)) return;
    const body = await readJson(response);
    if (isTerminal(state)) return;
    if (!response.ok || !isStartResponse(body)) {
      const error = typeof body.error === "string" ? body.error : `http_${response.status}`;
      const retryable = response.status >= 500 || response.status === 429 || (response.ok && !isStartResponse(body));
      emit({ status: "error", error, retryable });
      return;
    }
    started = body;
    deviceCode = body.deviceCode;
    deadline = Date.now() + body.expiresIn * 1000;
    intervalMs = body.interval * 1000;
    emit(pendingState(body));
    lastPollAt = Date.now();
    schedule(intervalMs);
  }

  async function poll() {
    if (isTerminal(state) || inFlight || !deviceCode) return;
    if (Date.now() > deadline) {
      emit({ status: "expired" });
      return;
    }
    clearTimer();
    inFlight = true;
    lastPollAt = Date.now();
    let response: Response | null = null;
    let body: Record<string, unknown> = {};
    try {
      response = await fetchImpl(`${base}/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Publishable-Key": options.publishableKey },
        body: JSON.stringify({ deviceCode }),
        signal: controller.signal,
      });
      body = await readJson(response);
    } catch {
      response = null;
    } finally {
      inFlight = false;
    }
    if (isTerminal(state)) return;

    if (response === null || response.status >= 500 || (response.status === 429 && body.error !== "slow_down")) {
      // Transient: back off quietly and try again until the code expires.
      failures += 1;
      schedule(Math.min(intervalMs * 2 ** failures, MAX_RETRY_DELAY_MS));
      return;
    }
    failures = 0;

    if (response.status === 429) {
      intervalMs += SLOW_DOWN_STEP_SECONDS * 1000;
      if (started) emit(pendingState(started));
      schedule(intervalMs);
      return;
    }
    if (response.ok && body.status === "pending") {
      schedule(intervalMs);
      return;
    }
    if (response.ok && body.status === "approved" && typeof body.sessionToken === "string" && body.sessionToken) {
      emit({ status: "approved", sessionToken: body.sessionToken });
      return;
    }
    if (response.ok && body.status === "denied") {
      emit({ status: "denied" });
      return;
    }
    if (body.error === "expired_token") {
      emit({ status: "expired" });
      return;
    }
    if (body.error === "invalid_device_code" && Date.now() >= deadline) {
      emit({ status: "expired" });
      return;
    }
    emit({ status: "error", error: typeof body.error === "string" ? body.error : `http_${response.status}`, retryable: false });
  }

  void begin();

  return {
    get state() {
      return state;
    },
    done,
    cancel() {
      if (isTerminal(state)) return;
      const code = deviceCode;
      emit({ status: "cancelled" });
      if (code) {
        // Not tied to the aborted signal; failure only means the code expires on its own.
        void fetchImpl(`${base}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Publishable-Key": options.publishableKey },
          body: JSON.stringify({ deviceCode: code }),
        }).catch(() => {});
      }
    },
    nudge() {
      if (state.status !== "pending" || inFlight) return;
      if (Date.now() - lastPollAt < intervalMs) return;
      void poll();
    },
  };
}

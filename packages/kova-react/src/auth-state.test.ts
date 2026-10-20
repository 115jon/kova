import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingState,
  createHostedSignInUrl,
  createPasswordResetUrl,
  createPendingState,
  pendingStateKey,
} from "./auth-state";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const pk = "pk_test";

afterEach(() => vi.unstubAllGlobals());

describe("pending states", () => {
  it("accepts a minted state once", () => {
    const s = fakeStorage();
    const state = createPendingState(s, pk);
    expect(state).toMatch(/^[A-Za-z0-9._~-]{1,256}$/);
    expect(consumePendingState(s, pk, state)).toBe(true);
    expect(consumePendingState(s, pk, state)).toBe(false);
  });

  it("refuses a wrong or missing state and keeps the real one", () => {
    const s = fakeStorage();
    const state = createPendingState(s, pk);
    expect(consumePendingState(s, pk, "other")).toBe(false);
    expect(consumePendingState(s, pk, null)).toBe(false);
    expect(consumePendingState(s, pk, state)).toBe(true);
  });

  it("prunes expired entries", () => {
    const s = fakeStorage();
    const state = createPendingState(s, pk, 1000);
    const day = 24 * 60 * 60 * 1000;
    expect(consumePendingState(s, pk, state, 1000 + day)).toBe(false);
    expect(JSON.parse(s.getItem(pendingStateKey(pk))!)).toEqual([]);
  });

  it("keeps only the newest five", () => {
    const s = fakeStorage();
    const states = Array.from({ length: 6 }, (_, i) => createPendingState(s, pk, 1000 + i));
    expect(consumePendingState(s, pk, states[0]!, 2000)).toBe(false);
    expect(consumePendingState(s, pk, states[5]!, 2000)).toBe(true);
  });

  it("without storage still returns a state but never accepts one", () => {
    const state = createPendingState(null, pk);
    expect(typeof state).toBe("string");
    expect(consumePendingState(null, pk, state)).toBe(false);
  });

  it("survives malformed stored data", () => {
    const s = fakeStorage();
    s.setItem(pendingStateKey(pk), "{nope");
    const state = createPendingState(s, pk);
    expect(consumePendingState(s, pk, state)).toBe(true);
  });
});

describe("hosted urls", () => {
  it("puts the minted state in both the URL and storage", () => {
    const s = fakeStorage();
    vi.stubGlobal("window", { localStorage: s });
    const url = new URL(
      createHostedSignInUrl({
        authUrl: "https://auth.example.com/",
        publishableKey: pk,
        redirectUrl: "https://app.example.com/",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.example.com/sign-in");
    expect(url.searchParams.get("pk")).toBe(pk);
    expect(url.searchParams.get("redirect_url")).toBe("https://app.example.com/");
    expect(consumePendingState(s, pk, url.searchParams.get("state"))).toBe(true);
  });

  it("builds the reset url with and without a key", () => {
    const s = fakeStorage();
    vi.stubGlobal("window", { localStorage: s });
    expect(createPasswordResetUrl({ authUrl: "https://auth.example.com" })).toBe(
      "https://auth.example.com/reset-password",
    );
    const url = new URL(
      createPasswordResetUrl({
        authUrl: "https://auth.example.com",
        publishableKey: pk,
        redirectUrl: "https://app.example.com/",
      }),
    );
    expect(url.pathname).toBe("/reset-password");
    expect(consumePendingState(s, pk, url.searchParams.get("state"))).toBe(true);
  });
});

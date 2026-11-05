import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLabel, deviceLabel, isFailedAction, locationLabel, relativeTime } from "./hosted-account";
import { bootHostedAuth } from "./hosted-auth";
import { byText, installDom, type FakeNode } from "./hosted-test-dom";

const NOW = Date.now();

const bootstrap = {
  publishableKey: "pk_test", authUrl: "https://mira.auth.example", page: "account", mode: "live",
  redirectUri: "", state: "", accountApiBase: "/api/account",
  appearance: { primaryColor: "#5865f2", backgroundColor: "#070709", theme: "dark", logoUrl: null, faviconUrl: null },
  app: { id: "app", name: "Ralph Meet", homeUrl: "https://meet.example", termsUrl: null, privacyUrl: null },
  hideBranding: true,
  user: { name: "Ada Lovelace", email: "ada@example.com", image: null },
};

const sessions = [
  { id: "s_other", appName: null, current: false, createdAt: NOW - 86_400_000, lastActiveAt: NOW - 3_600_000, country: "DE", city: "Berlin",
    client: { browser: "Chrome", os: "Android", inApp: "Instagram" } },
  { id: "s_here", appName: "Ralph Meet", current: true, createdAt: NOW - 1000, lastActiveAt: NOW - 1000, country: "US", city: null,
    client: { browser: "Safari", os: "iOS" } },
];

const firstPage = {
  events: [
    { id: "e1", action: "user.signInEmail", createdAt: NOW - 120_000, appName: "Ralph Meet", country: "US", city: "Austin", client: { browser: "Safari", os: "iOS" } },
    { id: "e2", action: "user.signInFailed", createdAt: NOW - 240_000, appName: null, country: null, city: null, client: null },
  ],
  nextCursor: "cursor_1",
};
const secondPage = {
  events: [{ id: "e3", action: "user.signUp", createdAt: NOW - 9_000_000, appName: null, country: null, city: null, client: null }],
  nextCursor: null,
};

type Route = (init: RequestInit | undefined) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(routes: Record<string, Route | Route[]>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "https://mira.auth.example");
    const key = `${init?.method ?? "GET"} ${url.pathname}${url.searchParams.has("before") ? "?before" : ""}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    const handler = Array.isArray(route) ? route.shift()! : route;
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function boot(routes: Record<string, Route | Route[]>) {
  const fetchMock = mockFetch(routes);
  const dom = installDom({ bootstrap });
  bootHostedAuth();
  return { ...dom, fetchMock };
}

const happyRoutes = (): Record<string, Route | Route[]> => ({
  "GET /api/account/sessions": () => json({ sessions }),
  "GET /api/account/activity": () => json(firstPage),
  "GET /api/account/activity?before": () => json(secondPage),
  "POST /api/account/sessions/revoke": () => json({ ok: true }),
  "POST /api/account/sessions/revoke-others": () => json({ ok: true, revoked: 1 }),
  "POST /api/auth/sign-out": () => json({ success: true }),
});

const rows = (nodes: FakeNode[]) => nodes.filter((node) => node.tag === "li");
const live = (nodes: FakeNode[]) => nodes.find((node) => node.attributes.role === "status")!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account helpers", () => {
  it("labels devices, places and actions", () => {
    expect(deviceLabel({ browser: "Safari", os: "iOS" })).toBe("Safari on iOS");
    expect(deviceLabel({ os: "Windows" })).toBe("Windows");
    expect(deviceLabel(null)).toBe("Unknown device");
    expect(locationLabel("Berlin", "DE")).toBe("Berlin, Germany");
    expect(locationLabel("Lyon", "XX")).toBe("Lyon");
    expect(locationLabel(null, "T1")).toBe("Tor network");
    expect(locationLabel(null, "Q")).toBe("Q");
    expect(locationLabel(null, null)).toBeNull();
    expect(activityLabel("user.signInSocial")).toBe("Signed in");
    expect(activityLabel("user.signInFailed")).toBe("Failed sign-in");
    expect(activityLabel("app.signIn")).toBe("Signed in to app");
    expect(activityLabel("user.emailVerified")).toBe("Email verified");
    expect(isFailedAction("twoFactor.challengeFailed")).toBe(true);
    expect(isFailedAction("user.signIn")).toBe(false);
    expect(relativeTime(NOW - 5_000, NOW)).toBe("Just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 hr ago");
  });
});

describe("hosted account page", () => {
  it("renders the user, sessions and activity", async () => {
    const { all, fetchMock } = boot(happyRoutes());
    const nodes = () => all();
    expect(byText(nodes(), "h1", "Ada Lovelace")).toBeDefined();
    expect(byText(nodes(), "p", "ada@example.com")).toBeDefined();
    expect(nodes().some((node) => node.className.includes("kv-monogram") && node.textContent === "AL")).toBe(true);
    expect(nodes().find((node) => node.tag === "a" && node.attributes.href === "https://meet.example")?.textContent).toBe("Back to Ralph Meet");

    await vi.waitFor(() => expect(rows(nodes())).toHaveLength(4));
    for (const call of fetchMock.mock.calls) expect(call[1]?.credentials).toBe("same-origin");
    expect(String(fetchMock.mock.calls.find((call) => String(call[0]).includes("activity"))?.[0])).toBe("/api/account/activity?limit=20");

    const [here, other] = rows(nodes());
    expect(here!.textContent).toContain("Safari on iOS");
    expect(here!.textContent).toContain("This device");
    expect(here!.textContent).toContain("Ralph Meet");
    expect(here!.children.some((node) => node.tag === "button")).toBe(false);
    expect(other!.textContent).toContain("Chrome on Android");
    expect(other!.textContent).toContain("Instagram in-app");
    expect(other!.textContent).toContain("Browser (Kova)");
    expect(other!.textContent).toContain("Berlin, Germany");
    expect(other!.textContent).toContain("Active 1 hr ago");
    expect(other!.textContent).not.toContain("This device");

    expect(byText(nodes(), "p", "Signed in")).toBeDefined();
    const failed = rows(nodes()).find((row) => row.textContent.includes("Failed sign-in"));
    expect(failed?.className).toContain("is-failed");
    expect(failed?.children.find((node) => node.tag === "time")?.attributes.title).toBeTruthy();
  });

  it("revokes another session with its id and drops the row", async () => {
    const { all, fetchMock } = boot(happyRoutes());
    await vi.waitFor(() => expect(rows(all())).toHaveLength(4));
    const button = all().find((node) => node.tag === "button" && node.attributes["aria-label"] === "Sign out Chrome on Android")!;
    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(rows(all())).toHaveLength(3));
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]) === "/api/account/sessions/revoke")!;
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ sessionId: "s_other" });
    expect(live(all()).textContent).toBe("Signed out Chrome on Android");
    expect(byText(all(), "button", "Sign out of all other sessions")).toBeUndefined();
  });

  it("asks before signing out every other session", async () => {
    const { all, fetchMock } = boot(happyRoutes());
    await vi.waitFor(() => expect(rows(all())).toHaveLength(4));
    byText(all(), "button", "Sign out of all other sessions")!.click();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("revoke-others"))).toBe(false);
    expect(all().some((node) => node.textContent === "Sign out of 1 other session? This device stays signed in.")).toBe(true);
    byText(all(), "button", "Cancel")!.click();
    expect(byText(all(), "button", "Cancel")).toBeUndefined();

    byText(all(), "button", "Sign out of all other sessions")!.click();
    const confirm = all().find((node) => node.tag === "button" && node.className.includes("is-strong"))!;
    confirm.click();
    await vi.waitFor(() => expect(rows(all())).toHaveLength(3));
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/account/sessions/revoke-others" && call[1]?.method === "POST")).toBe(true);
    expect(live(all()).textContent).toBe("Signed out of 1 other session");
  });

  it("loads more activity with the cursor and hides the button at the end", async () => {
    const { all, fetchMock } = boot(happyRoutes());
    await vi.waitFor(() => expect(rows(all())).toHaveLength(4));
    byText(all(), "button", "Load more")!.click();
    await vi.waitFor(() => expect(rows(all())).toHaveLength(5));
    const url = String(fetchMock.mock.calls.find((call) => String(call[0]).includes("before="))?.[0]);
    expect(new URLSearchParams(url.split("?")[1]).get("before")).toBe("cursor_1");
    expect(new URLSearchParams(url.split("?")[1]).get("limit")).toBe("20");
    expect(byText(all(), "p", "Account created")).toBeDefined();
    expect(byText(all(), "button", "Load more")).toBeUndefined();
  });

  it("shows the server error and retries", async () => {
    const routes = happyRoutes();
    routes["GET /api/account/sessions"] = [() => json({ error: "Sessions are unavailable." }, 503), () => json({ sessions })];
    const { all } = boot(routes);
    await vi.waitFor(() => expect(byText(all(), "p", "Sessions are unavailable.")).toBeDefined());
    expect(live(all()).textContent).toBe("Sessions are unavailable.");
    byText(all(), "button", "Try again")!.click();
    await vi.waitFor(() => expect(rows(all()).filter((row) => row.textContent.includes("This device"))).toHaveLength(1));
  });

  it("shows an empty state when there is no activity", async () => {
    const routes = happyRoutes();
    routes["GET /api/account/activity"] = () => json({ events: [], nextCursor: null });
    const { all } = boot(routes);
    await vi.waitFor(() => expect(byText(all(), "p", "No activity yet.")).toBeDefined());
  });

  it("goes to sign-in on 401 and returns to the account page afterwards", async () => {
    const routes = happyRoutes();
    routes["GET /api/account/sessions"] = () => json({ error: "Unauthorized" }, 401);
    const { assign } = boot(routes);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in?device_return=%2Faccount"));
  });

  it("signs out through Better Auth on authUrl, then goes to sign-in", async () => {
    const { all, fetchMock, assign } = boot(happyRoutes());
    const button = all().find((node) => node.tag === "button" && node.textContent === "Sign out" && node.className.includes("ac-btn-sm"))!;
    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]) === "https://mira.auth.example/api/auth/sign-out")!;
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.credentials).toBe("include");
    expect((call[1]?.headers as Record<string, string>)["x-publishable-key"]).toBe("pk_test");
  });
});

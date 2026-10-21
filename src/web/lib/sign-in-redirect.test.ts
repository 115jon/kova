import { describe, expect, it } from "vitest";
import { appSignInUrl } from "../../worker/lib/sign-in-url";
import {
  buildAuthPagePath,
  buildFreshSignInReturnPath,
  canContinueWithSession,
  existingSessionAction,
  validateSignInSearch,
  validateResetPasswordSearch,
  buildNativeHandoffPath,
  buildSignInReturnUrl,
  isAddAccount,
  safeApproveReturnPath,
  safeSignInReturnPath,
  searchParamString,
} from "./sign-in-redirect";

describe("sign-in redirect helpers", () => {
  const nativeSearch = {
    pk: "pk_dev_float",
    redirect_url: "float://auth",
    native_handoff: "1",
  };

  it("routes native sign-in through Kova's validated SDK bounce", () => {
    expect(buildNativeHandoffPath(nativeSearch)).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_float&redirect_uri=float%3A%2F%2Fauth",
    );
  });

  it("does not create a handoff without an app key and redirect", () => {
    expect(buildNativeHandoffPath({ ...nativeSearch, pk: undefined })).toBeNull();
    expect(
      buildNativeHandoffPath({ ...nativeSearch, redirect_url: undefined }),
    ).toBeNull();
  });

  it("recognizes native context after the router strips the optional hint", () => {
    expect(
      buildNativeHandoffPath({ ...nativeSearch, native_handoff: undefined }),
    ).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_float&redirect_uri=float%3A%2F%2Fauth",
    );
  });

  it("preserves native context when an auth method returns to sign-in", () => {
    expect(buildSignInReturnUrl(nativeSearch, "https://auth.example")).toBe(
      "https://auth.example/sign-in?pk=pk_dev_float&redirect_url=float%3A%2F%2Fauth&native_handoff=1",
    );
  });

  it("echoes the app state through the handoff and the sign-in round trip", () => {
    const search = { ...nativeSearch, native_handoff: undefined, state: "nonce-1" };
    expect(buildNativeHandoffPath(search)).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_float&redirect_uri=float%3A%2F%2Fauth&state=nonce-1",
    );
    expect(buildSignInReturnUrl(search, "https://auth.example")).toBe(
      "https://auth.example/sign-in?pk=pk_dev_float&redirect_url=float%3A%2F%2Fauth&state=nonce-1",
    );
  });

  it("links sign-in and sign-up to each other with the app context intact", () => {
    const search = { pk: "pk_dev_float", redirect_url: "float://auth", state: "nonce-1" };
    expect(buildAuthPagePath("sign-up", search)).toBe(
      "/sign-up?pk=pk_dev_float&redirect_url=float%3A%2F%2Fauth&state=nonce-1",
    );
    expect(buildAuthPagePath("sign-in", search)).toBe(
      "/sign-in?pk=pk_dev_float&redirect_url=float%3A%2F%2Fauth&state=nonce-1",
    );
    expect(buildAuthPagePath("sign-up", {})).toBe("/sign-up");
  });

  it("stops carrying on with the browser's session after a failed link", () => {
    const failed = validateSignInSearch({ pk: "pk_dev_float", redirect_url: "float://auth", error: "INVALID_TOKEN" });
    expect(failed.error).toBe("INVALID_TOKEN");
    expect(canContinueWithSession(failed)).toBe(false);
    expect(canContinueWithSession(validateSignInSearch({ pk: "pk_dev_float" }))).toBe(true);
    // The error is for this page view only: links between pages drop it.
    expect(buildAuthPagePath("sign-in", failed)).not.toContain("error");
    expect(buildNativeHandoffPath(failed)).not.toContain("error");
  });

  it("builds the app sign-in URL the dashboard shows and the hosted alias forwards to", () => {
    expect(appSignInUrl("https://auth.115jon.site", "pk_live_abc", "t3code://app/auth/kova")).toBe(
      "https://auth.115jon.site/sign-in?pk=pk_live_abc&redirect_url=t3code%3A%2F%2Fapp%2Fauth%2Fkova",
    );
    expect(appSignInUrl("https://auth.115jon.site/", "pk_dev_x")).toBe(
      "https://auth.115jon.site/sign-in?pk=pk_dev_x",
    );
  });

  it("keeps add-account even when the router JSON-parses 1 as a number", () => {
    expect(searchParamString(1)).toBe("1");
    expect(searchParamString("1")).toBe("1");
    expect(isAddAccount(1)).toBe(true);
    expect(isAddAccount("1")).toBe(true);
    expect(isAddAccount(true)).toBe(true);
    expect(isAddAccount(undefined)).toBe(false);
  });

  it("keeps add-account so a second Kova session can sign in", () => {
    expect(
      buildSignInReturnUrl(
        { redirect_url: "/oauth/continue?client_id=forgejo", add_account: "1" },
        "https://auth.example",
      ),
    ).toBe(
      "https://auth.example/sign-in?redirect_url=%2Foauth%2Fcontinue%3Fclient_id%3Dforgejo&add_account=1",
    );
  });

  it("uses the ordinary sign-in page when no native handoff is requested", () => {
    expect(buildSignInReturnUrl({}, "https://auth.example")).toBe(
      "https://auth.example/sign-in",
    );
  });

  it("only returns to same-origin device approve paths", () => {
    expect(safeApproveReturnPath("/approve/dc_abcdefghijklmnopqrstuvwxyz012345")).toBe(
      "/approve/dc_abcdefghijklmnopqrstuvwxyz012345",
    );
    expect(safeApproveReturnPath("https://evil.example/approve/dc_abc")).toBeNull();
    expect(safeApproveReturnPath("/settings")).toBeNull();
    expect(safeApproveReturnPath("//evil.example")).toBeNull();
  });

  it("returns to the 1:15 account picker after sign-in", () => {
    expect(
      safeSignInReturnPath("/oauth/continue?client_id=forgejo-client&state=abc"),
    ).toBe("/oauth/continue?client_id=forgejo-client&state=abc");
    expect(
      safeSignInReturnPath(
        "/oauth/continue?client_id=forgejo-115&redirect_uri=https://git.115jon.com/user/oauth2/kova/callback",
      ),
    ).toBe(
      "/oauth/continue?client_id=forgejo-115&redirect_uri=https://git.115jon.com/user/oauth2/kova/callback",
    );
    expect(safeSignInReturnPath("/dashboard")).toBeNull();
  });

  describe("SDK OAuth callback flow with native handoff", () => {
    it("preserves native handoff params through SDK OAuth redirect", () => {
      // Simulates the SDK OAuth flow:
      // 1. User arrives at /sign-in?pk=pk_dev_test&redirect_url=app://callback&native_handoff=1
      const initialSearch = {
        pk: "pk_dev_test",
        redirect_url: "app://callback",
        native_handoff: "1",
      };

      // 2. SDK receives afterSignInUrl from buildSignInReturnPath
      const afterSignInUrl = buildSignInReturnUrl(
        initialSearch,
        "https://auth.example",
      );
      expect(afterSignInUrl).toBe(
        "https://auth.example/sign-in?pk=pk_dev_test&redirect_url=app%3A%2F%2Fcallback&native_handoff=1",
      );

      // 3. After OAuth completes, user returns to that URL with session
      // The sign-in page then calls buildNativeHandoffPath with the preserved params
      const handoffPath = buildNativeHandoffPath(initialSearch);
      expect(handoffPath).toBe(
        "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_test&redirect_uri=app%3A%2F%2Fcallback",
      );

      // 4. The handoff endpoint validates and completes the native approval
      // This ensures the native app receives the authenticated session
    });

    it("handles SDK OAuth callback without native handoff", () => {
      // Regular web OAuth flow without native handoff
      const webSearch = {
        redirect_url: "/oauth/continue?client_id=test",
      };

      const afterSignInUrl = buildSignInReturnUrl(webSearch, "https://auth.example");
      expect(afterSignInUrl).toBe(
        "https://auth.example/sign-in?redirect_url=%2Foauth%2Fcontinue%3Fclient_id%3Dtest",
      );

      // No native handoff, so completeSignIn uses safeSignInReturnPath instead
      const safeReturn = safeSignInReturnPath(webSearch.redirect_url);
      expect(safeReturn).toBe("/oauth/continue?client_id=test");

      const handoffPath = buildNativeHandoffPath(webSearch);
      expect(handoffPath).toBeNull();
    });
  });
});

describe("reset-password page helpers", () => {
  it("builds the reset path carrying app context", () => {
    expect(buildAuthPagePath("reset-password", { pk: "pk_x", redirect_url: "float://auth", state: "n1" }))
      .toBe("/reset-password?pk=pk_x&redirect_url=float%3A%2F%2Fauth&state=n1");
    expect(buildAuthPagePath("reset-password", {})).toBe("/reset-password");
  });

  it("keeps only string search values", () => {
    expect(validateResetPasswordSearch({ pk: "pk_x", token: "abc", error: "INVALID_TOKEN", state: 5, redirect_url: {} }))
      .toEqual({ pk: "pk_x", token: "abc", error: "INVALID_TOKEN", state: "5", redirect_url: undefined });
    expect(validateResetPasswordSearch({ token: ["a"], error: null })).toEqual({
      pk: undefined, redirect_url: undefined, state: undefined, token: undefined, error: undefined,
    });
  });
});

describe("signing in when an account is already signed in", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const old = { id: "s-old", createdAt: "2026-10-19T09:00:00Z" };
  const justNow = { id: "s-new", createdAt: new Date(now - 20_000).toISOString() };
  const app = validateSignInSearch({ pk: "pk_live_house", redirect_url: "t3code://app/auth/kova" });

  it("asks which account to use instead of continuing as the one already there", () => {
    expect(existingSessionAction({ search: app, session: old, arrivedWithSessionId: "s-old", now })).toBe("choose");
  });

  it("shows the form when nobody is signed in", () => {
    expect(existingSessionAction({ search: app, session: null, arrivedWithSessionId: null, now })).toBe("form");
  });

  it("continues once someone signs in on the page, including another account", () => {
    expect(existingSessionAction({ search: app, session: justNow, arrivedWithSessionId: null, now })).toBe("continue");
    expect(existingSessionAction({ search: app, session: justNow, arrivedWithSessionId: "s-old", now })).toBe("continue");
  });

  it("continues straight through a provider or emailed link that returned with a fresh sign-in", () => {
    const back = validateSignInSearch({ ...app, fresh: "1" });
    expect(existingSessionAction({ search: back, session: justNow, arrivedWithSessionId: "s-new", now })).toBe("continue");
    // An already-used link lands here with someone else's older session: they choose.
    expect(existingSessionAction({ search: back, session: old, arrivedWithSessionId: "s-old", now })).toBe("choose");
  });

  it("shows the form for prompt=login and add_account until a new sign-in", () => {
    const login = validateSignInSearch({ ...app, prompt: "login" });
    expect(login.add_account).toBe("1");
    expect(existingSessionAction({ search: login, session: old, arrivedWithSessionId: "s-old", now })).toBe("form");
    expect(existingSessionAction({ search: login, session: justNow, arrivedWithSessionId: "s-old", now })).toBe("continue");
    expect(validateSignInSearch({ ...app, prompt: "select_account" }).add_account).toBeUndefined();
  });

  it("never offers the browser's session after a failed link", () => {
    const failed = validateSignInSearch({ ...app, fresh: "1", error: "INVALID_TOKEN" });
    expect(existingSessionAction({ search: failed, session: justNow, arrivedWithSessionId: "s-new", now })).toBe("form");
  });

  it("marks only the sign-in return as fresh, and only the bounce enforces it", () => {
    const search = { ...app, state: "nonce-1", add_account: "1" };
    expect(buildFreshSignInReturnPath(search)).toBe(
      "/sign-in?pk=pk_live_house&redirect_url=t3code%3A%2F%2Fapp%2Fauth%2Fkova&state=nonce-1&fresh=1",
    );
    const back = validateSignInSearch({ ...search, fresh: "1" });
    expect(buildAuthPagePath("sign-up", back)).not.toContain("fresh");
    expect(buildNativeHandoffPath(back)).not.toContain("fresh");
    expect(buildNativeHandoffPath(back, { fresh: true })).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_live_house&redirect_uri=t3code%3A%2F%2Fapp%2Fauth%2Fkova&state=nonce-1&fresh=1",
    );
  });
});

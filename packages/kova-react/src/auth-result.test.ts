import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  buildSdkBounceUrl,
  buildSdkOAuthStartUrl,
  emailLinkCallbackUrl,
  isPasskeyCancel,
  passkeyUsableHere,
  signUpNeedsVerification,
  unwrapAuthResult,
} from "./auth-result";
import { extractRetryAfter } from "./hooks/use-rate-limit";

describe("unwrapAuthResult", () => {
  it("returns the result of a successful call", async () => {
    const result = { data: { token: "t" }, error: null };
    await expect(unwrapAuthResult(async () => result)).resolves.toBe(result);
  });

  it("throws the server's message when the client resolved with an error", async () => {
    const failed = unwrapAuthResult(async () => ({
      data: null,
      error: { message: "Invalid email or password", status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
    }));
    await expect(failed).rejects.toMatchObject({
      message: "Invalid email or password",
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
  });

  it("falls back to the status text, then a generic message", async () => {
    await expect(unwrapAuthResult(async () => ({ error: { statusText: "FORBIDDEN" } }))).rejects.toThrow("FORBIDDEN");
    await expect(unwrapAuthResult(async () => ({ error: {} }))).rejects.toThrow("Something went wrong. Try again.");
  });

  it("keeps the failing response so a 429 can start its countdown", async () => {
    const response = new Response(null, { status: 429, headers: { "Retry-After": "42" } });
    const failed = unwrapAuthResult(async (hooks) => {
      hooks.onError({ response });
      return { error: { message: "Too many requests", status: 429 } };
    });
    const error = await failed.catch((e: unknown) => e);
    expect(extractRetryAfter(error)).toBe(42);
  });
});

describe("passkey helpers", () => {
  it("treats a dismissed prompt as a cancel, not a failure", () => {
    expect(isPasskeyCancel({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
    expect(isPasskeyCancel({ code: "AUTH_CANCELLED" })).toBe(true);
    expect(isPasskeyCancel({ code: "ERROR_INVALID_RP_ID" })).toBe(false);
    expect(isPasskeyCancel(null)).toBe(false);
  });

  it("only offers passkeys on the auth server's own origin", () => {
    const auth = "https://auth.115jon.site";
    expect(passkeyUsableHere(auth, { origin: "https://auth.115jon.site" }, true)).toBe(true);
    expect(passkeyUsableHere(auth, { origin: "https://app.example.com" }, true)).toBe(false);
    expect(passkeyUsableHere(auth, { origin: "https://slug.auth.115jon.site" }, true)).toBe(false);
    expect(passkeyUsableHere(auth, { origin: "https://auth.115jon.site" }, false)).toBe(false);
    expect(passkeyUsableHere(auth, undefined, true)).toBe(false);
    expect(passkeyUsableHere("not a url", { origin: "https://auth.115jon.site" }, true)).toBe(false);
  });
});

describe("signUpNeedsVerification", () => {
  it("is true when sign-up returned a user but no session", () => {
    expect(signUpNeedsVerification({ token: null })).toBe(true);
  });

  it("is false once the server issued a session", () => {
    expect(signUpNeedsVerification({ token: "abc" })).toBe(false);
    expect(signUpNeedsVerification(null)).toBe(false);
  });
});

describe("emailLinkCallbackUrl", () => {
  const auth = "https://auth.115jon.site";

  it("sends an app's emailed links back through the auth server's bounce", () => {
    const url = new URL(emailLinkCallbackUrl(auth, "pk_live_x", "https://app.example.com/home"));
    expect(url.origin).toBe(auth);
    expect(url.pathname).toBe("/api/hosted/oauth-complete");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mode: "sdk",
      pk: "pk_live_x",
      redirect_uri: "https://app.example.com/home",
      fresh: "1",
    });
  });

  it("carries the pending state onto the bounce", () => {
    const url = new URL(emailLinkCallbackUrl(auth, "pk_live_x", "https://app.example.com/home", "st_1"));
    expect(url.searchParams.get("state")).toBe("st_1");
    expect(url.searchParams.get("fresh")).toBe("1");
  });

  it("leaves the callback alone when there is no publishable key", () => {
    expect(emailLinkCallbackUrl(auth, undefined, "https://auth.115jon.site/sign-in")).toBe(
      "https://auth.115jon.site/sign-in",
    );
  });
});

describe("buildSdkBounceUrl", () => {
  it("does not double the slash when authUrl ends with one", () => {
    expect(buildSdkBounceUrl("https://auth.115jon.site/", "pk_x", "https://app.example.com/")).toBe(
      "https://auth.115jon.site/api/hosted/oauth-complete?mode=sdk&pk=pk_x&redirect_uri=https%3A%2F%2Fapp.example.com%2F",
    );
    expect(buildSdkBounceUrl("https://auth.115jon.site//", "pk_x", "https://app.example.com/")).toBe(
      buildSdkBounceUrl("https://auth.115jon.site", "pk_x", "https://app.example.com/"),
    );
  });
});

describe("buildSdkOAuthStartUrl", () => {
  it("forwards the state only when given", () => {
    const withState = new URL(
      buildSdkOAuthStartUrl(
        "https://auth.115jon.site",
        "pk_x",
        "github",
        "https://app.example.com/",
        "https://app.example.com/e",
        "st_1",
      ),
    );
    expect(withState.pathname).toBe("/api/pub/apps/pk_x/oauth/start");
    expect(Object.fromEntries(withState.searchParams)).toEqual({
      provider: "github",
      redirect_uri: "https://app.example.com/",
      error_callback_url: "https://app.example.com/e",
      state: "st_1",
    });
    const without = new URL(buildSdkOAuthStartUrl("https://auth.115jon.site", "pk_x", "github", "https://a/", "https://a/e"));
    expect(without.searchParams.has("state")).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("explains the codes Better Auth puts on a failed link", () => {
    expect(authErrorMessage("INVALID_TOKEN")).toMatch(/isn't valid/);
    expect(authErrorMessage("TOKEN_EXPIRED")).toMatch(/expired/);
    expect(authErrorMessage("EXPIRED_TOKEN")).toMatch(/expired/);
    expect(authErrorMessage("ATTEMPTS_EXCEEDED")).toMatch(/already used/);
    expect(authErrorMessage("INVALID_USER")).toMatch(/different account/);
    expect(authErrorMessage("STATE_MISMATCH")).toMatch(/different browser/);
    expect(authErrorMessage("MISSING_STATE")).toMatch(/wasn't started from this app/);
    expect(authErrorMessage("ALREADY_USED")).toMatch(/already used/);
    expect(authErrorMessage("NO_SESSION")).toBe("Sign-in didn't finish. Try again.");
    expect(authErrorMessage("OAUTH_START_FAILED")).toBe("Sign-in didn't finish. Try again.");
    expect(authErrorMessage("oauth")).toMatch(/provider/);
  });

  it("never echoes an unknown code back to the page", () => {
    expect(authErrorMessage("<img src=x>")).toBe("Sign-in didn't finish. Try again.");
  });
});

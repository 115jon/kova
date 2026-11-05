import { describe, expect, it } from "vitest";
import { bearerToken, requestWithoutCookiesForBearer, withoutCookiesForBearer } from "./bearer-headers";

const cookie = "__Secure-session_token=parent; __Secure-session_token_multi-parent=parent.sig";

describe("withoutCookiesForBearer", () => {
  it("drops the auth-domain cookies when a bearer is present", () => {
    const headers = new Headers({ Authorization: "Bearer app_tok", cookie, "X-Publishable-Key": "pk_x" });
    const out = withoutCookiesForBearer(headers);
    expect(out.has("cookie")).toBe(false);
    expect(out.get("Authorization")).toBe("Bearer app_tok");
    expect(out.get("X-Publishable-Key")).toBe("pk_x");
    expect(headers.has("cookie")).toBe(true);
  });

  it("keeps mid-sign-in challenge cookies", () => {
    const headers = new Headers({
      Authorization: "Bearer stale_tok",
      cookie: `${cookie}; __Secure-better-auth.session_data=x; __Secure-two_factor=tf.sig; dont_remember=1`,
    });
    expect(withoutCookiesForBearer(headers).get("cookie")).toBe("__Secure-two_factor=tf.sig; dont_remember=1");
  });

  it("carries the app id onto the rebuilt request", async () => {
    const { getAppId, setAppId } = await import("./app-context");
    const request = new Request("https://auth.example/api/auth/get-session", {
      headers: { Authorization: "Bearer app_tok", cookie },
    });
    setAppId(request, "app_1");
    expect(getAppId(requestWithoutCookiesForBearer(request))).toBe("app_1");
  });

  it("keeps cookies for cookie-only requests", () => {
    const headers = new Headers({ cookie });
    expect(withoutCookiesForBearer(headers)).toBe(headers);
  });

  it("ignores non-bearer authorization", () => {
    const headers = new Headers({ Authorization: "Basic abc", cookie });
    expect(withoutCookiesForBearer(headers).get("cookie")).toBe(cookie);
    expect(bearerToken(new Headers({ Authorization: "Bearer   " }))).toBeNull();
  });

  it("rebuilds a request without cookies and keeps its body", async () => {
    const request = new Request("https://auth.example/api/auth/sign-out", {
      method: "POST",
      headers: { Authorization: "Bearer app_tok", cookie, "content-type": "application/json" },
      body: "{}",
    });
    const out = requestWithoutCookiesForBearer(request);
    expect(out.headers.has("cookie")).toBe(false);
    expect(out.method).toBe("POST");
    expect(await out.text()).toBe("{}");
  });
});

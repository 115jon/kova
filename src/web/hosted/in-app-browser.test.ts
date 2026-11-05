import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHostedAuth } from "./hosted-auth";
import { byText, installDom } from "./hosted-test-dom";
import { detectInAppBrowser, suggestedBrowser } from "./in-app-browser";

const INSTAGRAM_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F77 Instagram 447.0.0.34.80 (iPhone18,1; iOS 26_5; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1065993616) Safari/604.1";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
const FACEBOOK_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108;FBBV/123;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]";
const FACEBOOK_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/473.0.0.37.81;]";
const TIKTOK_ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_340301 BytedanceWebview/d8a21c6";
const TIKTOK_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const GSA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.678 Mobile/15E148 Safari/604.1";

describe("in-app browser detection", () => {
  it("names the host app", () => {
    expect(detectInAppBrowser(INSTAGRAM_IOS)).toBe("Instagram");
    expect(detectInAppBrowser(FACEBOOK_IOS)).toBe("Facebook");
    expect(detectInAppBrowser(FACEBOOK_ANDROID)).toBe("Facebook");
    expect(detectInAppBrowser(TIKTOK_ANDROID)).toBe("TikTok");
    expect(detectInAppBrowser(TIKTOK_IOS)).toBe("TikTok");
    expect(detectInAppBrowser("Mozilla/5.0 (iPhone) Mobile/15E148 Snapchat/13.0.0.0 (like Safari/604.1)")).toBe("Snapchat");
    expect(detectInAppBrowser("Mozilla/5.0 (iPhone) Mobile/15E148 Safari Line/14.10.0")).toBe("LINE");
    expect(detectInAppBrowser("Mozilla/5.0 (iPhone) Mobile/15E148 [LinkedInApp]/9.30")).toBe("LinkedIn");
    expect(detectInAppBrowser("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 TwitterAndroid")).toBe("X");
  });

  it("leaves real browsers alone", () => {
    expect(detectInAppBrowser(SAFARI_IOS)).toBeNull();
    expect(detectInAppBrowser(ANDROID_CHROME)).toBeNull();
    expect(detectInAppBrowser(GSA_IOS)).toBeNull();
    expect(detectInAppBrowser("")).toBeNull();
  });

  it("suggests the platform browser", () => {
    expect(suggestedBrowser(INSTAGRAM_IOS)).toBe("Safari");
    expect(suggestedBrowser(TIKTOK_ANDROID)).toBe("Chrome");
    expect(suggestedBrowser("Mozilla/5.0 (Windows NT 10.0)")).toBe("your browser");
  });
});

const bootstrap = (enabledProviders: string[] = ["google"]) => ({
  publishableKey: "pk_test", authUrl: "https://mira.auth.example", mainAuthUrl: "https://auth.example",
  redirectUri: "", state: "", mode: "live", page: "sign-in", oauthCtx: "ctx",
  appearance: { primaryColor: "#5865f2", backgroundColor: "#070709", theme: "dark", logoUrl: null, faviconUrl: null },
  app: { id: "app", name: "Ralph Meet", homeUrl: null, termsUrl: null, privacyUrl: null },
  hideBranding: true, enabledProviders,
});

const notice = (nodes: ReturnType<ReturnType<typeof installDom>["all"]>) => nodes.find((node) => node.className.includes("ra-inapp ") || node.className === "ra-inapp");

afterEach(() => vi.unstubAllGlobals());

describe("in-app browser notice", () => {
  it("warns inside Instagram and copies the link", async () => {
    const writeText = vi.fn(async () => {});
    const dom = installDom({ bootstrap: bootstrap(), userAgent: INSTAGRAM_IOS, clipboard: { writeText } });
    bootHostedAuth();
    const box = notice(dom.all());
    expect(box?.textContent).toBe("You're in the Instagram browser. Google sign-in may not work here. Open this page in Safari for the best experience.Copy link");
    byText(dom.all(), "button", "Copy link")!.click();
    expect(writeText).toHaveBeenCalledWith("https://mira.auth.example/sign-in?redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=s");
    await vi.waitFor(() => expect(dom.all().find((node) => node.attributes["aria-live"] === "polite")?.textContent).toBe("Link copied"));
  });

  it("reveals the link to copy by hand without a clipboard", () => {
    const dom = installDom({ bootstrap: bootstrap(), userAgent: INSTAGRAM_IOS });
    bootHostedAuth();
    const input = dom.all().find((node) => node.className.includes("ra-inapp-url"))!;
    expect(input.hidden).toBe(true);
    byText(dom.all(), "button", "Copy link")!.click();
    expect(input.hidden).toBe(false);
    expect(input.value).toContain("https://mira.auth.example/sign-in");
    expect(input.selected).toBe(true);
  });

  it("can be dismissed", () => {
    const dom = installDom({ bootstrap: bootstrap(), userAgent: INSTAGRAM_IOS });
    bootHostedAuth();
    dom.all().find((node) => node.attributes["aria-label"] === "Dismiss")!.click();
    expect(notice(dom.all())).toBeUndefined();
    expect(dom.all().find((node) => node.id === "ra-email")?.focused).toBe(true);
  });

  it("stays away in Safari and when Google is off", () => {
    const safari = installDom({ bootstrap: bootstrap(), userAgent: SAFARI_IOS });
    bootHostedAuth();
    expect(notice(safari.all())).toBeUndefined();
    vi.unstubAllGlobals();
    const noGoogle = installDom({ bootstrap: bootstrap(["github"]), userAgent: INSTAGRAM_IOS });
    bootHostedAuth();
    expect(notice(noGoogle.all())).toBeUndefined();
  });
});

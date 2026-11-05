import { describe, expect, it } from "vitest";
import { detectInAppBrowser, suggestedBrowser } from "./in-app-browser";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F77 Instagram 447.0.0.34.80 (iPhone18,1; iOS 26_5; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1065993616) Safari/604.1";
const FACEBOOK_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/456.0.0.38.109;FBBV/584741264;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]";
const FACEBOOK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.105 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/454.0.0.44.108;]";
const TIKTOK =
  "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 musical_ly_2023301040 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.1.4 ByteLocale/en BytedanceWebview/d8a21c6";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const GOOGLE_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/311.0.622680208 Mobile/15E148 Safari/604.1";

describe("detectInAppBrowser", () => {
  it("detects Instagram", () => {
    expect(detectInAppBrowser(INSTAGRAM)).toBe("Instagram");
  });

  it("detects Facebook on iOS and Android", () => {
    expect(detectInAppBrowser(FACEBOOK_IOS)).toBe("Facebook");
    expect(detectInAppBrowser(FACEBOOK_ANDROID)).toBe("Facebook");
  });

  it("detects TikTok", () => {
    expect(detectInAppBrowser(TIKTOK)).toBe("TikTok");
  });

  it("detects the other supported apps", () => {
    expect(detectInAppBrowser(`${IOS_SAFARI} Snapchat/13.0.0.0 (like Safari/604.1)`)).toBe("Snapchat");
    expect(detectInAppBrowser(`${IOS_SAFARI} Line/14.3.0`)).toBe("LINE");
    expect(detectInAppBrowser(`${IOS_SAFARI} [LinkedInApp]/9.29.6`)).toBe("LinkedIn");
    expect(detectInAppBrowser(`${ANDROID_CHROME} TwitterAndroid`)).toBe("X");
  });

  it("ignores real browsers and the Google app", () => {
    expect(detectInAppBrowser(IOS_SAFARI)).toBeNull();
    expect(detectInAppBrowser(ANDROID_CHROME)).toBeNull();
    expect(detectInAppBrowser(GOOGLE_APP)).toBeNull();
    expect(detectInAppBrowser("")).toBeNull();
  });
});

describe("suggestedBrowser", () => {
  it("picks the platform browser", () => {
    expect(suggestedBrowser(INSTAGRAM)).toBe("Safari");
    expect(suggestedBrowser(TIKTOK)).toBe("Chrome");
    expect(suggestedBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("your browser");
  });
});

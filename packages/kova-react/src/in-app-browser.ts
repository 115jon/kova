/**
 * In-app browser detection (Instagram, TikTok, …). No dependencies.
 *
 * Embedded webviews often block Google sign-in, so the sign-in cards suggest
 * opening the page in the system browser. Call these from an effect, never
 * during render: the user agent is only known in the browser.
 */

const IN_APP_BROWSERS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  // Instagram first: its webview is built on Facebook's and may share tokens.
  ["Instagram", /\bInstagram\b/],
  ["Facebook", /FBAN\/|FBAV\/|FB_IAB\//],
  ["TikTok", /TikTok|musical_ly|BytedanceWebview/],
  ["Snapchat", /Snapchat/],
  ["LINE", /\bLine\//],
  ["LinkedIn", /LinkedInApp/],
  ["X", /Twitter/],
];

/** Display name of the app whose in-app browser sent `ua`, or null. */
export function detectInAppBrowser(ua: string): string | null {
  if (!ua) return null;
  for (const [name, pattern] of IN_APP_BROWSERS) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

/** The browser to suggest instead: Safari on iOS, Chrome on Android. */
export function suggestedBrowser(ua: string): "Safari" | "Chrome" | "your browser" {
  if (/iPhone|iPad|iPod/.test(ua)) return "Safari";
  if (/Android/.test(ua)) return "Chrome";
  return "your browser";
}

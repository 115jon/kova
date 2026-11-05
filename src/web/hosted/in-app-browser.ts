/**
 * In-app browser detection from the user agent. Pure, no DOM.
 *
 * Google refuses OAuth inside embedded webviews (`disallowed_useragent`), so
 * the hosted sign-in page warns people who opened it from a social app.
 * Google's own app (GSA) is a real browser for this purpose and is not listed.
 */

const IN_APP_BROWSERS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  // Instagram before Facebook: some Instagram builds also carry FB tokens.
  ["Instagram", /\bInstagram\b/],
  ["Facebook", /FBAN\/|FBAV\/|FB_IAB\//],
  ["TikTok", /TikTok|musical_ly|BytedanceWebview/i],
  ["Snapchat", /Snapchat/],
  ["LINE", /\bLine\//],
  ["LinkedIn", /LinkedInApp/],
  ["X", /Twitter for iP(?:hone|ad)|TwitterAndroid|\bTwitter\//],
];

/** The app whose embedded browser is showing the page, or null for a real browser. */
export function detectInAppBrowser(ua: string): string | null {
  for (const [name, pattern] of IN_APP_BROWSERS) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

/** The browser to suggest opening the page in. */
export function suggestedBrowser(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "Safari";
  if (/Android/.test(ua)) return "Chrome";
  return "your browser";
}

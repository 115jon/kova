/**
 * device.ts — Zero-dependency UserAgent parser for Cloudflare Workers.
 *
 * Extracts browser name + version, OS name + version, and device type
 * from a raw User-Agent string with pure regex — no external packages,
 * compatible with V8 isolates.
 *
 * Also provides a helper to lift Cloudflare geolocation from `request.cf`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeviceType = "Desktop" | "Mobile" | "Tablet" | "Unknown";

export type BrowserName =
  | "Chrome"
  | "Chromium"
  | "Firefox"
  | "Safari"
  | "Edge"
  | "Arc"
  | "Opera"
  | "Samsung Browser"
  | "UC Browser"
  | "Unknown";

export type OsName =
  | "Windows"
  | "macOS"
  | "Linux"
  | "iOS"
  | "Android"
  | "ChromeOS"
  | "Unknown";

export interface ParsedDevice {
  deviceType: DeviceType;
  browser: BrowserName;
  browserVersion: string | null;
  os: OsName;
  osVersion: string | null;
  /** Human-readable label, e.g. "Chrome 124 on Windows 11" */
  label: string;
}

export interface GeoInfo {
  city: string | null;
  country: string | null;       // ISO 3166-1 alpha-2, e.g. "US"
  countryName: string | null;   // Full country name via Intl.DisplayNames (Workers supports it)
  region: string | null;
  timezone: string | null;
  /** Display string — just city when flag is available (e.g. "Chicago"), or "City, COUNTRY" fallback */
  location: string | null;
  /** Country flag emoji, e.g. "🇺🇸" */
  flag: string | null;
}

// ── Device / OS / Browser detection ──────────────────────────────────────────

/**
 * Determine the device type from a user-agent string.
 * Tablet is checked before Mobile because iPads contain "Mobile" on some OS versions.
 */
function detectDeviceType(ua: string): DeviceType {
  if (!ua) return "Unknown";
  const u = ua.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))/i.test(u)) return "Tablet";
  if (/mobile|android|iphone|ipod|windows phone|blackberry|opera mini|iemobile/i.test(u)) return "Mobile";
  return "Desktop";
}

/**
 * Parse browser name and version.
 * Order matters — must check Edge before Chrome, Arc before Chrome, etc.
 */
function detectBrowser(ua: string): { browser: BrowserName; version: string | null } {
  // Arc browser — identifies as Chrome but includes "Arc/" token
  const arcMatch = ua.match(/Arc\/([\d.]+)/i);
  if (arcMatch) return { browser: "Arc", version: arcMatch[1] ?? null };

  // Samsung Internet
  const samsungMatch = ua.match(/SamsungBrowser\/([\d.]+)/i);
  if (samsungMatch) return { browser: "Samsung Browser", version: samsungMatch[1] ?? null };

  // UC Browser
  const ucMatch = ua.match(/UCBrowser\/([\d.]+)/i);
  if (ucMatch) return { browser: "UC Browser", version: ucMatch[1] ?? null };

  // Opera (new Blink-based)
  const opeMatch = ua.match(/OPR\/([\d.]+)/i) ?? ua.match(/Opera\/([\d.]+)/i);
  if (opeMatch) return { browser: "Opera", version: opeMatch[1] ?? null };

  // Edge (Chromium-based)
  const edgeMatch = ua.match(/Edg(?:e|)\/([\d.]+)/i);
  if (edgeMatch) return { browser: "Edge", version: edgeMatch[1] ?? null };

  // Firefox
  const ffMatch = ua.match(/Firefox\/([\d.]+)/i);
  if (ffMatch) return { browser: "Firefox", version: ffMatch[1] ?? null };

  // Chromium (before Chrome so it takes precedence)
  const chromiumMatch = ua.match(/Chromium\/([\d.]+)/i);
  if (chromiumMatch) return { browser: "Chromium", version: chromiumMatch[1] ?? null };

  // Chrome
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/i);
  if (chromeMatch) return { browser: "Chrome", version: chromeMatch[1] ?? null };

  // Safari (must be checked after Chrome since Chrome UA also contains "Safari")
  const safariMatch = ua.match(/Version\/([\d.]+).*Safari/i);
  if (safariMatch) return { browser: "Safari", version: safariMatch[1] ?? null };

  return { browser: "Unknown", version: null };
}

/**
 * Parse OS name and version from the user-agent string.
 */
function detectOs(ua: string): { os: OsName; osVersion: string | null } {
  // iOS — must come before macOS because Safari on iPad may match both
  const iosMatch = ua.match(/iP(?:hone|od|ad).*OS ([\d_]+)/i);
  if (iosMatch) {
    return { os: "iOS", osVersion: (iosMatch[1] ?? "").replace(/_/g, ".") };
  }

  // Android
  const androidMatch = ua.match(/Android ([\d.]+)/i);
  if (androidMatch) return { os: "Android", osVersion: androidMatch[1] ?? null };

  // Windows — NT version map
  const winMatch = ua.match(/Windows NT ([\d.]+)/i);
  if (winMatch) {
    const ntVersion = parseFloat(winMatch[1] ?? "0");
    const winVersionMap: Record<string, string> = {
      "10.0": "10/11",  // NT 10 is shared between Win 10 and Win 11
      "6.3": "8.1",
      "6.2": "8",
      "6.1": "7",
      "6.0": "Vista",
      "5.2": "XP x64",
      "5.1": "XP",
    };
    const label = winVersionMap[ntVersion.toString()] ?? winMatch[1];
    return { os: "Windows", osVersion: label ?? null };
  }

  // macOS
  const macMatch = ua.match(/Mac OS X ([\d_]+)/i);
  if (macMatch) {
    const rawVersion = (macMatch[1] ?? "").replace(/_/g, ".");
    return { os: "macOS", osVersion: rawVersion };
  }

  // ChromeOS
  if (/CrOS/i.test(ua)) return { os: "ChromeOS", osVersion: null };

  // Linux (broad catch-all after ChromeOS)
  if (/Linux/i.test(ua)) return { os: "Linux", osVersion: null };

  return { os: "Unknown", osVersion: null };
}

/**
 * Parse a raw User-Agent string into a structured {@link ParsedDevice}.
 * Returns sensible defaults for null / empty values.
 */
export function parseDevice(rawUa: string | null | undefined): ParsedDevice {
  const ua = rawUa ?? "";

  const deviceType = detectDeviceType(ua);
  const { browser, version: browserVersion } = detectBrowser(ua);
  const { os, osVersion } = detectOs(ua);

  // Compose a human-readable label
  const browserLabel = browserVersion
    ? `${browser} ${browserVersion.split(".")[0]}`  // major version only
    : browser;

  const osLabel = osVersion ? `${os} ${osVersion}` : os;

  const label =
    browser === "Unknown" && os === "Unknown"
      ? "Unknown device"
      : browser === "Unknown"
        ? osLabel
        : os === "Unknown"
          ? browserLabel
          : `${browserLabel} on ${osLabel}`;

  return { deviceType, browser, browserVersion, os, osVersion, label };
}

// ── Cloudflare geolocation ────────────────────────────────────────────────────

/**
 * Extract geolocation info from Cloudflare's `request.cf` object.
 * Safe to call even when `cf` is undefined (local dev without `--remote`).
 */
export function parseGeo(cf: IncomingRequestCfProperties | undefined | null): GeoInfo {
  if (!cf) {
    return {
      city: null,
      country: null,
      countryName: null,
      region: null,
      timezone: null,
      location: null,
      flag: null,
    };
  }

  const city = (cf.city as string | undefined) ?? null;
  // Normalize to uppercase — Cloudflare usually sends "US" but dev may send "us"
  const country = ((cf.country as string | undefined) ?? null)?.toUpperCase() ?? null;
  const region = (cf.region as string | undefined) ?? null;
  const timezone = (cf.timezone as string | undefined) ?? null;

  // Resolve full country name via Intl (V8 / Workers supports this)
  let countryName: string | null = null;
  if (country) {
    try {
      const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
      countryName = displayNames.of(country) ?? null;
    } catch {
      countryName = null;
    }
  }

  // Build flag emoji from ISO code (each letter maps to regional indicator A+25=🇦)
  let flag: string | null = null;
  if (country && country.length === 2) {
    try {
      flag = [...country.toUpperCase()]
        .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
        .join("");
    } catch {
      flag = null;
    }
  }

  // Compose display string.
  // When a flag is available it already communicates the country, so just show city.
  // Fall back to "City, COUNTRY" only if we couldn't build a flag, or country-only if no city.
  let location: string | null = null;
  if (city && flag) location = city;               // 🇺🇸 Chicago
  else if (city) location = `${city}, ${country ?? ""}`.trim().replace(/,$/, "");
  else if (country) location = country;             // country-only fallback

  return { city, country, countryName, region, timezone, location, flag };
}

/**
 * Pure helpers for the audit log: URL search validation, date bounds, client
 * and location formatting, and CSV export. No React, no fetch.
 */

// ── Row shape ─────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  userId: string;
  orgId: string | null;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  actorImage?: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  appId: string | null;
  appName?: string | null;
  country: string | null;
  city: string | null;
}

/** The API returns parsed metadata today; older builds sent a JSON string. */
export function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { raw: value };
    }
  }
  return null;
}

// ── URL search ────────────────────────────────────────────────────────────────

export const RANGE_PRESETS = ["24h", "7d", "30d", "90d"] as const;
export type AuditRangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<AuditRangePreset, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const RANGE_MS: Record<AuditRangePreset, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export interface AuditSearch {
  q?: string;
  appId?: string;
  action?: string;
  country?: string;
  outcome?: "failure";
  range?: AuditRangePreset;
  /** Custom range start, local date `YYYY-MM-DD`. */
  from?: string;
  /** Custom range end (inclusive), local date `YYYY-MM-DD`. */
  to?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The router JSON-parses values, so a numeric user id arrives as a number. */
function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function date(value: unknown): string | undefined {
  const v = text(value);
  return v && DATE_RE.test(v) && Number.isFinite(dateToMs(v, false)) ? v : undefined;
}

export function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
  const out: AuditSearch = {};
  const q = text(search.q);
  if (q) out.q = q.slice(0, 200);
  const appId = text(search.appId);
  if (appId) out.appId = appId;
  const action = text(search.action);
  if (action && /^[\w.*-]+$/.test(action)) out.action = action;
  const country = text(search.country)?.toUpperCase();
  if (country && /^[A-Z0-9]{2}$/.test(country)) out.country = country;
  if (search.outcome === "failure") out.outcome = "failure";
  const from = date(search.from);
  const to = date(search.to);
  if (from) out.from = from;
  if (to) out.to = to;
  const range = text(search.range);
  if (!from && !to && range && (RANGE_PRESETS as readonly string[]).includes(range)) {
    out.range = range as AuditRangePreset;
  }
  return out;
}

/** Local midnight for `YYYY-MM-DD`; with `endOfDay`, the last ms of that day. */
export function dateToMs(value: string, endOfDay: boolean): number {
  const [y = NaN, m = NaN, d = NaN] = value.split("-").map(Number);
  const start = new Date(y, m - 1, endOfDay ? d + 1 : d).getTime();
  return endOfDay ? start - 1 : start;
}

/** Unix-ms bounds for the API. Presets count back from `now`. */
export function auditBounds(search: AuditSearch, now: number): { from?: number; to?: number } {
  if (search.from || search.to) {
    return {
      from: search.from ? dateToMs(search.from, false) : undefined,
      to: search.to ? dateToMs(search.to, true) : undefined,
    };
  }
  if (search.range) return { from: now - RANGE_MS[search.range] };
  return {};
}

export function hasActiveFilters(search: AuditSearch): boolean {
  return Boolean(
    search.q || search.appId || search.action || search.country || search.outcome || search.range || search.from || search.to,
  );
}

/** Drops empty values so the URL only carries filters that are set. */
export function cleanAuditSearch(search: AuditSearch): AuditSearch {
  const out: AuditSearch = {};
  for (const [key, value] of Object.entries(search) as [keyof AuditSearch, AuditSearch[keyof AuditSearch]][]) {
    if (value !== undefined && value !== "") Object.assign(out, { [key]: value });
  }
  return out;
}

// ── Countries ─────────────────────────────────────────────────────────────────

/** Regional-indicator flag for an ISO-2 code; empty for Cloudflare's XX/T1. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code) || /^(XX|T1)$/i.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  if (upper === "T1") return "Tor network";
  if (upper === "XX") return "Unknown";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(undefined, { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** "Lisbon, Portugal", "Portugal", or null. */
export function locationText(city: string | null | undefined, country: string | null | undefined): string | null {
  const parts = [city, country ? countryName(country) : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface AuditClient {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  platform: string | null;
  inApp: string | null;
}

function field(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Fallback when an event predates parsed client metadata. */
function clientFromUserAgent(ua: string): AuditClient {
  let browser: string | null = null;
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  else if (/^curl\//i.test(ua)) browser = "curl";
  let os: string | null = null;
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, browserVersion: null, os, osVersion: null, platform: null, inApp: null };
}

export function auditClient(metadata: Record<string, unknown> | null, userAgent: string | null): AuditClient | null {
  const raw = metadata?.client;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const c = raw as Record<string, unknown>;
    return {
      browser: field(c, "browser"),
      browserVersion: field(c, "browserVersion"),
      os: field(c, "os"),
      osVersion: field(c, "osVersion"),
      platform: field(c, "platform"),
      inApp: field(c, "inApp"),
    };
  }
  return userAgent ? clientFromUserAgent(userAgent) : null;
}

/** "Safari on iOS", "Chrome", or null when nothing is known. */
export function deviceLabel(client: Pick<AuditClient, "browser" | "os"> | null): string | null {
  if (!client) return null;
  if (client.browser && client.os) return `${client.browser} on ${client.os}`;
  return client.browser ?? client.os ?? null;
}

// ── Method ────────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  credential: "Password",
  password: "Password",
  email: "Email and password",
  "email-password": "Email and password",
  emailOtp: "Email code",
  "email-otp": "Email code",
  magicLink: "Magic link",
  "magic-link": "Magic link",
  passkey: "Passkey",
  social: "Social",
  oauth: "OAuth",
  google: "Google",
  github: "GitHub",
  discord: "Discord",
  microsoft: "Microsoft",
  apple: "Apple",
  twitter: "X",
  device: "Device code",
  apiKey: "API key",
};

function methodWord(value: string): string {
  return METHOD_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, " ");
}

/** "Google", "Password", "Passkey", or null. Provider wins over a generic method. */
export function methodLabel(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const method = typeof metadata.method === "string" ? metadata.method : null;
  const provider = typeof metadata.provider === "string" ? metadata.provider : null;
  if (provider && (!method || method === "social" || method === "oauth" || method === provider)) return methodWord(provider);
  if (method && provider) return `${methodWord(method)} (${methodWord(provider)})`;
  return method ? methodWord(method) : null;
}

export function isFailureAction(action: string): boolean {
  return /Failed$/.test(action);
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export const EXPORT_ROW_CAP = 10_000;

/** Quotes a value; prefixes formula triggers so spreadsheets show text. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_HEADERS = [
  "Timestamp", "Action", "Outcome", "Actor", "Actor email", "User ID", "Target", "App", "App ID",
  "Country", "City", "Method", "Browser", "OS", "Platform", "In-app browser", "IP address", "User agent",
];

export function auditCsv(rows: AuditLogRow[]): string {
  const lines = rows.map(r => {
    const client = auditClient(r.metadata, r.userAgent);
    return [
      new Date(r.createdAt).toISOString(),
      r.action,
      isFailureAction(r.action) ? "failure" : "success",
      r.actorName ?? r.actor,
      r.actorEmail ?? "",
      r.userId,
      r.targetLabel ?? r.targetId ?? "",
      r.appName ?? "",
      r.appId ?? "",
      r.country ?? "",
      r.city ?? "",
      methodLabel(r.metadata) ?? "",
      client?.browser ?? "",
      client?.os ?? "",
      client?.platform ?? "",
      client?.inApp ?? "",
      r.ipAddress ?? "",
      r.userAgent ?? "",
    ].map(csvCell).join(",");
  });
  return [CSV_HEADERS.map(csvCell).join(","), ...lines].join("\r\n");
}

/** "Yap · Lisbon, Portugal · Safari on iOS (Instagram in-app)" for compact activity lists. */
export function activityContext(entry: {
  appName?: string | null;
  city?: string | null;
  country?: string | null;
  metadata: Record<string, unknown> | null;
  userAgent: string | null;
}): string | null {
  const client = auditClient(normalizeMetadata(entry.metadata), entry.userAgent);
  const device = deviceLabel(client);
  const parts = [
    entry.appName ?? null,
    locationText(entry.city, entry.country),
    device && client?.inApp ? `${device} (${client.inApp} in-app)` : device ?? (client?.inApp ? `${client.inApp} in-app` : null),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

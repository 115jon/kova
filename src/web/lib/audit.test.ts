import { afterEach, describe, expect, it, vi } from "vitest";
import { exportAuditLogs } from "../hooks/use-audit-logs";
import {
  activityContext,
  auditBounds,
  auditClient,
  auditCsv,
  type AuditLogRow,
  cleanAuditSearch,
  countryFlag,
  csvCell,
  dateToMs,
  deviceLabel,
  hasActiveFilters,
  methodLabel,
  normalizeMetadata,
  validateAuditSearch,
} from "./audit";

function row(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "a1",
    userId: "u1",
    orgId: null,
    actor: "u1",
    actorName: "Ana",
    actorEmail: "ana@example.com",
    action: "app.signIn",
    targetType: null,
    targetId: null,
    targetLabel: null,
    ipAddress: "203.0.113.4",
    userAgent: null,
    metadata: null,
    createdAt: Date.UTC(2026, 10, 1, 12),
    appId: "app_1",
    appName: "Yap",
    country: "PT",
    city: "Lisbon",
    ...overrides,
  };
}

describe("validateAuditSearch", () => {
  it("keeps known filters and drops junk", () => {
    expect(
      validateAuditSearch({
        q: "  ana@example.com ",
        appId: "app_1",
        action: "user.*",
        country: "pt",
        outcome: "failure",
        range: "7d",
        junk: "x",
      }),
    ).toEqual({ q: "ana@example.com", appId: "app_1", action: "user.*", country: "PT", outcome: "failure", range: "7d" });
  });

  it("coerces numbers the router parsed from JSON", () => {
    expect(validateAuditSearch({ q: 12345 })).toEqual({ q: "12345" });
  });

  it("rejects bad values", () => {
    expect(
      validateAuditSearch({ country: "Portugal", outcome: "success", range: "1y", from: "yesterday", action: "a b" }),
    ).toEqual({});
  });

  it("prefers custom dates over a preset", () => {
    expect(validateAuditSearch({ range: "7d", from: "2026-11-01" })).toEqual({ from: "2026-11-01" });
  });
});

describe("auditBounds", () => {
  it("counts presets back from now", () => {
    expect(auditBounds({ range: "24h" }, 1_000_000_000)).toEqual({ from: 1_000_000_000 - 86_400_000 });
  });

  it("makes custom ranges inclusive of the end day", () => {
    const { from, to } = auditBounds({ from: "2026-11-01", to: "2026-11-02" }, 0);
    expect(from).toBe(new Date(2026, 10, 1).getTime());
    expect(to).toBe(new Date(2026, 10, 3).getTime() - 1);
    expect(dateToMs("2026-11-02", true)).toBe(to);
  });

  it("is open-ended with no range", () => {
    expect(auditBounds({}, 5)).toEqual({});
  });
});

describe("search helpers", () => {
  it("cleans empty values", () => {
    expect(cleanAuditSearch({ q: "", appId: undefined, country: "PT" })).toEqual({ country: "PT" });
  });

  it("detects active filters", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ outcome: "failure" })).toBe(true);
  });
});

describe("formatting", () => {
  it("builds flags from ISO codes", () => {
    expect(countryFlag("pt")).toBe("🇵🇹");
    expect(countryFlag("XX")).toBe("");
    expect(countryFlag(null)).toBe("");
  });

  it("parses metadata strings", () => {
    expect(normalizeMetadata('{"method":"passkey"}')).toEqual({ method: "passkey" });
    expect(normalizeMetadata({ a: 1 })).toEqual({ a: 1 });
    expect(normalizeMetadata("not json")).toEqual({ raw: "not json" });
    expect(normalizeMetadata(null)).toBeNull();
  });

  it("reads parsed client metadata first", () => {
    const client = auditClient({ client: { browser: "Safari", os: "iOS", inApp: "Instagram" } }, "curl/8");
    expect(deviceLabel(client)).toBe("Safari on iOS");
    expect(client?.inApp).toBe("Instagram");
  });

  it("falls back to the user agent", () => {
    const ua = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    expect(deviceLabel(auditClient(null, ua))).toBe("Chrome on Android");
    expect(auditClient(null, null)).toBeNull();
  });

  it("labels sign-in methods", () => {
    expect(methodLabel({ method: "social", provider: "google" })).toBe("Google");
    expect(methodLabel({ method: "passkey" })).toBe("Passkey");
    expect(methodLabel({ method: "email-otp" })).toBe("Email code");
    expect(methodLabel(null)).toBeNull();
  });

  it("summarizes activity context", () => {
    const text = activityContext({
      appName: "Yap",
      city: "Lisbon",
      country: null,
      metadata: { client: { browser: "Safari", os: "iOS", inApp: "Instagram" } },
      userAgent: null,
    });
    expect(text).toBe("Yap · Lisbon · Safari on iOS (Instagram in-app)");
  });
});

describe("CSV", () => {
  it("guards against formula injection", () => {
    expect(csvCell("=HYPERLINK()")).toBe(`"'=HYPERLINK()"`);
    expect(csvCell('a "b"')).toBe(`"a ""b"""`);
    expect(csvCell(null)).toBe(`""`);
  });

  it("includes app, geo, method and client columns", () => {
    const csv = auditCsv([
      row({ metadata: { method: "social", provider: "google", client: { browser: "Safari", os: "iOS", platform: "mobile", inApp: "Instagram" } } }),
    ]);
    const [header, line] = csv.split("\r\n");
    expect(header).toContain('"App","App ID","Country","City","Method","Browser","OS","Platform","In-app browser"');
    expect(line).toContain('"Yap","app_1","PT","Lisbon","Google","Safari","iOS","mobile","Instagram"');
  });
});

describe("exportAuditLogs", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubPages(pages: { count: number; next: string | null }[]) {
    const calls: string[] = [];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const page = pages[i++] ?? { count: 0, next: null };
      const logs = Array.from({ length: page.count }, (_, n) => row({ id: `${i}-${n}` }));
      return new Response(JSON.stringify({ logs, nextCursor: page.next }), { status: 200 });
    }));
    return calls;
  }

  it("walks every page with the same filters", async () => {
    const calls = stubPages([{ count: 100, next: "c1" }, { count: 20, next: null }]);
    const result = await exportAuditLogs({ orgId: "", appId: "app_1", outcome: "failure", from: 10 });
    expect(result.rows).toHaveLength(120);
    expect(result.capped).toBe(false);
    expect(calls[0]).toContain("appId=app_1");
    expect(calls[0]).toContain("outcome=failure");
    expect(calls[0]).toContain("from=10");
    expect(calls[1]).toContain("before=c1");
  });

  it("stops at the cap and reports it", async () => {
    stubPages([{ count: 100, next: "c1" }, { count: 100, next: "c2" }]);
    const result = await exportAuditLogs({ orgId: "" }, { cap: 150 });
    expect(result.rows).toHaveLength(150);
    expect(result.capped).toBe(true);
  });

  it("throws the API error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 })));
    await expect(exportAuditLogs({ orgId: "" })).rejects.toThrow("Admin access required");
  });
});

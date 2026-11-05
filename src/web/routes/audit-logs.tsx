import { UserAvatar } from "@/components/UserAvatar";
import { exportAuditLogs, flattenAuditPages, useAuditFacets, useAuditLogs } from "@/hooks/use-audit-logs";
import {
  type AuditLogRow,
  type AuditRangePreset,
  type AuditSearch,
  auditBounds,
  auditClient,
  auditCsv,
  cleanAuditSearch,
  countryFlag,
  countryName,
  deviceLabel,
  EXPORT_ROW_CAP,
  hasActiveFilters,
  isFailureAction,
  locationText,
  methodLabel,
  RANGE_LABELS,
  RANGE_PRESETS,
  validateAuditSearch,
} from "@/lib/audit";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditLogFilters } from "@/lib/query-keys";
import { auditKeys } from "@/lib/query-keys";
import { relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Ban,
  Building2,
  ChevronDown,
  ClipboardList,
  Download,
  Key,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  SearchX,
  Shield,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/audit-logs")({
  validateSearch: validateAuditSearch,
  component: AuditLogsPage,
});

// ── Action metadata ───────────────────────────────────────────────────────────

type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

interface ActionMeta {
  label: string;
  icon: React.ReactNode;
  tone: BadgeTone;
}

const ACTION_MAP: Record<string, ActionMeta> = {
  "user.signIn": { label: "Signed in", icon: <LogIn />, tone: "info" },
  "user.signOut": { label: "Signed out", icon: <LogOut />, tone: "neutral" },
  "user.signUp": { label: "Account created", icon: <UserPlus />, tone: "success" },
  "user.signInFailed": { label: "Failed sign-in", icon: <Ban />, tone: "danger" },
  "user.passwordChanged": { label: "Password changed", icon: <Shield />, tone: "warning" },
  "user.passwordSet": { label: "Password set", icon: <Shield />, tone: "warning" },
  "app.signIn": { label: "Signed in to app", icon: <LogIn />, tone: "info" },
  "app.signOut": { label: "Signed out of app", icon: <LogOut />, tone: "neutral" },
  "session.ended": { label: "Session ended", icon: <Activity />, tone: "neutral" },
  "session.revoked": { label: "Session revoked", icon: <Activity />, tone: "danger" },
  "twoFactor.enabled": { label: "2FA enabled", icon: <Shield />, tone: "success" },
  "twoFactor.disabled": { label: "2FA disabled", icon: <Shield />, tone: "warning" },
  "twoFactor.challengeFailed": { label: "Failed 2FA", icon: <Ban />, tone: "danger" },
  "security.signInAlertSent": { label: "Sign-in alert sent", icon: <Mail />, tone: "info" },
  "security.signOutEverywhere": { label: "Signed out everywhere", icon: <LogOut />, tone: "warning" },
  "device.approved": { label: "Machine approved", icon: <Shield />, tone: "success" },
  "apiKey.created": { label: "API key created", icon: <Key />, tone: "success" },
  "apiKey.revoked": { label: "API key revoked", icon: <Key />, tone: "danger" },
  "org.created": { label: "Org created", icon: <Building2 />, tone: "success" },
  "member.invited": { label: "Member invited", icon: <UserPlus />, tone: "info" },
  "member.joined": { label: "Member joined", icon: <User />, tone: "success" },
  "member.removed": { label: "Member removed", icon: <User />, tone: "danger" },
  "member.roleChanged": { label: "Role changed", icon: <Shield />, tone: "warning" },
  "admin.userBanned": { label: "User banned", icon: <Ban />, tone: "danger" },
  "admin.userUnbanned": { label: "User unbanned", icon: <Shield />, tone: "success" },
  "admin.userDeleted": { label: "User deleted", icon: <User />, tone: "danger" },
  "admin.roleChanged": { label: "Role changed", icon: <Shield />, tone: "warning" },
};

function actionMeta(action: string): ActionMeta {
  return ACTION_MAP[action] ?? {
    label: action,
    icon: <Activity />,
    tone: isFailureAction(action) ? "danger" : "neutral",
  };
}

// ── Event filter options ──────────────────────────────────────────────────────

/** Category groups. The first option in each group matches the whole prefix. */
const CATEGORIES = [
  { prefix: "user", label: "Account" },
  { prefix: "app", label: "App sign-in/out" },
  { prefix: "session", label: "Sessions" },
  { prefix: "twoFactor", label: "Two-factor" },
  { prefix: "security", label: "Security alerts" },
  { prefix: "device", label: "Devices" },
  { prefix: "apiKey", label: "API keys" },
  { prefix: "org", label: "Organizations" },
  { prefix: "member", label: "Members" },
  { prefix: "admin", label: "Admin actions" },
];

function eventFilterLabel(action: string): string {
  if (action.endsWith(".*")) {
    const prefix = action.slice(0, -2);
    return `All ${(CATEGORIES.find(c => c.prefix === prefix)?.label ?? prefix).toLowerCase()}`;
  }
  return actionMeta(action).label;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const meta = actionMeta(action);
  return (
    <span className={`badge badge-${meta.tone}`}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function ActorCell({ row }: { row: AuditLogRow }) {
  const name = row.actorName ?? "Unknown";
  const email = row.actorEmail ?? row.actor;
  return (
    <div className="row">
      <UserAvatar src={row.actorImage ?? null} name={name} size={24} style={{ flexShrink: 0 }} />
      <div className="min-w-0">
        <p className="cell-primary truncate">{name}</p>
        <p className="text-sm text-tertiary text-mono truncate">{email}</p>
      </div>
    </div>
  );
}

function TimestampCell({ ts }: { ts: number }) {
  const date = new Date(ts);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} style={{ cursor: "default" }}>
      {relativeTime(date.toISOString())}
    </time>
  );
}

function CountryText({ code }: { code: string }) {
  const flag = countryFlag(code);
  return (
    <>
      {flag && <span aria-hidden="true">{flag} </span>}
      {code}
    </>
  );
}

function DetailItem({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "audit-detail-wide" : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function metaText(metadata: Record<string, unknown> | null, key: string): string | null {
  const v = metadata?.[key];
  if (typeof v === "string" && v) return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function RowDetails({ row, id, onFilter }: { row: AuditLogRow; id: string; onFilter: (patch: AuditSearch) => void }) {
  const client = auditClient(row.metadata, row.userAgent);
  const method = methodLabel(row.metadata);
  const endpoint = metaText(row.metadata, "endpoint");
  const reason = metaText(row.metadata, "reason");
  const via = metaText(row.metadata, "via");
  const disposable = row.metadata?.disposableEmail === true;
  const location = locationText(row.city, row.country);
  const browser = client?.browser ? [client.browser, client.browserVersion].filter(Boolean).join(" ") : null;
  const os = client?.os ? [client.os, client.osVersion].filter(Boolean).join(" ") : null;

  return (
    <div id={id} className="audit-detail">
      <dl className="audit-detail-grid">
        <DetailItem label="Event"><code>{row.action}</code></DetailItem>
        <DetailItem label="Outcome">
          {isFailureAction(row.action)
            ? <span className="badge badge-danger">Failure</span>
            : <span className="badge badge-neutral">Success</span>}
        </DetailItem>
        {method && <DetailItem label="Method">{method}</DetailItem>}
        {row.appId && (
          <DetailItem label="App">
            {row.appName ?? "Unknown app"} <span className="text-tertiary text-mono">{row.appId}</span>
          </DetailItem>
        )}
        <DetailItem label="User">
          <span className="row" style={{ flexWrap: "wrap" }}>
            <span className="text-mono">{row.userId}</span>
            <button type="button" className="link-button" onClick={() => onFilter({ q: row.userId })}>
              Show this user's events
            </button>
          </span>
        </DetailItem>
        {(browser || os) && <DetailItem label="Browser">{browser ?? "Unknown"}{os ? ` on ${os}` : ""}</DetailItem>}
        {client?.platform && <DetailItem label="Platform">{client.platform}</DetailItem>}
        {client?.inApp && (
          <DetailItem label="In-app browser"><span className="badge badge-warning">{client.inApp} in-app</span></DetailItem>
        )}
        {location && <DetailItem label="Location">{location}</DetailItem>}
        {row.ipAddress && <DetailItem label="IP address"><code>{row.ipAddress}</code></DetailItem>}
        {endpoint && <DetailItem label="Endpoint"><code>{endpoint}</code></DetailItem>}
        {reason && <DetailItem label="Reason">{reason}</DetailItem>}
        {via && <DetailItem label="Via">{via}</DetailItem>}
        {disposable && <DetailItem label="Email"><span className="badge badge-warning">Disposable address</span></DetailItem>}
        {(row.targetLabel || row.targetId) && (
          <DetailItem label="Target">
            {row.targetType && <span className="text-tertiary">{row.targetType} </span>}
            {row.targetLabel ?? <code>{row.targetId}</code>}
          </DetailItem>
        )}
        {row.userAgent && <DetailItem label="User agent" wide><span className="text-mono">{row.userAgent}</span></DetailItem>}
        {row.metadata && Object.keys(row.metadata).length > 0 && (
          <DetailItem label="Metadata" wide>
            <pre className="code-block" style={{ margin: 0, maxHeight: 240, overflow: "auto" }}>
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </DetailItem>
        )}
      </dl>
    </div>
  );
}

function AuditRow({ row, onFilter }: { row: AuditLogRow; onFilter: (patch: AuditSearch) => void }) {
  const [open, setOpen] = useState(false);
  const detailsId = `audit-details-${row.id}`;
  const client = auditClient(row.metadata, row.userAgent);
  const device = deviceLabel(client);
  const failed = isFailureAction(row.action);

  return (
    <>
      <tr
        className={`is-clickable${open ? " is-open" : ""}${failed ? " is-failure" : ""}`}
        onClick={e => {
          // Buttons inside the row (filters, toggle) handle their own clicks.
          if ((e.target as HTMLElement).closest("button, a")) return;
          if (window.getSelection()?.toString()) return;
          setOpen(o => !o);
        }}
      >
        <td className="cell-meta cell-inline">
          <TimestampCell ts={row.createdAt} />
        </td>
        <td className="cell-inline">
          <div className="stack-sm" style={{ gap: 2, alignItems: "flex-start" }}>
            <ActionBadge action={row.action} />
            {row.appId && (
              <button
                type="button"
                className="link-button text-sm"
                title={`Show events for ${row.appName ?? row.appId}`}
                onClick={() => onFilter({ appId: row.appId ?? undefined })}
              >
                {row.appName ?? row.appId}
              </button>
            )}
          </div>
        </td>
        <td>
          <ActorCell row={row} />
        </td>
        <td className="truncate audit-target" style={{ maxWidth: 200 }}>
          {row.targetLabel
            ? <span title={row.targetLabel}>{row.targetLabel}</span>
            : row.targetId
              ? <code title={row.targetId}>{row.targetId.slice(0, 12)}…</code>
              : <span className="text-tertiary">—</span>}
        </td>
        <td>
          <div className="stack-sm" style={{ gap: 2, alignItems: "flex-start" }}>
            {row.ipAddress && <code>{row.ipAddress}</code>}
            {(row.city || row.country) && (
              <span className="text-sm text-tertiary">
                {row.city && <>{row.city}{row.country ? ", " : ""}</>}
                {row.country && (
                  <button
                    type="button"
                    className="link-button"
                    title={`Show events from ${countryName(row.country)}`}
                    onClick={() => onFilter({ country: row.country ?? undefined })}
                  >
                    <CountryText code={row.country} />
                  </button>
                )}
              </span>
            )}
            {(device || client?.inApp) && (
              <span className="row text-sm text-tertiary" style={{ flexWrap: "wrap", gap: 6 }}>
                {device}
                {client?.inApp && <span className="badge badge-warning">{client.inApp} in-app</span>}
              </span>
            )}
            {!row.ipAddress && !row.country && !device && <span className="text-tertiary">—</span>}
          </div>
        </td>
        <td className="cell-actions">
          <button
            type="button"
            className="btn btn-subtle btn-icon btn-sm audit-expand"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            aria-label={open ? "Hide details" : "Show details"}
            title={open ? "Hide details" : "Show details"}
            onClick={() => setOpen(o => !o)}
          >
            <ChevronDown />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="audit-detail-row">
          <td colSpan={6}>
            <RowDetails row={row} id={detailsId} onFilter={onFilter} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AuditLogsPage() {
  const qc = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: facets } = useAuditFacets();

  /** Discrete filter changes push history so back/forward steps through them. */
  const setSearch = (patch: AuditSearch, replace = false) => {
    void navigate({ search: prev => cleanAuditSearch({ ...prev, ...patch }), replace });
  };

  // ── Search box: local while typing, URL after 300ms ─────────────────────────
  const [qInput, setQInput] = useState(search.q ?? "");
  const lastQ = useRef(search.q ?? "");
  useEffect(() => {
    const urlQ = search.q ?? "";
    if (urlQ !== lastQ.current) {
      lastQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [search.q]);
  useEffect(() => {
    const next = qInput.trim();
    if (next === lastQ.current) return;
    const t = setTimeout(() => {
      lastQ.current = next;
      void navigate({ search: prev => cleanAuditSearch({ ...prev, q: next || undefined }), replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, navigate]);

  // ── Date range ──────────────────────────────────────────────────────────────
  const [customOpen, setCustomOpen] = useState(false);
  const isCustom = customOpen || Boolean(search.from || search.to);
  // Presets count back from when they were picked, so the query key is stable.
  const bounds = useMemo(
    () => auditBounds({ range: search.range, from: search.from, to: search.to }, Date.now()),
    [search.range, search.from, search.to],
  );
  const today = new Date().toLocaleDateString("en-CA");

  const filters: AuditLogFilters = {
    orgId: activeOrg?.id ?? "",
    q: search.q,
    appId: search.appId,
    action: search.action,
    country: search.country,
    outcome: search.outcome,
    from: bounds.from,
    to: bounds.to,
  };
  const filtered = hasActiveFilters(search);

  const clearAll = () => {
    lastQ.current = "";
    setQInput("");
    setCustomOpen(false);
    void navigate({ search: {} });
  };

  // ── Data ─────────────────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isFetching,
  } = useAuditLogs(filters);
  const logs = flattenAuditPages(data);

  // ── Facet options (keep the current value even if facets don't list it) ─────
  const appOptions = useMemo(() => {
    const apps = [...(facets?.apps ?? [])];
    if (search.appId && !apps.some(a => a.id === search.appId)) {
      const fromRows = logs.find(r => r.appId === search.appId)?.appName;
      apps.push({ id: search.appId, name: fromRows ?? search.appId });
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
  }, [facets?.apps, search.appId, logs]);
  const appName = (id: string) => appOptions.find(a => a.id === id)?.name ?? id;

  const countryOptions = useMemo(() => {
    const codes = new Set((facets?.countries ?? []).map(c => c.toUpperCase()));
    if (search.country) codes.add(search.country);
    return [...codes].sort();
  }, [facets?.countries, search.country]);

  const eventGroups = useMemo(() => {
    const known = new Set([...Object.keys(ACTION_MAP), ...(facets?.actions ?? [])]);
    if (search.action && !search.action.endsWith(".*")) known.add(search.action);
    const groups = CATEGORIES.map(c => ({
      ...c,
      actions: [...known].filter(a => a.startsWith(`${c.prefix}.`)).sort(),
    }));
    const other = [...known].filter(a => !CATEGORIES.some(c => a.startsWith(`${c.prefix}.`))).sort();
    return { groups, other };
  }, [facets?.actions, search.action]);

  // ── Active filter chips ─────────────────────────────────────────────────────
  const chips: { key: string; label: React.ReactNode; text: string; clear: AuditSearch }[] = [];
  if (search.q) chips.push({ key: "q", label: <>Search: {search.q}</>, text: `search ${search.q}`, clear: { q: undefined } });
  if (search.appId) {
    const name = appName(search.appId);
    chips.push({ key: "app", label: <>App: {name}</>, text: `app ${name}`, clear: { appId: undefined } });
  }
  if (search.action) {
    const label = eventFilterLabel(search.action);
    chips.push({ key: "action", label: <>Event: {label}</>, text: `event ${label}`, clear: { action: undefined } });
  }
  if (search.country) {
    chips.push({
      key: "country",
      label: <>Country: <CountryText code={search.country} /></>,
      text: `country ${countryName(search.country)}`,
      clear: { country: undefined },
    });
  }
  if (search.range) {
    chips.push({ key: "range", label: RANGE_LABELS[search.range], text: RANGE_LABELS[search.range], clear: { range: undefined } });
  }
  if (search.from || search.to) {
    const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
    const label = search.from && search.to
      ? `${fmt(search.from)} – ${fmt(search.to)}`
      : search.from ? `From ${fmt(search.from)}` : `Until ${fmt(search.to as string)}`;
    chips.push({ key: "dates", label, text: label, clear: { from: undefined, to: undefined } });
  }
  if (search.outcome) chips.push({ key: "outcome", label: "Failures only", text: "failures only", clear: { outcome: undefined } });

  // ── Export ──────────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportNote, setExportNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);

  const runExport = async () => {
    exportAbort.current?.abort();
    const ctrl = new AbortController();
    exportAbort.current = ctrl;
    setExporting(0);
    setExportNote(null);
    try {
      const { rows, capped } = await exportAuditLogs(filters, { signal: ctrl.signal, onProgress: setExporting });
      const blob = new Blob([auditCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportNote(
        capped
          ? { tone: "info", text: `Exported the newest ${EXPORT_ROW_CAP.toLocaleString()} events. Narrow the filters or date range to export the rest.` }
          : { tone: "info", text: `Exported ${rows.length.toLocaleString()} event${rows.length === 1 ? "" : "s"}.` },
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setExportNote({ tone: "danger", text: `Export failed: ${err instanceof Error ? err.message : "unknown error"}` });
    } finally {
      if (exportAbort.current === ctrl) setExporting(null);
    }
  };

  const statusText = isLoading
    ? "Loading events"
    : error
      ? ""
      : `${logs.length} event${logs.length === 1 ? "" : "s"} shown${hasNextPage ? ", more available" : ""}`;

  return (
    <div>
      {/* Header */}
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Security</p>
          <h1 className="page-title">Audit logs</h1>
          <p className="page-subtitle">
            {activeOrg ? (
              <>Events for <strong className="text-strong">{activeOrg.name}</strong></>
            ) : "All platform events: sign-ins, key operations, org changes, admin actions"}
          </p>
        </div>
        <div className="page-header-actions">
          {(logs.length > 0 || exporting !== null) && !isLoading && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              title="Export all matching events as CSV"
              onClick={() => void runExport()}
              disabled={exporting !== null}
            >
              {exporting !== null ? <RefreshCw className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {exporting !== null ? `Exporting ${exporting.toLocaleString()}…` : "Export CSV"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: auditKeys.list(filters) });
              void qc.invalidateQueries({ queryKey: auditKeys.facets() });
            }}
            disabled={isFetching}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={isFetching ? "spin" : undefined} />
          </button>
        </div>
      </header>

      {/* Filters */}
      <section className="audit-filters" aria-label="Filters">
        <div className="audit-filter-row">
          <div className="input-icon" style={{ flex: "2 1 260px" }}>
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Search by email, name or user ID"
              className="input"
              placeholder="Search email, name or user ID"
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape" && qInput) {
                  e.preventDefault();
                  setQInput("");
                }
              }}
              style={{ paddingInlineEnd: 40 }}
            />
            {qInput && (
              <button
                type="button"
                aria-label="Clear search"
                className="btn btn-subtle btn-icon btn-sm"
                onClick={() => setQInput("")}
                style={{ position: "absolute", insetInlineEnd: 4, top: "50%", transform: "translateY(-50%)" }}
              >
                <X />
              </button>
            )}
          </div>

          <select
            aria-label="App"
            className="select"
            value={search.appId ?? ""}
            onChange={e => setSearch({ appId: e.target.value || undefined })}
          >
            <option value="">All apps</option>
            {appOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          <select
            aria-label="Event"
            className="select"
            value={search.action ?? ""}
            onChange={e => setSearch({ action: e.target.value || undefined })}
          >
            <option value="">All events</option>
            {eventGroups.groups.map(g => (
              <optgroup key={g.prefix} label={g.label}>
                <option value={`${g.prefix}.*`}>All {g.label.toLowerCase()}</option>
                {g.actions.map(a => <option key={a} value={a}>{actionMeta(a).label}</option>)}
              </optgroup>
            ))}
            {eventGroups.other.length > 0 && (
              <optgroup label="Other">
                {eventGroups.other.map(a => <option key={a} value={a}>{actionMeta(a).label}</option>)}
              </optgroup>
            )}
          </select>

          <select
            aria-label="Country"
            className="select"
            value={search.country ?? ""}
            onChange={e => setSearch({ country: e.target.value || undefined })}
          >
            <option value="">All countries</option>
            {countryOptions.map(c => (
              <option key={c} value={c}>{[countryFlag(c), c].filter(Boolean).join(" ")} · {countryName(c)}</option>
            ))}
          </select>
        </div>

        <div className="audit-filter-row">
          <div className="segmented" role="group" aria-label="Date range" style={{ flex: "0 1 auto" }}>
            {RANGE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                className="segmented-option"
                aria-pressed={!isCustom && search.range === p}
                title={RANGE_LABELS[p]}
                onClick={() => {
                  setCustomOpen(false);
                  setSearch({ range: p as AuditRangePreset, from: undefined, to: undefined });
                }}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              className="segmented-option"
              aria-pressed={!isCustom && !search.range}
              onClick={() => {
                setCustomOpen(false);
                setSearch({ range: undefined, from: undefined, to: undefined });
              }}
            >
              All
            </button>
            <button
              type="button"
              className="segmented-option"
              aria-pressed={isCustom}
              aria-expanded={isCustom}
              aria-controls="audit-custom-range"
              onClick={() => setCustomOpen(true)}
            >
              Custom
            </button>
          </div>

          {isCustom && (
            <div id="audit-custom-range" className="row" style={{ flexWrap: "wrap" }}>
              <label className="row text-sm text-secondary">
                From
                <input
                  type="date"
                  className="input audit-date"
                  value={search.from ?? ""}
                  max={search.to ?? today}
                  onChange={e => setSearch({ from: e.target.value || undefined, range: undefined })}
                />
              </label>
              <label className="row text-sm text-secondary">
                To
                <input
                  type="date"
                  className="input audit-date"
                  value={search.to ?? ""}
                  min={search.from}
                  max={today}
                  onChange={e => setSearch({ to: e.target.value || undefined, range: undefined })}
                />
              </label>
            </div>
          )}

          <label className="row text-sm text-secondary audit-failures">
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={search.outcome === "failure"}
              onClick={() => setSearch({ outcome: search.outcome === "failure" ? undefined : "failure" })}
            />
            Failures only
          </label>
        </div>

        {chips.length > 0 && (
          <div className="audit-filter-row" aria-label="Active filters" role="group">
            <ul className="audit-chips">
              {chips.map(chip => (
                <li key={chip.key} className="filter-chip">
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove filter: ${chip.text}`}
                    onClick={() => {
                      if (chip.key === "q") {
                        lastQ.current = "";
                        setQInput("");
                      }
                      if (chip.key === "dates") setCustomOpen(false);
                      setSearch(chip.clear);
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-subtle btn-sm" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </section>

      <p className="sr-only" role="status" aria-live="polite">{statusText}</p>

      {exportNote && (
        <p
          className={`alert alert-${exportNote.tone}`}
          role={exportNote.tone === "danger" ? "alert" : "status"}
          style={{ marginBottom: "var(--space-3)" }}
        >
          {exportNote.tone === "danger" ? <Ban /> : <Download />} {exportNote.text}
          <button
            type="button"
            className="btn btn-subtle btn-icon btn-sm"
            aria-label="Dismiss"
            onClick={() => setExportNote(null)}
            style={{ marginInlineStart: "auto" }}
          >
            <X />
          </button>
        </p>
      )}

      {/* Error */}
      {error && <p className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-3)" }}><Ban /> {error.message}</p>}

      {/* Table */}
      <div className="card card-flush">
        {isLoading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading audit logs">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : logs.length === 0 ? (
          filtered ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true"><SearchX /></span>
              <p className="empty-state-title">No events match these filters</p>
              <p className="empty-state-body">Try a wider date range or remove a filter.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>Clear filters</button>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true"><ClipboardList /></span>
              <p className="empty-state-title">No audit events yet</p>
              <p className="empty-state-body">
                Events are written automatically as users sign in and perform actions.
              </p>
            </div>
          )
        ) : (
          <div className="table-scroll">
            <table className="data-table is-stackable audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>IP / client</th>
                  <th><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(row => <AuditRow key={row.id} row={row} onFilter={patch => setSearch(patch)} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* Load more */}
        {hasNextPage && !isLoading && (
          <div className="panel-footer" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Row count */}
      {!isLoading && logs.length > 0 && (
        <p className="text-sm text-tertiary" style={{ marginTop: 10, textAlign: "end" }}>
          Showing {logs.length} event{logs.length !== 1 ? "s" : ""}
          {hasNextPage ? " — more available" : ""}
        </p>
      )}
    </div>
  );
}

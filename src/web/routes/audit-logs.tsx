import { UserAvatar } from "@/components/UserAvatar";
import { flattenAuditPages, useAuditLogs } from "@/hooks/use-audit-logs";
import { useActiveOrganization } from "@/lib/auth-client";
import { auditKeys } from "@/lib/query-keys";
import { relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Ban,
  Building2,
  ClipboardList,
  Download,
  Key,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/audit-logs")({
  component: AuditLogsPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLogRow {
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
}

// ── Action metadata ───────────────────────────────────────────────────────────

type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

interface ActionMeta {
  label: string;
  icon: React.ReactNode;
  tone: BadgeTone;
  category: "auth" | "security" | "keys" | "org" | "admin";
}

const ACTION_MAP: Record<string, ActionMeta> = {
  "user.signIn": { label: "Signed in", icon: <LogIn />, tone: "info", category: "auth" },
  "user.signOut": { label: "Signed out", icon: <LogOut />, tone: "neutral", category: "auth" },
  "user.signUp": { label: "Account created", icon: <UserPlus />, tone: "success", category: "auth" },
  "user.passwordChanged": { label: "Password changed", icon: <Shield />, tone: "warning", category: "security" },
  "user.passwordSet": { label: "Password set", icon: <Shield />, tone: "warning", category: "security" },
  "twoFactor.enabled": { label: "2FA enabled", icon: <Shield />, tone: "success", category: "security" },
  "twoFactor.disabled": { label: "2FA disabled", icon: <Shield />, tone: "warning", category: "security" },
  "apiKey.created": { label: "API key created", icon: <Key />, tone: "success", category: "keys" },
  "apiKey.revoked": { label: "API key revoked", icon: <Key />, tone: "danger", category: "keys" },
  "org.created": { label: "Org created", icon: <Building2 />, tone: "success", category: "org" },
  "member.invited": { label: "Member invited", icon: <UserPlus />, tone: "info", category: "org" },
  "member.joined": { label: "Member joined", icon: <User />, tone: "success", category: "org" },
  "member.removed": { label: "Member removed", icon: <User />, tone: "danger", category: "org" },
  "member.roleChanged": { label: "Role changed", icon: <Shield />, tone: "warning", category: "org" },
  "session.revoked": { label: "Session revoked", icon: <Activity />, tone: "danger", category: "admin" },
  "admin.userBanned": { label: "User banned", icon: <Ban />, tone: "danger", category: "admin" },
  "admin.userUnbanned": { label: "User unbanned", icon: <Shield />, tone: "success", category: "admin" },
  "admin.userDeleted": { label: "User deleted", icon: <User />, tone: "danger", category: "admin" },
  "admin.roleChanged": { label: "Role changed", icon: <Shield />, tone: "warning", category: "admin" },
  "device.approved": { label: "Machine approved", icon: <Shield />, tone: "success", category: "security" },
};

function actionMeta(action: string): ActionMeta {
  return ACTION_MAP[action] ?? {
    label: action,
    icon: <Activity />,
    tone: "neutral",
    category: "auth",
  };
}

// ── Category filter options ───────────────────────────────────────────────────

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "user.*", label: "Auth (sign-in/out)" },
  { value: "twoFactor.*", label: "Two-factor" },
  { value: "apiKey.*", label: "API keys" },
  { value: "org.*", label: "Organizations" },
  { value: "member.*", label: "Members" },
  { value: "admin.*", label: "Admin actions" },
  { value: "session.*", label: "Sessions" },
];

// ── User-agent parser (lightweight, no deps) ──────────────────────────────────

function parseUA(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome/i.test(ua)) return "Chrome";
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua)) return "Safari";
  if (/curl/i.test(ua)) return "curl";
  return "Browser";
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
      <UserAvatar
        src={(row as any).actorImage ?? null}
        name={name}
        size={24}
        style={{ flexShrink: 0 }}
      />
      <div className="min-w-0">
        <p className="cell-primary truncate">{name}</p>
        <p className="text-sm text-tertiary text-mono truncate">{email}</p>
      </div>
    </div>
  );
}

function TimestampCell({ ts }: { ts: number }) {
  const abs = new Date(ts).toLocaleString();
  return (
    <span title={abs} style={{ cursor: "default" }}>
      {relativeTime(new Date(ts).toISOString())}
    </span>
  );
}

// ── Filter dropdown ────────────────────────────────────────────────────────────

function FilterDropdown({
  value, options, onChange
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label="Filter by category"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="select"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AuditLogsPage() {
  const qc = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();

  // Filters — changes cause useInfiniteQuery to re-run from page 1
  const [userIdFilter, setUserIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const filters = {
    userId: userIdFilter.trim(),
    action: actionFilter,
    orgId: activeOrg?.id ?? "",
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

  // Flatten all pages into one array for rendering
  const logs = flattenAuditPages(data) as AuditLogRow[];

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
          {logs.length > 0 && !isLoading && (
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              title="Download CSV"
              aria-label="Download CSV"
              onClick={() => {
                const headers = ["Timestamp", "Action", "Actor", "Actor Email", "Target", "IP Address", "User Agent"];
                const rows = logs.map(r => [
                  new Date(r.createdAt).toISOString(),
                  r.action,
                  r.actorName ?? r.actor,
                  r.actorEmail ?? r.actor,
                  r.targetLabel ?? r.targetId ?? "",
                  r.ipAddress ?? "",
                  r.userAgent ?? "",
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
                const csv = [headers.join(","), ...rows].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download />
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => void qc.invalidateQueries({ queryKey: auditKeys.list(filters) })}
            disabled={isFetching}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={isFetching ? "spin" : undefined} />
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="row" style={{ marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 220px" }}>
          <FilterDropdown value={actionFilter} options={CATEGORIES} onChange={v => setActionFilter(v)} />
        </div>

        {/* User ID / email filter */}
        <div className="input-icon" style={{ flex: "1 1 220px" }}>
          <Search aria-hidden="true" />
          <input
            aria-label="Filter by user ID"
            className="input"
            placeholder="Filter by user ID…"
            value={userIdFilter}
            onChange={e => setUserIdFilter(e.target.value)}
            style={{ paddingInlineEnd: 40 }}
          />
          {userIdFilter && (
            <button
              type="button"
              aria-label="Clear user filter"
              className="btn btn-subtle btn-icon btn-sm"
              onClick={() => setUserIdFilter("")}
              style={{ position: "absolute", insetInlineEnd: 4, top: "50%", transform: "translateY(-50%)" }}
            >
              <X />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && <p className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-3)" }}><Ban /> {error.message}</p>}

      {/* Table */}
      <div className="card card-flush">
        {isLoading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading audit logs">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><ClipboardList /></span>
            <p className="empty-state-title">No audit events found</p>
            <p className="empty-state-body">
              Events are written automatically as users sign in and perform actions.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>IP / client</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(row => (
                  <tr key={row.id}>
                    <td className="cell-meta">
                      <TimestampCell ts={row.createdAt} />
                    </td>
                    <td>
                      <ActionBadge action={row.action} />
                    </td>
                    <td>
                      <ActorCell row={row} />
                    </td>
                    <td className="truncate" style={{ maxWidth: 200 }}>
                      {row.targetLabel
                        ? <span title={row.targetLabel}>{row.targetLabel}</span>
                        : row.targetId
                          ? <code>{row.targetId.slice(0, 12)}…</code>
                          : <span className="text-tertiary">—</span>
                      }
                    </td>
                    <td>
                      <div className="stack-sm" style={{ gap: 2 }}>
                        {row.ipAddress && (
                          <code>{row.ipAddress}</code>
                        )}
                        {row.userAgent && (
                          <span className="text-sm text-tertiary">{parseUA(row.userAgent)}</span>
                        )}
                        {!row.ipAddress && !row.userAgent && <span className="text-tertiary">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
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

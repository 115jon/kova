import { UserAvatar } from "@/components/UserAvatar";
import { flattenAuditPages, useAuditLogs } from "@/hooks/use-audit-logs";
import { useActiveOrganization } from "@/lib/auth-client";
import { auditKeys } from "@/lib/query-keys";
import { relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  ChevronDown,
  ClipboardList,
  Download,
  Key,
  LogIn,
  LogOut,
  RefreshCw,
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

interface ActionMeta {
  label: string;
  icon: React.ReactNode;
  color: string;     // badge background (rgba)
  textColor: string;
  category: "auth" | "security" | "keys" | "org" | "admin";
}

const ACTION_MAP: Record<string, ActionMeta> = {
  "user.signIn": { label: "Signed in", icon: <LogIn size={11} />, color: "rgba(99,102,241,0.15)", textColor: "#818cf8", category: "auth" },
  "user.signOut": { label: "Signed out", icon: <LogOut size={11} />, color: "rgba(71,85,105,0.2)", textColor: "#94a3b8", category: "auth" },
  "user.signUp": { label: "Account created", icon: <UserPlus size={11} />, color: "rgba(52,211,153,0.15)", textColor: "#34d399", category: "auth" },
  "user.passwordChanged": { label: "Password changed", icon: <Shield size={11} />, color: "rgba(234,179,8,0.15)", textColor: "#facc15", category: "security" },
  "user.passwordSet": { label: "Password set", icon: <Shield size={11} />, color: "rgba(234,179,8,0.15)", textColor: "#facc15", category: "security" },
  "twoFactor.enabled": { label: "2FA enabled", icon: <Shield size={11} />, color: "rgba(52,211,153,0.15)", textColor: "#34d399", category: "security" },
  "twoFactor.disabled": { label: "2FA disabled", icon: <Shield size={11} />, color: "rgba(239,68,68,0.12)", textColor: "#f87171", category: "security" },
  "apiKey.created": { label: "API key created", icon: <Key size={11} />, color: "rgba(245,158,11,0.15)", textColor: "#f59e0b", category: "keys" },
  "apiKey.revoked": { label: "API key revoked", icon: <Key size={11} />, color: "rgba(239,68,68,0.12)", textColor: "#f87171", category: "keys" },
  "org.created": { label: "Org created", icon: <Building2 size={11} />, color: "rgba(139,92,246,0.15)", textColor: "#a78bfa", category: "org" },
  "member.invited": { label: "Member invited", icon: <UserPlus size={11} />, color: "rgba(139,92,246,0.15)", textColor: "#a78bfa", category: "org" },
  "member.joined": { label: "Member joined", icon: <User size={11} />, color: "rgba(139,92,246,0.15)", textColor: "#a78bfa", category: "org" },
  "member.removed": { label: "Member removed", icon: <User size={11} />, color: "rgba(239,68,68,0.12)", textColor: "#f87171", category: "org" },
  "member.roleChanged": { label: "Role changed", icon: <Shield size={11} />, color: "rgba(139,92,246,0.12)", textColor: "#a78bfa", category: "org" },
  "session.revoked": { label: "Session revoked", icon: <Activity size={11} />, color: "rgba(239,68,68,0.12)", textColor: "#f87171", category: "admin" },
  "admin.userBanned": { label: "User banned", icon: <Shield size={11} />, color: "rgba(239,68,68,0.15)", textColor: "#f87171", category: "admin" },
  "admin.userUnbanned": { label: "User unbanned", icon: <Shield size={11} />, color: "rgba(52,211,153,0.12)", textColor: "#34d399", category: "admin" },
  "admin.userDeleted": { label: "User deleted", icon: <User size={11} />, color: "rgba(239,68,68,0.15)", textColor: "#f87171", category: "admin" },
  "admin.roleChanged": { label: "Role changed", icon: <Shield size={11} />, color: "rgba(239,68,68,0.12)", textColor: "#f87171", category: "admin" },
};

function actionMeta(action: string): ActionMeta {
  return ACTION_MAP[action] ?? {
    label: action,
    icon: <Activity size={11} />,
    color: "rgba(71,85,105,0.2)",
    textColor: "#94a3b8",
    category: "auth",
  };
}

// ── Category filter options ───────────────────────────────────────────────────

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "user.*", label: "Auth (sign-in/out)" },
  { value: "twoFactor.*", label: "Two-factor" },
  { value: "apiKey.*", label: "API Keys" },
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
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: meta.color, color: meta.textColor,
      borderRadius: 3, padding: "2px 7px",
      fontFamily: "var(--font-mono)",
      fontSize: "0.65rem", fontWeight: 500,
      letterSpacing: "0.04em",
    }}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function ActorCell({ row }: { row: AuditLogRow }) {
  const name = row.actorName ?? "Unknown";
  const email = row.actorEmail ?? row.actor;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <UserAvatar
        src={(row as any).actorImage ?? null}
        name={name}
        size={24}
        style={{ flexShrink: 0 }}
      />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", fontWeight: 500, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </p>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {email}
        </p>
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
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input"
        style={{ paddingRight: 28, appearance: "none", cursor: "pointer", fontSize: "0.8rem" }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#475569" }} />
    </div>
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
    <div className="animate-in">
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Security</p>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-subtitle">
            {activeOrg ? (
              <><Building2 size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                Events for <strong style={{ color: "var(--color-text-primary)" }}>{activeOrg.name}</strong></>
            ) : "All platform events — sign-ins, key operations, org changes, admin actions"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {logs.length > 0 && !isLoading && (
            <button
              className="btn btn-ghost"
              title="Download CSV"
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
              <Download size={14} />
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => void qc.invalidateQueries({ queryKey: auditKeys.list(filters) })}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw size={14} className={isFetching ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <FilterDropdown value={actionFilter} options={CATEGORIES} onChange={v => setActionFilter(v)} />

        {/* User ID / email filter */}
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <input
            className="input"
            placeholder="Filter by user ID…"
            value={userIdFilter}
            onChange={e => setUserIdFilter(e.target.value)}
            style={{ width: "100%", fontSize: "0.8rem", paddingRight: 32 }}
          />
          {userIdFilter && (
            <button
              onClick={() => setUserIdFilter("")}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#475569", padding: 2 }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.78rem",
        }}>
          {error.message}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading ? (
          <div className="loading" style={{ padding: 48, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>
            Loading audit logs…
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div style={{
              width: 40, height: 40, borderRadius: 5, margin: "0 auto 14px",
              background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ClipboardList size={18} color="var(--color-accent)" strokeWidth={1.5} />
            </div>
            <p style={{ color: "var(--color-text-secondary)", marginBottom: 6, fontFamily: "var(--font-mono)" }}>No audit events found</p>
            <p style={{ color: "var(--color-text-tertiary)", fontSize: "0.72rem" }}>
              Events are written automatically as users sign in and perform actions.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Target</th>
                <th>IP / Client</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(row => (
                <tr key={row.id}>
                  <td style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.74rem", whiteSpace: "nowrap" }}>
                    <TimestampCell ts={row.createdAt} />
                  </td>
                  <td>
                    <ActionBadge action={row.action} />
                  </td>
                  <td>
                    <ActorCell row={row} />
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-secondary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.targetLabel
                      ? <span title={row.targetLabel}>{row.targetLabel}</span>
                      : row.targetId
                        ? <code style={{ color: "var(--color-accent)" }}>{row.targetId.slice(0, 12)}…</code>
                        : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                    }
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {row.ipAddress && (
                        <code style={{ color: "var(--color-text-secondary)" }}>{row.ipAddress}</code>
                      )}
                      {row.userAgent && (
                        <span>{parseUA(row.userAgent)}</span>
                      )}
                      {!row.ipAddress && !row.userAgent && <span>—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Load more */}
        {hasNextPage && !isLoading && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "center" }}>
            <button className="btn btn-ghost" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Row count */}
      {!isLoading && logs.length > 0 && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 10, textAlign: "right" }}>
          Showing {logs.length} event{logs.length !== 1 ? "s" : ""}
          {hasNextPage ? " — more available" : ""}
        </p>
      )}
    </div>
  );
}

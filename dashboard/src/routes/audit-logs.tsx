import { useActiveOrganization } from "@/lib/auth-client";
import { relativeTime } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  ChevronDown,
  ClipboardList,
  Key,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
      borderRadius: 5, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 600,
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
      <div style={{
        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
        background: "linear-gradient(135deg, #6366f1, #7c3aed)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.65rem", fontWeight: 700, color: "#fff",
      }}>
        {name[0]?.toUpperCase() ?? "?"}
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </p>
        <p style={{ fontSize: "0.7rem", color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
  const { data: activeOrg } = useActiveOrganization();

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Filters
  const [userIdFilter, setUserIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  // Use a ref for nextCursor so loadLogs can have a stable identity
  // (never captures stale cursor value, no need for it in useCallback deps).
  const nextCursorRef = useRef<string | null>(null);
  // Stable ref so loadLogs reads current filter values without needing them in deps.
  const filtersRef = useRef({ userId: "", action: "", orgId: "" });

  const buildParams = (before?: string | null) => {
    const params = new URLSearchParams();
    if (filtersRef.current.userId) params.set("userId", filtersRef.current.userId);
    if (filtersRef.current.action) params.set("action", filtersRef.current.action);
    if (filtersRef.current.orgId) params.set("orgId", filtersRef.current.orgId);
    if (before) params.set("before", before);
    params.set("limit", "50");
    return params.toString();
  };

  // stable identity — reads from refs, never needs to be in useEffect deps
  const loadLogs = useCallback(async (replace = true) => {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError("");
    try {
      const qs = buildParams(replace ? null : nextCursorRef.current);
      const res = await fetch(`/api/audit/logs?${qs}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? `Failed (${res.status})`);
      }
      const data = await res.json() as { logs: AuditLogRow[]; nextCursor: string | null };
      nextCursorRef.current = data.nextCursor;
      setNextCursor(data.nextCursor);
      setLogs(prev => replace ? data.logs : [...prev, ...data.logs]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load whenever filters change
  useEffect(() => {
    filtersRef.current = {
      userId: userIdFilter.trim(),
      action: actionFilter,
      orgId: activeOrg?.id ?? "",
    };
    loadLogs(true);
  }, [userIdFilter, actionFilter, activeOrg?.id, loadLogs]);

  const handleLoadMore = () => loadLogs(false);

  return (
    <div className="animate-in">
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={20} color="#818cf8" />
            Audit Logs
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>
            {activeOrg ? (
              <><Building2 size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                Events for <strong style={{ color: "#94a3b8" }}>{activeOrg.name}</strong></>
            ) : "All platform events — sign-ins, key operations, org changes, admin actions"}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => loadLogs(true)} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
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
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: "0.83rem",
        }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ padding: 48, textAlign: "center", color: "#475569", fontSize: "0.85rem" }}>
            Loading audit logs…
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, margin: "0 auto 14px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ClipboardList size={20} color="#818cf8" strokeWidth={1.5} />
            </div>
            <p style={{ color: "#475569", fontSize: "0.85rem" }}>No audit events found</p>
            <p style={{ color: "#334155", fontSize: "0.78rem", marginTop: 6 }}>
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
                  <td style={{ color: "#64748b", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                    <TimestampCell ts={row.createdAt} />
                  </td>
                  <td>
                    <ActionBadge action={row.action} />
                  </td>
                  <td>
                    <ActorCell row={row} />
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.targetLabel
                      ? <span title={row.targetLabel}>{row.targetLabel}</span>
                      : row.targetId
                        ? <code style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#475569" }}>{row.targetId.slice(0, 12)}…</code>
                        : <span style={{ color: "#334155" }}>—</span>
                    }
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "#475569" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {row.ipAddress && (
                        <code style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{row.ipAddress}</code>
                      )}
                      {row.userAgent && (
                        <span style={{ color: "#334155" }}>{parseUA(row.userAgent)}</span>
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
        {nextCursor && !loading && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "center" }}>
            <button className="btn btn-ghost" onClick={handleLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Row count */}
      {!loading && logs.length > 0 && (
        <p style={{ fontSize: "0.75rem", color: "#334155", marginTop: 10, textAlign: "right" }}>
          Showing {logs.length} event{logs.length !== 1 ? "s" : ""}
          {nextCursor ? " — more available" : ""}
        </p>
      )}
    </div>
  );
}

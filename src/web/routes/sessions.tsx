import { ConfirmModal } from "@/components/ConfirmModal";
import { UserAvatar } from "@/components/UserAvatar";
import { useRevokeAllOtherSessions, useRevokeSession, useSessions } from "@/hooks/use-sessions";
import { sessionKeys } from "@/lib/query-keys";
import { relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Laptop,
  RefreshCw,
  Shield,
  Smartphone,
  Tablet,
  X,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";

export const Route = createFileRoute("/sessions")({
  component: SessionsPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedSession = {
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  userName: string;
  userEmail: string;
  userImage: string | null;
  isCurrent: boolean;
  deviceType: "Desktop" | "Mobile" | "Tablet" | "Unknown";
  browser: string;
  browserVersion: string | null;
  os: string;
  osVersion: string | null;
  deviceLabel: string;
  geoCity: string | null;
  geoCountry: string | null;
  geoLocation: string | null;
  geoFlag: string | null;
};

// ── Device icon ───────────────────────────────────────────────────────────────

function DeviceIcon({ type }: { type: string }) {
  switch (type) {
    case "Mobile": return <Smartphone />;
    case "Tablet": return <Tablet />;
    default: return <Laptop />;
  }
}

// ── Toast notification ────────────────────────────────────────────────────────

type Toast = { id: number; type: "success" | "error"; message: string };

function ToastGroup({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, insetInlineEnd: 24,
      maxWidth: "calc(100vw - 32px)",
      display: "flex", flexDirection: "column", gap: 10,
      zIndex: 9999, pointerEvents: "none",
    }}>
      {toasts.map(t => (
        // The alert tint is translucent, so it sits on an opaque surface to stay legible over page content.
        <div
          key={t.id}
          style={{
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-pop)",
            pointerEvents: "auto",
          }}
        >
          <p
            className={`alert ${t.type === "success" ? "alert-success" : "alert-danger"}`}
            role={t.type === "success" ? "status" : "alert"}
            style={{ alignItems: "center" }}
          >
            {t.type === "success" ? <CheckCircle2 /> : <AlertCircle />}
            <span className="min-w-0">{t.message}</span>
            <button
              type="button"
              className="btn btn-subtle btn-sm btn-icon"
              style={{ marginInlineStart: "auto" }}
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
            >
              <X />
            </button>
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Sessions table ────────────────────────────────────────────────────────────

function SessionsTable({
  sessions,
  revokingId,
  onRevoke,
}: {
  sessions: EnrichedSession[];
  revokingId: string | null;
  onRevoke: (sessionId: string) => void;
}) {
  return (
    <div className="card card-flush">
      <table className="data-table is-stackable">
        <thead>
          <tr>
            <th>Device</th>
            <th>User</th>
            <th>Location</th>
            <th>Active</th>
            <th>Expires</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => {
            const revoking = revokingId === s.id;
            const unknownDevice = s.deviceLabel === "Unknown device";
            return (
              <tr key={s.id}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`icon-tile icon-tile-sm ${s.isCurrent ? "" : "tone-neutral"}`} aria-hidden="true">
                      <DeviceIcon type={s.deviceType} />
                    </span>
                    <div className="min-w-0">
                      <p className={unknownDevice ? "text-tertiary" : "text-strong"}>{s.deviceLabel}</p>
                      {s.isCurrent && (
                        <span className="badge badge-info" style={{ marginTop: 4 }}><Zap /> Current</span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <UserAvatar src={s.userImage ?? null} name={s.userName} size={28} />
                    <div className="min-w-0">
                      <p className="text-strong truncate">{s.userName}</p>
                      <p className="text-mono text-tertiary truncate">{s.userEmail}</p>
                    </div>
                  </div>
                </td>
                <td data-label="Location" className="cell-location">
                  {s.geoLocation && (
                    <p>{s.geoFlag && <span aria-hidden="true">{s.geoFlag} </span>}{s.geoLocation}</p>
                  )}
                  {s.ipAddress && <p className="text-mono text-tertiary truncate" title={s.ipAddress}>{s.ipAddress}</p>}
                  {!s.geoLocation && !s.ipAddress && <span className="text-tertiary">—</span>}
                </td>
                <td className="cell-meta cell-inline">
                  <span className="cell-prefix">Active </span>{relativeTime(new Date(s.updatedAt).toISOString())}
                </td>
                <td className="cell-meta cell-inline">
                  <span className="cell-prefix">expires </span>{relativeTime(new Date(s.expiresAt).toISOString())}
                </td>
                <td className="cell-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm btn-icon"
                    disabled={revoking}
                    onClick={() => onRevoke(s.id)}
                    title={s.isCurrent ? "You cannot revoke your own current session" : "Revoke this session"}
                    aria-label={s.isCurrent ? "Revoke current session" : `Revoke session for ${s.userName}`}
                  >
                    {revoking ? <RefreshCw className="spin" /> : <X />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SessionsPage() {
  const qc = useQueryClient();

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data, isLoading } = useSessions();
  const sessions = data?.sessions ?? [];
  const currentSessionId = data?.currentSessionId ?? null;

  // ── Mutations ───────────────────────────────────────────────────────────────
  const revokeMut = useRevokeSession();
  const revokeAllMut = useRevokeAllOtherSessions();

  // ── Local UI state (toasts + confirm dialog) ────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);
  const toastCounter = useRef(0);

  const addToast = (type: "success" | "error", message: string) => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  // ── Handlers ────────────────────────────────────────────────────────────────
  const revoke = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session?.isCurrent) {
      addToast("error", "Cannot revoke your own current session");
      return;
    }
    revokeMut.mutate(
      { sessionId },
      {
        onSuccess: () => addToast("success", "Session revoked"),
        onError: (err) => addToast("error", err.message ?? "Failed to revoke session"),
      },
    );
  };

  const revokeAllOthers = () => {
    setConfirmState({
      title: "Revoke all other sessions?",
      body: "All other users and all other browser sessions will be immediately signed out. This cannot be undone.",
      confirmLabel: "Revoke all",
      onConfirm: () => {
        setConfirmState(null);
        if (!currentSessionId) return;
        revokeAllMut.mutate(
          { exceptSessionId: currentSessionId },
          {
            onSuccess: (data) =>
              addToast("success", `Revoked ${data.revokedCount} session${data.revokedCount !== 1 ? "s" : ""}`),
            onError: (err) => addToast("error", err.message ?? "Revoke all failed"),
          },
        );
      },
    });
  };

  const loading = isLoading;
  const revokingAll = revokeAllMut.isPending;
  const revokingId = revokeMut.isPending ? (revokeMut.variables?.sessionId ?? null) : null;

  // Separate current from others, sort others by most-recently-active
  const currentSession = sessions.find(s => s.isCurrent);
  const otherSessions = sessions
    .filter(s => !s.isCurrent)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Group others by user
  const userGroups = otherSessions.reduce<Record<string, { user: EnrichedSession; sessions: EnrichedSession[] }>>(
    (acc, s) => {
      if (!acc[s.userId]) acc[s.userId] = { user: s, sessions: [] };
      acc[s.userId]!.sessions.push(s);
      return acc;
    },
    {}
  );

  const otherCount = otherSessions.length;
  const groupedOthers = Object.values(userGroups).flatMap(g => g.sessions);

  return (
    <div>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          loading={revokingAll}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}

      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Platform</p>
          <h1 className="page-title">Sessions</h1>
          {loading ? (
            <p className="page-subtitle"><span className="skeleton" style={{ height: 14, width: 200 }} /></p>
          ) : (
            <p className="page-subtitle tabular">
              {`${sessions.length} active session${sessions.length !== 1 ? "s" : ""} across ${Object.keys(userGroups).length + (currentSession ? 1 : 0)} user${Object.keys(userGroups).length + (currentSession ? 1 : 0) !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>

        <div className="page-header-actions">
          {!loading && otherCount > 0 && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={revokingAll}
              onClick={revokeAllOthers}
            >
              {revokingAll ? <RefreshCw className="spin" /> : <Shield />}
              Revoke all other sessions
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => void qc.invalidateQueries({ queryKey: sessionKeys.all })}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh sessions"
          >
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="card card-flush">
          <div className="skeleton-rows" role="status" aria-label="Loading sessions">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="card card-flush">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Laptop /></span>
            <p className="empty-state-title">No active sessions</p>
            <p className="empty-state-body">Signed-in sessions across your apps appear here.</p>
          </div>
        </div>
      )}

      {!loading && currentSession && (
        <section className="stack-sm" style={{ marginBottom: 24 }} aria-labelledby="sessions-current">
          <h2 className="text-h3" id="sessions-current">Your current session</h2>
          <SessionsTable sessions={[currentSession]} revokingId={revokingId} onRevoke={revoke} />
        </section>
      )}

      {!loading && otherCount > 0 && (
        <section className="stack-sm" aria-labelledby="sessions-other">
          <h2 className="text-h3" id="sessions-other">Other sessions ({otherCount})</h2>
          <SessionsTable sessions={groupedOthers} revokingId={revokingId} onRevoke={revoke} />
        </section>
      )}

      <ToastGroup toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

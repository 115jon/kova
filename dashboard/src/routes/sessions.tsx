import { ConfirmModal } from "@/components/ConfirmModal";
import { UserAvatar } from "@/components/UserAvatar";
import { relativeTime } from "@/lib/utils";
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
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/sessions")({
  component: SessionsPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedSession = {
  id: string;
  userId: string;
  token: string;
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

// ── Browser SVG icons ─────────────────────────────────────────────────────────

function BrowserIcon({ name, size = 20 }: { name: string; size?: number }) {
  switch (name) {
    case "Chrome":
    case "Chromium":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" fill="#4285F4" />
          <path d="M12 8h8.66a10 10 0 1 0-1.34 10.94L12 12V8z" fill="#EA4335" />
          <path d="M12 8h8.66a10 10 0 0 1-3.32 13.44L12 12" fill="#FBBC05" />
          <path d="M12 16a4 4 0 0 0 3.32-6.21L12 12z" fill="#34A853" />
          <circle cx="12" cy="12" r="3" fill="#4285F4" />
        </svg>
      );
    case "Firefox":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#FF9400" />
          <path d="M18.5 9.5C17.3 6.8 14.8 5 12 5  c-3.9 0-7 3.1-7 7s3.1 7 7 7c2.4 0 4.5-1.2 5.8-3" stroke="#FF4D00" strokeWidth="0" fill="#CC3000" />
          <circle cx="12" cy="12" r="4" fill="#0090FF" />
          <circle cx="14" cy="10" r="2" fill="#00BFFF" />
        </svg>
      );
    case "Safari":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#3399FF" strokeWidth="2" fill="none" />
          <line x1="12" y1="3" x2="12" y2="21" stroke="#CBD5E1" strokeWidth="0.5" />
          <line x1="3" y1="12" x2="21" y2="12" stroke="#CBD5E1" strokeWidth="0.5" />
          <polygon points="12,6 15,15 12,13 9,15" fill="#EF4444" />
          <polygon points="12,18 9,9 12,11 15,9" fill="#64748B" />
        </svg>
      );
    case "Edge":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M4 12C4 7.6 7.6 4 12 4c2.7 0 5.1 1.3 6.6 3.3C17.2 7.1 15.7 7 14 7c-3.3 0-6 2.7-6 6 0 2 1 3.8 2.4 4.9C8.5 17.5 6 15.1 6 12" fill="#0078D4" />
          <path d="M12 13c0-3.3 2.7-6 6-6 .5 0 1 .1 1.4.2A10 10 0 0 1 12 22c-1.8 0-3.4-.5-4.9-1.3 1.4.8 3 1 4.5.5 2-.7 3.4-2.7 3.4-5 0-1.8-1.3-3.2-3-3.2H12z" fill="#0546B3" />
        </svg>
      );
    case "Arc":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="arc-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FF6B9D" />
              <stop offset="50%" stopColor="#C44DE6" />
              <stop offset="100%" stopColor="#4ECBF5" />
            </linearGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#arc-g)" />
          <path d="M7 17L12 7l5 10H7z" fill="white" fillOpacity="0.9" />
        </svg>
      );
    case "Opera":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#FF1B2D" />
          <ellipse cx="12" cy="12" rx="4.5" ry="7" stroke="white" strokeWidth="2" fill="none" />
        </svg>
      );
    case "Samsung Browser":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#1428A0" />
          <text x="12" y="16" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">S</text>
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#475569" strokeWidth="2" fill="none" />
          <circle cx="12" cy="12" r="3" fill="#64748b" />
        </svg>
      );
  }
}

// ── Device icon ───────────────────────────────────────────────────────────────

function DeviceIcon({ type, color = "var(--color-text-secondary)" }: { type: string; color?: string }) {
  const props = { size: 18, color };
  switch (type) {
    case "Mobile": return <Smartphone {...props} />;
    case "Tablet": return <Tablet {...props} />;
    default: return <Laptop {...props} />;
  }
}

// ── Toast notification ────────────────────────────────────────────────────────

type Toast = { id: number; type: "success" | "error"; message: string };

function ToastGroup({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      display: "flex", flexDirection: "column", gap: 10,
      zIndex: 9999, pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "11px 14px", borderRadius: 5, fontSize: "0.8rem",
            background: t.type === "success" ? "var(--color-surface)" : "rgba(248,113,113,0.08)",
            border: t.type === "success"
              ? "1px solid rgba(52,211,153,0.25)"
              : "1px solid rgba(248,113,113,0.25)",
            color: t.type === "success" ? "var(--color-green)" : "var(--color-red)",
            fontFamily: "var(--font-mono)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            pointerEvents: "auto",
            animation: "slideInRight 0.2s ease",
          }}
        >
          {t.type === "success"
            ? <CheckCircle2 size={14} />
            : <AlertCircle size={14} />
          }
          {t.message}
          <button
            onClick={() => onDismiss(t.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 2, marginLeft: 4 }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  revoking,
  onRevoke,
}: {
  session: EnrichedSession;
  revoking: boolean;
  onRevoke: (token: string) => void;
}) {
  const deviceColor = session.isCurrent ? "var(--color-accent)" : "var(--color-text-secondary)";

  return (
    <div
      style={{
        background: session.isCurrent
          ? "var(--color-accent-glow)"
          : "var(--color-surface)",
        border: session.isCurrent
          ? "1px solid var(--color-border-accent)"
          : "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "center",
        transition: "border-color 0.2s",
      }}
    >
      {/* Left — device + browser icons */}
      <div style={{
        width: 40, height: 40, borderRadius: 5,
        background: session.isCurrent ? "var(--color-accent-dim)" : "var(--color-surface-raised)",
        border: "1px solid " + (session.isCurrent ? "var(--color-border-accent)" : "var(--color-border)"),
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", flexShrink: 0,
      }}>
        <DeviceIcon type={session.deviceType} color={deviceColor} />
        {/* Small browser badge */}
        <div style={{
          position: "absolute", bottom: -3, right: -3,
          width: 20, height: 20, borderRadius: 4,
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <BrowserIcon name={session.browser} size={14} />
        </div>
      </div>

      {/* Middle — all session details */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {/* Top row: user + "This device" badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UserAvatar src={session.userImage ?? null} name={session.userName} size={22} />
            <span style={{ fontSize: "0.84rem", fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--color-text-primary)" }}>
              {session.userName}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>
              {session.userEmail}
            </span>
          </div>
          {session.isCurrent && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.06em",
              padding: "2px 7px", borderRadius: 3,
              background: "var(--color-accent-dim)", border: "1px solid var(--color-border-accent)",
              color: "var(--color-accent)", textTransform: "uppercase",
            }}>
              <Zap size={9} fill="currentColor" /> Current
            </span>
          )}
        </div>

        {/* Device label line */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            {session.deviceLabel !== "Unknown device" ? session.deviceLabel : (
              <span style={{ color: "#475569" }}>Unknown device</span>
            )}
          </span>

          {/* Location pill — flag emoji + "City, COUNTRY" from CF geo, or IP fallback */}
          {(session.geoLocation || session.ipAddress) && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: "0.72rem", color: "#64748b",
            }}>
              {session.geoLocation
                ? <>{session.geoFlag && <span style={{ lineHeight: 1 }}>{session.geoFlag}</span>} {session.geoLocation}</>
                : <><span style={{ opacity: 0.6 }}>🌐</span> {session.ipAddress}</>}
            </span>
          )}
        </div>

        {/* Bottom row: IP + timestamps */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {session.ipAddress && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
              {session.ipAddress}
            </span>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
            Active {relativeTime(new Date(session.updatedAt).toISOString())}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", opacity: 0.6 }}>
            Expires {relativeTime(new Date(session.expiresAt).toISOString())}
          </span>
        </div>
      </div>

      {/* Right — revoke button */}
      <button
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 4, flexShrink: 0,
          background: session.isCurrent ? "transparent" : "var(--color-red-dim)",
          border: session.isCurrent ? "1px solid var(--color-border)" : "1px solid rgba(248,113,113,0.2)",
          color: session.isCurrent ? "var(--color-text-tertiary)" : "var(--color-red)",
          cursor: revoking ? "not-allowed" : "pointer",
          transition: "all 0.15s",
          opacity: revoking ? 0.5 : 1,
        }}
        disabled={revoking}
        onClick={() => onRevoke(session.token)}
        title={session.isCurrent ? "You cannot revoke your own current session" : "Revoke this session"}
        onMouseEnter={e => {
          if (!session.isCurrent && !revoking) {
            (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.2)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.35)";
          }
        }}
        onMouseLeave={e => {
          if (!session.isCurrent) {
            (e.currentTarget as HTMLElement).style.background = "var(--color-red-dim)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.2)";
          }
        }}
      >
        {revoking ? (
          <RefreshCw size={12} style={{ animation: "spin 0.8s linear infinite" }} />
        ) : (
          <X size={13} />
        )}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SessionsPage() {
  const [sessions, setSessions] = useState<EnrichedSession[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
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

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sessions", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: EnrichedSession[]; currentSessionToken: string };
      setSessions(data.sessions ?? []);
      setCurrentToken(data.currentSessionToken ?? null);
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (token: string) => {
    const session = sessions.find(s => s.token === token);
    if (session?.isCurrent) {
      addToast("error", "Cannot revoke your own current session");
      return;
    }
    setRevoking(token);
    try {
      const res = await fetch("/api/auth/admin/revoke-user-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionToken: token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        addToast("error", body.message ?? "Failed to revoke session");
        return;
      }
      addToast("success", "Session revoked");
      setSessions(prev => prev.filter(s => s.token !== token));
    } catch {
      addToast("error", "Network error");
    } finally {
      setRevoking(null);
    }
  };

  const revokeAllOthers = () => {
    setConfirmState({
      title: "Revoke all other sessions?",
      body: "All other users and all other browser sessions will be immediately signed out. This cannot be undone.",
      confirmLabel: "Revoke all",
      onConfirm: () => {
        setConfirmState(null);
        void doRevokeAllOthers();
      },
    });
  };

  const doRevokeAllOthers = async () => {
    setRevokingAll(true);
    try {
      const res = await fetch("/api/admin/sessions/revoke-all-others", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ exceptToken: currentToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        addToast("error", body.error ?? "Revoke all failed");
        return;
      }
      const data = await res.json() as { revokedCount: number };
      addToast("success", `Revoked ${data.revokedCount} session${data.revokedCount !== 1 ? "s" : ""}`);
      await load();
    } catch {
      addToast("error", "Network error");
    } finally {
      setRevokingAll(false);
    }
  };

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

  return (
    <div className="animate-in" style={{ maxWidth: 780 }}>
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
      {/* ── Global animation keyframe ── */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Page header ────────────────────────────────────────── */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Platform</p>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">
            {loading
              ? "Loading…"
              : `${sessions.length} active session${sessions.length !== 1 ? "s" : ""} across ${Object.keys(userGroups).length + (currentSession ? 1 : 0)} user${Object.keys(userGroups).length + (currentSession ? 1 : 0) !== 1 ? "s" : ""}`
            }
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {!loading && otherCount > 0 && (
            <button
              className="btn btn-danger"
              disabled={revokingAll}
              onClick={revokeAllOthers}
            >
              {revokingAll ? <RefreshCw size={12} style={{ animation: "spin 0.8s linear infinite" }} /> : <Shield size={13} />}
              Revoke all other sessions
            </button>
          )}

          {/* Refresh */}
          <button
            className="btn btn-ghost"
            style={{ padding: "6px 10px" }}
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={13} style={loading ? { animation: "spin 0.8s linear infinite" } : {}} />
          </button>
        </div>
      </div>

      {/* ── Loading skeleton ──────────────────────────────────── */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="card loading" style={{ height: 70 }} />
          ))}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────── */}
      {!loading && sessions.length === 0 && (
        <div className="empty-state" style={{ border: "1px dashed var(--color-border)", borderRadius: 6 }}>
          <Laptop size={24} style={{ margin: "0 auto 12px", opacity: 0.3, display: "block" }} />
          No active sessions
        </div>
      )}

      {/* ── Current session section ───────────────────────────── */}
      {!loading && currentSession && (
        <div style={{ marginBottom: 20 }}>
          <p className="section-label" style={{ marginBottom: 8 }}>Your current session</p>
          <SessionCard
            session={currentSession}
            revoking={revoking === currentSession.token}
            onRevoke={revoke}
          />
        </div>
      )}

      {/* ── Other sessions ─────────────────────────────────────── */}
      {!loading && otherCount > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <p className="section-label">Other sessions ({otherCount})</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.values(userGroups).map(({ user: groupUser, sessions: groupSessions }) => (
              <div key={groupUser.userId}>
                {/* Per-user sub-header when multiple users */}
                {Object.keys(userGroups).length > 1 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    marginBottom: 5, marginTop: 6,
                  }}>
                    <UserAvatar src={groupUser.userImage ?? null} name={groupUser.userName} size={18} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-secondary)" }}>
                      {groupUser.userName} · {groupSessions.length} session{groupSessions.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {groupSessions.map(s => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      revoking={revoking === s.token}
                      onRevoke={revoke}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Toast container ───────────────────────────────────── */}
      <ToastGroup toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

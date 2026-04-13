import { formatDate } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { Info, Monitor, RefreshCw, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/sessions")({
  component: SessionsPage,
});

type Session = {
  id: string;
  userId: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  userName?: string;
  userEmail?: string;
};

function isMobile(ua: string | null) {
  if (!ua) return false;
  return /mobile|android|iphone|ipad/i.test(ua);
}

function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // Fetch all users first
      const usersRes = await fetch(`/api/auth/admin/list-users?limit=100`, { credentials: "include" });
      const usersData = await usersRes.json() as { users: { id: string; name: string; email: string }[] };
      const users = usersData.users ?? [];

      // POST list-user-sessions for each user (userId in body, not query)
      const sessionResults = await Promise.all(
        users.map(async (u) => {
          try {
            const r = await fetch(`/api/auth/admin/list-user-sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ userId: u.id }),
            });
            if (!r.ok) return [];
            const data = await r.json() as { sessions: Session[] };
            return (data.sessions ?? []).map(s => ({
              ...s,
              userName: u.name,
              userEmail: u.email,
            }));
          } catch {
            return [];
          }
        })
      );

      const allSessions = sessionResults.flat().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setSessions(allSessions);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // revoke-user-session takes only sessionToken in body (no userId needed)
  const revoke = async (sessionToken: string) => {
    setRevoking(sessionToken);
    try {
      await fetch(`/api/auth/admin/revoke-user-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionToken }),
      });
      load();
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="animate-in">
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>Sessions</h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>{sessions.length} active sessions</p>
        </div>
        <button className="btn btn-ghost" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
        borderRadius: 8, marginBottom: 16, fontSize: "0.8rem", color: "#818cf8",
      }}>
        <Info size={13} />
        Sessions are fetched per-user via <code style={{ fontFamily: "monospace" }}>POST /admin/list-user-sessions</code>.
        Revoke individual sessions below.
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ padding: 32, textAlign: "center", color: "#475569", fontSize: "0.85rem" }}>
            Loading sessions…
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Device</th>
                <th>IP</th>
                <th>Created</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const DeviceIcon = isMobile(s.userAgent) ? Smartphone : Monitor;
                const expired = new Date(s.expiresAt) < new Date();
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar">{s.userName?.[0]?.toUpperCase() ?? "?"}</div>
                        <div>
                          <p style={{ fontWeight: 500, color: "#e2e8f0", fontSize: "0.875rem" }}>{s.userName}</p>
                          <p style={{ color: "#64748b", fontSize: "0.75rem" }}>{s.userEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8" }}>
                        <DeviceIcon size={14} />
                        <span style={{ fontSize: "0.75rem" }}>
                          {s.userAgent ? s.userAgent.slice(0, 32) + "…" : "Unknown"}
                        </span>
                      </div>
                    </td>
                    <td style={{ color: "#64748b", fontSize: "0.8rem", fontFamily: "monospace" }}>
                      {s.ipAddress ?? "—"}
                    </td>
                    <td style={{ color: "#64748b", fontSize: "0.78rem" }}>{formatDate(s.createdAt)}</td>
                    <td>
                      <span className={`badge ${expired ? "badge-red" : "badge-green"}`}>
                        {expired ? "expired" : formatDate(s.expiresAt).split(",")[0]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px" }}
                        disabled={revoking === s.token}
                        onClick={() => revoke(s.token)}
                        title="Revoke session"
                      >
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "#475569", padding: 32 }}>
                    No active sessions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

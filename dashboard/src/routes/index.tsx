import { relativeTime } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Globe, Shield, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

type Stats = {
  totalUsers: number;
  activeSessions: number;
  bannedUsers: number;
  recentUsers: { id: string; name: string; email: string; createdAt: string; role: string }[];
};

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <p style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500 }}>{label}</p>
        <p style={{ fontSize: "1.6rem", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.2 }}>{value}</p>
      </div>
    </div>
  );
}

function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [usersRes, sessionsRes] = await Promise.all([
          fetch(`/api/auth/admin/list-users?limit=5`, { credentials: "include" }),
          // /api/auth/list-sessions = current-user sessions (admin list-all doesn't exist)
          fetch(`/api/auth/list-sessions`, { credentials: "include" }),
        ]);
        const usersData = await usersRes.json() as { users: Stats["recentUsers"]; total: number };
        const sessData = await sessionsRes.json() as { session: unknown[] } | unknown[];
        const sessions = Array.isArray(sessData) ? sessData : (sessData as any).sessions ?? [];
        const banned = usersData.users?.filter((u: any) => u.banned).length ?? 0;
        setStats({
          totalUsers: usersData.total ?? usersData.users?.length ?? 0,
          activeSessions: sessions.length,
          bannedUsers: banned,
          recentUsers: usersData.users ?? [],
        });
      } catch {
        setStats({ totalUsers: 0, activeSessions: 0, bannedUsers: 0, recentUsers: [] });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>Overview</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>Platform health at a glance</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card loading" style={{ padding: 20, height: 80 }} />
          ))
        ) : (
          <>
            <StatCard label="Total Users" value={stats!.totalUsers} icon={Users} color="#818cf8" />
            <StatCard label="Active Sessions" value={stats!.activeSessions} icon={Activity} color="#34d399" />
            <StatCard label="Banned Users" value={stats!.bannedUsers} icon={Shield} color="#f87171" />
            <StatCard label="Providers" value="2 active" icon={Globe} color="#facc15" />
          </>
        )}
      </div>

      {/* Recent signups */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Recent Signups</h2>
          <TrendingUp size={14} color="#64748b" />
        </div>
        {loading ? (
          <div className="loading" style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: "0.85rem" }}>Loading…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats!.recentUsers.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                      <span style={{ fontWeight: 500, color: "#e2e8f0" }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "#64748b" }}>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "badge-blue" : "badge-gray"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ color: "#64748b", fontSize: "0.8rem" }}>{relativeTime(u.createdAt)}</td>
                </tr>
              ))}
              {stats!.recentUsers.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "#475569", padding: 24 }}>No users yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

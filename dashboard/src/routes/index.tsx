import { UserAvatar } from "@/components/UserAvatar";
import { relativeTime } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, Globe, Shield, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

type Stats = {
  totalUsers: number;
  activeSessions: number;
  bannedUsers: number;
  recentUsers: { id: string; name: string; email: string; createdAt: string; role: string; image?: string | null }[];
};

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", alignItems: "flex-start", gap: 14, cursor: "default" }}>
      <div style={{
        width: 36, height: 36, borderRadius: 5, flexShrink: 0,
        background: `${color}18`,
        border: `1px solid ${color}28`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={16} color={color} strokeWidth={1.75} />
      </div>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
      </div>
    </div>
  );
}

function OverviewPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [usersRes, sessionsRes] = await Promise.all([
          fetch(`/api/auth/admin/list-users?limit=5`, { credentials: "include" }),
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
      {/* Page header */}
      <div style={{ marginBottom: 22, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Platform</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">System health at a glance</p>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 24 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card loading" style={{ padding: "18px 20px", height: 74 }} />
          ))
        ) : (
          <>
            <StatCard label="Total Users" value={stats!.totalUsers} icon={Users} color="var(--color-accent)" />
            <StatCard label="Active Sessions" value={stats!.activeSessions} icon={Activity} color="var(--color-green)" />
            <StatCard label="Banned Users" value={stats!.bannedUsers} icon={Shield} color="var(--color-red)" />
            <StatCard label="Providers" value="2 active" icon={Globe} color="var(--color-amber)" />
          </>
        )}
      </div>

      {/* Recent signups */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "13px 18px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <h2 style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.82rem", fontWeight: 600,
              color: "var(--color-text-primary)", letterSpacing: "-0.01em",
            }}>Recent Signups</h2>
          </div>
          <TrendingUp size={13} color="var(--color-text-tertiary)" />
        </div>
        {loading ? (
          <div className="loading" style={{ padding: 24, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
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
                <tr
                  key={u.id}
                  onClick={() => navigate({ to: "/users/$userId", params: { userId: u.id } })}
                  style={{ cursor: "pointer" }}
                  title="View user details"
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <UserAvatar src={u.image ?? null} name={u.name} size={28} />
                      <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-text-primary)", fontSize: "0.84rem" }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "badge-blue" : "badge-gray"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-text-tertiary)" }}>{relativeTime(u.createdAt)}</td>
                </tr>
              ))}
              {stats!.recentUsers.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", padding: 24, fontSize: "0.78rem" }}>No users yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

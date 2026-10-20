import { UserAvatar } from "@/components/UserAvatar";
import { useOverviewStats } from "@/hooks/use-overview";
import { relativeTime, sentenceCase } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, Globe, Shield, Users } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { LandingPage } from "@/components/LandingPage";

export const Route = createFileRoute("/")({
  component: IndexRouteComponent,
});

function IndexRouteComponent() {
  const { data: session } = useSession();

  if (!session) {
    return <LandingPage />;
  }

  return <OverviewPage />;
}

function StatCard({ label, value, icon: Icon, tone = "" }: {
  label: string; value: number | string; icon: React.ElementType; tone?: string;
}) {
  return (
    <div className="card stat-card">
      <span className={`icon-tile ${tone}`} aria-hidden="true"><Icon strokeWidth={1.75} /></span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
      </div>
    </div>
  );
}

function OverviewPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading, isError } = useOverviewStats();
  const recentUsers = stats?.recentUsers ?? [];

  return (
    <div>
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Platform</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">System health at a glance</p>
        </div>
      </header>

      <div className="stat-grid">
        {isLoading || isError || !stats ? (
          [0, 1, 2, 3].map(i => (
            <div key={i} className="card stat-card" aria-hidden="true">
              <span className="skeleton" style={{ width: 36, height: 36, borderRadius: "var(--radius-md)" }} />
              <div className="stack-sm" style={{ flex: 1 }}>
                <span className="skeleton" style={{ width: "60%", height: 13 }} />
                <span className="skeleton" style={{ width: "40%", height: 24 }} />
              </div>
            </div>
          ))
        ) : (
          <>
            <StatCard label="Total users" value={stats.totalUsers} icon={Users} />
            <StatCard label="Active sessions" value={stats.activeSessions} icon={Activity} tone="tone-success" />
            <StatCard label="Banned users" value={stats.bannedUsers} icon={Shield} tone="tone-danger" />
            <StatCard label="Providers" value="2 active" icon={Globe} />
          </>
        )}
      </div>
      {isError && (
        <p className="alert alert-danger" role="alert" style={{ marginTop: -8, marginBottom: 24 }}>
          Couldn't load platform stats. Refresh to try again.
        </p>
      )}

      <section className="card card-flush" aria-labelledby="recent-signups">
        <div className="panel-header">
          <h2 className="panel-title" id="recent-signups">Recent signups</h2>
        </div>
        {isLoading ? (
          <div className="skeleton-rows" aria-label="Loading recent signups" role="status">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : recentUsers.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Users /></span>
            <p className="empty-state-title">No users yet</p>
            <p className="empty-state-body">New sign-ups across your apps show up here.</p>
          </div>
        ) : (
          <table className="data-table is-stackable">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map(u => {
                const open = () => navigate({ to: "/users/$userId", params: { userId: u.id } });
                return (
                  <tr
                    key={u.id}
                    className="is-clickable"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={e => { if (e.key === "Enter") open(); }}
                    title="View user details"
                  >
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <UserAvatar src={u.image ?? null} name={u.name} size={28} />
                        <span className="text-strong truncate">{u.name}</span>
                      </div>
                    </td>
                    <td><span className="text-mono">{u.email}</span></td>
                    <td className="cell-inline">
                      <span className={`badge ${u.role === "admin" ? "badge-info" : "badge-neutral"}`}>
                        {sentenceCase(u.role)}
                      </span>
                    </td>
                    <td className="cell-meta cell-inline"><span className="cell-prefix">Joined </span>{relativeTime(u.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

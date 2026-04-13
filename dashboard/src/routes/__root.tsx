import { signOut, useSession } from "@/lib/auth-client";
import { createRootRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Globe,
  Key,
  LogOut,
  Settings,
  Shield,
  Users,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Overview", icon: BarChart3, exact: true },
  { to: "/users", label: "Users", icon: Users, exact: false },
  { to: "/sessions", label: "Sessions", icon: Activity, exact: false },
  { to: "/oauth-apps", label: "OAuth Apps", icon: Globe, exact: false },
  { to: "/api-keys", label: "API Keys", icon: Key, exact: false },
];

function Sidebar() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      background: "var(--color-surface-800)",
      borderRight: "1px solid var(--color-border)",
      display: "flex",
      flexDirection: "column",
      padding: "20px 12px",
      gap: 4,
    }}>
      {/* Logo */}
      <div style={{ padding: "4px 12px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Shield size={14} color="#fff" strokeWidth={2.5} />
        </div>
        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#e2e8f0", letterSpacing: "-0.02em" }}>
          ralph<span style={{ color: "#818cf8" }}>auth</span>
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <p style={{ fontSize: "0.65rem", color: "#475569", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 12px 8px" }}>
          Platform
        </p>
        {NAV.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? path === to : path.startsWith(to);
          return (
            <Link key={to} to={to as any} className={`nav-item${active ? " active" : ""}`}>
              <Icon size={15} strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}

        <div style={{ height: 1, background: "var(--color-border)", margin: "12px 4px" }} />
        <p style={{ fontSize: "0.65rem", color: "#475569", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 12px 8px" }}>
          Config
        </p>
        <Link to="/settings" className={`nav-item${path.startsWith("/settings") ? " active" : ""}`}>
          <Settings size={15} />
          Settings
        </Link>
      </nav>

      {/* User */}
      {session && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
            <div className="avatar" style={{ width: 28, height: 28, fontSize: "0.7rem" }}>
              {session.user.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.user.name}
              </p>
              <p style={{ fontSize: "0.7rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.user.email}
              </p>
            </div>
            <button className="btn btn-ghost" style={{ padding: "4px", borderRadius: 6 }} onClick={handleSignOut} title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function AccessRestricted({ name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-surface-900)", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "var(--color-surface-800)",
        borderRadius: 16, border: "1px solid var(--color-border)",
        padding: 36, textAlign: "center",
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: "0 auto 20px",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Shield size={22} color="#f87171" strokeWidth={2} />
        </div>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>
          Admin access required
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#64748b", lineHeight: 1.65, marginBottom: 24 }}>
          This dashboard is restricted to administrators. You're signed in as{" "}
          <strong style={{ color: "#94a3b8" }}>{email}</strong>, which doesn't have admin privileges.
        </p>
        <button
          className="btn btn-danger"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={onSignOut}
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

function isAdmin(role: string | undefined | null) {
  // roles can be comma-separated for multi-role support
  return role?.split(",").map(r => r.trim()).includes("admin") ?? false;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  if (isPending) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="loading" style={{ color: "#818cf8", fontSize: "0.9rem" }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    setTimeout(() => navigate({ to: "/sign-in" }), 0);
    return null;
  }

  // Signed in but not an admin — show access restricted page
  if (!isAdmin(session.user.role)) {
    return (
      <AccessRestricted
        name={session.user.name ?? ""}
        email={session.user.email}
        onSignOut={handleSignOut}
      />
    );
  }

  return <>{children}</>;
}

function RootComponent() {
  const location = useLocation();
  const isPublic = location.pathname === "/sign-in" || location.pathname === "/auth-error";

  if (isPublic) {
    return <Outlet />;
  }

  return (
    <AuthGuard>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: "auto", padding: 28 }}>
          <Outlet />
        </main>
      </div>
    </AuthGuard>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});

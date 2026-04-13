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

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="loading" style={{ color: "#818cf8", fontSize: "0.9rem" }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    // Use setTimeout to avoid calling navigate during render
    setTimeout(() => navigate({ to: "/sign-in" }), 0);
    return null;
  }

  return <>{children}</>;
}

function RootComponent() {
  const location = useLocation();
  const isSignIn = location.pathname === "/sign-in";

  if (isSignIn) {
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

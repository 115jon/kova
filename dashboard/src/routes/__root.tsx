import { organization, signOut, useActiveOrganization, useListOrganizations, useSession } from "@/lib/auth-client";
import { createRootRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  Globe,
  Key,
  LogOut,
  Settings,
  Shield,
  UserCircle,
  Users,
} from "lucide-react";
import React from "react";

const NAV = [
  { to: "/", label: "Overview", icon: BarChart3, exact: true },
  { to: "/users", label: "Users", icon: Users, exact: false },
  { to: "/sessions", label: "Sessions", icon: Activity, exact: false },
  { to: "/audit-logs", label: "Audit Logs", icon: ClipboardList, exact: false },
  { to: "/organizations", label: "Organizations", icon: Building2, exact: false },
  { to: "/oauth-apps", label: "OAuth Apps", icon: Globe, exact: false },
  { to: "/api-keys", label: "API Keys", icon: Key, exact: false },
];

// ── Org Switcher ──────────────────────────────────────────────────────────────

function OrgAvatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 7, flexShrink: 0,
      background: "linear-gradient(135deg, #6366f1, #7c3aed)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.42, color: "#fff",
    }}>
      {name[0]?.toUpperCase() ?? "O"}
    </div>
  );
}

function OrgSwitcher() {
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSetActive = async (orgId: string | null) => {
    if (orgId === (activeOrg?.id ?? null) || switching) return;
    setSwitching(orgId ?? "__personal__");
    try {
      await organization.setActive({ organizationId: orgId });
    } finally {
      setSwitching(null);
      setOpen(false);
    }
  };

  if (!orgs || orgs.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 12 }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: open ? "var(--color-surface-700)" : "transparent",
          border: "1px solid", borderColor: open ? "var(--color-border)" : "transparent",
          borderRadius: 8, padding: "7px 10px", cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        {activeOrg
          ? <OrgAvatar name={activeOrg.name} />
          : <div style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: "var(--color-surface-600)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Building2 size={13} color="#475569" /></div>
        }
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <p style={{
            fontSize: "0.78rem", fontWeight: 600, color: "#e2e8f0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {activeOrg?.name ?? "Select org"}
          </p>
          {activeOrg && (
            <p style={{ fontSize: "0.65rem", color: "#475569", fontFamily: "monospace" }}>
              {activeOrg.slug}
            </p>
          )}
        </div>
        <ChevronDown size={13} color="#475569"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>

      {open && (
        <div role="listbox" style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--color-surface-800)", border: "1px solid var(--color-border)",
          borderRadius: 10, padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        }}>
          <p style={{
            fontSize: "0.6rem", color: "#475569", fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "6px 10px 4px",
          }}>Switch organization</p>

          {/* Personal / no-org escape hatch */}
          {(() => {
            const isPersonal = activeOrg === null;
            const isSwitching = switching === "__personal__";
            return (
              <button
                role="option"
                aria-selected={isPersonal}
                disabled={isSwitching}
                onClick={() => handleSetActive(null)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 7,
                  cursor: isPersonal ? "default" : "pointer",
                  background: isPersonal ? "rgba(99,102,241,0.12)" : "transparent",
                  border: "none", transition: "background 0.12s", marginBottom: 2,
                  opacity: isSwitching ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!isPersonal) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
                onMouseLeave={e => { if (!isPersonal) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: "var(--color-surface-600)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <UserCircle size={14} color="#475569" />
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{
                    fontSize: "0.8rem", fontWeight: 600,
                    color: isPersonal ? "#818cf8" : "#94a3b8",
                  }}>
                    {isSwitching ? "Switching…" : "No organization"}
                  </p>
                </div>
                {isPersonal && <Check size={12} color="#818cf8" />}
              </button>
            );
          })()}

          {/* Divider */}
          <div style={{ height: 1, background: "var(--color-border)", margin: "4px 0" }} />

          {orgs.map(org => {
            const isActive = org.id === activeOrg?.id;
            const isSwitching = switching === org.id;
            return (
              <button
                key={org.id}
                role="option"
                aria-selected={isActive}
                disabled={isSwitching}
                onClick={() => handleSetActive(org.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 7,
                  cursor: isActive ? "default" : "pointer",
                  background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                  border: "none", transition: "background 0.12s", marginBottom: 2,
                  opacity: isSwitching ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <OrgAvatar name={org.name} />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{
                    fontSize: "0.8rem", fontWeight: 600,
                    color: isActive ? "#818cf8" : "#e2e8f0",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {isSwitching ? "Switching…" : org.name}
                  </p>
                </div>
                {isActive && <Check size={12} color="#818cf8" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

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

      {/* Org Switcher */}
      <OrgSwitcher />

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
  const isPublic = ["/sign-in", "/auth-error"].some(p => location.pathname === p)
    || location.pathname.startsWith("/accept-invitation");

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

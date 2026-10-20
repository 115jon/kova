import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { UserAvatar } from "@/components/UserAvatar";
import { OrgAvatar } from "@/components/OrgAvatar";
import { KovaLogo } from "@/components/KovaLogo";
import { multiSession, organization, signOut, useActiveOrganization, useListOrganizations, useSession } from "@/lib/auth-client";
import { queryClient } from "@/lib/query-client";
import { useSearchShortcut } from "@/lib/shortcut";
import { setThemePreference, THEME_BOOT_SCRIPT, THEME_OPTIONS, useTheme, type ThemePreference } from "@/lib/theme";
import { createRootRoute, HeadContent, Link, Outlet, Scripts, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Copy,
  Globe,
  Key,
  Layers,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sun,
  UserCircle,
  Users,
  Webhook,
  X,
} from "lucide-react";
import React from "react";
import appCss from "../styles.css?url";

// ── Error Boundary ────────────────────────────────────────────────────────────

interface EBState { hasError: boolean; message: string }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: unknown): EBState {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="center-panel">
        <div className="card notice-card" role="alert">
          <span className="icon-tile icon-tile-lg tone-danger" aria-hidden="true"><AlertTriangle /></span>
          <h2>Something went wrong</h2>
          <p>This view hit an unexpected error. Reloading it usually helps.</p>
          {import.meta.env.DEV && this.state.message && (
            <pre className="code-block" style={{ marginTop: 16, maxHeight: 160, overflow: "auto", textAlign: "start" }}>
              {this.state.message}
            </pre>
          )}
          <div className="notice-actions">
            <button type="button" className="btn btn-secondary" onClick={() => this.setState({ hasError: false, message: "" })}>
              <RefreshCw /> Reload view
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => { await signOut(); window.location.href = "/sign-in"; }}
            >
              <LogOut /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const satisfies Record<ThemePreference, React.ElementType>;
const THEME_ACTIONS: Record<ThemePreference, string> = {
  light: "Switch to light theme",
  dark: "Switch to dark theme",
  system: "Follow system theme",
};

// ── Command Palette (Cmd+K) ───────────────────────────────────────────────────
// Opens and closes without animation: it is keyboard-driven and used constantly.
// Below 640px it becomes a sheet pinned to the top of the visual viewport.

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
}

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: <BarChart3 /> },
  { to: "/users", label: "Users", icon: <Users /> },
  { to: "/sessions", label: "Sessions", icon: <Activity /> },
  { to: "/audit-logs", label: "Audit logs", icon: <ClipboardList /> },
  { to: "/organizations", label: "Organizations", icon: <Building2 /> },
  { to: "/oauth-apps", label: "OAuth apps", icon: <Globe /> },
  { to: "/api-keys", label: "API keys", icon: <Key /> },
  { to: "/webhooks", label: "Webhooks", icon: <Webhook /> },
  { to: "/applications", label: "Applications", icon: <Layers /> },
  { to: "/settings", label: "Settings", icon: <Settings /> },
];

function CommandPalette({ onClose, currentUserId }: { onClose: () => void; currentUserId?: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [userResults, setUserResults] = React.useState<{ id: string; name: string; email: string; image: string | null }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { preference } = useTheme();
  const overlayRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { trigger?.focus?.(); };
  }, []);

  // Phones only: the page behind stays put, and the sheet follows the visual
  // viewport, because the on-screen keyboard shrinks that but not the layout
  // viewport, which would leave the list behind the keys. It re-evaluates if
  // the screen crosses the breakpoint while open (rotation, a resized window).
  React.useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const phone = window.matchMedia("(max-width: 640px)");
    const viewport = window.visualViewport;
    let release = () => {};

    const apply = () => {
      release();
      release = () => {};
      if (!phone.matches) {
        overlay.style.removeProperty("--vv-top");
        overlay.style.removeProperty("--vv-height");
        return;
      }
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const sync = () => {
        if (!viewport) return;
        overlay.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
        overlay.style.setProperty("--vv-height", `${viewport.height}px`);
      };
      sync();
      viewport?.addEventListener("resize", sync);
      viewport?.addEventListener("scroll", sync);
      release = () => {
        viewport?.removeEventListener("resize", sync);
        viewport?.removeEventListener("scroll", sync);
        document.body.style.overflow = overflow;
      };
    };

    apply();
    phone.addEventListener("change", apply);
    return () => {
      phone.removeEventListener("change", apply);
      release();
    };
  }, []);

  React.useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) { setUserResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: "6", searchField: "email", searchValue: query, searchOperator: "contains" });
        const res = await fetch(`/api/auth/admin/list-users?${params}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { users: { id: string; name: string; email: string; image: string | null }[] };
          setUserResults(data.users ?? []);
        }
      } finally { setSearching(false); }
    }, 250);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query]);

  const items = React.useMemo<PaletteItem[]>(() => {
    const q = query.toLowerCase();
    const navItems: PaletteItem[] = NAV_ITEMS
      .filter(n => !q || n.label.toLowerCase().includes(q))
      .map(n => ({
        id: `nav:${n.to}`,
        label: `Go to ${n.label}`,
        icon: n.icon,
        action: () => { navigate({ to: n.to as any }); onClose(); },
      }));

    const userItems: PaletteItem[] = userResults.map(u => ({
      id: `user:${u.id}`,
      label: u.name,
      sublabel: u.email,
      icon: <UserAvatar src={u.image} name={u.name} size={20} />,
      action: () => { window.location.href = `/users/${u.id}`; onClose(); },
    }));

    // Only the choices that would change something; the topbar menu shows the current one.
    const extras: PaletteItem[] = THEME_OPTIONS
      .filter(({ value, label }) => value !== preference && (!q || `theme appearance ${label}`.toLowerCase().includes(q)))
      .map(({ value }) => {
        const Icon = THEME_ICONS[value];
        return {
          id: `theme:${value}`,
          label: THEME_ACTIONS[value],
          icon: <Icon />,
          action: () => { setThemePreference(value); onClose(); },
        };
      });
    if (currentUserId && (!q || "copy id".includes(q))) {
      extras.push({
        id: "copy-id",
        label: copied ? "Copied" : "Copy my user ID",
        sublabel: currentUserId,
        icon: <Copy />,
        action: () => {
          navigator.clipboard.writeText(currentUserId);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
      });
    }

    return [...navItems, ...userItems, ...extras];
  }, [query, userResults, currentUserId, copied, navigate, onClose, preference]);

  React.useEffect(() => { setActiveIdx(0); }, [items.length]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); items[activeIdx]?.action(); }
    if (e.key === "Tab") e.preventDefault();
  };

  const activeId = items[activeIdx] ? `palette-${items[activeIdx]!.id}` : undefined;

  return (
    <div ref={overlayRef} className="palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Go to a page or search users…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
          />
          {searching && <RefreshCw className="spin" aria-label="Searching" />}
          <kbd>esc</kbd>
          <button type="button" className="palette-close btn btn-subtle btn-icon btn-sm" aria-label="Close search" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="palette-list" id="palette-list" role="listbox">
          {items.length === 0 && (
            <p className="palette-empty">{query ? `Nothing matches “${query}”.` : "Type to search."}</p>
          )}
          {items.map((item, idx) => (
            <button
              key={item.id}
              id={`palette-${item.id}`}
              type="button"
              role="option"
              aria-selected={activeIdx === idx}
              tabIndex={-1}
              className="palette-item"
              onClick={item.action}
              onMouseMove={() => { if (activeIdx !== idx) setActiveIdx(idx); }}
            >
              <span className="palette-item-icon">{item.icon}</span>
              <span className="item-text">
                <span className="palette-item-label">{item.label}</span>
                {item.sublabel && <span className="palette-item-sub truncate">{item.sublabel}</span>}
              </span>
              {activeIdx === idx && <kbd aria-hidden="true">↵</kbd>}
            </button>
          ))}
        </div>

        <div className="palette-footer" aria-hidden="true">
          {[["↑↓", "navigate"], ["↵", "select"], ["esc", "close"]].map(([key, hint]) => (
            <span key={key}><kbd>{key}</kbd>{hint}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV = [
  { to: "/", label: "Overview", icon: BarChart3, exact: true },
  { to: "/users", label: "Users", icon: Users, exact: false },
  { to: "/sessions", label: "Sessions", icon: Activity, exact: false },
  { to: "/audit-logs", label: "Audit logs", icon: ClipboardList, exact: false },
  { to: "/organizations", label: "Organizations", icon: Building2, exact: false },
  { to: "/oauth-apps", label: "OAuth apps", icon: Globe, exact: false },
  { to: "/api-keys", label: "API keys", icon: Key, exact: false },
  { to: "/webhooks", label: "Webhooks", icon: Webhook, exact: false },
  { to: "/applications", label: "Applications", icon: Layers, exact: false },
];

function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

// ── Org Switcher ──────────────────────────────────────────────────────────────

function OrgSwitcher() {
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

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

  const isPersonal = activeOrg === null;

  return (
    <div ref={ref} className="popover-anchor org-switcher">
      <button
        type="button"
        className="switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {activeOrg
          ? <OrgAvatar name={activeOrg.name} logo={(activeOrg as any).logo ?? null} size={32} />
          : <span className="icon-tile icon-tile-sm tone-neutral"><Building2 /></span>}
        <span className="item-text">
          <span className="text-strong truncate">{activeOrg?.name ?? "No organization"}</span>
          {activeOrg && <span className="text-sm text-tertiary truncate">{activeOrg.slug}</span>}
        </span>
        <ChevronsUpDown aria-hidden="true" />
      </button>

      {open && (
        <div className="menu menu-below" role="listbox" aria-label="Switch organization">
          <p className="menu-label text-overline">Switch organization</p>
          <button
            type="button"
            role="option"
            aria-selected={isPersonal}
            disabled={switching === "__personal__"}
            className="menu-item"
            onClick={() => handleSetActive(null)}
          >
            <UserCircle />
            <span className="item-text truncate">{switching === "__personal__" ? "Switching…" : "No organization"}</span>
            {isPersonal && <Check />}
          </button>
          <div className="menu-separator" />
          {orgs.map(org => {
            const isActive = org.id === activeOrg?.id;
            return (
              <button
                key={org.id}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={switching === org.id}
                className="menu-item"
                onClick={() => handleSetActive(org.id)}
              >
                <OrgAvatar name={org.name} logo={(org as any).logo ?? null} size={22} />
                <span className="item-text truncate">{switching === org.id ? "Switching…" : org.name}</span>
                {isActive && <Check />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Session Switcher (Multi-Session) ──────────────────────────────────────────

type DeviceSession = {
  session: { token: string; userAgent?: string | null };
  user: { id: string; name?: string | null; email: string; image?: string | null };
};

function SessionSwitcher() {
  const { data: currentSession } = useSession();
  const [sessions, setSessions] = React.useState<DeviceSession[]>([]);
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  React.useEffect(() => {
    if (!open) return;
    multiSession.listDeviceSessions().then((res: Awaited<ReturnType<typeof multiSession.listDeviceSessions>>) => {
      setSessions((res.data as DeviceSession[] | null) ?? []);
    }).catch(() => setSessions([]));
  }, [open]);

  const handleSwitch = async (token: string) => {
    if (switching) return;
    setSwitching(token);
    try {
      await multiSession.setActive({ sessionToken: token });
      window.location.reload();
    } catch {
      setSwitching(null);
    }
  };

  const others = sessions.filter(s => s.user.id !== currentSession?.user.id);

  return (
    <div ref={ref} className="popover-anchor">
      <button
        type="button"
        className="switcher-trigger switcher-trigger-sm text-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <UserCircle aria-hidden="true" />
        <span className="item-text">Accounts{others.length > 0 ? ` (${others.length + 1})` : ""}</span>
        <ChevronsUpDown aria-hidden="true" />
      </button>

      {open && (
        <div className="menu menu-above" role="menu" aria-label="Switch account">
          <p className="menu-label text-overline">Switch account</p>

          {currentSession && (
            <div className="menu-item is-current" role="menuitem" aria-current="true">
              <UserAvatar src={(currentSession.user as any).image as string | null} name={currentSession.user.name} size={24} />
              <span className="item-text">
                <span className="text-strong truncate">{currentSession.user.name ?? currentSession.user.email}</span>
                <span className="text-sm text-tertiary truncate">{currentSession.user.email}</span>
              </span>
              <Check />
            </div>
          )}

          {others.map(s => (
            <button
              key={s.session.token}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => handleSwitch(s.session.token)}
              disabled={!!switching}
            >
              <UserAvatar src={(s.user as any).image as string | null} name={s.user.name} size={24} />
              <span className="item-text">
                <span className="text-strong truncate">
                  {switching === s.session.token ? "Switching…" : (s.user.name ?? s.user.email)}
                </span>
                <span className="text-sm text-tertiary truncate">{s.user.email}</span>
              </span>
            </button>
          ))}

          {others.length === 0 && sessions.length > 0 && (
            <p className="menu-note text-sm text-tertiary">Only this account is signed in.</p>
          )}

          <div className="menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => { setOpen(false); window.location.href = "/sign-in"; }}
          >
            <PlusCircle /> Add account
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const ref = React.useRef<HTMLElement>(null);

  // While the drawer is open on mobile: focus moves in, Tab stays inside.
  React.useEffect(() => {
    if (!mobileOpen || !ref.current) return;
    const root = ref.current;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <aside ref={ref} id="dashboard-nav" className={`dashboard-sidebar${mobileOpen ? " is-open" : ""}`} aria-label="Dashboard">
      <div className="sidebar-brand">
        <KovaLogo size={24} variant="full" />
      </div>

      <OrgSwitcher />

      <nav className="sidebar-nav" aria-label="Main">
        <p className="sidebar-group-label text-overline">Platform</p>
        {NAV.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? path === to : path.startsWith(to);
          return (
            <Link key={to} to={to as any} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={onNavigate}>
              <Icon strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}

        <p className="sidebar-group-label text-overline">Configure</p>
        <Link
          to="/settings"
          className={`nav-item${path.startsWith("/settings") ? " active" : ""}`}
          aria-current={path.startsWith("/settings") ? "page" : undefined}
          onClick={onNavigate}
        >
          <Settings strokeWidth={1.75} />
          Settings
        </Link>
      </nav>

      <div className="sidebar-footer">
        <SessionSwitcher />
        {session && (
          <div className="session-row">
            <UserAvatar src={(session.user as any).image as string | null} name={session.user.name} size={28} />
            <div className="item-text">
              <p className="text-strong truncate">{session.user.name}</p>
              <p className="text-sm text-tertiary truncate">{session.user.email}</p>
            </div>
            <button
              type="button"
              className="btn btn-subtle btn-icon btn-sm"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function AccessRestricted({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <main className="center-screen">
      <div className="card notice-card">
        <span className="icon-tile icon-tile-lg tone-danger" aria-hidden="true"><Shield /></span>
        <h1>Admin access required</h1>
        <p>
          This dashboard is for administrators. You're signed in as{" "}
          <strong className="text-strong">{email}</strong>, which isn't an admin account.
        </p>
        <div className="notice-actions">
          <button type="button" className="btn btn-secondary btn-block" onClick={onSignOut}>
            <LogOut /> Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

function isAdmin(role: string | undefined | null) {
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
    // Static frame in the shell's shape so the layout doesn't jump on load.
    return (
      <div className="dashboard-shell" role="status" aria-label="Loading dashboard">
        <div className="dashboard-sidebar" aria-hidden="true">
          <div className="sidebar-brand"><KovaLogo size={24} variant="full" /></div>
        </div>
        <div className="dashboard-main">
          <div className="dashboard-topbar" />
          <div className="dashboard-content">
            <div className="dashboard-content-inner">
              <span className="skeleton" style={{ width: 180, height: 28, marginBottom: 24 }} />
              <div className="stat-grid">
                {[0, 1, 2, 3].map(i => <span key={i} className="skeleton" style={{ height: 78, borderRadius: "var(--radius-lg)" }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    setTimeout(() => navigate({ to: "/sign-in" }), 0);
    return null;
  }

  if (!isAdmin(session.user.role)) {
    return <AccessRestricted email={session.user.email} onSignOut={handleSignOut} />;
  }

  return <>{children}</>;
}

function ThemeMenu() {
  const { preference } = useTheme();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  // Where focus lands on open: the active choice by default, the first or last row from the arrow keys.
  const landOn = React.useRef<"selected" | "first" | "last">("selected");
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  React.useEffect(() => {
    if (!open) return;
    const rows = items();
    const target = landOn.current === "first" ? rows[0]
      : landOn.current === "last" ? rows[rows.length - 1]
      : rows.find((row) => row.getAttribute("aria-checked") === "true");
    target?.focus();
    landOn.current = "selected";
  }, [open]);

  const choose = (value: ThemePreference) => {
    setThemePreference(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (open) {
      const rows = items();
      (e.key === "ArrowDown" ? rows[0] : rows[rows.length - 1])?.focus();
    } else {
      landOn.current = e.key === "ArrowDown" ? "first" : "last";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Tab hands focus back to the trigger first, so it moves on from there instead of from a removed item.
    if (e.key === "Escape" || e.key === "Tab") {
      triggerRef.current?.focus();
      if (e.key === "Tab") close();
      return;
    }
    const rows = items();
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? rows[(index + 1) % rows.length]
      : e.key === "ArrowUp" ? rows[(index - 1 + rows.length) % rows.length]
      : e.key === "Home" ? rows[0]
      : e.key === "End" ? rows[rows.length - 1]
      : undefined;
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const label = THEME_OPTIONS.find((option) => option.value === preference)?.label ?? "System";

  return (
    <div ref={ref} className="popover-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-subtle btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${label}`}
        title={`Theme: ${label}`}
        onClick={() => setOpen(v => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {/* All three render; html[data-theme] CSS shows the one that matches, so nothing swaps after hydration. */}
        <Sun className="theme-icon theme-icon-light" aria-hidden="true" />
        <Moon className="theme-icon theme-icon-dark" aria-hidden="true" />
        <Monitor className="theme-icon theme-icon-system" aria-hidden="true" />
      </button>

      {open && (
        <div className="menu menu-below menu-end" role="menu" aria-label="Theme" onKeyDown={onMenuKeyDown}>
          {THEME_OPTIONS.map(({ value, label }) => {
            const ItemIcon = THEME_ICONS[value];
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="menu-item"
                onClick={() => choose(value)}
              >
                <ItemIcon aria-hidden="true" />
                <span className="item-text">{label}</span>
                {selected && <Check aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The search field in the topbar; the shortcut hint only shows where a keyboard makes it useful. */
function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const shortcut = useSearchShortcut();
  return (
    <button type="button" className="dashboard-search" onClick={onOpen} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
      <Search aria-hidden="true" />
      <span>Search…</span>
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

function DashboardRoot() {
  const location = useLocation();
  const { data: session } = useSession();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const menuToggleRef = React.useRef<HTMLButtonElement>(null);
  const isPublic = ["/sign-in", "/sign-up", "/auth-error", "/reset-password", "/oauth/continue"].some(p => location.pathname === p)
    || location.pathname.startsWith("/accept-invitation")
    || location.pathname.startsWith("/approve/")
    || (location.pathname === "/" && !session);

  React.useEffect(() => {
    if (isPublic) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPublic]);

  // The backdrop stays mounted while the drawer slides out, fading with it.
  const [backdrop, setBackdrop] = React.useState<"hidden" | "open" | "closing">("hidden");
  React.useEffect(() => {
    if (sidebarOpen) { setBackdrop("open"); return; }
    setBackdrop(b => (b === "open" ? "closing" : b));
    const t = setTimeout(() => setBackdrop(b => (b === "closing" ? "hidden" : b)), 260);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

  // The drawer closes on navigation, Escape, and when the viewport grows past it.
  React.useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  React.useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSidebarOpen(false); menuToggleRef.current?.focus(); }
    };
    const wide = window.matchMedia("(min-width: 821px)");
    const onWide = () => { if (wide.matches) setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [sidebarOpen]);

  if (isPublic) {
    return <Outlet />;
  }

  return (
    <AuthGuard>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          currentUserId={session?.user.id}
        />
      )}
      <div className="dashboard-shell">
        {backdrop !== "hidden" && (
          <button
            className="sidebar-backdrop"
            data-state={backdrop}
            type="button"
            aria-label="Close navigation"
            tabIndex={backdrop === "open" ? 0 : -1}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar mobileOpen={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
        <div className="dashboard-main" inert={sidebarOpen || undefined}>
          <header className="dashboard-topbar">
            <button
              ref={menuToggleRef}
              className="dashboard-menu-toggle btn btn-secondary btn-icon"
              type="button"
              aria-label="Open navigation"
              aria-controls="dashboard-nav"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </button>
            <SearchTrigger onOpen={() => setPaletteOpen(true)} />
            <div className="topbar-actions">
              <ThemeMenu />
            </div>
          </header>

          <main className="dashboard-content">
            <div className="dashboard-content-inner">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets data-theme before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <DashboardRoot />;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kova | Identity infrastructure at the edge" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

import { UserAvatar } from "@/components/UserAvatar";
import { multiSession, organization, signOut, useActiveOrganization, useListOrganizations, useSession } from "@/lib/auth-client";
import { createRootRoute, Link, Outlet, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Globe,
  Key,
  LogOut,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  UserCircle,
  Users
} from "lucide-react";
import React from "react";

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
      <div style={{
        height: "100%", minHeight: 400,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        <div style={{
          width: "100%", maxWidth: 460,
          background: "var(--color-surface-800)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 16, padding: 36, textAlign: "center",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: "0 auto 20px",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <AlertTriangle size={22} color="#f87171" strokeWidth={2} />
          </div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: "0.82rem", color: "#64748b", lineHeight: 1.65, marginBottom: 6 }}>
            An unexpected error occurred in this view.
          </p>
          {import.meta.env.DEV && this.state.message && (
            <pre style={{
              fontSize: "0.72rem", color: "#f87171",
              background: "rgba(239,68,68,0.07)", borderRadius: 8,
              padding: "10px 12px", textAlign: "left",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 160, overflow: "auto", marginBottom: 20,
            }}>{this.state.message}</pre>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20 }}>
            <button
              className="btn btn-ghost"
              onClick={() => this.setState({ hasError: false, message: "" })}
            >
              <RefreshCw size={14} /> Reload
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => { await signOut(); window.location.href = "/sign-in"; }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Command Palette (Cmd+K) ───────────────────────────────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
}

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: <BarChart3 size={15} /> },
  { to: "/users", label: "Users", icon: <Users size={15} /> },
  { to: "/sessions", label: "Sessions", icon: <Activity size={15} /> },
  { to: "/audit-logs", label: "Audit Logs", icon: <ClipboardList size={15} /> },
  { to: "/organizations", label: "Organizations", icon: <Building2 size={15} /> },
  { to: "/oauth-apps", label: "OAuth Apps", icon: <Globe size={15} /> },
  { to: "/api-keys", label: "API Keys", icon: <Key size={15} /> },
  { to: "/settings", label: "Settings", icon: <Settings size={15} /> },
];

function CommandPalette({ onClose, currentUserId }: { onClose: () => void; currentUserId?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [userResults, setUserResults] = React.useState<{ id: string; name: string; email: string; image: string | null }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  // Live user search
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

  // Build items list
  const items = React.useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = NAV_ITEMS
      .filter(n => !query || n.label.toLowerCase().includes(query.toLowerCase()))
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
      icon: <UserAvatar src={u.image} name={u.name} size={20} style={{ flexShrink: 0 }} />,
      action: () => { window.location.href = `/users/${u.id}`; onClose(); },
    }));

    const extras: PaletteItem[] = [];
    if (currentUserId && (!query || "copy id".includes(query.toLowerCase()))) {
      extras.push({
        id: "copy-id",
        label: copied ? "Copied!" : "Copy my user ID",
        sublabel: currentUserId,
        icon: <Copy size={15} />,
        action: () => {
          navigator.clipboard.writeText(currentUserId);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
      });
    }

    return [...navItems, ...userItems, ...extras];
  }, [query, userResults, currentUserId, copied, navigate, onClose]);

  React.useEffect(() => { setActiveIdx(0); }, [items.length]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); items[activeIdx]?.action(); }
  };

  // Close on backdrop
  const handleBackdropClick = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };

  void router;

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540,
        background: "var(--color-surface-800)",
        border: "1px solid var(--color-border)",
        borderRadius: 14, overflow: "hidden",
        boxShadow: "0 32px 64px rgba(0,0,0,0.6)",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <Search size={15} color="#475569" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Navigate, search users…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "#e2e8f0", fontSize: "0.92rem",
            }}
          />
          {searching && <div className="loading" style={{ width: 14, height: 14, flexShrink: 0 }} />}
          <kbd style={{
            fontSize: "0.65rem", color: "#475569",
            background: "var(--color-surface-700)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "2px 6px", flexShrink: 0,
          }}>esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: 4 }}>
          {items.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "#475569", fontSize: "0.83rem" }}>
              {query ? "No results" : "Type to search or navigate…"}
            </div>
          )}
          {items.map((item, idx) => (
            <button
              key={item.id}
              onClick={item.action}
              onMouseEnter={() => setActiveIdx(idx)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 8, marginBottom: 2,
                background: activeIdx === idx ? "rgba(99,102,241,0.12)" : "transparent",
                border: "none", cursor: "pointer", transition: "background 0.1s",
                textAlign: "left",
              }}
            >
              <span style={{ color: activeIdx === idx ? "#818cf8" : "#475569", flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.85rem", color: activeIdx === idx ? "#e2e8f0" : "#94a3b8", fontWeight: 500 }}>
                  {item.label}
                </span>
                {item.sublabel && (
                  <span style={{ display: "block", fontSize: "0.72rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.sublabel}
                  </span>
                )}
              </span>
              {activeIdx === idx && (
                <kbd style={{ fontSize: "0.65rem", color: "#475569", background: "var(--color-surface-700)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>↵</kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "8px 16px", display: "flex", gap: 14 }}>
          {[["↑↓", "navigate"], ["↵", "select"], ["esc", "close"]].map(([key, hint]) => (
            <span key={key} style={{ fontSize: "0.69rem", color: "#334155", display: "flex", alignItems: "center", gap: 4 }}>
              <kbd style={{ background: "var(--color-surface-700)", border: "1px solid var(--color-border)", borderRadius: 3, padding: "1px 5px" }}>{key}</kbd>
              {hint}
            </span>
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

  // Load device sessions whenever the dropdown opens
  React.useEffect(() => {
    if (!open) return;
    multiSession.listDeviceSessions().then((res: Awaited<ReturnType<typeof multiSession.listDeviceSessions>>) => {
      setSessions((res.data as DeviceSession[] | null) ?? []);
    }).catch(() => setSessions([]));
  }, [open]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSwitch = async (token: string) => {
    if (switching) return;
    setSwitching(token);
    try {
      await multiSession.setActive({ sessionToken: token });
      window.location.reload(); // full reload to pick up new session cookie
    } catch {
      setSwitching(null);
    }
  };

  const others = sessions.filter(s => s.user.id !== currentSession?.user.id);

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 4 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: "transparent", border: "none",
          borderRadius: 8, padding: "5px 10px", cursor: "pointer",
          color: "#475569", fontSize: "0.72rem", transition: "background 0.15s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <UserCircle size={13} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Accounts{others.length > 0 ? ` (${others.length + 1})` : ""}
        </span>
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--color-surface-800)", border: "1px solid var(--color-border)",
          borderRadius: 10, padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        }}>
          <p style={{
            fontSize: "0.6rem", color: "#475569", fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "6px 10px 4px",
          }}>Switch account</p>

          {/* Current session */}
          {currentSession && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", borderRadius: 7,
              background: "rgba(99,102,241,0.12)", marginBottom: 2,
            }}>
              <UserAvatar
                src={(currentSession.user as any).image as string | null}
                name={currentSession.user.name}
                size={24}
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#818cf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentSession.user.name ?? currentSession.user.email}
                </p>
                <p style={{ fontSize: "0.65rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentSession.user.email}
                </p>
              </div>
              <Check size={11} color="#818cf8" />
            </div>
          )}

          {/* Other sessions */}
          {others.map(s => {
            const isSwitching = switching === s.session.token;
            return (
              <button
                key={s.session.token}
                onClick={() => handleSwitch(s.session.token)}
                disabled={!!switching}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 7, marginBottom: 2,
                  background: "transparent", border: "none", cursor: "pointer",
                  opacity: isSwitching ? 0.6 : 1, transition: "background 0.12s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <UserAvatar
                  src={(s.user as any).image as string | null}
                  name={s.user.name}
                  size={24}
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isSwitching ? "Switching..." : (s.user.name ?? s.user.email)}
                  </p>
                  <p style={{ fontSize: "0.65rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.user.email}
                  </p>
                </div>
              </button>
            );
          })}

          {others.length === 0 && sessions.length > 0 && (
            <p style={{ padding: "8px 10px", fontSize: "0.75rem", color: "#475569" }}>
              Only one account signed in
            </p>
          )}

          <div style={{ height: 1, background: "var(--color-border)", margin: "4px 0" }} />
          <button
            onClick={() => { setOpen(false); window.location.href = "/sign-in"; }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", borderRadius: 7,
              background: "transparent", border: "none", cursor: "pointer",
              color: "#64748b", fontSize: "0.78rem", transition: "background 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-700)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <PlusCircle size={13} /> Add account
          </button>
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

      {/* Session / Account Switcher (multi-session) */}
      <SessionSwitcher />

      {/* User */}
      {session && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
            <UserAvatar
              src={(session.user as any).image as string | null}
              name={session.user.name}
              size={28}
            />
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
  const { data: session } = useSession();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const isPublic = ["/sign-in", "/auth-error"].some(p => location.pathname === p)
    || location.pathname.startsWith("/accept-invitation");

  // Global Cmd+K / Ctrl+K listener
  React.useEffect(() => {
    if (isPublic) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPublic]);

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
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: "auto", padding: 28, minWidth: 0 }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});

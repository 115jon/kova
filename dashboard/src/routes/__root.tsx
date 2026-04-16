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
  Layers,
  LogOut,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  UserCircle,
  Users,
  Webhook,
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
          background: "var(--color-surface)",
          border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 6, padding: 36, textAlign: "center",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 6, margin: "0 auto 20px",
            background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <AlertTriangle size={20} color="var(--color-red)" strokeWidth={2} />
          </div>
          <h2 style={{
            fontFamily: "var(--font-mono)", fontSize: "1rem",
            fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8,
            letterSpacing: "-0.02em",
          }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", lineHeight: 1.65, marginBottom: 6 }}>
            An unexpected error occurred in this view.
          </p>
          {import.meta.env.DEV && this.state.message && (
            <pre style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem", color: "var(--color-red)",
              background: "rgba(248,113,113,0.07)", borderRadius: 4,
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
              <RefreshCw size={13} /> Reload
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => { await signOut(); window.location.href = "/sign-in"; }}
            >
              <LogOut size={13} /> Sign out
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
  { to: "/", label: "Overview", icon: <BarChart3 size={14} /> },
  { to: "/users", label: "Users", icon: <Users size={14} /> },
  { to: "/sessions", label: "Sessions", icon: <Activity size={14} /> },
  { to: "/audit-logs", label: "Audit Logs", icon: <ClipboardList size={14} /> },
  { to: "/organizations", label: "Organizations", icon: <Building2 size={14} /> },
  { to: "/oauth-apps", label: "OAuth Apps", icon: <Globe size={14} /> },
  { to: "/api-keys", label: "API Keys", icon: <Key size={14} /> },
  { to: "/webhooks", label: "Webhooks", icon: <Webhook size={14} /> },
  { to: "/applications", label: "Applications", icon: <Layers size={14} /> },
  { to: "/settings", label: "Settings", icon: <Settings size={14} /> },
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
      icon: <UserAvatar src={u.image} name={u.name} size={18} style={{ flexShrink: 0 }} />,
      action: () => { window.location.href = `/users/${u.id}`; onClose(); },
    }));

    const extras: PaletteItem[] = [];
    if (currentUserId && (!query || "copy id".includes(query.toLowerCase()))) {
      extras.push({
        id: "copy-id",
        label: copied ? "Copied!" : "Copy my user ID",
        sublabel: currentUserId,
        icon: <Copy size={14} />,
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

  const handleBackdropClick = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };

  void router;

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 520,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: 6, overflow: "hidden",
        boxShadow: "0 32px 64px rgba(0,0,0,0.7)",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <Search size={14} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Navigate, search users…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontFamily: "var(--font-mono)", color: "var(--color-text-primary)",
              fontSize: "0.85rem",
            }}
          />
          {searching && <div className="loading" style={{ width: 12, height: 12, borderRadius: 2, background: "var(--color-border-strong)", flexShrink: 0 }} />}
          <kbd style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.62rem", color: "var(--color-text-tertiary)",
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 3, padding: "2px 6px", flexShrink: 0,
          }}>esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 340, overflowY: "auto", padding: "4px" }}>
          {items.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>
              {query ? "no results" : "type to search or navigate…"}
            </div>
          )}
          {items.map((item, idx) => (
            <button
              key={item.id}
              onClick={item.action}
              onMouseEnter={() => setActiveIdx(idx)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 4, marginBottom: 1,
                background: activeIdx === idx ? "var(--color-accent-glow)" : "transparent",
                border: activeIdx === idx ? "1px solid rgba(59,130,246,0.15)" : "1px solid transparent",
                cursor: "pointer", transition: "background 0.1s, border-color 0.1s",
                textAlign: "left",
              }}
            >
              <span style={{ color: activeIdx === idx ? "var(--color-accent)" : "var(--color-text-tertiary)", flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: "block",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  color: activeIdx === idx ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  fontWeight: 500,
                }}>
                  {item.label}
                </span>
                {item.sublabel && (
                  <span style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.68rem",
                    color: "var(--color-text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {item.sublabel}
                  </span>
                )}
              </span>
              {activeIdx === idx && (
                <kbd style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.62rem", color: "var(--color-text-tertiary)",
                  background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                  borderRadius: 3, padding: "2px 5px", flexShrink: 0,
                }}>↵</kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "7px 14px", display: "flex", gap: 14 }}>
          {[["↑↓", "navigate"], ["↵", "select"], ["esc", "close"]].map(([key, hint]) => (
            <span key={key} style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem", color: "var(--color-text-tertiary)",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <kbd style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 2, padding: "1px 4px" }}>{key}</kbd>
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
  { to: "/webhooks", label: "Webhooks", icon: Webhook, exact: false },
  { to: "/applications", label: "Applications", icon: Layers, exact: false },
];

// ── Org Switcher ──────────────────────────────────────────────────────────────

function OrgAvatar({ name, logo, size = 24 }: { name: string; logo?: string | null; size?: number }) {
  const [imgError, setImgError] = React.useState(false);
  const borderRadius = 4;
  const baseStyle: React.CSSProperties = {
    width: size, height: size, borderRadius, flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  };

  if (logo && !imgError) {
    return (
      <div style={baseStyle}>
        <img
          src={logo}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          style={{ width: size, height: size, objectFit: "cover", borderRadius }}
        />
      </div>
    );
  }

  return (
    <div style={{
      ...baseStyle,
      background: "var(--color-accent-dim)",
      border: "1px solid rgba(59,130,246,0.2)",
      fontFamily: "var(--font-mono)",
      fontWeight: 700, fontSize: size * 0.44, color: "var(--color-accent)",
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
    <div ref={ref} style={{ position: "relative", marginBottom: 10 }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: open ? "var(--color-surface-hover)" : "transparent",
          border: "1px solid", borderColor: open ? "var(--color-border)" : "transparent",
          borderRadius: 4, padding: "6px 8px", cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        {activeOrg
          ? <OrgAvatar name={activeOrg.name} logo={(activeOrg as any).logo ?? null} />
          : <div style={{
            width: 24, height: 24, borderRadius: 4, flexShrink: 0,
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Building2 size={12} color="var(--color-text-tertiary)" /></div>
        }
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem", fontWeight: 600,
            color: "var(--color-text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            letterSpacing: "-0.01em",
          }}>
            {activeOrg?.name ?? "Select org"}
          </p>
          {activeOrg && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--color-text-tertiary)" }}>
              {activeOrg.slug}
            </p>
          )}
        </div>
        <ChevronDown size={11} color="var(--color-text-tertiary)"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>

      {open && (
        <div role="listbox" style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, zIndex: 100,
          background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
          borderRadius: 5, padding: 3, boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
        }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.58rem", color: "var(--color-text-tertiary)", fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "6px 8px 4px",
          }}>Switch organization</p>

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
                  padding: "6px 8px", borderRadius: 4,
                  cursor: isPersonal ? "default" : "pointer",
                  background: isPersonal ? "var(--color-accent-glow)" : "transparent",
                  border: isPersonal ? "1px solid rgba(59,130,246,0.15)" : "1px solid transparent",
                  transition: "background 0.1s", marginBottom: 1,
                  opacity: isSwitching ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!isPersonal) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
                onMouseLeave={e => { if (!isPersonal) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                  background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <UserCircle size={13} color="var(--color-text-tertiary)" />
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.76rem", fontWeight: 600,
                    color: isPersonal ? "var(--color-accent)" : "var(--color-text-secondary)",
                    letterSpacing: "-0.01em",
                  }}>
                    {isSwitching ? "Switching…" : "No organization"}
                  </p>
                </div>
                {isPersonal && <Check size={11} color="var(--color-accent)" />}
              </button>
            );
          })()}

          <div style={{ height: 1, background: "var(--color-border)", margin: "3px 0" }} />

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
                  padding: "6px 8px", borderRadius: 4,
                  cursor: isActive ? "default" : "pointer",
                  background: isActive ? "var(--color-accent-glow)" : "transparent",
                  border: isActive ? "1px solid rgba(59,130,246,0.15)" : "1px solid transparent",
                  transition: "background 0.1s", marginBottom: 1,
                  opacity: isSwitching ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <OrgAvatar name={org.name} logo={(org as any).logo ?? null} />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.76rem", fontWeight: 600,
                    color: isActive ? "var(--color-accent)" : "var(--color-text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    letterSpacing: "-0.01em",
                  }}>
                    {isSwitching ? "Switching…" : org.name}
                  </p>
                </div>
                {isActive && <Check size={11} color="var(--color-accent)" />}
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

  React.useEffect(() => {
    if (!open) return;
    multiSession.listDeviceSessions().then((res: Awaited<ReturnType<typeof multiSession.listDeviceSessions>>) => {
      setSessions((res.data as DeviceSession[] | null) ?? []);
    }).catch(() => setSessions([]));
  }, [open]);

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
      window.location.reload();
    } catch {
      setSwitching(null);
    }
  };

  const others = sessions.filter(s => s.user.id !== currentSession?.user.id);

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 3 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 7,
          background: "transparent", border: "1px solid transparent",
          borderRadius: 4, padding: "5px 8px", cursor: "pointer",
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-tertiary)", fontSize: "0.7rem", transition: "background 0.12s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <UserCircle size={12} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Accounts{others.length > 0 ? ` (${others.length + 1})` : ""}
        </span>
        <ChevronDown size={10} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 3px)", left: 0, right: 0, zIndex: 100,
          background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
          borderRadius: 5, padding: 3, boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
        }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.58rem", color: "var(--color-text-tertiary)", fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "6px 8px 4px",
          }}>Switch account</p>

          {currentSession && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 8px", borderRadius: 4,
              background: "var(--color-accent-glow)",
              border: "1px solid rgba(59,130,246,0.15)",
              marginBottom: 1,
            }}>
              <UserAvatar
                src={(currentSession.user as any).image as string | null}
                name={currentSession.user.name}
                size={22}
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                  {currentSession.user.name ?? currentSession.user.email}
                </p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentSession.user.email}
                </p>
              </div>
              <Check size={10} color="var(--color-accent)" />
            </div>
          )}

          {others.map(s => {
            const isSwitching = switching === s.session.token;
            return (
              <button
                key={s.session.token}
                onClick={() => handleSwitch(s.session.token)}
                disabled={!!switching}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 4, marginBottom: 1,
                  background: "transparent", border: "1px solid transparent",
                  cursor: "pointer",
                  opacity: isSwitching ? 0.6 : 1, transition: "background 0.1s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <UserAvatar
                  src={(s.user as any).image as string | null}
                  name={s.user.name}
                  size={22}
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                    {isSwitching ? "Switching..." : (s.user.name ?? s.user.email)}
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.user.email}
                  </p>
                </div>
              </button>
            );
          })}

          {others.length === 0 && sessions.length > 0 && (
            <p style={{ fontFamily: "var(--font-mono)", padding: "7px 8px", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>
              Only one account signed in
            </p>
          )}

          <div style={{ height: 1, background: "var(--color-border)", margin: "3px 0" }} />
          <button
            onClick={() => { setOpen(false); window.location.href = "/sign-in"; }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 7,
              padding: "6px 8px", borderRadius: 4,
              background: "transparent", border: "1px solid transparent",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-tertiary)", fontSize: "0.75rem", transition: "background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-hover)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <PlusCircle size={12} /> Add account
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
      width: 216,
      flexShrink: 0,
      background: "var(--color-surface)",
      borderRight: "1px solid var(--color-border)",
      display: "flex",
      flexDirection: "column",
      padding: "16px 10px",
      gap: 2,
    }}>
      {/* Logo — maple-style square icon + wordmark */}
      <div style={{ padding: "4px 10px 18px", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 5,
          background: "var(--color-accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Shield size={13} color="#fff" strokeWidth={2.5} />
        </div>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700, fontSize: "0.88rem",
          color: "var(--color-text-primary)",
          letterSpacing: "-0.03em",
        }}>
          ralph<span style={{ color: "var(--color-accent)" }}>auth</span>
        </span>
      </div>

      {/* Org Switcher */}
      <OrgSwitcher />

      {/* Nav section label */}
      <p style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.58rem", color: "var(--color-text-tertiary)",
        fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
        padding: "2px 10px 6px",
      }}>
        Navigation
      </p>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? path === to : path.startsWith(to);
          return (
            <Link key={to} to={to as any} className={`nav-item${active ? " active" : ""}`}>
              <Icon size={14} strokeWidth={active ? 2.5 : 1.75} />
              {label}
            </Link>
          );
        })}

        <div style={{ height: 1, background: "var(--color-border)", margin: "10px 2px" }} />
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.58rem", color: "var(--color-text-tertiary)",
          fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "2px 10px 6px",
        }}>
          Config
        </p>
        <Link to="/settings" className={`nav-item${path.startsWith("/settings") ? " active" : ""}`}>
          <Settings size={14} strokeWidth={path.startsWith("/settings") ? 2.5 : 1.75} />
          Settings
        </Link>
      </nav>

      {/* Session / Account Switcher */}
      <SessionSwitcher />

      {/* User footer */}
      {session && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, marginTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
            <UserAvatar
              src={(session.user as any).image as string | null}
              name={session.user.name}
              size={26}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.76rem", fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                letterSpacing: "-0.01em",
              }}>
                {session.user.name}
              </p>
              <p style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.62rem", color: "var(--color-text-tertiary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {session.user.email}
              </p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 6px", borderRadius: 4, minWidth: 28 }}
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function AccessRestricted({ name: _name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-bg)", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 400,
        background: "var(--color-surface)",
        borderRadius: 6, border: "1px solid rgba(248,113,113,0.2)",
        padding: 36, textAlign: "center",
        boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 6, margin: "0 auto 20px",
          background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Shield size={20} color="var(--color-red)" strokeWidth={2} />
        </div>
        <h1 style={{
          fontFamily: "var(--font-mono)",
          fontSize: "1rem", fontWeight: 700,
          color: "var(--color-text-primary)", marginBottom: 10,
          letterSpacing: "-0.02em",
        }}>
          Admin access required
        </h1>
        <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", lineHeight: 1.65, marginBottom: 24 }}>
          This dashboard is restricted to administrators. You're signed in as{" "}
          <strong style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{email}</strong>,
          which doesn't have admin privileges.
        </p>
        <button
          className="btn btn-danger"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={onSignOut}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
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
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="loading" style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-tertiary)", fontSize: "0.8rem",
        }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    setTimeout(() => navigate({ to: "/sign-in" }), 0);
    return null;
  }

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
        {/* Right column: topbar + scrollable main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Topbar */}
          <div style={{
            height: 42,
            borderBottom: "1px solid var(--color-border)",
            display: "flex", alignItems: "center",
            padding: "0 24px", gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setPaletteOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "4px 10px",
                cursor: "pointer", color: "var(--color-text-tertiary)",
                fontFamily: "var(--font-mono)", fontSize: "0.72rem",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-strong)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)"; }}
            >
              <Search size={11} />
              <span>Search…</span>
              <kbd style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.6rem", background: "var(--color-surface)",
                border: "1px solid var(--color-border)", borderRadius: 2,
                padding: "1px 4px", marginLeft: 4,
              }}>⌘K</kbd>
            </button>
            {/* Spacer */}
            <div style={{ flex: 1 }} />
          </div>

          {/* Main scrollable content area — fills remaining height */}
          <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px 40px", minWidth: 0 }}>
            <div style={{ maxWidth: 980, margin: "0 auto" }}>
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

export const Route = createRootRoute({
  component: RootComponent,
});

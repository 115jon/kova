import { UserAvatar } from "@/components/UserAvatar";
import { organization } from "@/lib/auth-client";
import { relativeTime } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, ArrowLeft, CheckCircle,
  ClipboardList,
  Mail,
  RefreshCw,
  Settings,
  Trash2, UserMinus, UserPlus, Users, X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/organizations_/$orgId")({
  component: OrgDetailPage,
});

type Tab = "members" | "invitations" | "activity" | "settings";

// ── Role badge styling using design tokens ────────────────────────────────────

function roleBadgeStyle(role: string): React.CSSProperties {
  if (role === "owner") return { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", color: "var(--color-amber)" };
  if (role === "admin") return { background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)", color: "var(--color-accent)" };
  return { background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" };
}

// ── Invite Member Modal ───────────────────────────────────────────────────────

function InviteModal({ orgId, onClose, onInvited }: { orgId: string; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await organization.inviteMember({ email, role, organizationId: orgId });
      if (res.error) throw new Error(res.error.message);
      setSuccess(true);
      setTimeout(() => { onInvited(); onClose(); }, 1200);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <p className="panel-title">Invite member</p>
          <button className="btn btn-ghost" style={{ padding: 5, marginLeft: "auto" }} onClick={onClose}>
            <X size={13} />
          </button>
        </div>
        <form onSubmit={handle} className="modal-body">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="input" type="email" placeholder="colleague@example.com" value={email}
              onChange={e => setEmail(e.target.value)} autoFocus required />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value as any)}
              style={{ appearance: "none", cursor: "pointer" }}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && (
            <div style={{
              background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
              color: "var(--color-red)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
            }}><AlertCircle size={12} /> {error}</div>
          )}
          {success && (
            <div style={{
              background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
              borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
              color: "var(--color-green)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
            }}><CheckCircle size={12} /> Invitation sent!</div>
          )}
          <div className="modal-footer" style={{ border: "none", padding: 0 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}
              disabled={loading || !email || success}>
              <Mail size={13} /> {loading ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Org Audit Log mini-view ───────────────────────────────────────────────────

interface AuditLogRow {
  id: string;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  actorImage?: string | null;
  action: string;
  targetLabel: string | null;
  targetId: string | null;
  ipAddress: string | null;
  createdAt: number;
}

const ACTION_META: Record<string, { label: string; color: string }> = {
  "user.signIn": { label: "Signed in", color: "var(--color-accent)" },
  "user.signOut": { label: "Signed out", color: "var(--color-text-tertiary)" },
  "user.signUp": { label: "Signed up", color: "var(--color-green)" },
  "apiKey.created": { label: "API key created", color: "var(--color-amber)" },
  "apiKey.revoked": { label: "API key revoked", color: "var(--color-red)" },
  "member.invited": { label: "Member invited", color: "var(--color-accent)" },
  "member.joined": { label: "Member joined", color: "var(--color-accent)" },
  "member.removed": { label: "Member removed", color: "var(--color-red)" },
  "member.roleChanged": { label: "Role changed", color: "var(--color-amber)" },
  "session.revoked": { label: "Session revoked", color: "var(--color-red)" },
  "admin.userBanned": { label: "User banned", color: "var(--color-red)" },
  "admin.userUnbanned": { label: "User unbanned", color: "var(--color-green)" },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action];
  const label = meta?.label ?? action;
  const color = meta?.color ?? "var(--color-text-secondary)";
  return (
    <span style={{
      display: "inline-block",
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      color, borderRadius: 3, padding: "1px 7px",
      fontFamily: "var(--font-mono)", fontSize: "0.68rem", fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function OrgAuditLog({ orgId }: { orgId: string }) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);

  const fetchLogs = useCallback(async (replace = true) => {
    if (replace) setLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({ orgId, limit: "30" });
      if (!replace && nextCursorRef.current) params.set("before", nextCursorRef.current);
      const res = await fetch(`/api/audit/logs?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? `Failed (${res.status})`);
      }
      const data = await res.json() as { logs: AuditLogRow[]; nextCursor: string | null };
      nextCursorRef.current = data.nextCursor;
      setNextCursor(data.nextCursor);
      setLogs(prev => replace ? data.logs : [...prev, ...data.logs]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { fetchLogs(true); }, [fetchLogs]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p className="panel-title">Recent activity</p>
        <button className="btn btn-ghost" onClick={() => fetchLogs(true)} disabled={loading} title="Refresh" style={{ padding: "4px 8px" }}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div style={{
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem", marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading empty-state" style={{ fontSize: "0.78rem" }}>Loading activity…</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={18} color="var(--color-text-tertiary)" strokeWidth={1.5} style={{ marginBottom: 10 }} />
            <p>No activity recorded yet for this organization.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["When", "Event", "Actor", "Target", "IP"].map(h => (
                  <th key={h} style={{
                    padding: "8px 14px", textAlign: "left",
                    fontFamily: "var(--font-mono)", fontSize: "0.6rem", fontWeight: 600,
                    color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((row, i) => (
                <tr key={row.id} style={{
                  borderBottom: i < logs.length - 1 ? "1px solid var(--color-border)" : "none",
                  transition: "background 0.1s",
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "9px 14px", fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                    <span title={new Date(row.createdAt).toLocaleString()}>
                      {relativeTime(new Date(row.createdAt).toISOString())}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    <ActionBadge action={row.action} />
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <UserAvatar src={row.actorImage ?? null} name={row.actorName ?? row.actor} size={22} style={{ flexShrink: 0 }} />
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.78rem", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>
                        {row.actorName ?? row.actorEmail ?? row.actor}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "9px 14px", fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.targetLabel ?? (row.targetId
                      ? <code>{row.targetId.slice(0, 10)}…</code>
                      : <span>—</span>)}
                  </td>
                  <td style={{ padding: "9px 14px", fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
                    {row.ipAddress ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {nextCursor && !loading && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "center" }}>
            <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} onClick={() => fetchLogs(false)} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Org Detail Page ───────────────────────────────────────────────────────────

function OrgDetailPage() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [showInvite, setShowInvite] = useState(false);

  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const fetchOrg = async () => {
    setLoading(true);
    try {
      const [orgRes, membersRes, invitesRes] = await Promise.all([
        organization.getFullOrganization({ query: { organizationId: orgId } }),
        organization.listMembers({ query: { organizationId: orgId } }),
        organization.listInvitations({ query: { organizationId: orgId } }),
      ]);
      const orgData = orgRes.data;
      if (orgData) {
        setOrg(orgData);
        setEditName(orgData.name ?? "");
        setEditSlug(orgData.slug ?? "");
      }
      setMembers((membersRes.data as any)?.members ?? membersRes.data ?? []);
      setInvitations((invitesRes.data as any) ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrg(); }, [orgId]);

  const handleRemoveMember = async (memberId: string) => {
    await organization.removeMember({ memberIdOrEmail: memberId, organizationId: orgId });
    setMembers(m => m.filter(x => x.id !== memberId));
  };

  const handleChangeRole = async (memberId: string, role: string) => {
    await organization.updateMemberRole({ memberId, role, organizationId: orgId });
    setMembers(m => m.map(x => x.id === memberId ? { ...x, role } : x));
  };

  const handleCancelInvite = async (inviteId: string) => {
    await organization.cancelInvitation({ invitationId: inviteId });
    setInvitations(i => i.filter(x => x.id !== inviteId));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveErr(""); setSaveMsg(""); setSaveLoading(true);
    try {
      const res = await organization.update({ organizationId: orgId, data: { name: editName, slug: editSlug } });
      if (res.error) throw new Error(res.error.message);
      setSaveMsg("Saved successfully");
      setOrg((o: any) => ({ ...o, name: editName, slug: editSlug }));
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e: any) {
      setSaveErr(e?.message ?? "Failed to save");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (!confirm(`Delete "${org?.name}"? This is irreversible.`)) return;
    await organization.delete({ organizationId: orgId });
    navigate({ to: "/organizations" as any });
  };

  if (loading) return (
    <div className="loading" style={{ padding: "40px 0", textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
  );

  if (!org) return (
    <div style={{ padding: 24 }}>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.82rem" }}>Organization not found.</p>
    </div>
  );

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "members", label: `Members (${members.length})`, icon: <Users size={13} /> },
    { key: "invitations", label: `Invitations (${invitations.filter(i => i.status === "pending").length})`, icon: <Mail size={13} /> },
    { key: "activity", label: "Activity", icon: <ClipboardList size={13} /> },
    { key: "settings", label: "Settings", icon: <Settings size={13} /> },
  ];

  return (
    <div className="animate-in" style={{ maxWidth: 760 }}>
      {showInvite && (
        <InviteModal orgId={orgId} onClose={() => setShowInvite(false)} onInvited={fetchOrg} />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost" style={{ fontSize: "0.76rem", marginBottom: 14 }}
          onClick={() => navigate({ to: "/organizations" as any })}>
          <ArrowLeft size={12} /> Organizations
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Org avatar square */}
          <div style={{
            width: 44, height: 44, borderRadius: 5, flexShrink: 0,
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "1.1rem",
            color: "var(--color-accent)",
          }}>
            {org.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="page-title">{org.name}</h1>
            {org.slug && <p className="page-subtitle" style={{ fontFamily: "var(--font-mono)" }}>{org.slug}</p>}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--color-border)" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: "0.76rem", fontWeight: 500,
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === t.key ? "var(--color-accent)" : "var(--color-text-tertiary)",
              borderBottom: activeTab === t.key ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: -1, transition: "color 0.15s",
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {activeTab === "members" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="panel-header">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-secondary)" }}>
              {members.length} member{members.length !== 1 ? "s" : ""}
            </span>
            <button className="btn btn-primary" style={{ fontSize: "0.76rem", padding: "5px 11px" }} onClick={() => setShowInvite(true)}>
              <UserPlus size={12} /> Invite
            </button>
          </div>
          {members.map((m: any, i: number) => (
            <div key={m.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
              borderBottom: i < members.length - 1 ? "1px solid var(--color-border)" : "none",
              transition: "background 0.1s",
            }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <UserAvatar src={(m.user as any)?.image ?? null} name={m.user?.name} size={30} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.84rem", fontWeight: 500, color: "var(--color-text-primary)" }}>{m.user?.name ?? "—"}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>{m.user?.email ?? "—"}</p>
              </div>
              {/* Role badge/selector */}
              <select
                value={m.role}
                onChange={e => handleChangeRole(m.id, e.target.value)}
                disabled={m.role === "owner"}
                style={{
                  ...roleBadgeStyle(m.role),
                  borderRadius: 3, padding: "3px 8px",
                  fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 600,
                  cursor: m.role === "owner" ? "default" : "pointer",
                  textTransform: "capitalize", appearance: "none",
                  background: roleBadgeStyle(m.role).background,
                }}
              >
                <option value="owner">owner</option>
                <option value="admin">admin</option>
                <option value="member">member</option>
              </select>
              {m.role !== "owner" && (
                <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }}
                  onClick={() => handleRemoveMember(m.id)} title="Remove member">
                  <UserMinus size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && <OrgAuditLog orgId={orgId} />}

      {/* Invitations tab */}
      {activeTab === "invitations" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="panel-header">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-secondary)" }}>Pending invitations</span>
            <button className="btn btn-primary" style={{ fontSize: "0.76rem", padding: "5px 11px" }} onClick={() => setShowInvite(true)}>
              <Mail size={12} /> Invite
            </button>
          </div>
          {invitations.length === 0 ? (
            <div className="empty-state">No pending invitations</div>
          ) : invitations.map((inv: any, i: number) => (
            <div key={inv.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
              borderBottom: i < invitations.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: inv.status !== "pending" ? 0.5 : 1,
            }}>
              <Mail size={13} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.83rem", color: "var(--color-text-primary)" }}>{inv.email}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
                  Invited as <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>{inv.role}</span>
                  {" · "}{inv.status}
                </p>
              </div>
              {inv.status === "pending" && (
                <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: "0.74rem", color: "var(--color-red)" }}
                  onClick={() => handleCancelInvite(inv.id)}>
                  <Trash2 size={12} /> Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Settings tab */}
      {activeTab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <p className="section-label">General</p>
            </div>
            <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: 14, padding: 18 }}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Slug</label>
                <input className="input" value={editSlug} onChange={e => setEditSlug(e.target.value)} />
              </div>
              {saveMsg && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)",
                  fontSize: "0.76rem", color: "var(--color-green)", background: "var(--color-green-dim)",
                  border: "1px solid rgba(52,211,153,0.2)", borderRadius: 4, padding: "8px 12px",
                }}><CheckCircle size={12} /> {saveMsg}</div>
              )}
              {saveErr && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)",
                  fontSize: "0.76rem", color: "var(--color-red)", background: "var(--color-red-dim)",
                  border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "8px 12px",
                }}><AlertCircle size={12} /> {saveErr}</div>
              )}
              <div>
                <button type="submit" className="btn btn-primary" disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>

          {/* Danger zone */}
          <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: "rgba(248,113,113,0.18)" }}>
            <div className="panel-header" style={{ borderBottomColor: "rgba(248,113,113,0.14)" }}>
              <p className="section-label" style={{ color: "var(--color-red)" }}>Danger zone</p>
            </div>
            <div style={{ padding: 18 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)", marginBottom: 14 }}>
                Deleting an organization is permanent and cannot be undone. All members and invitations will be removed.
              </p>
              <button className="btn btn-danger" onClick={handleDeleteOrg}>
                <Trash2 size={13} /> Delete organization
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

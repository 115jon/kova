import { organization } from "@/lib/auth-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, ArrowLeft, CheckCircle,
  Mail,
  Settings,
  Trash2, UserMinus, UserPlus, Users
} from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/organizations_/$orgId")({
  component: OrgDetailPage,
});

const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#818cf8",
  member: "#34d399",
};

type Tab = "members" | "invitations" | "settings";

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
      const res = await organization.inviteMember({
        email, role, organizationId: orgId,
      });
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
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: "var(--color-surface-800)",
        border: "1px solid var(--color-border)",
        borderRadius: 16, padding: 28, width: "100%", maxWidth: 420,
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 20 }}>Invite member</h2>
        <form onSubmit={handle} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Email</label>
            <input className="input" type="email" placeholder="colleague@example.com" value={email}
              onChange={e => setEmail(e.target.value)} autoFocus required />
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value as any)}
              style={{ appearance: "none" }}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: "0.8rem",
              display: "flex", alignItems: "center", gap: 6,
            }}><AlertCircle size={13} /> {error}</div>
          )}
          {success && (
            <div style={{
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 8, padding: "8px 12px", color: "#22c55e", fontSize: "0.8rem",
              display: "flex", alignItems: "center", gap: 6,
            }}><CheckCircle size={13} /> Invitation sent!</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
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

  // Settings state
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
      const res = await organization.update({
        organizationId: orgId,
        data: { name: editName, slug: editSlug },
      });
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
    <div style={{ padding: "40px 0", textAlign: "center" }}>
      <div className="loading" style={{ color: "#818cf8", fontSize: "0.9rem" }}>Loading…</div>
    </div>
  );

  if (!org) return (
    <div style={{ padding: 24 }}>
      <p style={{ color: "#f87171" }}>Organization not found.</p>
    </div>
  );

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "members", label: `Members (${members.length})`, icon: <Users size={14} /> },
    { key: "invitations", label: `Invitations (${invitations.filter(i => i.status === "pending").length})`, icon: <Mail size={14} /> },
    { key: "settings", label: "Settings", icon: <Settings size={14} /> },
  ];

  return (
    <div className="animate-in" style={{ maxWidth: 740 }}>
      {showInvite && (
        <InviteModal orgId={orgId} onClose={() => setShowInvite(false)} onInvited={fetchOrg} />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost" style={{ fontSize: "0.78rem", marginBottom: 12 }}
          onClick={() => navigate({ to: "/organizations" as any })}>
          <ArrowLeft size={13} /> Organizations
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "linear-gradient(135deg, #6366f1, #7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: "1.2rem", color: "#fff", flexShrink: 0,
          }}>
            {org.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
              {org.name}
            </h1>
            {org.slug && <p style={{ fontSize: "0.78rem", color: "#475569", fontFamily: "monospace" }}>{org.slug}</p>}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid var(--color-border)", paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", fontSize: "0.82rem", fontWeight: 500,
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === t.key ? "#818cf8" : "#64748b",
              borderBottom: activeTab === t.key ? "2px solid #818cf8" : "2px solid transparent",
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
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>{members.length} member{members.length !== 1 ? "s" : ""}</span>
            <button className="btn btn-primary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => setShowInvite(true)}>
              <UserPlus size={13} /> Invite
            </button>
          </div>
          {members.map((m: any, i: number) => (
            <div key={m.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 20px",
              borderBottom: i < members.length - 1 ? "1px solid var(--color-border)" : "none",
            }}>
              <div className="avatar" style={{ width: 32, height: 32, fontSize: "0.75rem", flexShrink: 0 }}>
                {m.user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.85rem", fontWeight: 500, color: "#e2e8f0" }}>{m.user?.name ?? "—"}</p>
                <p style={{ fontSize: "0.75rem", color: "#64748b" }}>{m.user?.email ?? "—"}</p>
              </div>
              {/* Role selector */}
              <select
                value={m.role}
                onChange={e => handleChangeRole(m.id, e.target.value)}
                disabled={m.role === "owner"}
                style={{
                  background: `${ROLE_COLORS[m.role] ?? "#64748b"}18`,
                  border: `1px solid ${ROLE_COLORS[m.role] ?? "#64748b"}30`,
                  color: ROLE_COLORS[m.role] ?? "#64748b",
                  borderRadius: 6, padding: "3px 8px", fontSize: "0.72rem", fontWeight: 600,
                  cursor: m.role === "owner" ? "default" : "pointer",
                  textTransform: "capitalize", appearance: "none",
                }}
              >
                <option value="owner">👑 owner</option>
                <option value="admin">🛡 admin</option>
                <option value="member">member</option>
              </select>
              {m.role !== "owner" && (
                <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "#ef4444" }}
                  onClick={() => handleRemoveMember(m.id)} title="Remove member">
                  <UserMinus size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Invitations tab */}
      {activeTab === "invitations" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Pending invitations</span>
            <button className="btn btn-primary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => setShowInvite(true)}>
              <Mail size={13} /> Invite
            </button>
          </div>
          {invitations.length === 0 ? (
            <div style={{ padding: "28px", textAlign: "center", color: "#475569", fontSize: "0.85rem" }}>
              No pending invitations
            </div>
          ) : invitations.map((inv: any, i: number) => (
            <div key={inv.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 20px",
              borderBottom: i < invitations.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: inv.status !== "pending" ? 0.5 : 1,
            }}>
              <Mail size={14} color="#64748b" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>{inv.email}</p>
                <p style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  Invited as <span style={{ color: ROLE_COLORS[inv.role] ?? "#64748b", fontWeight: 600 }}>{inv.role}</span>
                  {" · "}{inv.status}
                </p>
              </div>
              {inv.status === "pending" && (
                <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: "0.75rem", color: "#ef4444" }}
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
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "#e2e8f0", marginBottom: 16 }}>General</h3>
            <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Slug</label>
                <input className="input" value={editSlug} onChange={e => setEditSlug(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: "0.85rem" }} />
              </div>
              {saveMsg && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem",
                  color: "#22c55e", background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, padding: "8px 12px",
                }}><CheckCircle size={13} /> {saveMsg}</div>
              )}
              {saveErr && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem",
                  color: "#f87171", background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "8px 12px",
                }}><AlertCircle size={13} /> {saveErr}</div>
              )}
              <div>
                <button type="submit" className="btn btn-primary" disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>

          {/* Danger zone */}
          <div className="card" style={{ padding: 20, borderColor: "rgba(239,68,68,0.2)" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f87171", marginBottom: 8 }}>Danger zone</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 16 }}>
              Deleting an organization is permanent and cannot be undone. All members and invitations will be removed.
            </p>
            <button className="btn btn-danger" onClick={handleDeleteOrg}>
              <Trash2 size={13} /> Delete organization
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

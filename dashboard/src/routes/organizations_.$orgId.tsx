import { AvatarUpload } from "@/components/AvatarUpload";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { OrgAvatar } from "@/components/OrgAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { organization } from "@/lib/auth-client";
import { relativeTime } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, ArrowLeft,
  CheckCircle,
  ClipboardList,
  Mail,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2, UserMinus, UserPlus, Users, UsersRound, X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/organizations_/$orgId")({
  component: OrgDetailPage,
});

type Tab = "members" | "invitations" | "teams" | "roles" | "activity" | "settings";

// ── Role badge styling ────────────────────────────────────────────────────────

function roleBadgeStyle(role: string): React.CSSProperties {
  if (role === "owner") return { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", color: "var(--color-amber)" };
  if (role === "admin") return { background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)", color: "var(--color-accent)" };
  return { background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" };
}

// ── Shared inline error / success banners ─────────────────────────────────────

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
      borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
      color: "var(--color-red)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
    }}>
      <AlertCircle size={12} /> {msg}
    </div>
  );
}

function OkBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
      borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
      color: "var(--color-green)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
    }}>
      <CheckCircle size={12} /> {msg}
    </div>
  );
}

// ── Invite Member Modal ───────────────────────────────────────────────────────

function InviteModal({ orgId, teams, onClose, onInvited }: {
  orgId: string;
  teams: any[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [teamId, setTeamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const payload: any = { email, role, organizationId: orgId };
      if (teamId) payload.teamId = teamId;
      const res = await organization.inviteMember(payload);
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
    <Modal onClose={onClose} maxWidth={420}>
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
        {teams.length > 0 && (
          <div className="form-group">
            <label className="form-label">Assign to team <span style={{ color: "var(--color-text-tertiary)" }}>(optional)</span></label>
            <select className="input" value={teamId} onChange={e => setTeamId(e.target.value)}
              style={{ appearance: "none", cursor: "pointer" }}>
              <option value="">No team</option>
              {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {error && <ErrBanner msg={error} />}
        {success && <OkBanner msg="Invitation sent!" />}
        <div className="modal-footer" style={{ border: "none", padding: 0 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}
            disabled={loading || !email || success}>
            <Mail size={13} /> {loading ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Create Team Modal ─────────────────────────────────────────────────────────

function CreateTeamModal({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await organization.createTeam({ name, organizationId: orgId });
      if (res.error) throw new Error(res.error.message);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create team");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth={380}>
      <div className="modal-header">
        <p className="panel-title">New team</p>
        <button className="btn btn-ghost" style={{ padding: 5, marginLeft: "auto" }} onClick={onClose}><X size={13} /></button>
      </div>
      <form onSubmit={handle} className="modal-body">
        <div className="form-group">
          <label className="form-label">Team name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frontend, Platform…" autoFocus required />
        </div>
        {error && <ErrBanner msg={error} />}
        <div className="modal-footer" style={{ border: "none", padding: 0 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={loading || !name}>
            <Plus size={13} /> {loading ? "Creating…" : "Create team"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Add Team Member Modal (multi-select + avatars) ───────────────────────────

function AddTeamMemberModal({ teamId, orgId, members, currentTeamUserIds, onClose, onAdded }: {
  teamId: string;
  orgId: string;
  members: any[];
  currentTeamUserIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  // Filter out members already in this team
  const available = members.filter((m: any) => {
    const uid = m.userId ?? m.user?.id ?? m.id;
    return !currentTeamUserIds.has(uid);
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = (userId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected.size) return;
    setError(""); setLoading(true);
    try {
      await Promise.all(
        Array.from(selected).map(userId =>
          organization.addTeamMember({ teamId, userId, organizationId: orgId })
        )
      );
      onAdded();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add members");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth={420}>
      <div className="modal-header">
        <p className="panel-title">Add members to team</p>
        <button className="btn btn-ghost" style={{ padding: 5, marginLeft: "auto" }} onClick={onClose}><X size={13} /></button>
      </div>
      <form onSubmit={handle} className="modal-body">
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", marginBottom: 12 }}>
          Select one or more members to add:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
          {available.length === 0 && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)" }}>
              {members.length === 0 ? "No org members to add." : "All members are already in this team."}
            </p>
          )}
          {available.map((m: any) => {
            const uid = m.userId ?? m.user?.id ?? m.id;
            const checked = selected.has(uid);
            return (
              <label key={m.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                background: checked ? "var(--color-accent-dim)" : "transparent",
                border: checked ? "1px solid rgba(59,130,246,0.25)" : "1px solid transparent",
                transition: "background 0.12s, border 0.12s",
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(uid)}
                  style={{ accentColor: "var(--color-accent)", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                <UserAvatar src={(m.user as any)?.image ?? null} name={m.user?.name ?? uid} size={28} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", fontWeight: 500, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.user?.name ?? "—"}
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.user?.email ?? uid}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
        {error && <ErrBanner msg={error} />}
        <div className="modal-footer" style={{ border: "none", padding: 0 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={loading || !selected.size}>
            <UserPlus size={13} /> {loading ? "Adding…" : `Add ${selected.size > 0 ? `(${selected.size})` : ""}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Create Role Modal ─────────────────────────────────────────────────────────

const PERMISSION_RESOURCES = [
  { resource: "organization", actions: ["update", "delete"] },
  { resource: "member", actions: ["create", "update", "delete"] },
  { resource: "invitation", actions: ["create", "cancel"] },
  { resource: "project", actions: ["create", "update", "delete", "view"] },
  { resource: "billing", actions: ["read", "manage"] },
  { resource: "deploy", actions: ["trigger", "rollback"] },
] as const;

type PermMap = Record<string, string[]>;

function CreateRoleModal({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: () => void }) {
  const [roleName, setRoleName] = useState("");
  const [perms, setPerms] = useState<PermMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = (resource: string, action: string) => {
    setPerms(prev => {
      const existing = prev[resource] ?? [];
      const next = existing.includes(action)
        ? existing.filter(a => a !== action)
        : [...existing, action];
      return { ...prev, [resource]: next };
    });
  };

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await (organization as any).createOrgRole({ role: roleName, permission: perms, organizationId: orgId });
      if (res.error) throw new Error(res.error.message);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create role");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth={480}>
      <div className="modal-header">
        <p className="panel-title">New role</p>
        <button className="btn btn-ghost" style={{ padding: 5, marginLeft: "auto" }} onClick={onClose}><X size={13} /></button>
      </div>
      <form onSubmit={handle} className="modal-body" style={{ gap: 14 }}>
        <div className="form-group">
          <label className="form-label">Role name</label>
          <input className="input" value={roleName} onChange={e => setRoleName(e.target.value)}
            placeholder="e.g. billing-manager, deployer…" autoFocus required />
        </div>
        <div className="form-group">
          <label className="form-label">Permissions</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PERMISSION_RESOURCES.map(({ resource, actions }) => (
              <div key={resource}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 5, textTransform: "lowercase" }}>
                  {resource}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {actions.map(action => {
                    const checked = (perms[resource] ?? []).includes(action);
                    return (
                      <label key={action} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(resource, action)}
                          style={{ accentColor: "var(--color-accent)", width: 13, height: 13, cursor: "pointer" }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: checked ? "var(--color-accent)" : "var(--color-text-secondary)" }}>
                          {action}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrBanner msg={error} />}
        <div className="modal-footer" style={{ border: "none", padding: 0 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={loading || !roleName}>
            <Shield size={13} /> {loading ? "Creating…" : "Create role"}
          </button>
        </div>
      </form>
    </Modal>
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
      const res = await fetch(`/api/admin/audit/logs?${params}`, { credentials: "include" });
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

// ── Teams Tab ─────────────────────────────────────────────────────────────────

function TeamsTab({ orgId, members }: { orgId: string; members: any[] }) {
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [addToTeam, setAddToTeam] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  const fetchTeams = useCallback(async () => {
    setLoading(true); setError("");
    // Build a lookup map from userId -> org member (for enriching team member rows with user data)
    const memberByUserId = Object.fromEntries(members.map((m: any) => [m.userId, m]));
    try {
      const res = await fetch(
        `/api/auth/organization/list-teams?organizationId=${orgId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to load teams (${res.status})`);
      const list: any[] = await res.json();
      setTeams(list);
      const entries = await Promise.all(
        list.map(async (t: any) => {
          const r = await fetch(
            `/api/auth/organization/list-team-members?teamId=${t.id}`,
            { credentials: "include" }
          );
          const rawRows: any[] = r.ok ? await r.json() : [];
          // Enrich: BA only returns { id, teamId, userId, createdAt } — no nested user.
          // Cross-reference with the org members array to get name/email/image.
          const enriched = (Array.isArray(rawRows) ? rawRows : []).map((tm: any) => ({
            ...tm,
            user: memberByUserId[tm.userId]?.user ?? null,
          }));
          return [t.id, enriched] as [string, any[]];
        })
      );
      setTeamMembersMap(Object.fromEntries(entries));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [orgId, members]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const handleRemoveTeam = (teamId: string, teamName: string) => {
    setConfirmState({
      title: `Delete team "${teamName}"?`,
      body: "All team members will be removed from this team. This cannot be undone.",
      confirmLabel: "Delete team",
      onConfirm: async () => {
        setConfirmState(null);
        await organization.removeTeam({ teamId, organizationId: orgId });
        fetchTeams();
      },
    });
  };

  const handleRemoveTeamMember = (teamId: string, userId: string, name: string) => {
    setConfirmState({
      title: "Remove from team?",
      body: `${name} will be removed from this team.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        setConfirmState(null);
        await organization.removeTeamMember({ teamId, userId, organizationId: orgId });
        fetchTeams();
      },
    });
  };

  if (loading) return <div className="loading empty-state" style={{ fontSize: "0.78rem" }}>Loading teams…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
      {showCreate && (
        <CreateTeamModal orgId={orgId} onClose={() => setShowCreate(false)} onCreated={fetchTeams} />
      )}
      {addToTeam && (
        <AddTeamMemberModal
          teamId={addToTeam}
          orgId={orgId}
          members={members}
          currentTeamUserIds={new Set((teamMembersMap[addToTeam] ?? []).map((tm: any) => tm.userId))}
          onClose={() => setAddToTeam(null)}
          onAdded={fetchTeams}
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" style={{ fontSize: "0.76rem", padding: "5px 11px" }} onClick={() => setShowCreate(true)}>
          <Plus size={12} /> New team
        </button>
      </div>

      {error && <ErrBanner msg={error} />}

      {teams.length === 0 ? (
        <div className="card empty-state">
          <UsersRound size={18} color="var(--color-text-tertiary)" strokeWidth={1.5} style={{ marginBottom: 10 }} />
          <p>No teams yet. Create one to start grouping members.</p>
        </div>
      ) : (
        teams.map((team: any) => {
          const tms: any[] = teamMembersMap[team.id] ?? [];
          return (
            <div key={team.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="panel-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <UsersRound size={13} color="var(--color-accent)" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {team.name}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "0.67rem", color: "var(--color-text-tertiary)",
                    background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                    borderRadius: 3, padding: "1px 6px",
                  }}>
                    {tms.length} member{tms.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: "0.73rem", padding: "4px 9px" }}
                    onClick={() => setAddToTeam(team.id)}>
                    <UserPlus size={11} /> Add
                  </button>
                  <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }}
                    onClick={() => handleRemoveTeam(team.id, team.name)} title="Delete team">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {tms.length === 0 ? (
                <div style={{ padding: "14px 18px", fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-tertiary)" }}>
                  No members yet.
                </div>
              ) : (
                tms.map((tm: any, i: number) => (
                  <div key={tm.id} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 18px",
                    borderTop: i === 0 ? "1px solid var(--color-border)" : undefined,
                    borderBottom: i < tms.length - 1 ? "1px solid var(--color-border)" : undefined,
                    transition: "background 0.1s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <UserAvatar src={(tm.user as any)?.image ?? null} name={tm.user?.name ?? tm.userId} size={28} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", fontWeight: 500, color: "var(--color-text-primary)" }}>{tm.user?.name ?? "—"}</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.69rem", color: "var(--color-text-tertiary)" }}>{tm.user?.email ?? tm.userId}</p>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }}
                      onClick={() => handleRemoveTeamMember(team.id, tm.userId, tm.user?.name ?? tm.userId)}
                      title="Remove from team">
                      <UserMinus size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Roles Tab (Dynamic RBAC) ──────────────────────────────────────────────────

function PermBadge({ resource, actions }: { resource: string; actions: string[] }) {
  if (!actions.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6, marginBottom: 4 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>{resource}:</span>
      {actions.map(a => (
        <span key={a} style={{
          fontFamily: "var(--font-mono)", fontSize: "0.66rem", fontWeight: 600,
          background: "var(--color-accent-dim)", color: "var(--color-accent)",
          border: "1px solid rgba(59,130,246,0.18)", borderRadius: 3, padding: "1px 5px",
        }}>{a}</span>
      ))}
    </span>
  );
}

function RolesTab({ orgId }: { orgId: string }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true); setError("");
    try {
      // list-roles is a GET endpoint
      const res = await fetch(
        `/api/auth/organization/list-roles?organizationId=${orgId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to load roles (${res.status})`);
      const data = await res.json();
      setRoles(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const handleDeleteRole = (roleId: string, roleName: string) => {
    setConfirmState({
      title: `Delete role "${roleName}"?`,
      body: "Members assigned this role will fall back to their base org role. This cannot be undone.",
      confirmLabel: "Delete role",
      onConfirm: async () => {
        setConfirmState(null);
        await (organization as any).deleteOrgRole({ roleId, organizationId: orgId });
        fetchRoles();
      },
    });
  };

  if (loading) return <div className="loading empty-state" style={{ fontSize: "0.78rem" }}>Loading roles…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
      {showCreate && (
        <CreateRoleModal orgId={orgId} onClose={() => setShowCreate(false)} onCreated={fetchRoles} />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)", maxWidth: 420 }}>
          Custom roles let you define fine-grained permissions for org members beyond the built-in owner / admin / member hierarchy.
        </p>
        <button className="btn btn-primary" style={{ fontSize: "0.76rem", padding: "5px 11px", flexShrink: 0 }} onClick={() => setShowCreate(true)}>
          <Shield size={12} /> New role
        </button>
      </div>

      {error && <ErrBanner msg={error} />}

      {roles.length === 0 ? (
        <div className="card empty-state">
          <Shield size={18} color="var(--color-text-tertiary)" strokeWidth={1.5} style={{ marginBottom: 10 }} />
          <p>No custom roles yet. Create one to define granular permissions.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {roles.map((role: any, i: number) => {
            const permsObj: PermMap = (() => {
              try { return typeof role.permissions === "string" ? JSON.parse(role.permissions) : role.permissions ?? {}; }
              catch { return {}; }
            })();
            return (
              <div key={role.id} style={{
                padding: "13px 18px",
                borderBottom: i < roles.length - 1 ? "1px solid var(--color-border)" : undefined,
                transition: "background 0.1s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Shield size={12} color="var(--color-accent)" />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
                      {role.role}
                    </span>
                  </div>
                  <button className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }}
                    onClick={() => handleDeleteRole(role.id, role.role)} title="Delete role">
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {Object.entries((() => { try { return typeof role.permission === "string" ? JSON.parse(role.permission) : role.permission ?? {}; } catch { return {}; } })()).map(([resource, actions]) => (
                    <PermBadge key={resource} resource={resource} actions={actions as string[]} />
                  ))}
                  {Object.keys((() => { try { return typeof role.permission === "string" ? JSON.parse(role.permission) : role.permission ?? {}; } catch { return {}; } })()).length === 0 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>No permissions assigned</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── LogoCard ──────────────────────────────────────────────────────────────────
// Self-contained card for the org logo in the Settings tab.
// Has its own loading/error/success state entirely decoupled from the General form.

interface LogoCardProps {
  orgId: string;
  /** Current logo URL, or null if none uploaded yet. */
  logo: string | null;
  /** Org name — used as the monogram fallback label inside OrgAvatar. */
  name: string;
  /** Called after a successful upload or removal with the new logo URL (or null). */
  onLogoChange: (newLogo: string | null) => void;
}

function LogoCard({ orgId, logo, name, onLogoChange }: LogoCardProps) {
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoErr, setLogoErr] = useState("");

  const clearFeedback = () => { setLogoMsg(""); setLogoErr(""); };

  const handleUploadSuccess = (imageUrl: string) => {
    clearFeedback();
    onLogoChange(imageUrl);
    setLogoMsg("Logo updated successfully");
    setTimeout(() => setLogoMsg(""), 3500);
  };

  const handleUploadError = (msg: string) => {
    clearFeedback();
    setLogoErr(msg);
  };

  const handleRemoveLogo = async () => {
    clearFeedback();
    setLogoRemoving(true);
    try {
      const res = await fetch(`/api/org/avatar/${orgId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        onLogoChange(null);
        setLogoMsg("Logo removed");
        setTimeout(() => setLogoMsg(""), 3500);
      } else {
        const body = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        setLogoErr(body.error ?? "Failed to remove logo");
      }
    } catch {
      setLogoErr("Network error — could not remove logo");
    } finally {
      setLogoRemoving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="panel-header">
        <p className="section-label">Logo</p>
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Single interactive element — hover to reveal camera icon, click to crop & upload */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <AvatarUpload
            src={logo}
            name={name}
            size={72}
            type="org"
            uploadUrl={`/api/org/avatar/${orgId}`}
            onSuccess={handleUploadSuccess}
            onError={handleUploadError}
          />
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
            Hover the logo to change it.<br />
            JPEG, PNG or WebP · Max 10 MB<br />
            Recommended 256 × 256 px
          </p>
        </div>

        {/* Feedback banners — scoped to this card only */}
        {logoMsg && <OkBanner msg={logoMsg} />}
        {logoErr && <ErrBanner msg={logoErr} />}

        {/* Remove action — only visible when a logo URL is set */}
        {logo && (
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={logoRemoving}
              onClick={handleRemoveLogo}
              style={{ fontSize: "0.77rem", color: "var(--color-red)", display: "flex", alignItems: "center", gap: 6 }}
            >
              <Trash2 size={12} />
              {logoRemoving ? "Removing…" : "Remove logo"}
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
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [showInvite, setShowInvite] = useState(false);

  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  const fetchOrg = async () => {
    setLoading(true);
    try {
      const [orgRes, membersRes, invitesRes, teamsRes] = await Promise.all([
        organization.getFullOrganization({ query: { organizationId: orgId } }),
        organization.listMembers({ query: { organizationId: orgId } }),
        organization.listInvitations({ query: { organizationId: orgId } }),
        // list-teams is a GET — call directly
        fetch(`/api/auth/organization/list-teams?organizationId=${orgId}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : []),
      ]);
      const orgData = orgRes.data;
      if (orgData) {
        setOrg(orgData);
        setEditName(orgData.name ?? "");
        setEditSlug(orgData.slug ?? "");
      }
      setMembers((membersRes.data as any)?.members ?? membersRes.data ?? []);
      setInvitations((invitesRes.data as any) ?? []);
      setTeams(Array.isArray(teamsRes) ? teamsRes : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrg(); }, [orgId]);

  const handleRemoveMember = (memberId: string, memberEmail: string) => {
    setConfirmState({
      title: "Remove member?",
      body: `${memberEmail} will lose access to this organization immediately.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        setConfirmState(null);
        await organization.removeMember({ memberIdOrEmail: memberId, organizationId: orgId });
        setMembers(m => m.filter(x => x.id !== memberId));
      },
    });
  };

  const handleChangeRole = async (memberId: string, role: string) => {
    await organization.updateMemberRole({ memberId, role, organizationId: orgId });
    setMembers(m => m.map(x => x.id === memberId ? { ...x, role } : x));
  };

  const handleCancelInvite = (inviteId: string, email: string) => {
    setConfirmState({
      title: "Cancel invitation?",
      body: `The invitation for ${email} will be revoked immediately.`,
      confirmLabel: "Cancel invite",
      onConfirm: async () => {
        setConfirmState(null);
        await organization.cancelInvitation({ invitationId: inviteId });
        setInvitations(i => i.filter(x => x.id !== inviteId));
      },
    });
  };

  const handleDeleteOrg = () => {
    setConfirmState({
      title: `Delete "${org?.name}"?`,
      body: "This will permanently delete the organization and all its members and data. This cannot be undone.",
      confirmLabel: "Delete organization",
      onConfirm: async () => {
        setConfirmState(null);
        await organization.delete({ organizationId: orgId });
        navigate({ to: "/organizations" as any });
      },
    });
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

  if (loading) return (
    <div className="loading" style={{ padding: "40px 0", textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
  );

  if (!org) return (
    <div style={{ padding: 24 }}>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.82rem" }}>Organization not found.</p>
    </div>
  );

  const pendingTeamCount = teams.length;
  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "members", label: `Members (${members.length})`, icon: <Users size={13} /> },
    { key: "invitations", label: `Invitations (${invitations.filter(i => i.status === "pending").length})`, icon: <Mail size={13} /> },
    { key: "teams", label: `Teams (${pendingTeamCount})`, icon: <UsersRound size={13} /> },
    { key: "roles", label: "Roles", icon: <Shield size={13} /> },
    { key: "activity", label: "Activity", icon: <ClipboardList size={13} /> },
    { key: "settings", label: "Settings", icon: <Settings size={13} /> },
  ];

  return (
    <div className="animate-in" style={{ maxWidth: 760 }}>
      {showInvite && (
        <InviteModal orgId={orgId} teams={teams} onClose={() => setShowInvite(false)} onInvited={fetchOrg} />
      )}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost" style={{ fontSize: "0.76rem", marginBottom: 14 }}
          onClick={() => navigate({ to: "/organizations" as any })}>
          <ArrowLeft size={12} /> Organizations
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Read-only logo in the header — upload lives in Settings tab */}
          <OrgAvatar
            name={org.name ?? "O"}
            logo={(org as any).logo ?? null}
            size={44}
          />
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
                  onClick={() => handleRemoveMember(m.id, m.user?.email ?? m.email ?? m.id)} title="Remove member">
                  <UserMinus size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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
                  {inv.teamId && <span> · team <span style={{ color: "var(--color-accent)" }}>{teams.find(t => t.id === inv.teamId)?.name ?? inv.teamId}</span></span>}
                  {" · "}{inv.status}
                </p>
              </div>
              {inv.status === "pending" && (
                <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: "0.74rem", color: "var(--color-red)" }}
                  onClick={() => handleCancelInvite(inv.id, inv.email)}>
                  <Trash2 size={12} /> Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Teams tab */}
      {activeTab === "teams" && <TeamsTab orgId={orgId} members={members} />}

      {/* Roles tab */}
      {activeTab === "roles" && <RolesTab orgId={orgId} />}

      {/* Activity tab */}
      {activeTab === "activity" && <OrgAuditLog orgId={orgId} />}

      {/* Settings tab */}
      {activeTab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <LogoCard
            orgId={orgId}
            logo={(org as any).logo ?? null}
            name={org.name ?? "O"}
            onLogoChange={(newLogo) => setOrg((o: any) => ({ ...o, logo: newLogo }))}
          />

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
              {saveMsg && <OkBanner msg={saveMsg} />}
              {saveErr && <ErrBanner msg={saveErr} />}
              <div>
                <button type="submit" className="btn btn-primary" disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>

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

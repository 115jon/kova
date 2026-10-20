import { AvatarUpload } from "@/components/AvatarUpload";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal, ModalHeader } from "@/components/Modal";
import { OrgAvatar } from "@/components/OrgAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { organization } from "@/lib/auth-client";
import { relativeTime, sentenceCase } from "@/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, ArrowLeft,
  CheckCircle,
  ClipboardList,
  Mail,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2, UserMinus, UserPlus, Users, UsersRound
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/organizations_/$orgId")({
  component: OrgDetailPage,
});

type Tab = "members" | "invitations" | "teams" | "roles" | "activity" | "settings";

// ── Shared inline error / success banners ─────────────────────────────────────

function ErrBanner({ msg }: { msg: string }) {
  return <p className="alert alert-danger" role="alert"><AlertCircle /> {msg}</p>;
}

function OkBanner({ msg }: { msg: string }) {
  return <p className="alert alert-success" role="status"><CheckCircle /> {msg}</p>;
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
      <ModalHeader
        title="Invite member"
        icon={<span className="icon-tile" aria-hidden="true"><Mail /></span>}
      />
      <form onSubmit={handle}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="invite-email">Email</label>
            <input id="invite-email" className="input" type="email" placeholder="colleague@example.com" value={email}
              onChange={e => setEmail(e.target.value)} autoFocus required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="invite-role">Role</label>
            <select id="invite-role" className="select" value={role} onChange={e => setRole(e.target.value as any)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {teams.length > 0 && (
            <div className="form-group">
              <label className="form-label" htmlFor="invite-team">Assign to team <span className="text-tertiary">(optional)</span></label>
              <select id="invite-team" className="select" value={teamId} onChange={e => setTeamId(e.target.value)}>
                <option value="">No team</option>
                {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {error && <ErrBanner msg={error} />}
          {success && <OkBanner msg="Invitation sent!" />}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !email || success}>
            <Mail /> {loading ? "Sending…" : "Send invite"}
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
      <ModalHeader
        title="New team"
        icon={<span className="icon-tile" aria-hidden="true"><UsersRound /></span>}
      />
      <form onSubmit={handle}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="team-name">Team name</label>
            <input id="team-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frontend, Platform…" autoFocus required />
          </div>
          {error && <ErrBanner msg={error} />}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !name}>
            <Plus /> {loading ? "Creating…" : "Create team"}
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
      <ModalHeader
        title="Add members to team"
        icon={<span className="icon-tile" aria-hidden="true"><UserPlus /></span>}
      />
      <form onSubmit={handle}>
        <div className="modal-body">
          <p className="text-secondary">Select one or more members to add.</p>
          <div className="stack-sm" style={{ maxHeight: 280, overflowY: "auto" }}>
            {available.length === 0 && (
              <p className="text-secondary">
                {members.length === 0 ? "No org members to add." : "All members are already in this team."}
              </p>
            )}
            {available.map((m: any) => {
              const uid = m.userId ?? m.user?.id ?? m.id;
              const checked = selected.has(uid);
              return (
                <label key={m.id} className="row" style={{
                  gap: 10, padding: "8px 10px", borderRadius: "var(--radius-md)", cursor: "pointer",
                  background: checked ? "var(--color-accent-soft)" : "transparent",
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(uid)} />
                  <UserAvatar src={(m.user as any)?.image ?? null} name={m.user?.name ?? uid} size={32} />
                  <div className="min-w-0">
                    <p className="text-strong truncate">{m.user?.name ?? "—"}</p>
                    <p className="text-mono text-sm text-tertiary truncate">{m.user?.email ?? uid}</p>
                  </div>
                </label>
              );
            })}
          </div>
          {error && <ErrBanner msg={error} />}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !selected.size}>
            <UserPlus /> {loading ? "Adding…" : `Add ${selected.size > 0 ? `(${selected.size})` : ""}`}
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
      <ModalHeader
        title="New role"
        icon={<span className="icon-tile" aria-hidden="true"><Shield /></span>}
      />
      <form onSubmit={handle}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="role-name">Role name</label>
            <input id="role-name" className="input" value={roleName} onChange={e => setRoleName(e.target.value)}
              placeholder="e.g. billing-manager, deployer…" autoFocus required />
          </div>
          <fieldset className="form-group" style={{ border: 0 }}>
            <legend className="form-label" style={{ marginBottom: 6 }}>Permissions</legend>
            <div className="stack">
              {PERMISSION_RESOURCES.map(({ resource, actions }) => (
                <div key={resource} className="stack-sm">
                  <p className="text-strong text-sm">{sentenceCase(resource)}</p>
                  <div className="row" style={{ flexWrap: "wrap", columnGap: 16 }}>
                    {actions.map(action => {
                      const checked = (perms[resource] ?? []).includes(action);
                      return (
                        <label key={action} className="row" style={{ gap: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggle(resource, action)} />
                          <span className={checked ? "text-sm text-strong" : "text-sm text-secondary"}>
                            {sentenceCase(action)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {error && <ErrBanner msg={error} />}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !roleName}>
            <Shield /> {loading ? "Creating…" : "Create role"}
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

type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

const ACTION_META: Record<string, { label: string; tone: BadgeTone }> = {
  "user.signIn": { label: "Signed in", tone: "info" },
  "user.signOut": { label: "Signed out", tone: "neutral" },
  "user.signUp": { label: "Signed up", tone: "success" },
  "apiKey.created": { label: "API key created", tone: "warning" },
  "apiKey.revoked": { label: "API key revoked", tone: "danger" },
  "member.invited": { label: "Member invited", tone: "info" },
  "member.joined": { label: "Member joined", tone: "info" },
  "member.removed": { label: "Member removed", tone: "danger" },
  "member.roleChanged": { label: "Role changed", tone: "warning" },
  "session.revoked": { label: "Session revoked", tone: "danger" },
  "admin.userBanned": { label: "User banned", tone: "danger" },
  "admin.userUnbanned": { label: "User unbanned", tone: "success" },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action];
  return <span className={`badge badge-${meta?.tone ?? "neutral"}`}>{meta?.label ?? action}</span>;
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
    <div className="stack">
      {error && <ErrBanner msg={error} />}

      <div className="card card-flush">
        <div className="panel-header">
          <h2 className="panel-title"><ClipboardList /> Recent activity</h2>
          <button type="button" className="btn btn-subtle btn-icon btn-sm" onClick={() => fetchLogs(true)} disabled={loading} title="Refresh" aria-label="Refresh activity">
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </div>

        {loading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading activity">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><ClipboardList /></span>
            <p className="empty-state-title">No activity yet</p>
            <p className="empty-state-body">Nothing has been recorded for this organization.</p>
          </div>
        ) : (
          <table className="data-table is-stackable">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Target</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(row => (
                <tr key={row.id}>
                  <td data-label="When" className="cell-meta">
                    <span title={new Date(row.createdAt).toLocaleString()}>
                      {relativeTime(new Date(row.createdAt).toISOString())}
                    </span>
                  </td>
                  <td data-label="Event">
                    <ActionBadge action={row.action} />
                  </td>
                  <td data-label="Actor">
                    <div className="row">
                      <UserAvatar src={row.actorImage ?? null} name={row.actorName ?? row.actor} size={24} />
                      <span className="truncate" style={{ maxWidth: 160 }}>
                        {row.actorName ?? row.actorEmail ?? row.actor}
                      </span>
                    </div>
                  </td>
                  <td data-label="Target">
                    {row.targetLabel
                      ? <span className="truncate" style={{ display: "block", maxWidth: 180 }}>{row.targetLabel}</span>
                      : row.targetId
                        ? <code>{row.targetId.slice(0, 10)}…</code>
                        : <span className="text-tertiary">—</span>}
                  </td>
                  <td data-label="IP" className="text-mono text-tertiary">
                    {row.ipAddress ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {nextCursor && !loading && (
          <div className="panel-footer" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchLogs(false)} disabled={loadingMore}>
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

  if (loading) return (
    <div className="card card-flush">
      <div className="skeleton-rows" role="status" aria-label="Loading teams">
        <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
      </div>
    </div>
  );

  return (
    <div className="stack">
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

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <Plus /> New team
        </button>
      </div>

      {error && <ErrBanner msg={error} />}

      {teams.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><UsersRound /></span>
            <p className="empty-state-title">No teams yet</p>
            <p className="empty-state-body">Create one to start grouping members.</p>
          </div>
        </div>
      ) : (
        teams.map((team: any) => {
          const tms: any[] = teamMembersMap[team.id] ?? [];
          return (
            <div key={team.id} className="card card-flush">
              <div className="panel-header">
                <div className="row">
                  <h3 className="panel-title"><UsersRound /> <span className="truncate">{team.name}</span></h3>
                  <span className="badge badge-neutral">
                    {tms.length} member{tms.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddToTeam(team.id)}>
                    <UserPlus /> Add
                  </button>
                  <button type="button" className="btn btn-danger btn-sm btn-icon"
                    onClick={() => handleRemoveTeam(team.id, team.name)} title="Delete team" aria-label={`Delete team ${team.name}`}>
                    <Trash2 />
                  </button>
                </div>
              </div>
              {tms.length === 0 ? (
                <div className="panel-body">
                  <p className="text-secondary">No members yet.</p>
                </div>
              ) : (
                tms.map((tm: any) => (
                  <div key={tm.id} className="list-row">
                    <UserAvatar src={(tm.user as any)?.image ?? null} name={tm.user?.name ?? tm.userId} size={32} />
                    <div className="list-row-main">
                      <p className="list-row-title truncate">{tm.user?.name ?? "—"}</p>
                      <p className="text-mono text-sm text-tertiary truncate">{tm.user?.email ?? tm.userId}</p>
                    </div>
                    <div className="list-row-actions">
                      <button type="button" className="btn btn-danger btn-sm btn-icon"
                        onClick={() => handleRemoveTeamMember(team.id, tm.userId, tm.user?.name ?? tm.userId)}
                        title="Remove from team" aria-label={`Remove ${tm.user?.name ?? tm.userId} from team`}>
                        <UserMinus />
                      </button>
                    </div>
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
    <span className="row" style={{ gap: 4 }}>
      <span className="text-sm text-tertiary">{sentenceCase(resource)}:</span>
      {actions.map(a => (
        <span key={a} className="badge badge-info">{sentenceCase(a)}</span>
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

  if (loading) return (
    <div className="card card-flush">
      <div className="skeleton-rows" role="status" aria-label="Loading roles">
        <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
      </div>
    </div>
  );

  return (
    <div className="stack">
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

      <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <p className="text-secondary" style={{ maxWidth: 480 }}>
          Custom roles let you define fine-grained permissions for org members beyond the built-in owner / admin / member hierarchy.
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <Shield /> New role
        </button>
      </div>

      {error && <ErrBanner msg={error} />}

      {roles.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Shield /></span>
            <p className="empty-state-title">No custom roles yet</p>
            <p className="empty-state-body">Create one to define granular permissions.</p>
          </div>
        </div>
      ) : (
        <div className="card card-flush">
          {roles.map((role: any) => {
            const rolePerms: Record<string, unknown> = (() => {
              try { return typeof role.permission === "string" ? JSON.parse(role.permission) : role.permission ?? {}; }
              catch { return {}; }
            })();
            const permEntries = Object.entries(rolePerms);
            return (
              <div key={role.id} className="list-row" style={{ alignItems: "flex-start" }}>
                <span className="icon-tile icon-tile-sm" aria-hidden="true"><Shield /></span>
                <div className="list-row-main">
                  <p className="list-row-title truncate">{role.role}</p>
                  <div className="row" style={{ flexWrap: "wrap", columnGap: 12, rowGap: 6, marginTop: 6 }}>
                    {permEntries.map(([resource, actions]) => (
                      <PermBadge key={resource} resource={resource} actions={actions as string[]} />
                    ))}
                    {permEntries.length === 0 && (
                      <span className="text-sm text-tertiary">No permissions assigned</span>
                    )}
                  </div>
                </div>
                <div className="list-row-actions">
                  <button type="button" className="btn btn-danger btn-sm btn-icon"
                    onClick={() => handleDeleteRole(role.id, role.role)} title="Delete role" aria-label={`Delete role ${role.role}`}>
                    <Trash2 />
                  </button>
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
    <div className="card card-flush">
      <div className="panel-header">
        <h2 className="panel-title">Logo</h2>
      </div>

      <div className="panel-body stack">
        {/* Single interactive element — hover to reveal camera icon, click to crop & upload */}
        <div className="row" style={{ gap: 16 }}>
          <AvatarUpload
            src={logo}
            name={name}
            size={72}
            type="org"
            uploadUrl={`/api/org/avatar/${orgId}`}
            onSuccess={handleUploadSuccess}
            onError={handleUploadError}
          />
          <p className="text-sm text-tertiary">
            Hover the logo to change it.<br />
            JPEG, PNG or WebP · Max 10 MB<br />
            Recommended 256 × 256 px
          </p>
        </div>

        {/* Feedback banners — scoped to this card only */}
        {logoMsg && <OkBanner msg={logoMsg} />}
        {logoErr && <ErrBanner msg={logoErr} />}
      </div>

      {/* Remove action — only visible when a logo URL is set */}
      {logo && (
        <div className="panel-footer">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={logoRemoving}
            onClick={handleRemoveLogo}
          >
            <Trash2 />
            {logoRemoving ? "Removing…" : "Remove logo"}
          </button>
        </div>
      )}
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
    <div role="status" aria-label="Loading organization">
      <span className="skeleton" style={{ height: 14, width: 140, marginBottom: 16 }} />
      <div className="row" style={{ gap: 14, marginBottom: 24 }}>
        <span className="skeleton" style={{ height: 48, width: 48, flexShrink: 0 }} />
        <span className="skeleton" style={{ height: 28, width: 220 }} />
      </div>
      <div className="card card-flush">
        <div className="skeleton-rows">
          <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
        </div>
      </div>
    </div>
  );

  if (!org) return (
    <div>
      <Link className="back-link" to={"/organizations" as any}><ArrowLeft /> Back to organizations</Link>
      <p className="alert alert-danger" role="alert"><AlertCircle /> Organization not found.</p>
    </div>
  );

  const pendingTeamCount = teams.length;
  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "members", label: `Members (${members.length})`, icon: <Users size={14} /> },
    { key: "invitations", label: `Invitations (${invitations.filter(i => i.status === "pending").length})`, icon: <Mail size={14} /> },
    { key: "teams", label: `Teams (${pendingTeamCount})`, icon: <UsersRound size={14} /> },
    { key: "roles", label: "Roles", icon: <Shield size={14} /> },
    { key: "activity", label: "Activity", icon: <ClipboardList size={14} /> },
    { key: "settings", label: "Settings", icon: <Settings size={14} /> },
  ];

  return (
    <div>
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

      <Link className="back-link" to={"/organizations" as any}><ArrowLeft /> Back to organizations</Link>

      <header className="page-header">
        <div className="page-header-main">
          <div className="row" style={{ gap: 14 }}>
            {/* Read-only logo in the header — upload lives in Settings tab */}
            <OrgAvatar
              name={org.name ?? "O"}
              logo={(org as any).logo ?? null}
              size={48}
            />
            <div className="min-w-0">
              <p className="section-label">Organization</p>
              <h1 className="page-title">{org.name}</h1>
              {org.slug && <p className="page-subtitle"><span className="text-mono">{org.slug}</span></p>}
            </div>
          </div>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Organization sections" style={{ marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className="tab"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {activeTab === "members" && (
        <div className="card card-flush">
          <div className="panel-header">
            <h2 className="panel-title tabular">
              <Users /> {members.length} member{members.length !== 1 ? "s" : ""}
            </h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>
              <UserPlus /> Invite
            </button>
          </div>
          {members.map((m: any) => (
            <div key={m.id} className="list-row">
              <UserAvatar src={(m.user as any)?.image ?? null} name={m.user?.name} size={40} />
              <div className="list-row-main">
                <p className="list-row-title truncate">{m.user?.name ?? "—"}</p>
                <p className="text-mono text-sm text-tertiary truncate">{m.user?.email ?? "—"}</p>
              </div>
              <div className="list-row-actions">
                <select
                  className="select"
                  aria-label={`Role for ${m.user?.name ?? m.user?.email ?? "member"}`}
                  value={m.role}
                  onChange={e => handleChangeRole(m.id, e.target.value)}
                  disabled={m.role === "owner"}
                  style={{ width: "auto", height: 32 }}
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
                {m.role !== "owner" && (
                  <button type="button" className="btn btn-danger btn-sm btn-icon"
                    onClick={() => handleRemoveMember(m.id, m.user?.email ?? m.email ?? m.id)}
                    title="Remove member" aria-label={`Remove ${m.user?.name ?? m.user?.email ?? "member"}`}>
                    <UserMinus />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invitations tab */}
      {activeTab === "invitations" && (
        <div className="card card-flush">
          <div className="panel-header">
            <h2 className="panel-title"><Mail /> Pending invitations</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowInvite(true)}>
              <Mail /> Invite
            </button>
          </div>
          {invitations.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true"><Mail /></span>
              <p className="empty-state-title">No pending invitations</p>
              <p className="empty-state-body">Invite someone to give them access to this organization.</p>
            </div>
          ) : invitations.map((inv: any) => (
            <div key={inv.id} className="list-row">
              <span className="icon-tile tone-neutral" aria-hidden="true"><Mail /></span>
              <div className="list-row-main">
                <p className="list-row-title truncate">{inv.email}</p>
                <p className="text-sm text-secondary">
                  Invited as <span className="text-strong">{sentenceCase(inv.role)}</span>
                  {inv.teamId && <span> · Team <span className="text-strong">{teams.find(t => t.id === inv.teamId)?.name ?? inv.teamId}</span></span>}
                </p>
              </div>
              <div className="list-row-actions">
                <span className={`badge ${inv.status === "pending" ? "badge-warning" : inv.status === "accepted" ? "badge-success" : "badge-neutral"}`}>
                  {sentenceCase(inv.status)}
                </span>
                {inv.status === "pending" && (
                  <button type="button" className="btn btn-danger btn-sm"
                    onClick={() => handleCancelInvite(inv.id, inv.email)}>
                    <Trash2 /> Cancel
                  </button>
                )}
              </div>
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
        <div className="stack">
          <LogoCard
            orgId={orgId}
            logo={(org as any).logo ?? null}
            name={org.name ?? "O"}
            onLogoChange={(newLogo) => setOrg((o: any) => ({ ...o, logo: newLogo }))}
          />

          <div className="card card-flush">
            <div className="panel-header">
              <h2 className="panel-title"><Settings /> General</h2>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div className="panel-body stack">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="org-edit-name">Name</label>
                    <input id="org-edit-name" className="input" value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="org-edit-slug">Slug</label>
                    <input id="org-edit-slug" className="input input-mono" value={editSlug} onChange={e => setEditSlug(e.target.value)} />
                  </div>
                </div>
                {saveMsg && <OkBanner msg={saveMsg} />}
                {saveErr && <ErrBanner msg={saveErr} />}
              </div>
              <div className="panel-footer">
                <button type="submit" className="btn btn-primary" disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>

          <div className="card card-flush">
            <div className="panel-header">
              <h2 className="panel-title" style={{ color: "var(--color-danger-text)" }}>
                <AlertCircle /> Danger zone
              </h2>
            </div>
            <div className="panel-body">
              <p className="text-secondary">
                Deleting an organization is permanent and cannot be undone. All members and invitations will be removed.
              </p>
            </div>
            <div className="panel-footer">
              <button type="button" className="btn btn-danger" onClick={handleDeleteOrg}>
                <Trash2 /> Delete organization
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

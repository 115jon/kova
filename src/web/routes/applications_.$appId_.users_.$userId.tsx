import { AvatarUpload } from "@/components/AvatarUpload";
import { ProviderIcon } from "@/components/BrandIcons";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  useAppMemberAvatarRemove,
  useAppMemberAvatarUpload,
  useAppMemberBan,
  useAppMemberDetail,
  useAppMemberImpersonate,
  useAppMemberLock,
  useAppMemberRemove,
  useAppMemberRoleChange,
  useAppMemberUnban,
  useAppMemberUnlock,
} from "@/hooks/use-app-members";
import type { ProviderId } from "@/lib/providers";
import { relativeTime } from "@/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle,
  Clock,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserX,
} from "lucide-react";
import { useState } from "react";

// Flat route — /applications/$appId/users/$userId (NOT nested inside applications_.$appId.tsx)
export const Route = createFileRoute("/applications_/$appId_/users_/$userId")({
  component: AppMemberDetailPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Password",
  google: "Google",
  discord: "Discord",
  github: "GitHub",
  twitter: "Twitter / X",
  microsoft: "Microsoft",
};

function actionLabel(action: string): { label: string; color: string } {
  if (action.startsWith("user.signIn")) return { label: "Signed in", color: "var(--color-success-text)" };
  if (action.startsWith("user.signOut")) return { label: "Signed out", color: "var(--color-text-tertiary)" };
  if (action.startsWith("user.signUp")) return { label: "Account created", color: "var(--color-accent-text)" };
  if (action.startsWith("user.password")) return { label: "Password changed", color: "var(--color-warning-text)" };
  if (action.startsWith("admin.userBanned")) return { label: "Banned", color: "var(--color-danger-text)" };
  if (action.startsWith("admin.userUnbanned")) return { label: "Unbanned", color: "var(--color-success-text)" };
  if (action.startsWith("admin.userLocked")) return { label: "Locked", color: "var(--color-warning-text)" };
  if (action.startsWith("admin.userUnlocked")) return { label: "Unlocked", color: "var(--color-success-text)" };
  if (action.startsWith("admin.userImpersonated")) return { label: "Impersonated", color: "var(--color-accent-text)" };
  return { label: action, color: "var(--color-text-secondary)" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, tone = "" }: {
  icon: React.ReactNode; label: string; value: string | number; tone?: string;
}) {
  return (
    <div className="card stat-card">
      <span className={`icon-tile ${tone}`} aria-hidden="true">{icon}</span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
      </div>
    </div>
  );
}

function AdminAction({ label, icon, danger = false, disabled = false, onClick }: {
  label: string; icon: React.ReactNode; danger?: boolean;
  disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn btn-block ${danger ? "btn-danger" : "btn-secondary"}`}
      style={{ justifyContent: "flex-start" }}
      disabled={disabled}
      onClick={onClick}
    >
      {icon} {label}
    </button>
  );
}

// 52-week contribution heatmap
function ActivityHeatmap({ hist }: { hist: Record<string, number> }) {
  const weeks: { date: string; count: number }[][] = [];
  const today = new Date();
  // Build 52 weeks of days from 364 days ago up to today
  for (let w = 51; w >= 0; w--) {
    const week: { date: string; count: number }[] = [];
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - (w * 7 + d));
      const key = dt.toISOString().slice(0, 10);
      week.push({ date: key, count: hist[key] ?? 0 });
    }
    weeks.push(week);
  }

  const max = Math.max(1, ...Object.values(hist));
  const cellColor = (count: number) => {
    if (count === 0) return "var(--color-surface-raised)";
    const intensity = Math.ceil((count / max) * 4);
    const pct = [25, 45, 70, 100][intensity - 1];
    return `color-mix(in oklab, var(--color-accent) ${pct}%, var(--color-surface-raised))`;
  };

  return (
    <section className="card card-flush" aria-labelledby="member-activity-heat">
      <div className="panel-header">
        <h2 className="panel-title" id="member-activity-heat"><Activity /> Activity — past 52 weeks</h2>
      </div>
      <div className="panel-body" style={{ display: "flex", gap: 3, overflowX: "auto" }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {week.map(day => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} event${day.count !== 1 ? "s" : ""}`}
                style={{
                  width: 11, height: 11, borderRadius: 2,
                  background: cellColor(day.count),
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AppMemberDetailPage() {
  const { appId, userId } = Route.useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useAppMemberDetail(appId, userId);

  // Mutations
  const avatarUpload = useAppMemberAvatarUpload();
  const avatarRemove = useAppMemberAvatarRemove();
  const roleChange = useAppMemberRoleChange();
  const ban = useAppMemberBan();
  const unban = useAppMemberUnban();
  const lock = useAppMemberLock();
  const unlock = useAppMemberUnlock();
  const remove = useAppMemberRemove();
  const impersonate = useAppMemberImpersonate();

  const anyMutPending =
    avatarUpload.isPending || avatarRemove.isPending || roleChange.isPending ||
    ban.isPending || unban.isPending || lock.isPending || unlock.isPending ||
    remove.isPending;

  // Local UI state
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [impersonateResult, setImpersonateResult] = useState<{ token: string; expiresAt: number } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  const withConfirm = (title: string, body: string, confirmLabel: string, fn: () => void) => {
    setConfirmState({ title, body, confirmLabel, onConfirm: () => { setConfirmState(null); fn(); } });
  };

  const actionError =
    roleChange.error?.message ?? ban.error?.message ?? unban.error?.message ??
    lock.error?.message ?? unlock.error?.message ?? remove.error?.message ??
    impersonate.error?.message ?? "";

  const actionSuccess =
    (!roleChange.isPending && roleChange.isSuccess) ||
    (!ban.isPending && ban.isSuccess) ||
    (!unban.isPending && unban.isSuccess) ||
    (!lock.isPending && lock.isSuccess) ||
    (!unlock.isPending && unlock.isSuccess);

  // Loading / error
  if (isLoading) {
    return (
      <div className="stack" style={{ maxWidth: 900 }} role="status" aria-label="Loading member">
        <span className="skeleton" style={{ height: 14, width: 100 }} />
        <span className="skeleton" style={{ height: 116, borderRadius: "var(--radius-lg)" }} />
        <span className="skeleton" style={{ height: 220, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <Link to="/applications/$appId" params={{ appId }} className="back-link">
          <ArrowLeft /> Back to app
        </Link>
        <p className="alert alert-danger" role="alert">
          <AlertCircle /> {error?.message ?? "Member not found"}
        </p>
      </div>
    );
  }

  const { member, accounts, activeSessionCount, recentActivity, activityHist } = data;
  const isLocked = member.banned && member.banReason === "__locked__";

  return (
    <div style={{ maxWidth: 900 }}>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          loading={anyMutPending}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}

      <Link to="/applications/$appId" params={{ appId }} className="back-link">
        <ArrowLeft /> Back to app
      </Link>

      {/* ── Hero header ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
        <AvatarUpload
          src={localImage ?? member.image}
          name={member.name ?? member.email ?? "?"}
          size={68}
          uploadUrl={`/api/admin/apps/${appId}/users/${userId}/avatar`}
          onSuccess={(url) => setLocalImage(url)}
          onError={(msg) => console.error("Avatar upload error:", msg)}
        />

        <div className="min-w-0" style={{ flex: "1 1 160px" }}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <h1 className="page-title">{member.name ?? "—"}</h1>
            {member.role === "owner" && (
              <span className="badge badge-info"><ShieldCheck /> Owner</span>
            )}
            {member.role === "admin" && (
              <span className="badge badge-info"><Shield /> Admin</span>
            )}
            {isLocked && (
              <span className="badge badge-warning"><Lock /> Locked</span>
            )}
            {member.banned && !isLocked && (
              <span className="badge badge-danger"><Ban /> Banned</span>
            )}
            {!member.emailVerified && (
              <span className="badge badge-warning">Unverified</span>
            )}
          </div>

          <p className="page-subtitle text-mono">{member.email}</p>

          {member.username && (
            <p className="text-mono text-tertiary" style={{ marginTop: 4 }}>
              @{member.username}
            </p>
          )}

          <div className="row" style={{ flexWrap: "wrap", gap: "4px 16px", marginTop: 12 }}>
            <span className="text-sm text-tertiary">
              ID <code>{member.userId}</code>
            </span>
            <span className="text-sm text-tertiary">
              Joined {relativeTime(new Date(member.joinedAt).toISOString())}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          onClick={() => void refetch()}
          title="Refresh"
          aria-label="Refresh member"
        >
          <RefreshCw />
        </button>
      </div>

      {/* ── Two-column layout ─────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>

        {/* Left column */}
        <div className="stack min-w-0" style={{ flex: "999 1 420px", gap: 20 }}>

          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <StatCard icon={<Activity />} label="Active sessions" value={activeSessionCount} tone="tone-success" />
            <StatCard icon={<Clock />} label="Last updated" value={relativeTime(new Date(member.updatedAt).toISOString())} />
          </div>

          <ActivityHeatmap hist={activityHist} />

          {/* Identity providers */}
          <section className="card card-flush" aria-labelledby="member-providers">
            <div className="panel-header" style={{ paddingBlock: 8 }}>
              <div className="min-w-0">
                <h2 className="panel-title" id="member-providers">Identity providers</h2>
                <p className="text-sm text-tertiary">Authentication methods linked to this account</p>
              </div>
            </div>
            {accounts.length === 0 ? (
              <p className="panel-body text-sm text-tertiary" style={{ textAlign: "center" }}>No linked providers</p>
            ) : (
              accounts.map(acc => {
                const label = PROVIDER_LABELS[acc.providerId] ?? acc.providerId;
                return (
                  <div key={acc.id} className="list-row">
                    <span className="icon-tile icon-tile-sm tone-neutral" aria-hidden="true">
                      {acc.providerId === "credential"
                        ? <KeyRound />
                        : <ProviderIcon id={acc.providerId as ProviderId} size={16} />}
                    </span>
                    <div className="list-row-main">
                      <p className="list-row-title">{label}</p>
                      <p className="text-sm text-tertiary">
                        Linked {new Date(acc.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="badge badge-success">Connected</span>
                  </div>
                );
              })
            )}
          </section>

          {/* Recent activity */}
          <section className="card card-flush" aria-labelledby="member-recent">
            <div className="panel-header" style={{ paddingBlock: 8 }}>
              <div className="min-w-0">
                <h2 className="panel-title" id="member-recent">Recent activity</h2>
                <p className="text-sm text-tertiary">Last 15 audit entries</p>
              </div>
            </div>
            {recentActivity.length === 0 ? (
              <p className="panel-body text-sm text-tertiary" style={{ textAlign: "center" }}>No activity recorded</p>
            ) : (
              recentActivity.map(entry => {
                const { label, color } = actionLabel(entry.action);
                return (
                  <div key={entry.id} className="list-row" style={{ alignItems: "flex-start" }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 6 }}
                    />
                    <div className="list-row-main">
                      <p className="text-strong">{label}</p>
                      {entry.ipAddress && (
                        <p className="text-mono text-tertiary">{entry.ipAddress}</p>
                      )}
                    </div>
                    <p className="text-sm text-tertiary tabular" style={{ flexShrink: 0 }}>
                      {relativeTime(new Date(entry.createdAt).toISOString())}
                    </p>
                  </div>
                );
              })
            )}
          </section>
        </div>

        {/* Right column — Admin actions */}
        <div className="stack" style={{ flex: "1 1 260px", gap: 16 }}>

          {actionError && (
            <p className="alert alert-danger" role="alert"><AlertCircle /> {actionError}</p>
          )}
          {actionSuccess && !anyMutPending && (
            <p className="alert alert-success" role="status"><CheckCircle /> Done</p>
          )}

          {/* Role */}
          <section className="card card-flush" aria-labelledby="member-role">
            <div className="panel-header"><h2 className="panel-title" id="member-role">App role</h2></div>
            <div className="panel-body">
              <select
                className="select"
                aria-labelledby="member-role"
                value={member.role}
                disabled={anyMutPending}
                onChange={e => roleChange.mutate({ appId, userId, role: e.target.value })}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            </div>
          </section>

          {/* Impersonate */}
          <section className="card card-flush" aria-labelledby="member-impersonate">
            <div className="panel-header">
              <h2 className="panel-title" id="member-impersonate">Impersonate</h2>
              <span className="badge badge-warning">Pro</span>
            </div>
            <div className="panel-body stack-sm">
              {impersonateResult ? (
                <>
                  <p className="form-hint">
                    Token (expires {relativeTime(new Date(impersonateResult.expiresAt).toISOString())})
                  </p>
                  <div className="code-block">{impersonateResult.token}</div>
                  <button type="button" className="btn btn-secondary btn-sm btn-block"
                    onClick={() => setImpersonateResult(null)}>Clear</button>
                </>
              ) : (
                <AdminAction
                  label={impersonate.isPending ? "Generating…" : "Generate token"}
                  icon={<Sparkles />}
                  disabled={anyMutPending || impersonate.isPending}
                  onClick={() => impersonate.mutate({ appId, userId }, {
                    onSuccess: r => setImpersonateResult({ token: r.token, expiresAt: r.expiresAt }),
                  })}
                />
              )}
            </div>
          </section>

          {/* Lock / Ban */}
          <section className="card card-flush" aria-labelledby="member-status">
            <div className="panel-header"><h2 className="panel-title" id="member-status">Account status</h2></div>
            <div className="panel-body stack-sm">
              {isLocked ? (
                <AdminAction
                  label="Unlock account"
                  icon={<CheckCircle />}
                  disabled={anyMutPending}
                  onClick={() => unlock.mutate({ appId, userId })}
                />
              ) : (
                <AdminAction
                  label="Lock account"
                  icon={<Lock />}
                  disabled={anyMutPending}
                  onClick={() => withConfirm(
                    "Lock this account?",
                    "The user will be unable to sign in to this app until unlocked.",
                    "Lock",
                    () => lock.mutate({ appId, userId })
                  )}
                />
              )}
              {member.banned && !isLocked ? (
                <AdminAction
                  label="Unban user"
                  icon={<CheckCircle />}
                  disabled={anyMutPending}
                  onClick={() => unban.mutate({ appId, userId })}
                />
              ) : !isLocked ? (
                <AdminAction
                  label="Ban user"
                  icon={<Ban />}
                  danger
                  disabled={anyMutPending}
                  onClick={() => withConfirm(
                    "Ban this user?",
                    "They will be unable to sign in until unbanned.",
                    "Ban user",
                    () => ban.mutate({ appId, userId, reason: "Banned by admin" })
                  )}
                />
              ) : null}
            </div>
          </section>

          {/* Danger zone */}
          <section
            className="card card-flush"
            aria-labelledby="member-danger"
            style={{ borderColor: "color-mix(in oklab, var(--color-danger-text) 30%, transparent)" }}
          >
            <div className="panel-header">
              <h2 className="panel-title" id="member-danger" style={{ color: "var(--color-danger-text)" }}>Danger zone</h2>
            </div>
            <div className="panel-body stack-sm">
              <AdminAction
                label="Remove from app"
                icon={<Trash2 />}
                danger
                disabled={anyMutPending}
                onClick={() => withConfirm(
                  `Remove ${member.name ?? member.email} from app?`,
                  "They will lose access to this application. Their global account is preserved.",
                  "Remove member",
                  () => remove.mutate(
                    { appId, userId },
                    { onSuccess: () => void navigate({ to: "/applications/$appId", params: { appId } }) }
                  )
                )}
              />
              <AdminAction
                label="Remove & ban globally"
                icon={<UserX />}
                danger
                disabled={anyMutPending}
                onClick={() => withConfirm(
                  "Remove and globally ban?",
                  "This will remove the user from this app AND ban their global account.",
                  "Remove & ban",
                  () => {
                    ban.mutate({ appId, userId, reason: "Banned by admin" });
                    remove.mutate({ appId, userId }, {
                      onSuccess: () => void navigate({ to: "/applications/$appId", params: { appId } }),
                    });
                  }
                )}
              />
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

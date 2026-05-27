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
  if (action.startsWith("user.signIn")) return { label: "Signed in", color: "var(--color-green)" };
  if (action.startsWith("user.signOut")) return { label: "Signed out", color: "var(--color-text-tertiary)" };
  if (action.startsWith("user.signUp")) return { label: "Account created", color: "var(--color-accent)" };
  if (action.startsWith("user.password")) return { label: "Password changed", color: "var(--color-amber)" };
  if (action.startsWith("admin.userBanned")) return { label: "Banned", color: "var(--color-red)" };
  if (action.startsWith("admin.userUnbanned")) return { label: "Unbanned", color: "var(--color-green)" };
  if (action.startsWith("admin.userLocked")) return { label: "Locked", color: "var(--color-amber)" };
  if (action.startsWith("admin.userUnlocked")) return { label: "Unlocked", color: "var(--color-green)" };
  if (action.startsWith("admin.userImpersonated")) return { label: "Impersonated", color: "var(--color-accent)" };
  return { label: action, color: "var(--color-text-secondary)" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string;
}) {
  return (
    <div className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 34, height: 34, borderRadius: 5,
        background: `${color}18`, border: `1px solid ${color}30`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="stat-value" style={{ fontSize: "1.15rem" }}>{value}</p>
        <p className="stat-label" style={{ marginBottom: 0, marginTop: 2 }}>{label}</p>
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
      className={danger ? "btn btn-danger" : "btn btn-ghost"}
      style={{ width: "100%", justifyContent: "flex-start", fontSize: "0.8rem" }}
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
    const alpha = [0.2, 0.4, 0.65, 0.9][intensity - 1];
    return `rgba(59,130,246,${alpha})`;
  };

  return (
    <div className="card" style={{ padding: "16px 20px", overflow: "hidden" }}>
      <p className="panel-title" style={{ marginBottom: 12 }}>Activity — past 52 weeks</p>
      <div style={{ display: "flex", gap: 3, overflowX: "auto" }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {week.map(day => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} event${day.count !== 1 ? "s" : ""}`}
                style={{
                  width: 11, height: 11, borderRadius: 2,
                  background: cellColor(day.count),
                  border: "1px solid rgba(255,255,255,0.04)",
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
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
      <div className="animate-in loading" style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-text-tertiary)" }}>
        <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading member…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-in">
        <Link to="/applications/$appId" params={{ appId }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem", textDecoration: "none", marginBottom: 20 }}>
          <ArrowLeft size={13} /> Back to app
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.78rem" }}>
          <AlertCircle size={14} /> {error?.message ?? "Member not found"}
        </div>
      </div>
    );
  }

  const { member, accounts, activeSessionCount, recentActivity, activityHist } = data;
  const isLocked = member.banned && member.banReason === "__locked__";

  return (
    <div className="animate-in" style={{ maxWidth: 900 }}>
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

      {/* Back nav */}
      <Link
        to="/applications/$appId"
        params={{ appId }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.76rem", textDecoration: "none", marginBottom: 20 }}
      >
        <ArrowLeft size={12} /> Back to app
      </Link>

      {/* ── Hero header ───────────────────────────────────── */}
      <div className="card" style={{ padding: 24, marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 20 }}>
        <AvatarUpload
          src={localImage ?? member.image}
          name={member.name ?? member.email ?? "?"}
          size={68}
          uploadUrl={`/api/admin/apps/${appId}/users/${userId}/avatar`}
          onSuccess={(url) => setLocalImage(url)}
          onError={(msg) => console.error("Avatar upload error:", msg)}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 className="page-title">{member.name ?? "—"}</h1>
            {member.role === "owner" && (
              <span className="badge badge-blue"><ShieldCheck size={9} /> owner</span>
            )}
            {member.role === "admin" && (
              <span className="badge badge-blue"><Shield size={9} /> admin</span>
            )}
            {isLocked && (
              <span className="badge badge-yellow"><Lock size={9} /> locked</span>
            )}
            {member.banned && !isLocked && (
              <span className="badge badge-red"><Ban size={9} /> banned</span>
            )}
            {!member.emailVerified && (
              <span className="badge badge-yellow">unverified</span>
            )}
          </div>

          <p className="page-subtitle" style={{ marginTop: 3 }}>{member.email}</p>

          {member.username && (
            <p style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.72rem", marginTop: 3 }}>
              @{member.username}
            </p>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>ID: </span>
              <code>{member.userId}</code>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
              Joined {relativeTime(new Date(member.joinedAt).toISOString())}
            </span>
          </div>
        </div>

        <button
          className="btn btn-ghost"
          style={{ padding: "5px 9px", fontSize: "0.76rem", flexShrink: 0 }}
          onClick={() => void refetch()}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── Two-column layout ─────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <StatCard icon={<Activity size={15} />} label="Active sessions" value={activeSessionCount} color="var(--color-green)" />
            <StatCard icon={<Clock size={15} />} label="Last updated" value={relativeTime(new Date(member.updatedAt).toISOString())} color="var(--color-accent)" />
          </div>

          {/* Activity heatmap */}
          <ActivityHeatmap hist={activityHist} />

          {/* Identity providers */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <div>
                <p className="panel-title">Identity providers</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                  Authentication methods linked to this account
                </p>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ padding: "16px 20px", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.76rem", textAlign: "center" }}>No linked providers</div>
            ) : (
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map(acc => {
                  const label = PROVIDER_LABELS[acc.providerId] ?? acc.providerId;
                  return (
                    <div key={acc.id} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 4,
                      background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                    }}>
                      <div style={{ width: 26, height: 26, borderRadius: 4, background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {acc.providerId === "credential"
                          ? <KeyRound size={12} color="var(--color-accent)" />
                          : <ProviderIcon id={acc.providerId as ProviderId} size={13} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</p>
                        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--color-text-tertiary)" }}>
                          Linked {new Date(acc.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="badge badge-green">connected</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <div>
                <p className="panel-title">Recent activity</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>Last 15 audit entries</p>
              </div>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ padding: 20, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.76rem", textAlign: "center" }}>No activity recorded</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentActivity.map((entry, i) => {
                  const { label, color } = actionLabel(entry.action);
                  return (
                    <div key={entry.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 20px",
                      borderBottom: i < recentActivity.length - 1 ? "1px solid var(--color-border)" : "none",
                    }}>
                      <div style={{ width: 6, height: 6, borderRadius: 2, background: color, flexShrink: 0, marginTop: 5 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.81rem", color: "var(--color-text-primary)", fontWeight: 500 }}>{label}</p>
                        {entry.ipAddress && (
                          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>{entry.ipAddress}</p>
                        )}
                      </div>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--color-text-tertiary)", flexShrink: 0, marginTop: 2 }}>
                        {relativeTime(new Date(entry.createdAt).toISOString())}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column — Admin actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {actionError && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem" }}>
              <AlertCircle size={13} /> {actionError}
            </div>
          )}
          {actionSuccess && !anyMutPending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-green)", fontSize: "0.76rem" }}>
              <CheckCircle size={13} /> Done!
            </div>
          )}

          {/* Role */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header"><p className="section-label">App role</p></div>
            <div style={{ padding: "12px 14px" }}>
              <select
                className="input"
                style={{ width: "100%", fontSize: "0.78rem", padding: "5px 8px", appearance: "none" }}
                value={member.role}
                disabled={anyMutPending}
                onChange={e => roleChange.mutate({ appId, userId, role: e.target.value })}
              >
                <option value="owner">owner</option>
                <option value="admin">admin</option>
                <option value="member">member</option>
              </select>
            </div>
          </div>

          {/* Impersonate */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <p className="section-label">Impersonate</p>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--color-amber)", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 3, padding: "1px 6px" }}>Pro</span>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {impersonateResult ? (
                <div>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginBottom: 6 }}>
                    Token (expires {relativeTime(new Date(impersonateResult.expiresAt).toISOString())})
                  </p>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--color-accent)", wordBreak: "break-all", display: "block", background: "var(--color-surface-raised)", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--color-border)" }}>
                    {impersonateResult.token}
                  </code>
                  <button className="btn btn-ghost" style={{ marginTop: 6, fontSize: "0.72rem", width: "100%" }}
                    onClick={() => setImpersonateResult(null)}>Clear</button>
                </div>
              ) : (
                <AdminAction
                  label={impersonate.isPending ? "Generating…" : "Generate token"}
                  icon={<Sparkles size={13} />}
                  disabled={anyMutPending || impersonate.isPending}
                  onClick={() => impersonate.mutate({ appId, userId }, {
                    onSuccess: r => setImpersonateResult({ token: r.token, expiresAt: r.expiresAt }),
                  })}
                />
              )}
            </div>
          </div>

          {/* Lock / Ban */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header"><p className="section-label">Account status</p></div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {isLocked ? (
                <AdminAction
                  label="Unlock account"
                  icon={<CheckCircle size={13} />}
                  disabled={anyMutPending}
                  onClick={() => unlock.mutate({ appId, userId })}
                />
              ) : (
                <AdminAction
                  label="Lock account"
                  icon={<Lock size={13} />}
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
                  icon={<CheckCircle size={13} />}
                  disabled={anyMutPending}
                  onClick={() => unban.mutate({ appId, userId })}
                />
              ) : !isLocked ? (
                <AdminAction
                  label="Ban user"
                  icon={<Ban size={13} />}
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
          </div>

          {/* Danger zone */}
          <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: "rgba(248,113,113,0.18)" }}>
            <div className="panel-header" style={{ borderBottomColor: "rgba(248,113,113,0.14)" }}>
              <p className="section-label" style={{ color: "var(--color-red)" }}>Danger zone</p>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <AdminAction
                label="Remove from app"
                icon={<Trash2 size={13} />}
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
                icon={<UserX size={13} />}
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
          </div>

        </div>
      </div>
    </div>
  );
}

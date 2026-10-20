import { AvatarUpload } from "@/components/AvatarUpload";
import { ProviderIcon } from "@/components/BrandIcons";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  useBanUser,
  useDeleteUser,
  useSetUserRole,
  useUnbanUser,
  useUserDetail,
} from "@/hooks/use-users";
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
  Key,
  KeyRound,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import { useState } from "react";

// The underscore in the filename (users_.$userId.tsx) tells TanStack Router
// this is a top-level route at /users/$userId, NOT nested inside users.tsx.
export const Route = createFileRoute("/users_/$userId")({
  component: UserDetailPage,
});

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

function AdminAction({
  label, icon, danger = false, disabled = false, onClick,
}: {
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

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Password",
  google: "Google",
  discord: "Discord",
  github: "GitHub",
  twitter: "Twitter / X",
};

function actionLabel(action: string): { label: string; color: string } {
  if (action.startsWith("user.signIn")) return { label: "Signed in", color: "var(--color-success-text)" };
  if (action.startsWith("user.signOut")) return { label: "Signed out", color: "var(--color-text-tertiary)" };
  if (action.startsWith("user.signUp")) return { label: "Account created", color: "var(--color-accent-text)" };
  if (action.startsWith("user.password")) return { label: "Password changed", color: "var(--color-warning-text)" };
  if (action.startsWith("user.ban")) return { label: "Banned", color: "var(--color-danger-text)" };
  if (action.startsWith("user.unban")) return { label: "Unbanned", color: "var(--color-success-text)" };
  if (action.startsWith("apiKey")) return { label: "API key action", color: "var(--color-warning-text)" };
  if (action.startsWith("org.")) return { label: "Org action", color: "var(--color-accent-text)" };
  if (action.startsWith("session.")) return { label: "Session action", color: "var(--color-accent-text)" };
  return { label: action, color: "var(--color-text-secondary)" };
}

// ── Main page ─────────────────────────────────────────────────────────────────

function UserDetailPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data, isLoading, error, refetch } = useUserDetail(userId);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const setRoleMut = useSetUserRole();
  const banMut = useBanUser();
  const unbanMut = useUnbanUser();
  const deleteMut = useDeleteUser();

  const anyMutPending =
    setRoleMut.isPending || banMut.isPending || unbanMut.isPending || deleteMut.isPending;

  // ── Local UI ───────────────────────────────────────────────────────────────
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string; body: string; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  /** Show a ConfirmModal and execute fn only if user confirms. */
  const withConfirm = (title: string, body: string, confirmLabel: string, fn: () => void) => {
    setConfirmState({ title, body, confirmLabel, onConfirm: () => { setConfirmState(null); fn(); } });
  };

  // Aggregate mutation errors for the right-column error banner
  const actionError =
    setRoleMut.error?.message ??
    banMut.error?.message ??
    unbanMut.error?.message ??
    deleteMut.error?.message ??
    "";

  const actionSuccess =
    (!setRoleMut.isPending && setRoleMut.isSuccess) ||
    (!banMut.isPending && banMut.isSuccess) ||
    (!unbanMut.isPending && unbanMut.isSuccess);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="stack" style={{ maxWidth: 900 }} role="status" aria-label="Loading user">
        <span className="skeleton" style={{ height: 14, width: 100 }} />
        <span className="skeleton" style={{ height: 116, borderRadius: "var(--radius-lg)" }} />
        <span className="skeleton" style={{ height: 220, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <Link to="/users" className="back-link">
          <ArrowLeft /> Back to users
        </Link>
        <p className="alert alert-danger" role="alert">
          <AlertCircle /> {error?.message ?? "User not found"}
        </p>
      </div>
    );
  }

  const { user, accounts, sessionCount, apiKeyCount, recentActivity } = data;

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

      <Link to="/users" className="back-link">
        <ArrowLeft /> Back to users
      </Link>

      {/* ── Hero header ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
        <AvatarUpload
          src={localImage ?? user.image}
          name={user.name}
          size={68}
          uploadUrl={`/api/admin/users/${userId}/avatar`}
          onSuccess={(url) => setLocalImage(url)}
          onError={(msg) => console.error("Avatar upload error:", msg)}
        />

        <div className="min-w-0" style={{ flex: "1 1 160px" }}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <h1 className="page-title">{user.name}</h1>
            {user.role === "admin" && (
              <span className="badge badge-info"><Shield /> Admin</span>
            )}
            {user.banned && (
              <span className="badge badge-danger"><Ban /> Banned</span>
            )}
            {!user.emailVerified && (
              <span className="badge badge-warning">Unverified</span>
            )}
          </div>

          <p className="page-subtitle text-mono">{user.email}</p>

          {user.username && (
            <p className="text-mono text-tertiary" style={{ marginTop: 4 }}>
              @{user.username}
            </p>
          )}

          <div className="row" style={{ flexWrap: "wrap", gap: "4px 16px", marginTop: 12 }}>
            <span className="text-sm text-tertiary">
              ID <code>{user.id}</code>
            </span>
            <span className="text-sm text-tertiary">
              Joined {relativeTime(new Date(user.createdAt).toISOString())}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          onClick={() => void refetch()}
          title="Refresh"
          aria-label="Refresh user"
        >
          <RefreshCw />
        </button>
      </div>

      {/* ── Two-column layout ───────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>

        {/* Left column */}
        <div className="stack min-w-0" style={{ flex: "999 1 420px", gap: 20 }}>

          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <StatCard icon={<Activity />} label="Active sessions" value={sessionCount} tone="tone-success" />
            <StatCard icon={<Key />} label="API keys" value={apiKeyCount} tone="tone-warning" />
            <StatCard icon={<Clock />} label="Last updated" value={relativeTime(new Date(user.updatedAt).toISOString())} />
          </div>

          {/* Linked accounts */}
          <section className="card card-flush" aria-labelledby="user-providers">
            <div className="panel-header" style={{ paddingBlock: 8 }}>
              <div className="min-w-0">
                <h2 className="panel-title" id="user-providers">Identity providers</h2>
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
          <section className="card card-flush" aria-labelledby="user-recent">
            <div className="panel-header" style={{ paddingBlock: 8 }}>
              <div className="min-w-0">
                <h2 className="panel-title" id="user-recent">Recent activity</h2>
                <p className="text-sm text-tertiary">Last 10 audit log entries</p>
              </div>
              <Link to="/audit-logs" className="btn btn-subtle btn-sm">
                View all →
              </Link>
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
          <section className="card card-flush" aria-labelledby="user-role">
            <div className="panel-header">
              <h2 className="panel-title" id="user-role">Role</h2>
            </div>
            <div className="panel-body stack-sm">
              {user.role !== "admin" ? (
                <AdminAction
                  label="Promote to admin"
                  icon={<ShieldCheck />}
                  disabled={anyMutPending}
                  onClick={() => withConfirm(
                    "Promote to admin?",
                    "This user will have full dashboard access.",
                    "Promote",
                    () => setRoleMut.mutate({ userId, role: "admin" })
                  )}
                />
              ) : (
                <AdminAction
                  label="Demote to user"
                  icon={<UserX />}
                  disabled={anyMutPending}
                  onClick={() => withConfirm(
                    "Remove admin role?",
                    "This user will lose dashboard access.",
                    "Demote",
                    () => setRoleMut.mutate({ userId, role: "user" })
                  )}
                />
              )}
            </div>
          </section>

          {/* Status */}
          <section className="card card-flush" aria-labelledby="user-status">
            <div className="panel-header">
              <h2 className="panel-title" id="user-status">Account status</h2>
            </div>
            <div className="panel-body stack-sm">
              {user.banned ? (
                <>
                  {user.banReason && (
                    <p className="text-sm text-danger">
                      Reason: {user.banReason}
                    </p>
                  )}
                  <AdminAction
                    label="Unban user"
                    icon={<CheckCircle />}
                    disabled={anyMutPending}
                    onClick={() => unbanMut.mutate({ userId })}
                  />
                </>
              ) : (
                <AdminAction
                  label="Ban user"
                  icon={<Ban />}
                  danger
                  disabled={anyMutPending}
                  onClick={() => withConfirm(
                    "Ban this user?",
                    "They will be unable to sign in until unbanned.",
                    "Ban user",
                    () => banMut.mutate({ userId, banReason: "Banned by admin" })
                  )}
                />
              )}
            </div>
          </section>

          {/* Danger zone */}
          <section
            className="card card-flush"
            aria-labelledby="user-danger"
            style={{ borderColor: "color-mix(in oklab, var(--color-danger-text) 30%, transparent)" }}
          >
            <div className="panel-header">
              <h2 className="panel-title" id="user-danger" style={{ color: "var(--color-danger-text)" }}>Danger zone</h2>
            </div>
            <div className="panel-body stack-sm">
              <AdminAction
                label="Delete account"
                icon={<Trash2 />}
                danger
                disabled={anyMutPending}
                onClick={() => withConfirm(
                  `Delete ${user.name}'s account?`,
                  "This will permanently erase all data for this user. This cannot be undone.",
                  "Delete permanently",
                  () => deleteMut.mutate(
                    { userId },
                    { onSuccess: () => void navigate({ to: "/users" }) }
                  )
                )}
              />
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

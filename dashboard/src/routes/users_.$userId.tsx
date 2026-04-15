import { AvatarUpload } from "@/components/AvatarUpload";
import { ProviderIcon } from "@/components/BrandIcons";
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
  UserX
} from "lucide-react";
import { useEffect, useState } from "react";

// The underscore in the filename (users_.$userId.tsx) tells TanStack Router
// this is a top-level route at /users/$userId, NOT nested inside users.tsx.
export const Route = createFileRoute("/users_/$userId")({
  component: UserDetailPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type UserDetail = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  createdAt: number;
  updatedAt: number;
  username: string | null;
};

type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: number;
};

type AuditEntry = {
  id: string;
  action: string;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: number;
  metadata: Record<string, unknown> | null;
};

type UserDetailResponse = {
  user: UserDetail;
  accounts: LinkedAccount[];
  sessionCount: number;
  apiKeyCount: number;
  recentActivity: AuditEntry[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Password",
  google: "Google",
  discord: "Discord",
  github: "GitHub",
  twitter: "Twitter / X",
};

function actionLabel(action: string): { label: string; color: string } {
  if (action.startsWith("user.signIn")) return { label: "Signed in", color: "var(--color-green)" };
  if (action.startsWith("user.signOut")) return { label: "Signed out", color: "var(--color-text-tertiary)" };
  if (action.startsWith("user.signUp")) return { label: "Account created", color: "var(--color-accent)" };
  if (action.startsWith("user.password")) return { label: "Password changed", color: "var(--color-amber)" };
  if (action.startsWith("user.ban")) return { label: "Banned", color: "var(--color-red)" };
  if (action.startsWith("user.unban")) return { label: "Unbanned", color: "var(--color-green)" };
  if (action.startsWith("apiKey")) return { label: "API key action", color: "var(--color-amber)" };
  if (action.startsWith("org.")) return { label: "Org action", color: "var(--color-accent)" };
  if (action.startsWith("session.")) return { label: "Session action", color: "var(--color-accent)" };
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

function AdminAction({
  label, icon, danger = false, disabled = false, onClick, confirm: confirmMsg,
}: {
  label: string; icon: React.ReactNode; danger?: boolean;
  disabled?: boolean; onClick: () => void; confirm?: string;
}) {
  const handler = () => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    onClick();
  };
  return (
    <button
      className={danger ? "btn btn-danger" : "btn btn-ghost"}
      style={{ width: "100%", justifyContent: "flex-start", fontSize: "0.8rem" }}
      disabled={disabled}
      onClick={handler}
    >
      {icon} {label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function UserDetailPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [localImage, setLocalImage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(await res.json() as UserDetailResponse);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [userId]);

  const adminAction = async (endpoint: string, body: object) => {
    setActionLoading(true); setActionError(""); setActionSuccess("");
    try {
      const res = await fetch(`/api/auth/admin/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { message?: string };
        setActionError(b.message ?? `Action failed (${res.status})`);
        return;
      }
      setActionSuccess("Done!");
      setTimeout(() => setActionSuccess(""), 3000);
      await load();
    } catch (e: any) {
      setActionError(e?.message ?? "Network error");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Loading / error states ────────────────
  if (loading) {
    return (
      <div className="animate-in loading" style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-text-tertiary)" }}>
        <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading user…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-in">
        <Link to="/users" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem", textDecoration: "none", marginBottom: 20 }}>
          <ArrowLeft size={13} /> Back to Users
        </Link>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.78rem",
        }}>
          <AlertCircle size={14} /> {error || "User not found"}
        </div>
      </div>
    );
  }

  const { user, accounts, sessionCount, apiKeyCount, recentActivity } = data;

  return (
    <div className="animate-in" style={{ maxWidth: 900 }}>
      {/* Back nav */}
      <Link
        to="/users"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.76rem", textDecoration: "none", marginBottom: 20 }}
      >
        <ArrowLeft size={12} /> All users
      </Link>

      {/* ── Hero header ─────────────────────────────────────── */}
      <div className="card" style={{ padding: 24, marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 20 }}>
        <AvatarUpload
          src={localImage ?? user.image}
          name={user.name}
          size={68}
          uploadUrl={`/api/admin/users/${userId}/avatar`}
          onSuccess={(url) => setLocalImage(url)}
          onError={(msg) => setActionError(msg)}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 className="page-title">{user.name}</h1>
            {user.role === "admin" && (
              <span className="badge badge-blue"><Shield size={9} /> admin</span>
            )}
            {user.banned && (
              <span className="badge badge-red"><Ban size={9} /> banned</span>
            )}
            {!user.emailVerified && (
              <span className="badge badge-yellow">unverified</span>
            )}
          </div>

          <p className="page-subtitle" style={{ marginTop: 3 }}>{user.email}</p>

          {user.username && (
            <p style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.72rem", marginTop: 3 }}>
              @{user.username}
            </p>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>ID: </span>
              <code>{user.id}</code>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>
              Joined {relativeTime(new Date(user.createdAt).toISOString())}
            </span>
          </div>
        </div>

        <button
          className="btn btn-ghost"
          style={{ padding: "5px 9px", fontSize: "0.76rem", flexShrink: 0 }}
          onClick={load} title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── Two-column layout ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <StatCard icon={<Activity size={15} />} label="Active sessions" value={sessionCount} color="var(--color-green)" />
            <StatCard icon={<Key size={15} />} label="API keys" value={apiKeyCount} color="var(--color-amber)" />
            <StatCard icon={<Clock size={15} />} label="Last updated" value={relativeTime(new Date(user.updatedAt).toISOString())} color="var(--color-accent)" />
          </div>

          {/* Linked accounts */}
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
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "9px 12px", borderRadius: 4,
                      background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                    }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 4,
                        background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {acc.providerId === "credential" ? (
                          <KeyRound size={12} color="var(--color-accent)" />
                        ) : (
                          <ProviderIcon id={acc.providerId as ProviderId} size={13} />
                        )}
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
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>Last 10 audit log entries</p>
              </div>
              <Link
                to="/audit-logs"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-accent)", textDecoration: "none" }}
              >
                View all →
              </Link>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ padding: 20, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.76rem", textAlign: "center" }}>No activity recorded</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentActivity.map((entry, i) => {
                  const { label, color } = actionLabel(entry.action);
                  return (
                    <div key={entry.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 12,
                      padding: "10px 20px",
                      borderBottom: i < recentActivity.length - 1 ? "1px solid var(--color-border)" : "none",
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: 2,
                        background: color, flexShrink: 0, marginTop: 5,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.81rem", color: "var(--color-text-primary)", fontWeight: 500 }}>{label}</p>
                        {entry.ipAddress && (
                          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                            {entry.ipAddress}
                          </p>
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
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
              background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
            }}>
              <AlertCircle size={13} /> {actionError}
            </div>
          )}
          {actionSuccess && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
              background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
              borderRadius: 4, fontFamily: "var(--font-mono)", color: "var(--color-green)", fontSize: "0.76rem",
            }}>
              <CheckCircle size={13} /> {actionSuccess}
            </div>
          )}

          {/* Role */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <p className="section-label">Role</p>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {user.role !== "admin" ? (
                <AdminAction
                  label="Promote to admin"
                  icon={<ShieldCheck size={13} />}
                  disabled={actionLoading}
                  confirm="Promote this user to admin? They will have full dashboard access."
                  onClick={() => adminAction("set-role", { userId, role: "admin" })}
                />
              ) : (
                <AdminAction
                  label="Demote to user"
                  icon={<UserX size={13} />}
                  disabled={actionLoading}
                  confirm="Remove admin role from this user?"
                  onClick={() => adminAction("set-role", { userId, role: "user" })}
                />
              )}
            </div>
          </div>

          {/* Status */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header">
              <p className="section-label">Account status</p>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {user.banned ? (
                <>
                  {user.banReason && (
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-red)", marginBottom: 4 }}>
                      Reason: {user.banReason}
                    </p>
                  )}
                  <AdminAction
                    label="Unban user"
                    icon={<CheckCircle size={13} />}
                    disabled={actionLoading}
                    onClick={() => adminAction("unban-user", { userId })}
                  />
                </>
              ) : (
                <AdminAction
                  label="Ban user"
                  icon={<Ban size={13} />}
                  danger
                  disabled={actionLoading}
                  confirm="Ban this user? They will be unable to sign in."
                  onClick={() => adminAction("ban-user", { userId, banReason: "Banned by admin" })}
                />
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: "rgba(248,113,113,0.18)" }}>
            <div className="panel-header" style={{ borderBottomColor: "rgba(248,113,113,0.14)" }}>
              <p className="section-label" style={{ color: "var(--color-red)" }}>Danger zone</p>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <AdminAction
                label="Delete account"
                icon={<Trash2 size={13} />}
                danger
                disabled={actionLoading}
                confirm={`Permanently delete ${user.name}'s account? This cannot be undone.`}
                onClick={async () => {
                  await adminAction("remove-user", { userId });
                  navigate({ to: "/users" });
                }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

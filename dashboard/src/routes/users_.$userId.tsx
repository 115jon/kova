import { ProviderIcon } from "@/components/BrandIcons";
import { UserAvatar } from "@/components/UserAvatar";
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

const PROVIDER_COLORS: Record<string, string> = {
  credential: "#64748b",
  google: "#ea4335",
  discord: "#5865f2",
  github: "#e2e8f0",
  twitter: "#1da1f2",
};

function actionLabel(action: string): { label: string; color: string } {
  if (action.startsWith("user.signIn")) return { label: "Signed in", color: "#22c55e" };
  if (action.startsWith("user.signOut")) return { label: "Signed out", color: "#64748b" };
  if (action.startsWith("user.signUp")) return { label: "Account created", color: "#818cf8" };
  if (action.startsWith("user.password")) return { label: "Password changed", color: "#f59e0b" };
  if (action.startsWith("user.ban")) return { label: "Banned", color: "#ef4444" };
  if (action.startsWith("user.unban")) return { label: "Unbanned", color: "#22c55e" };
  if (action.startsWith("apiKey")) return { label: "API key action", color: "#f59e0b" };
  if (action.startsWith("org.")) return { label: "Org action", color: "#a78bfa" };
  if (action.startsWith("session.")) return { label: "Session action", color: "#38bdf8" };
  return { label: action, color: "#94a3b8" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string;
}) {
  return (
    <div style={{
      background: "var(--color-surface-700)", borderRadius: 10,
      padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: `${color}20`, border: `1px solid ${color}40`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p style={{ fontSize: "1.2rem", fontWeight: 700, color: "#e2e8f0", lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 3 }}>{label}</p>
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
      style={{ width: "100%", justifyContent: "flex-start", fontSize: "0.82rem" }}
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
      <div className="animate-in" style={{ display: "flex", alignItems: "center", gap: 12, color: "#475569", padding: 40 }}>
        <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading user…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-in">
        <Link to="/users" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: "0.85rem", textDecoration: "none", marginBottom: 20 }}>
          <ArrowLeft size={14} /> Back to Users
        </Link>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 10, color: "#f87171",
        }}>
          <AlertCircle size={16} /> {error || "User not found"}
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
        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: "0.82rem", textDecoration: "none", marginBottom: 20 }}
      >
        <ArrowLeft size={13} /> All users
      </Link>

      {/* ── Hero header ─────────────────────────────────────── */}
      <div className="card" style={{ padding: 28, marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 20 }}>
        <UserAvatar src={user.image} name={user.name} size={72} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
              {user.name}
            </h1>
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

          <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: 4 }}>{user.email}</p>

          {user.username && (
            <p style={{ color: "#475569", fontSize: "0.78rem", marginTop: 2, fontFamily: "monospace" }}>
              @{user.username}
            </p>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "#475569" }}>
              <span style={{ color: "#64748b" }}>User ID: </span>
              <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>{user.id}</code>
            </span>
            <span style={{ fontSize: "0.75rem", color: "#475569" }}>
              Joined {relativeTime(new Date(user.createdAt).toISOString())}
            </span>
          </div>
        </div>

        <button
          className="btn btn-ghost"
          style={{ padding: "6px 10px", fontSize: "0.78rem", flexShrink: 0 }}
          onClick={load} title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* ── Two-column layout ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20, alignItems: "start" }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <StatCard icon={<Activity size={16} />} label="Active sessions" value={sessionCount} color="#22c55e" />
            <StatCard icon={<Key size={16} />} label="API keys" value={apiKeyCount} color="#f59e0b" />
            <StatCard icon={<Clock size={16} />} label="Last updated" value={relativeTime(new Date(user.updatedAt).toISOString())} color="#818cf8" />
          </div>

          {/* Linked accounts */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)" }}>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#e2e8f0" }}>Identity providers</p>
              <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 2 }}>
                Authentication methods linked to this account
              </p>
            </div>
            {accounts.length === 0 ? (
              <div style={{ padding: "20px", color: "#475569", fontSize: "0.82rem", textAlign: "center" }}>No linked providers</div>
            ) : (
              <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                {accounts.map(acc => {
                  const color = PROVIDER_COLORS[acc.providerId] ?? "#94a3b8";
                  const label = PROVIDER_LABELS[acc.providerId] ?? acc.providerId;
                  return (
                    <div key={acc.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--color-surface-700)",
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 7,
                        background: `${color}20`, border: `1px solid ${color}40`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {acc.providerId === "credential" ? (
                          <KeyRound size={13} color={color} />
                        ) : (
                          <ProviderIcon id={acc.providerId as ProviderId} size={15} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "0.83rem", fontWeight: 600, color: "#e2e8f0" }}>{label}</p>
                        <p style={{ fontSize: "0.7rem", color: "#64748b" }}>
                          Linked {new Date(acc.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>connected</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#e2e8f0" }}>Recent activity</p>
                <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 2 }}>Last 10 audit log entries</p>
              </div>
              <Link
                to="/audit-logs"
                style={{ fontSize: "0.75rem", color: "#818cf8", textDecoration: "none" }}
              >
                View all →
              </Link>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ padding: 20, color: "#475569", fontSize: "0.82rem", textAlign: "center" }}>No activity recorded</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentActivity.map((entry, i) => {
                  const { label, color } = actionLabel(entry.action);
                  return (
                    <div key={entry.id} style={{
                      display: "flex", alignItems: "flex-start", gap: 12,
                      padding: "11px 20px",
                      borderBottom: i < recentActivity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: color, flexShrink: 0, marginTop: 5,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "0.82rem", color: "#e2e8f0", fontWeight: 500 }}>{label}</p>
                        {entry.ipAddress && (
                          <p style={{ fontSize: "0.7rem", color: "#475569", fontFamily: "monospace", marginTop: 2 }}>
                            {entry.ipAddress}
                          </p>
                        )}
                      </div>
                      <p style={{ fontSize: "0.72rem", color: "#475569", flexShrink: 0, marginTop: 1 }}>
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
              display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8, color: "#f87171", fontSize: "0.8rem",
            }}>
              <AlertCircle size={13} /> {actionError}
            </div>
          )}
          {actionSuccess && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 8, color: "#22c55e", fontSize: "0.8rem",
            }}>
              <CheckCircle size={13} /> {actionSuccess}
            </div>
          )}

          {/* Role */}
          <div className="card" style={{ padding: "14px 16px" }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Role
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
          <div className="card" style={{ padding: "14px 16px" }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Account status
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {user.banned ? (
                <>
                  {user.banReason && (
                    <p style={{ fontSize: "0.75rem", color: "#f87171", marginBottom: 4 }}>
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
          <div className="card" style={{ padding: "14px 16px", borderColor: "rgba(239,68,68,0.2)" }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 600, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Danger zone
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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

import { ConfirmModal } from "@/components/ConfirmModal";
import { UserAvatar } from "@/components/UserAvatar";
import {
  useBanUser,
  useDeleteUser,
  useSetUserRole,
  useUnbanUser,
  useUsers,
} from "@/hooks/use-users";
import { userKeys } from "@/lib/query-keys";
import { relativeTime } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/users")({
  component: UsersPage,
});

const PAGE_SIZE = 20;

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;

function UsersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data, isLoading, error, isFetching } = useUsers({ page, search });
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const setRoleMut = useSetUserRole();
  const banMut = useBanUser();
  const unbanMut = useUnbanUser();
  const deleteMut = useDeleteUser();

  // Track which user has an in-flight mutation for button disabled states
  const mutatingUserId =
    setRoleMut.variables?.userId ??
    banMut.variables?.userId ??
    unbanMut.variables?.userId ??
    deleteMut.variables?.userId ??
    null;

  // ── Handlers ────────────────────────────────────────────────────────────────
  const setRole = (userId: string, role: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRoleMut.mutate({ userId, role });
  };

  const banUser = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      title: "Ban this user?",
      body: "They will be unable to sign in until unbanned.",
      confirmLabel: "Ban user",
      onConfirm: () => {
        setConfirmState(null);
        banMut.mutate({ userId, banReason: "Banned by admin" });
      },
    });
  };

  const unbanUser = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    unbanMut.mutate({ userId });
  };

  const deleteUser = (userId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      title: `Delete ${name}'s account?`,
      body: "This will permanently erase all data for this user and cannot be undone.",
      confirmLabel: "Delete permanently",
      onConfirm: () => {
        setConfirmState(null);
        deleteMut.mutate({ userId });
      },
    });
  };

  // Aggregate mutation error for the error banner
  const actionError =
    setRoleMut.error?.message ??
    banMut.error?.message ??
    unbanMut.error?.message ??
    deleteMut.error?.message ??
    "";

  return (
    <div className="animate-in">
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Platform</p>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{total.toLocaleString()} total</p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => void qc.invalidateQueries({ queryKey: userKeys.all })}
          title="Refresh"
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? "spin" : ""} />
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)", pointerEvents: "none" }} />
        <input
          id="user-search"
          className="input"
          style={{ paddingLeft: 34 }}
          placeholder="Search by email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      {/* Action error banner */}
      {actionError && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          color: "var(--color-red)",
          fontFamily: "var(--font-mono)", fontSize: "0.78rem",
        }}>
          <Ban size={13} /> {actionError}
        </div>
      )}

      {/* Query error */}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          color: "var(--color-red)",
          fontFamily: "var(--font-mono)", fontSize: "0.78rem",
        }}>
          <Ban size={13} /> {error.message}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading ? (
          <div className="loading" style={{ padding: 32, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Verified</th>
                <th>Status</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  onClick={() => navigate({ to: "/users/$userId", params: { userId: u.id } })}
                  style={{ cursor: "pointer" }}
                  title="View user details"
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <UserAvatar src={u.image} name={u.name} size={28} />
                      <div>
                        <p style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-text-primary)", fontSize: "0.84rem" }}>{u.name}</p>
                        <p style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", fontSize: "0.72rem" }}>{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "badge-blue" : "badge-gray"}`}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.emailVerified ? "badge-green" : "badge-yellow"}`}>
                      {u.emailVerified ? "verified" : "pending"}
                    </span>
                  </td>
                  <td>
                    {u.banned
                      ? <span className="badge badge-red">banned</span>
                      : <span className="badge badge-green">active</span>}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.74rem" }}>{relativeTime(u.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                      {u.role !== "admin" && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={mutatingUserId === u.id}
                          onClick={e => setRole(u.id, "admin", e)}
                          title="Make admin"
                        >
                          <ShieldCheck size={13} /> Admin
                        </button>
                      )}
                      {u.role === "admin" && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={mutatingUserId === u.id}
                          onClick={e => setRole(u.id, "user", e)}
                          title="Remove admin"
                        >
                          User
                        </button>
                      )}
                      {u.banned ? (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={mutatingUserId === u.id}
                          onClick={e => unbanUser(u.id, e)}
                          title="Unban"
                        >
                          Unban
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={mutatingUserId === u.id}
                          onClick={e => banUser(u.id, e)}
                          title="Ban user"
                        >
                          <Ban size={12} />
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px" }}
                        disabled={mutatingUserId === u.id}
                        onClick={e => deleteUser(u.id, u.name, e)}
                        title="Delete user"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6}><div className="empty-state">No users found</div></td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>Page {page + 1} of {pages}</span>
            <button className="btn btn-ghost" style={{ padding: "4px 8px" }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            <button className="btn btn-ghost" style={{ padding: "4px 8px" }} disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

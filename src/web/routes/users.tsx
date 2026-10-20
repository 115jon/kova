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
import { relativeTime, sentenceCase } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
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
    <div>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Platform</p>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle tabular">{total.toLocaleString()} total</p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => void qc.invalidateQueries({ queryKey: userKeys.all })}
            title="Refresh"
            aria-label="Refresh users"
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? "spin" : ""} />
          </button>
        </div>
      </header>

      <div className="input-icon" style={{ marginBottom: 16 }}>
        <Search aria-hidden="true" />
        <input
          id="user-search"
          className="input"
          type="search"
          aria-label="Search users by email"
          placeholder="Search by email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      {(actionError || error) && (
        <div className="stack-sm" style={{ marginBottom: 16 }}>
          {actionError && <p className="alert alert-danger" role="alert"><Ban /> {actionError}</p>}
          {error && <p className="alert alert-danger" role="alert"><Ban /> {error.message}</p>}
        </div>
      )}

      <div className="card card-flush">
        {isLoading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading users">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Search /></span>
            <p className="empty-state-title">{search ? "No matching users" : "No users yet"}</p>
            <p className="empty-state-body">
              {search ? `No email contains “${search}”.` : "People who sign up to your apps appear here."}
            </p>
          </div>
        ) : (
          <table className="data-table is-stackable">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Verified</th>
                <th>Status</th>
                <th>Joined</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const open = () => navigate({ to: "/users/$userId", params: { userId: u.id } });
                return (
                  <tr
                    key={u.id}
                    className="is-clickable"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }}
                    title="View user details"
                  >
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <UserAvatar src={u.image} name={u.name} size={28} />
                        <div className="min-w-0">
                          <p className="text-strong truncate">{u.name}</p>
                          <p className="text-mono text-tertiary truncate" style={{ fontSize: 12 }}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="cell-inline">
                      <span className={`badge ${u.role === "admin" ? "badge-info" : "badge-neutral"}`}>{sentenceCase(u.role)}</span>
                    </td>
                    <td className="cell-inline">
                      <span className={`badge ${u.emailVerified ? "badge-success" : "badge-warning"}`}>
                        {u.emailVerified ? "Verified" : "Pending"}
                      </span>
                    </td>
                    <td className="cell-inline">
                      {u.banned
                        ? <span className="badge badge-danger">Banned</span>
                        : <span className="badge badge-success">Active</span>}
                    </td>
                    <td className="cell-meta"><span className="cell-prefix">Joined </span>{relativeTime(u.createdAt)}</td>
                    <td className="cell-actions">
                      <div className="row cell-actions-row" onClick={e => e.stopPropagation()}>
                        {u.role !== "admin" ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={mutatingUserId === u.id}
                            onClick={e => setRole(u.id, "admin", e)}
                            title="Make admin"
                          >
                            Make admin
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={mutatingUserId === u.id}
                            onClick={e => setRole(u.id, "user", e)}
                            title="Remove admin"
                          >
                            Make user
                          </button>
                        )}
                        {u.banned ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={mutatingUserId === u.id}
                            onClick={e => unbanUser(u.id, e)}
                            title="Unban"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            disabled={mutatingUserId === u.id}
                            onClick={e => banUser(u.id, e)}
                            title="Ban user"
                            aria-label={`Ban ${u.name}`}
                          >
                            <Ban />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          disabled={mutatingUserId === u.id}
                          onClick={e => deleteUser(u.id, u.name, e)}
                          title="Delete user"
                          aria-label={`Delete ${u.name}`}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="panel-footer">
            <span className="text-sm text-tertiary tabular">Page {page + 1} of {pages}</span>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft />
            </button>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { UserAvatar } from "@/components/UserAvatar";
import { relativeTime } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ban, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/users")({
  component: UsersPage,
});

type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const PAGE_SIZE = 20;

function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionUser, setActionUser] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        ...(search ? { searchField: "email", searchValue: search, searchOperator: "contains" } : {}),
      });
      const res = await fetch(`/api/auth/admin/list-users?${params}`, { credentials: "include" });
      const data = await res.json() as { users: User[]; total: number };
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, search]);

  const action = async (endpoint: string, body: object, userId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger row click → detail page
    setActionUser(userId);
    setActionError("");
    try {
      const res = await fetch(`/api/auth/admin/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string };
        setActionError(err.message ?? `Action failed (${res.status})`);
        return;
      }
      load();
    } catch (e: any) {
      setActionError(e?.message ?? "Network error — action may not have completed");
    } finally {
      setActionUser(null);
    }
  };

  const setRole = (id: string, role: string, e: React.MouseEvent) => action("set-role", { userId: id, role }, id, e);
  const banUser = (id: string, e: React.MouseEvent) => action("ban-user", { userId: id, banReason: "Banned by admin" }, id, e);
  const unbanUser = (id: string, e: React.MouseEvent) => action("unban-user", { userId: id }, id, e);
  const deleteUser = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this user permanently?")) return;
    action("remove-user", { userId: id }, id, e);
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="animate-in">
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Platform</p>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{total.toLocaleString()} total</p>
        </div>
        <button className="btn btn-ghost" onClick={load} title="Refresh">
          <RefreshCw size={14} />
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

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
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
                          disabled={actionUser === u.id}
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
                          disabled={actionUser === u.id}
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
                          disabled={actionUser === u.id}
                          onClick={e => unbanUser(u.id, e)}
                          title="Unban"
                        >
                          Unban
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={actionUser === u.id}
                          onClick={e => banUser(u.id, e)}
                          title="Ban user"
                        >
                          <Ban size={12} />
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px" }}
                        disabled={actionUser === u.id}
                        onClick={e => deleteUser(u.id, e)}
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

import { relativeTime } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
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
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionUser, setActionUser] = useState<string | null>(null);

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

  const action = async (endpoint: string, body: object, userId: string) => {
    setActionUser(userId);
    try {
      await fetch(`/api/auth/admin/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      load();
    } finally {
      setActionUser(null);
    }
  };

  const setRole = (id: string, role: string) => action("set-role", { userId: id, role }, id);
  const banUser = (id: string) => action("ban-user", { userId: id, banReason: "Banned by admin" }, id);
  const unbanUser = (id: string) => action("unban-user", { userId: id }, id);
  const deleteUser = (id: string) => {
    if (!confirm("Delete this user permanently?")) return;
    action("remove-user", { userId: id }, id);
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="animate-in">
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>Users</h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>{total.toLocaleString()} total</p>
        </div>
        <button className="btn btn-ghost" onClick={load} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
        <input
          id="user-search"
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Search by email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ padding: 32, textAlign: "center", color: "#475569", fontSize: "0.85rem" }}>Loading…</div>
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
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                      <div>
                        <p style={{ fontWeight: 500, color: "#e2e8f0", fontSize: "0.875rem" }}>{u.name}</p>
                        <p style={{ color: "#64748b", fontSize: "0.75rem" }}>{u.email}</p>
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
                  <td style={{ color: "#64748b", fontSize: "0.8rem" }}>{relativeTime(u.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      {u.role !== "admin" && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={actionUser === u.id}
                          onClick={() => setRole(u.id, "admin")}
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
                          onClick={() => setRole(u.id, "user")}
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
                          onClick={() => unbanUser(u.id)}
                          title="Unban"
                        >
                          Unban
                        </button>
                      ) : (
                        <button
                          className="btn btn-danger"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          disabled={actionUser === u.id}
                          onClick={() => banUser(u.id)}
                          title="Ban user"
                        >
                          <Ban size={12} />
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px" }}
                        disabled={actionUser === u.id}
                        onClick={() => deleteUser(u.id)}
                        title="Delete user"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#475569", padding: 32 }}>No users found</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Page {page + 1} of {pages}</span>
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

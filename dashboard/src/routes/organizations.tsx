import { authClient } from "@/lib/auth-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, ChevronRight, Crown, Plus, Shield } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/organizations")({
  component: OrganizationsPage,
});

const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#818cf8",
  member: "#34d399",
};

// ── Create Org Modal ──────────────────────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slugTouched) {
      setSlug(name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
    }
  }, [name, slugTouched]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(""); setLoading(true);
    try {
      const res = await (authClient as any).organization.create({ name: name.trim(), slug: slug || undefined });
      if (res.error) throw new Error(res.error.message);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create organization");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: "var(--color-surface-800)",
        border: "1px solid var(--color-border)",
        borderRadius: 16, padding: 28, width: "100%", maxWidth: 440,
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Building2 size={16} color="#818cf8" />
          </div>
          <div>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0" }}>Create organization</h2>
            <p style={{ fontSize: "0.75rem", color: "#64748b" }}>You'll be the owner</p>
          </div>
        </div>

        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Name</label>
            <input className="input" placeholder="Acme Inc." value={name}
              onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: "0.78rem", color: "#94a3b8", display: "block", marginBottom: 6 }}>Slug</label>
            <input className="input" placeholder="acme-inc" value={slug}
              onChange={e => { setSlug(e.target.value); setSlugTouched(true); }}
              style={{ fontFamily: "monospace", fontSize: "0.85rem" }} />
            <p style={{ fontSize: "0.72rem", color: "#475569", marginTop: 4 }}>
              Used in URLs — letters, numbers and hyphens only
            </p>
          </div>
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: "0.8rem",
            }}>{error}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}
              disabled={loading || !name.trim()}>
              <Building2 size={13} /> {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Organizations List Page ───────────────────────────────────────────────────

function OrganizationsPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const res = await (authClient as any).organization.list();
      if (!res.error) setOrgs(res.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrgs(); }, []);

  return (
    <div className="animate-in" style={{ maxWidth: 740 }}>
      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={fetchOrgs} />}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
            Organizations
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>
            Manage your apps and team workspaces
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New organization
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="loading" style={{ color: "#818cf8", fontSize: "0.9rem" }}>Loading organizations…</div>
        </div>
      ) : orgs.length === 0 ? (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
            background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Building2 size={22} color="#818cf8" strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>
            No organizations yet
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 20, maxWidth: 320, margin: "0 auto 20px" }}>
            Create your first organization to manage apps, users, and team members.
          </p>
          <button className="btn btn-primary" style={{ margin: "0 auto" }} onClick={() => setShowCreate(true)}>
            <Plus size={13} /> Create your first organization
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {orgs.map((org: any) => (
            <div
              key={org.id}
              className="card"
              style={{
                padding: "16px 20px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 16,
              }}
              onClick={() => navigate({ to: "/organizations/$orgId", params: { orgId: org.id } } as any)}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: "linear-gradient(135deg, #6366f1, #7c3aed)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: "1rem", color: "#fff",
              }}>
                {org.name?.[0]?.toUpperCase() ?? "O"}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>{org.name}</p>
                {org.slug && (
                  <p style={{ fontSize: "0.75rem", color: "#475569", fontFamily: "monospace" }}>{org.slug}</p>
                )}
              </div>

              {org.role && (
                <span style={{
                  fontSize: "0.7rem", fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                  background: `${ROLE_COLORS[org.role] ?? "#64748b"}18`,
                  color: ROLE_COLORS[org.role] ?? "#64748b",
                  border: `1px solid ${ROLE_COLORS[org.role] ?? "#64748b"}30`,
                  textTransform: "capitalize", display: "flex", alignItems: "center", gap: 4,
                }}>
                  {org.role === "owner" && <Crown size={10} />}
                  {org.role === "admin" && <Shield size={10} />}
                  {org.role}
                </span>
              )}

              <ChevronRight size={14} color="#475569" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

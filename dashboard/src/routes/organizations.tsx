import { organization } from "@/lib/auth-client";
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
      const resolvedSlug = slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const res = await organization.create({ name: name.trim(), slug: resolvedSlug });
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 5,
              background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Building2 size={15} color="var(--color-accent)" />
            </div>
            <div>
              <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "0.88rem", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>Create organization</h2>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>You'll be the owner</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleCreate} className="modal-body">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="input" placeholder="Acme Inc." value={name}
              onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Slug</label>
            <input className="input" placeholder="acme-inc" value={slug}
              onChange={e => { setSlug(e.target.value); setSlugTouched(true); }}
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }} />
            <p className="form-hint">Used in URLs — letters, numbers and hyphens only</p>
          </div>
          {error && (
            <div style={{
              background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 4, padding: "8px 12px",
              fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.75rem",
            }}>{error}</div>
          )}
          <div className="modal-footer" style={{ border: "none", padding: 0 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary"
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
      const res = await organization.list();
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
          <p className="section-label" style={{ marginBottom: 4 }}>Platform</p>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">Manage your apps and team workspaces</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> New organization
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="loading" style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.8rem" }}>Loading organizations…</div>
        </div>
      ) : orgs.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 40, height: 40, borderRadius: 5, margin: "0 auto 14px",
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Building2 size={18} color="var(--color-accent)" strokeWidth={1.5} />
          </div>
          <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6, letterSpacing: "-0.02em" }}>
            No organizations yet
          </h2>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-text-tertiary)", marginBottom: 18, maxWidth: 300, margin: "0 auto 18px" }}>
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
                padding: "14px 18px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 14,
              }}
              onClick={() => navigate({ to: "/organizations/$orgId", params: { orgId: org.id } } as any)}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 5, flexShrink: 0,
                background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.9rem", color: "var(--color-accent)",
              }}>
                {org.name?.[0]?.toUpperCase() ?? "O"}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.88rem", fontWeight: 600, color: "var(--color-text-primary)" }}>{org.name}</p>
                {org.slug && (
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>{org.slug}</p>
                )}
              </div>

              {org.role && (
                <span className={`badge ${org.role === "owner" ? "badge-yellow" : org.role === "admin" ? "badge-blue" : "badge-gray"}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {org.role === "owner" && <Crown size={9} />}
                  {org.role === "admin" && <Shield size={9} />}
                  {org.role}
                </span>
              )}

              <ChevronRight size={13} color="var(--color-text-tertiary)" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

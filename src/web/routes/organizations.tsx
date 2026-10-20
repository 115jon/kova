import { Modal, ModalHeader } from "@/components/Modal";
import { OrgAvatar } from "@/components/OrgAvatar";
import {
  useCreateOrganization,
  useOrganizations,
} from "@/hooks/use-organizations";
import { sentenceCase } from "@/lib/utils";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Building2, ChevronRight, Crown, Plus, Shield } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/organizations")({
  component: OrganizationsPage,
});

// ── Create Org Modal ──────────────────────────────────────────────────────────

function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const createOrg = useCreateOrganization();

  // Auto-derive slug from name until user touches it
  const derivedSlug = slugTouched
    ? slug
    : name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const resolvedSlug =
      derivedSlug.trim() ||
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    createOrg.mutate(
      { name: name.trim(), slug: resolvedSlug },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal onClose={onClose} maxWidth={440}>
      <ModalHeader
        title="Create organization"
        subtitle="You'll be the owner"
        icon={<span className="icon-tile" aria-hidden="true"><Building2 /></span>}
      />

      <form onSubmit={handleCreate}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="org-name">Name</label>
            <input id="org-name" className="input" placeholder="Acme Inc." value={name}
              onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="org-slug">Slug</label>
            <input id="org-slug" className="input input-mono" placeholder="acme-inc" value={derivedSlug}
              onChange={e => { setSlug(e.target.value); setSlugTouched(true); }} />
            <p className="form-hint">Used in URLs. Letters, numbers and hyphens only.</p>
          </div>
          {createOrg.error && (
            <p className="alert alert-danger" role="alert"><AlertCircle /> {createOrg.error.message}</p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary"
            disabled={createOrg.isPending || !name.trim()}>
            <Building2 /> {createOrg.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Organizations List Page ───────────────────────────────────────────────────

function OrganizationsPage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  const { data: orgs = [], isLoading, error } = useOrganizations();

  return (
    <div>
      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} />}

      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Platform</p>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">Manage your apps and team workspaces</p>
        </div>
        {/* The empty state carries the create action; one primary per view. */}
        {(isLoading || orgs.length > 0) && (
          <div className="page-header-actions">
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus /> New organization
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle /> {error.message}
        </p>
      )}

      {isLoading ? (
        <div className="card card-flush">
          <div className="skeleton-rows" role="status" aria-label="Loading organizations">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        </div>
      ) : orgs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Building2 /></span>
            <p className="empty-state-title">No organizations yet</p>
            <p className="empty-state-body">
              Create your first organization to manage apps, users, and team members.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus /> Create your first organization
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {orgs.map((org: any) => {
            const open = () => navigate({ to: "/organizations/$orgId", params: { orgId: org.id } } as any);
            return (
              <div
                key={org.id}
                className="card card-flush card-link"
                role="link"
                tabIndex={0}
                onClick={open}
                onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }}
              >
                <div className="list-row">
                  <OrgAvatar
                    name={org.name ?? "O"}
                    logo={org.logo ?? null}
                    size={40}
                  />

                  <div className="list-row-main">
                    <div className="row">
                      <p className="list-row-title truncate">{org.name}</p>
                      {org.role && (
                        <span className={`badge ${org.role === "owner" ? "badge-warning" : org.role === "admin" ? "badge-info" : "badge-neutral"}`}>
                          {org.role === "owner" && <Crown aria-hidden="true" />}
                          {org.role === "admin" && <Shield aria-hidden="true" />}
                          {sentenceCase(org.role)}
                        </span>
                      )}
                    </div>
                    {org.slug && (
                      <p className="text-mono text-sm text-tertiary truncate">{org.slug}</p>
                    )}
                  </div>

                  <ChevronRight className="text-tertiary" size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

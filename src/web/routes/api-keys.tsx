import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal, ModalHeader } from "@/components/Modal";
import { useApiKeys, useDeleteApiKey } from "@/hooks/use-api-keys";
import { apiKey, useActiveOrganization } from "@/lib/auth-client";
import { queryClient } from "@/lib/query-client";
import { apiKeyKeys } from "@/lib/query-keys";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Building2, Check, Copy, Key, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/api-keys")({
  component: ApiKeysPage,
});

type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  lastRequest: Date | string | null;
  requestCount: number;
  configId?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(d: string | null) {
  if (!d) return "Never";
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── One-time key reveal modal ─────────────────────────────────────────────────

function KeyRevealModal({ keyValue, onClose }: { keyValue: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(keyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal onClose={onClose} maxWidth={520}>
      <ModalHeader
        title="Save your API key"
        subtitle="This won't be shown again after you close this dialog."
        icon={<span className="icon-tile" aria-hidden="true"><Key /></span>}
      />

      <div className="modal-body">
        <div className="code-block">{keyValue}</div>
      </div>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Done — I've saved it
        </button>
        <button type="button" className="btn btn-primary" onClick={copy}>
          {copied ? <><Check /> Copied</> : <><Copy /> Copy key</>}
        </button>
      </div>
    </Modal>
  );
}

// ── Create key form ───────────────────────────────────────────────────────────

function CreateKeyForm({
  organizationId,
  onCreated,
  onClose,
}: {
  organizationId: string | null;
  onCreated: (key: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("never");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const EXPIRY_OPTIONS = [
    { label: "Never", value: "never" },
    { label: "7 days", value: "604800" },
    { label: "30 days", value: "2592000" },
    { label: "90 days", value: "7776000" },
    { label: "1 year", value: "31536000" },
  ];

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setError("");
    setLoading(true);
    try {
      const result = await apiKey.create({
        name: name.trim(),
        configId: organizationId ? "organization" : "personal",
        ...(expiry !== "never" ? { expiresIn: parseInt(expiry) } : {}),
        ...(organizationId ? { organizationId } : {}),
      });
      if (result.error) throw new Error(result.error.message ?? "Failed to create key");
      const rawKey = result.data?.key;
      if (!rawKey) throw new Error("Key created but server did not return the plaintext value — check the API key plugin version");
      // Invalidate the list so it refreshes after the reveal modal is closed
      void queryClient.invalidateQueries({
        queryKey: apiKeyKeys.list({ organizationId }),
      });
      onCreated(rawKey);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create API key";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  return (
    <section className="card card-flush" style={{ marginBottom: 20 }} aria-labelledby="new-api-key-title">
      <div className="panel-header">
        <h2 className="panel-title" id="new-api-key-title"><Key /> New API key</h2>
      </div>
      <div className="panel-body stack">
      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="api-key-name">Name</label>
          <input
            id="api-key-name"
            ref={nameRef}
            className="input"
            placeholder="e.g. kova-meet backend"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="api-key-expiry">Expires</label>
          <select
            id="api-key-expiry"
            className="select"
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
          >
            {EXPIRY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={handleCreate}>
          {loading ? "Creating…" : <><Plus /> Create</>}
        </button>
      </div>
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ApiKeysPage() {
  const { data: activeOrg } = useActiveOrganization();
  const activeOrgId = activeOrg?.id ?? null;

  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [creating, setCreating] = useState(false);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const { data: keys = [], isLoading, error } = useApiKeys({ organizationId: activeOrgId });

  // ── Mutation ──────────────────────────────────────────────────────────────────
  const deleteKey = useDeleteApiKey();

  const handleDelete = useCallback((key: ApiKey) => {
    setRevokeTarget(null);
    const configId = activeOrgId ? "organization" : "personal";
    deleteKey.mutate({ id: key.id, configId, organizationId: activeOrgId });
  }, [activeOrgId, deleteKey]);

  return (
    <div>
      {revealKey && (
        <KeyRevealModal keyValue={revealKey} onClose={() => setRevealKey(null)} />
      )}
      {revokeTarget && (
        <ConfirmModal
          title="Revoke API key?"
          body={`"${revokeTarget.name ?? "Unnamed key"}" will be permanently revoked. Any service using it will lose access immediately.`}
          confirmLabel="Revoke key"
          loading={deleteKey.isPending && deleteKey.variables?.id === revokeTarget.id}
          onConfirm={() => void handleDelete(revokeTarget)}
          onClose={() => setRevokeTarget(null)}
        />
      )}

      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Security</p>
          <h1 className="page-title">API keys</h1>
          <p className="page-subtitle">
            {activeOrg
              ? (<span className="row" style={{ gap: 6 }}><Building2 size={14} aria-hidden="true" /><span>Keys for <strong className="text-strong">{activeOrg.name}</strong></span></span>)
              : "Server-to-server access tokens — shown once on creation"
            }
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => void queryClient.invalidateQueries({ queryKey: apiKeyKeys.list({ organizationId: activeOrgId }) })}
            disabled={isLoading}
            title="Refresh"
            aria-label="Refresh API keys"
          >
            <RotateCcw className={isLoading ? "spin" : ""} />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={creating}>
            <Plus /> Create API key
          </button>
        </div>
      </header>

      {creating && (
        <CreateKeyForm
          organizationId={activeOrgId}
          onCreated={(key) => setRevealKey(key)}
          onClose={() => setCreating(false)}
        />
      )}

      {(error || deleteKey.error) && (
        <p className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle /> {error?.message ?? deleteKey.error?.message}
        </p>
      )}

      <div className="card card-flush">
        {isLoading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading API keys">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : keys.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Key /></span>
            <p className="empty-state-title">No API keys yet</p>
            <p className="empty-state-body">
              API keys allow your backend services to authenticate against this platform without a browser session.
            </p>
          </div>
        ) : (
          <table className="data-table is-stackable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key prefix</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Last used</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => {
                const expired = k.expiresAt ? new Date(k.expiresAt) < new Date() : false;
                const revoking = deleteKey.isPending && deleteKey.variables?.id === k.id;
                return (
                  <tr key={k.id}>
                    <td data-label="Name">
                      <div className="row">
                        <span className="cell-primary truncate">{k.name ?? "Unnamed key"}</span>
                        {!k.enabled && <span className="badge badge-neutral">Disabled</span>}
                      </div>
                    </td>
                    <td data-label="Key prefix">
                      <span className="mono-chip">
                        {k.prefix ? `${k.prefix}_` : ""}{k.start ?? "••••••••"}…
                      </span>
                    </td>
                    <td data-label="Created" className="cell-meta">{fmt(String(k.createdAt))}</td>
                    <td data-label="Expires" className="cell-meta">
                      {k.expiresAt
                        ? expired
                          ? <span className="text-danger">{fmt(String(k.expiresAt))} (expired)</span>
                          : <span>{fmt(String(k.expiresAt))}</span>
                        : <span className="badge badge-neutral">Never</span>
                      }
                    </td>
                    <td data-label="Last used" className="cell-meta">
                      {relativeTime(k.lastRequest ? String(k.lastRequest) : null)}
                      {k.requestCount > 0 && (
                        <span className="text-sm" style={{ marginInlineStart: 6 }}>
                          ({k.requestCount.toLocaleString()} reqs)
                        </span>
                      )}
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={revoking}
                        onClick={() => setRevokeTarget(k as ApiKey)}
                        title="Revoke key"
                      >
                        <Trash2 />
                        {revoking ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Usage info */}
      <section className="card card-flush" style={{ marginTop: 20 }} aria-labelledby="api-key-usage-title">
        <div className="panel-header">
          <h2 className="panel-title" id="api-key-usage-title">Using an API key</h2>
        </div>
        <div className="panel-body">
        <pre className="code-block" style={{ overflowX: "auto" }}>
          {`// In your backend service:\nconst res = await fetch("${window.location.origin}/api/auth/api-key/verify", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ key: "your_api_key_here" }),\n});\nconst { valid, key } = await res.json();`}
        </pre>
        </div>
      </section>
    </div>
  );
}

import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { useApiKeys, useDeleteApiKey } from "@/hooks/use-api-keys";
import { apiKey, useActiveOrganization } from "@/lib/auth-client";
import { queryClient } from "@/lib/query-client";
import { apiKeyKeys } from "@/lib/query-keys";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Building2, Check, Copy, Key, Plus, RotateCcw, Trash2, X } from "lucide-react";
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
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 5, flexShrink: 0,
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Key size={15} color="var(--color-accent)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.88rem" }}>Save your API key</p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>
              This won't be shown again after you close this dialog.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 6 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="modal-body">
        <div style={{
          background: "var(--color-surface-raised)", borderRadius: 4, padding: "11px 14px",
          fontFamily: "var(--font-mono)", fontSize: "0.77rem", color: "var(--color-accent)",
          wordBreak: "break-all", border: "1px solid var(--color-border)",
          letterSpacing: "0.03em",
        }}>
          {keyValue}
        </div>

        <div className="modal-footer" style={{ border: "none", padding: 0 }}>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={copy}>
            {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy key</>}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
            Done — I've saved it
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create key form ───────────────────────────────────────────────────────────

function CreateKeyForm({
  organizationId,
  onCreated,
}: {
  organizationId: string | null;
  onCreated: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
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
      setName("");
      setExpiry("never");
      setOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create API key";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={14} /> Create API key
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 20 }}>
      <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 14, fontSize: "0.88rem", letterSpacing: "-0.02em" }}>
        New API key
      </p>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "8px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="form-label">Name</label>
          <input
            ref={nameRef}
            className="input"
            placeholder="e.g. ralph-meet backend"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div style={{ width: 140 }}>
          <label className="form-label">Expires</label>
          <select
            className="input"
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
            style={{ cursor: "pointer" }}
          >
            {EXPIRY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={loading} onClick={handleCreate}>
          {loading ? "Creating…" : <><Plus size={13} /> Create</>}
        </button>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); setError(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ApiKeysPage() {
  const { data: activeOrg } = useActiveOrganization();
  const activeOrgId = activeOrg?.id ?? null;

  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

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
    <div className="animate-in">
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Security</p>
          <h1 className="page-title">API Keys</h1>
          <p className="page-subtitle" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {activeOrg
              ? (<><Building2 size={11} /><span>Keys for <strong style={{ color: "var(--color-text-primary)" }}>{activeOrg.name}</strong></span></>)
              : "Server-to-server access tokens — shown once on creation"
            }
          </p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => void queryClient.invalidateQueries({ queryKey: apiKeyKeys.list({ organizationId: activeOrgId }) })}
          disabled={isLoading}
          title="Refresh"
        >
          <RotateCcw size={14} className={isLoading ? "spin" : ""} />
        </button>
      </div>

      <CreateKeyForm organizationId={activeOrgId} onCreated={(key) => setRevealKey(key)} />

      {(error || deleteKey.error) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
        }}>
          <AlertCircle size={13} /> {error?.message ?? deleteKey.error?.message}
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <div className="loading" style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
        </div>
      ) : keys.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 36, height: 36, borderRadius: 5, margin: "0 auto 12px",
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Key size={16} color="var(--color-accent)" />
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 5, letterSpacing: "-0.02em" }}>No API keys yet</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>
            API keys allow your backend services to authenticate against this platform without a browser session.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Name", "Key prefix", "Created", "Expires", "Last used", ""].map(h => (
                  <th key={h} style={{
                    padding: "9px 16px", textAlign: "left",
                    fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 600,
                    color: "var(--color-text-tertiary)",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k, i) => (
                <tr
                  key={k.id}
                  style={{
                    borderBottom: i < keys.length - 1 ? "1px solid var(--color-border)" : "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: 2,
                        background: k.enabled ? "var(--color-green)" : "var(--color-text-tertiary)", flexShrink: 0,
                      }} />
                      <span style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", fontWeight: 500, fontSize: "0.84rem" }}>
                        {k.name ?? "Unnamed key"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <code style={{
                      fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)",
                      background: "var(--color-surface-raised)", padding: "2px 6px", borderRadius: 3,
                      border: "1px solid var(--color-border)",
                    }}>
                      {k.prefix ? `${k.prefix}_` : ""}{k.start ?? "••••••••"}…
                    </code>
                  </td>
                  <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)" }}>
                    {fmt(String(k.createdAt))}
                  </td>
                  <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)" }}>
                    {k.expiresAt
                      ? <span style={{ color: new Date(k.expiresAt) < new Date() ? "var(--color-red)" : "var(--color-text-tertiary)" }}>{fmt(String(k.expiresAt))}</span>
                      : <span className="badge badge-gray">Never</span>
                    }
                  </td>
                  <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-tertiary)" }}>
                    {relativeTime(k.lastRequest ? String(k.lastRequest) : null)}
                    {k.requestCount > 0 && (
                      <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "var(--color-text-tertiary)", opacity: 0.7 }}>
                        ({k.requestCount.toLocaleString()} reqs)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      disabled={deleteKey.isPending && deleteKey.variables?.id === k.id}
                      onClick={() => setRevokeTarget(k as ApiKey)}
                      title="Revoke key"
                    >
                      <Trash2 size={12} />
                      {deleteKey.isPending && deleteKey.variables?.id === k.id ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage info */}
      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Using an API key</p>
        <code style={{
          display: "block", background: "var(--color-surface-raised)", borderRadius: 4,
          border: "1px solid var(--color-border)",
          padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: "0.75rem",
          color: "var(--color-text-secondary)", lineHeight: 1.8,
        }}>
          {`// In your backend service:\nconst res = await fetch("${window.location.origin}/api/auth/api-key/verify", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ key: "your_api_key_here" }),\n});\nconst { valid, key } = await res.json();`}
        </code>
      </div>
    </div>
  );
}

import { apiKey } from "@/lib/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Check, Copy, Key, Plus, RotateCcw, Trash2, X } from "lucide-react";
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
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--color-surface-800)", border: "1px solid var(--color-border)",
          borderRadius: 16, padding: 32, maxWidth: 520, width: "100%",
          boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: "rgba(99,102,241,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Key size={18} color="#818cf8" />
          </div>
          <div>
            <p style={{ fontWeight: 700, color: "#e2e8f0" }}>Save your API key</p>
            <p style={{ fontSize: "0.78rem", color: "#64748b" }}>
              This won't be shown again after you close this dialog.
            </p>
          </div>
          <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 6 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{
          background: "var(--color-surface-700)", borderRadius: 8, padding: "12px 14px",
          fontFamily: "monospace", fontSize: "0.8rem", color: "#c4b5fd",
          wordBreak: "break-all", marginBottom: 16, border: "1px solid var(--color-border)",
        }}>
          {keyValue}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={copy}
          >
            {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy key</>}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
            Done — I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create key form ───────────────────────────────────────────────────────────

function CreateKeyForm({ onCreated }: { onCreated: (key: string) => void }) {
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
        ...(expiry !== "never" ? { expiresIn: parseInt(expiry) } : {}),
      });
      if (result.error) throw new Error(result.error.message ?? "Failed to create key");
      const rawKey = result.data?.key ?? result.data?.id;
      onCreated(rawKey);
      setName("");
      setExpiry("never");
      setOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create API key");
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
      <p style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 16, fontSize: "0.95rem" }}>
        New API key
      </p>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: "0.8rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 5 }}>
            Name
          </label>
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
          <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 5 }}>
            Expires
          </label>
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
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiKey.list({ query: { sortBy: "createdAt", sortDirection: "desc" } });
      if (res.error) throw new Error(res.error.message);
      setKeys(res.data?.apiKeys ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await apiKey.delete({ keyId: id });
      setKeys(k => k.filter(x => x.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to revoke key");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="animate-in">
      {revealKey && (
        <KeyRevealModal keyValue={revealKey} onClose={() => { setRevealKey(null); loadKeys(); }} />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
            API Keys
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>
            Server-to-server access tokens — shown once on creation
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadKeys} disabled={loading} title="Refresh">
          <RotateCcw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      <CreateKeyForm onCreated={(key) => setRevealKey(key)} />

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: "0.83rem",
        }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "#475569" }}>Loading…</div>
      ) : keys.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <Key size={28} color="#334155" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600, color: "#64748b", marginBottom: 6 }}>No API keys yet</p>
          <p style={{ fontSize: "0.82rem", color: "#475569" }}>
            API keys allow your backend services to authenticate against this platform
            without a browser session.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Name", "Key prefix", "Created", "Expires", "Last used", ""].map(h => (
                  <th key={h} style={{
                    padding: "10px 16px", textAlign: "left",
                    fontSize: "0.7rem", fontWeight: 600, color: "#475569",
                    textTransform: "uppercase", letterSpacing: "0.06em",
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
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-700)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: k.enabled ? "#22c55e" : "#475569", flexShrink: 0,
                      }} />
                      <span style={{ color: "#e2e8f0", fontWeight: 500, fontSize: "0.87rem" }}>
                        {k.name ?? "Unnamed key"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <code style={{
                      fontFamily: "monospace", fontSize: "0.8rem", color: "#94a3b8",
                      background: "var(--color-surface-700)", padding: "2px 8px", borderRadius: 4,
                    }}>
                      {k.prefix ? `${k.prefix}_` : ""}{k.start ?? "••••••••"}…
                    </code>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "0.82rem", color: "#64748b" }}>
                    {fmt(String(k.createdAt))}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "0.82rem", color: "#64748b" }}>
                    {k.expiresAt
                      ? <span style={{ color: new Date(k.expiresAt) < new Date() ? "#f87171" : "#64748b" }}>{fmt(String(k.expiresAt))}</span>
                      : <span className="badge badge-gray">Never</span>
                    }
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "0.82rem", color: "#64748b" }}>
                    {relativeTime(k.lastRequest ? String(k.lastRequest) : null)}
                    {k.requestCount > 0 && (
                      <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#475569" }}>
                        ({k.requestCount.toLocaleString()} reqs)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      disabled={deletingId === k.id}
                      onClick={() => handleDelete(k.id)}
                      title="Revoke key"
                    >
                      <Trash2 size={12} />
                      {deletingId === k.id ? "Revoking…" : "Revoke"}
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
        <p style={{ fontSize: "0.7rem", color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Using an API key
        </p>
        <code style={{
          display: "block", background: "var(--color-surface-700)", borderRadius: 8,
          padding: "12px 14px", fontSize: "0.78rem", color: "#94a3b8",
          fontFamily: "monospace", lineHeight: 1.7,
        }}>
          {`// In your backend service:\nconst res = await fetch("${window.location.origin}/api/auth/api-key/verify", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ key: "your_api_key_here" }),\n});\nconst { valid, key } = await res.json();`}
        </code>
      </div>
    </div>
  );
}

import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import {
  useApplications,
  useCreateApplication,
  useDeleteApplication,
  useRotateSecret,
  useUpdateApplication,
  type Application,
} from "@/hooks/use-applications";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Key,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/applications")({
  component: ApplicationsPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "Just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Secret reveal modal ──────────────────────────────────────────────────────

function SecretRevealModal({ secret, label, onClose }: {
  secret: string;
  label: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal onClose={onClose} maxWidth={520} scrollableBody>
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 6, flexShrink: 0,
            background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Key size={16} color="var(--color-green)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.88rem" }}>
              {label}
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>
              This secret will not be shown again — copy it now.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="modal-body" style={{ gap: 12 }}>
        <p className="form-label" style={{ marginBottom: 6 }}>Secret key (sk_*)</p>
        <div style={{
          background: "var(--color-surface-raised)", border: "1px solid rgba(52,211,153,0.25)",
          borderRadius: 4, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{
            flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.76rem",
            color: "var(--color-green)", wordBreak: "break-all",
            filter: visible ? "none" : "blur(5px)", transition: "filter 0.15s",
            userSelect: visible ? "text" : "none",
          }}>
            {secret}
          </span>
          <button className="btn btn-ghost" style={{ padding: "4px 6px", flexShrink: 0 }}
            onClick={() => setVisible(v => !v)}>
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <p className="form-hint" style={{ marginTop: 4 }}>
          For server-to-server use only — never expose this in client code.
        </p>
      </div>

      <div className="modal-footer">
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}
          onClick={() => void copy()}>
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy secret</>}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
          Done — I&apos;ve saved it
        </button>
      </div>
    </Modal>
  );
}

// ── Create application modal ──────────────────────────────────────────────────

function CreateAppModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (app: Application, secret: string) => void;
}) {
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"development" | "production">("development");
  const [originsText, setOriginsText] = useState("");
  const [redirectsText, setRedirectsText] = useState("");
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateApplication();

  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 50); }, []);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setError("");
    create.mutate(
      {
        name: name.trim(),
        environment: env,
        allowed_origins: originsText.split("\n").map(s => s.trim()).filter(Boolean),
        redirect_uris: redirectsText.split("\n").map(s => s.trim()).filter(Boolean),
      },
      {
        onSuccess: (r) => onCreated(r.app, r.rawSecretKey),
        onError: (e) => setError(e.message ?? "Failed"),
      },
    );
  };

  return (
    <Modal onClose={onClose} maxWidth={560} scrollableBody>
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, flexShrink: 0,
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Layers size={15} color="var(--color-accent)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.88rem" }}>
              Create application
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>
              Register a new SDK consumer with its own publishable key.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="modal-body" style={{ gap: 16 }}>
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 4, padding: "8px 12px",
            fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
          }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Application name</label>
          <input ref={nameRef} className="input" value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My SaaS App"
            onKeyDown={e => e.key === "Enter" && void handleSubmit()} />
        </div>

        <div className="form-group">
          <label className="form-label">Environment</label>
          {/* Segmented toggle — single continuous pill */}
          <div style={{
            display: "flex", borderRadius: 5, overflow: "hidden",
            border: "1px solid var(--color-border)", background: "var(--color-surface-raised)",
          }}>
            {(["development", "production"] as const).map((e, i) => (
              <button key={e} onClick={() => setEnv(e)} style={{
                flex: 1, padding: "7px 0", cursor: "pointer",
                background: env === e ? "var(--color-accent)" : "transparent",
                border: "none",
                borderLeft: i === 1 ? "1px solid var(--color-border)" : "none",
                color: env === e ? "#fff" : "var(--color-text-tertiary)",
                fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: env === e ? 600 : 400,
                transition: "background 0.15s, color 0.15s",
              }}>
                {e}
              </button>
            ))}
          </div>
          <p className="form-hint" style={{ marginTop: 5 }}>
            Keys use <code>pk_dev_*</code> / <code>pk_live_*</code> prefix accordingly.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Allowed origins</label>
          <textarea className="input" rows={3} value={originsText}
            onChange={e => setOriginsText(e.target.value)}
            placeholder={"http://localhost:5180\nhttps://app.example.com"}
            style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.76rem", lineHeight: 1.7 }} />
          <p className="form-hint">One origin per line. CORS is sourced from this list for SDK requests.</p>
        </div>

        <div className="form-group">
          <label className="form-label">Allowed redirect URIs</label>
          <textarea className="input" rows={3} value={redirectsText}
            onChange={e => setRedirectsText(e.target.value)}
            placeholder={"http://localhost:5180\nhttps://app.example.com/dashboard"}
            style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.76rem", lineHeight: 1.7 }} />
          <p className="form-hint">One URI per line. OAuth callbacks must match one of these prefixes.</p>
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-primary" disabled={create.isPending} onClick={() => void handleSubmit()}>
          {create.isPending ? "Creating…" : <><Plus size={13} /> Create application</>}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditAppModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const [name, setName] = useState(app.name);
  const [originsText, setOriginsText] = useState(app.allowed_origins.join("\n"));
  const [redirectsText, setRedirectsText] = useState(app.redirect_uris.join("\n"));
  const [error, setError] = useState("");
  const update = useUpdateApplication();

  const handleSave = async () => {
    update.mutate(
      {
        id: app.id,
        name: name.trim() || undefined,
        allowed_origins: originsText.split("\n").map(s => s.trim()).filter(Boolean),
        redirect_uris: redirectsText.split("\n").map(s => s.trim()).filter(Boolean),
      },
      { onSuccess: () => onClose(), onError: (e) => setError(e.message) },
    );
  };

  return (
    <Modal onClose={onClose} maxWidth={540} scrollableBody>
      <div className="modal-header">
        <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.88rem" }}>
          Edit — {app.name}
        </p>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="modal-body" style={{ gap: 16 }}>
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 4, padding: "8px 12px",
            fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
          }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Allowed origins</label>
          <textarea className="input" rows={3} value={originsText}
            onChange={e => setOriginsText(e.target.value)}
            style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.76rem", lineHeight: 1.7 }} />
          <p className="form-hint">One origin per line.</p>
        </div>
        <div className="form-group">
          <label className="form-label">Allowed redirect URIs</label>
          <textarea className="input" rows={3} value={redirectsText}
            onChange={e => setRedirectsText(e.target.value)}
            style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.76rem", lineHeight: 1.7 }} />
          <p className="form-hint">One URI per line.</p>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" disabled={update.isPending} onClick={() => void handleSave()}>
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Application card ──────────────────────────────────────────────────────────

function AppCard({ app, onDelete }: { app: Application; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [pkCopied, setPkCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const rotate = useRotateSecret();

  const copyPk = async () => {
    await navigator.clipboard.writeText(app.publishable_key);
    setPkCopied(true);
    setTimeout(() => setPkCopied(false), 2000);
  };

  const handleRotate = async () => {
    setRotateConfirm(false);
    rotate.mutate({ id: app.id }, { onSuccess: (r) => setRevealedSecret(r.rawSecretKey) });
  };

  const isProd = app.environment === "production";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {deleteConfirm && (
        <ConfirmModal
          title="Delete application?"
          body={`"${app.name}" and its publishable key will be permanently removed. SDK consumers using this key will stop working immediately.`}
          confirmLabel="Delete application"
          loading={false}
          onConfirm={() => { setDeleteConfirm(false); onDelete(app.id); }}
          onClose={() => setDeleteConfirm(false)}
        />
      )}
      {rotateConfirm && (
        <ConfirmModal
          title="Rotate secret key?"
          body="The current secret key will be invalidated immediately. Any server using it will need to be updated with the new key."
          confirmLabel="Rotate secret"
          loading={false}
          onConfirm={() => void handleRotate()}
          onClose={() => setRotateConfirm(false)}
        />
      )}
      {editOpen && <EditAppModal app={app} onClose={() => setEditOpen(false)} />}
      {revealedSecret && (
        <SecretRevealModal
          secret={revealedSecret}
          label={`New secret for "${app.name}"`}
          onClose={() => setRevealedSecret(null)}
        />
      )}

      {/* Card header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
        {/* App icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 8, flexShrink: 0,
          background: isProd ? "rgba(52,211,153,0.08)" : "var(--color-accent-dim)",
          border: `1px solid ${isProd ? "rgba(52,211,153,0.2)" : "rgba(59,130,246,0.15)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Layers size={16} color={isProd ? "var(--color-green)" : "var(--color-accent)"} />
        </div>

        {/* Name + key */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.86rem",
              color: "var(--color-text-primary)",
            }}>
              {app.name}
            </span>
            <span className={`badge ${isProd ? "badge-green" : "badge-gray"}`}>
              {app.environment}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <code style={{
              fontSize: "0.7rem", color: "var(--color-text-tertiary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420,
            }}>
              {app.publishable_key}
            </code>
            <button className="btn btn-ghost" style={{ padding: "2px 5px", flexShrink: 0 }}
              title="Copy publishable key" onClick={() => void copyPk()}>
              {pkCopied ? <Check size={11} color="var(--color-green)" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: "0.74rem" }}
            onClick={() => setEditOpen(true)}>
            Edit
          </button>
          <button className="btn btn-ghost" style={{ padding: "5px 8px" }}
            title={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded(v => !v)}>
            {expanded
              ? <ChevronDown size={13} color="var(--color-text-secondary)" />
              : <ChevronRight size={13} color="var(--color-text-secondary)" />}
          </button>
          <button className="btn btn-danger" style={{ padding: "5px 8px" }}
            title="Delete application" onClick={() => setDeleteConfirm(true)}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Origins */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Globe size={12} color="var(--color-text-tertiary)" />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Allowed origins
                </span>
                <span className="badge badge-gray" style={{ fontSize: "0.58rem" }}>
                  {app.allowed_origins.length}
                </span>
              </div>
              {app.allowed_origins.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {app.allowed_origins.map(o => (
                    <code key={o} style={{
                      fontSize: "0.72rem", background: "var(--color-surface-raised)",
                      border: "1px solid var(--color-border)", borderRadius: 4, padding: "3px 8px",
                      color: "var(--color-text-secondary)",
                    }}>{o}</code>
                  ))}
                </div>
              ) : (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-amber)" }}>
                  ⚠ No origin restrictions — not recommended for production
                </p>
              )}
            </div>

            {/* Redirect URIs */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Key size={12} color="var(--color-text-tertiary)" />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Redirect URIs
                </span>
                <span className="badge badge-gray" style={{ fontSize: "0.58rem" }}>
                  {app.redirect_uris.length}
                </span>
              </div>
              {app.redirect_uris.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {app.redirect_uris.map(u => (
                    <code key={u} style={{
                      fontSize: "0.72rem", background: "var(--color-surface-raised)",
                      border: "1px solid var(--color-border)", borderRadius: 4, padding: "3px 8px",
                      color: "var(--color-text-secondary)",
                    }}>{u}</code>
                  ))}
                </div>
              ) : (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>
                  No redirect URI restrictions
                </p>
              )}
            </div>

            {/* Meta + rotate secret */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                    Created
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)" }}>
                    {relTime(app.createdAt)}
                  </p>
                </div>
                <div>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                    Updated
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)" }}>
                    {relTime(app.updatedAt)}
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost" style={{ gap: 6 }}
                disabled={rotate.isPending} onClick={() => setRotateConfirm(true)}>
                <RefreshCw size={12} />
                {rotate.isPending ? "Rotating…" : "Rotate secret key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Integration guide ─────────────────────────────────────────────────────────

function IntegrationGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 9,
          padding: "12px 16px", background: "none", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)")}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "")}
      >
        <Key size={13} color="var(--color-text-secondary)" />
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          SDK integration guide
        </span>
        {open
          ? <ChevronDown size={12} color="var(--color-text-tertiary)" />
          : <ChevronRight size={12} color="var(--color-text-tertiary)" />}
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "14px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["1", "Create an application — use development for local SDKs, production for deployed apps."],
              ["2", "Add your app's origin to allowed origins so CORS is permitted for SDK requests."],
              ["3", `Pass the publishable key to your provider: <RalphAuthProvider publishableKey="pk_dev_..." />`],
              ["4", "The SDK forwards it as X-Publishable-Key — the server validates it on every request."],
              ["5", "The secret key (sk_*) is for server-side use only — webhook signing, token issuance, etc."],
            ].map(([n, text]) => (
              <div key={n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
                  background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)", fontSize: "0.62rem", fontWeight: 700, color: "var(--color-accent)",
                }}>{n}</span>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ApplicationsPage() {
  const { data: apps = [], isLoading, error } = useApplications();
  const deleteApp = useDeleteApplication();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{ name: string; secret: string } | null>(null);

  return (
    <div className="animate-in">
      {createOpen && (
        <CreateAppModal
          onClose={() => setCreateOpen(false)}
          onCreated={(app, secret) => {
            setCreateOpen(false);
            setRevealedSecret({ name: app.name, secret });
          }}
        />
      )}
      {revealedSecret && (
        <SecretRevealModal
          secret={revealedSecret.secret}
          label={`Secret for "${revealedSecret.name}"`}
          onClose={() => setRevealedSecret(null)}
        />
      )}

      {/* Page header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>SDK</p>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle">
            {isLoading ? "Loading…" : `${apps.length} registered app${apps.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New application
        </button>
      </div>

      <IntegrationGuide />

      {/* Error */}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6,
          fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-red)",
        }}>
          <AlertTriangle size={14} /> {error.message}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: 70, borderRadius: 8 }} />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && apps.length === 0 && (
        <div className="empty-state">
          <Layers size={34} color="var(--color-text-tertiary)" />
          <p>No applications yet</p>
          <p style={{ fontSize: "0.78rem", color: "var(--color-text-tertiary)", marginTop: 4 }}>
            Create your first application to get a publishable key for your SDK.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> Create application
          </button>
        </div>
      )}

      {/* App list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {apps.map(app => (
          <AppCard
            key={app.id}
            app={app}
            onDelete={(id) => deleteApp.mutate({ id })}
          />
        ))}
      </div>
    </div>
  );
}

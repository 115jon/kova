import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal, ModalHeader, ModalScrollBody } from "@/components/Modal";
import {
  useApplications,
  useCreateApplication,
  useDeleteApplication,
  useRotateSecret,
  useUpdateApplication,
  type Application,
} from "@/hooks/use-applications";
import { sentenceCase } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Key,
  Layers,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
      <ModalHeader
        title={label}
        subtitle="This secret will not be shown again — copy it now."
        icon={<span className="icon-tile tone-success" aria-hidden="true"><Key /></span>}
      />

      <ModalScrollBody>
        <div className="modal-body">
          <div className="form-group">
            <p className="form-label">Secret key (sk_*)</p>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div
                className="code-block"
                style={{
                  flex: 1,
                  // Hides the secret until revealed: functional, not decorative.
                  filter: visible ? "none" : "blur(5px)",
                  userSelect: visible ? "text" : "none",
                }}
              >
                {secret}
              </div>
              <button
                type="button"
                className="btn btn-subtle btn-icon"
                aria-label={visible ? "Hide secret" : "Reveal secret"}
                aria-pressed={visible}
                onClick={() => setVisible(v => !v)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <p className="form-hint">
              For server-to-server use only — never expose this in client code.
            </p>
          </div>
        </div>
      </ModalScrollBody>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Done — I&apos;ve saved it
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? <><Check /> Copied</> : <><Copy /> Copy secret</>}
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
      <ModalHeader
        title="Create application"
        subtitle="Register a new SDK consumer with its own publishable key."
        icon={<span className="icon-tile" aria-hidden="true"><Layers /></span>}
      />

      <ModalScrollBody>
        <div className="modal-body">
          {error && (
            <p className="alert alert-danger" role="alert"><AlertTriangle /> {error}</p>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="app-name">Application name</label>
            <input id="app-name" ref={nameRef} className="input" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My SaaS app"
              onKeyDown={e => e.key === "Enter" && void handleSubmit()} />
          </div>

          <div className="form-group">
            <span className="form-label" id="app-env-label">Environment</span>
            <div className="segmented" role="group" aria-labelledby="app-env-label">
              {(["development", "production"] as const).map(e => (
                <button key={e} type="button" className="segmented-option"
                  aria-pressed={env === e} onClick={() => setEnv(e)}>
                  {sentenceCase(e)}
                </button>
              ))}
            </div>
            <p className="form-hint">
              Keys use <code>pk_dev_*</code> / <code>pk_live_*</code> prefix accordingly.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="app-origins">Allowed origins</label>
            <textarea id="app-origins" className="input input-mono" rows={3} value={originsText}
              onChange={e => setOriginsText(e.target.value)}
              placeholder={"http://localhost:5180\nhttps://app.example.com"} />
            <p className="form-hint">One origin per line. CORS is sourced from this list for SDK requests.</p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="app-redirects">Allowed redirect URIs</label>
            <textarea id="app-redirects" className="input input-mono" rows={3} value={redirectsText}
              onChange={e => setRedirectsText(e.target.value)}
              placeholder={"http://localhost:5180\nhttps://app.example.com/dashboard"} />
            <p className="form-hint">One URI per line. OAuth callbacks must match one of these prefixes.</p>
          </div>
        </div>
      </ModalScrollBody>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void handleSubmit()}>
          {create.isPending ? "Creating…" : <><Plus /> Create application</>}
        </button>
      </div>
    </Modal>
  );
}

// ── Application row ───────────────────────────────────────────────────────────

function AppCard({ app, onDelete }: { app: Application; onDelete: (id: string, name: string) => void }) {
  const [pkCopied, setPkCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const copyPk = async () => {
    await navigator.clipboard.writeText(app.publishable_key);
    setPkCopied(true);
    setTimeout(() => setPkCopied(false), 2000);
  };

  const isProd = app.environment === "production";

  return (
    <div className="list-row">
      {deleteConfirm && (
        <ConfirmModal
          title="Delete application?"
          body={`"${app.name}" and its publishable key will be permanently removed. SDK consumers using this key will stop working immediately.`}
          confirmLabel="Delete application"
          loading={false}
          onConfirm={() => { setDeleteConfirm(false); onDelete(app.id, app.name); }}
          onClose={() => setDeleteConfirm(false)}
        />
      )}

      <span className={`icon-tile icon-tile-lg ${isProd ? "tone-success" : ""}`} aria-hidden="true">
        <Layers />
      </span>

      {/* Name + key: the name opens the detail page */}
      <div className="list-row-main stack-sm" style={{ gap: 4 }}>
        <div className="row">
          <Link
            to="/applications/$appId"
            params={{ appId: app.id }}
            className="list-row-title truncate min-w-0"
          >
            {app.name}
          </Link>
          <span className={`badge ${isProd ? "badge-success" : "badge-neutral"}`}>
            {sentenceCase(app.environment)}
          </span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className="mono-chip">{app.publishable_key}</span>
          <button
            type="button"
            className="btn btn-subtle btn-sm btn-icon"
            title="Copy publishable key"
            aria-label="Copy publishable key"
            onClick={() => void copyPk()}
          >
            {pkCopied ? <Check className="text-success" /> : <Copy />}
          </button>
        </div>
      </div>

      <div className="list-row-actions">
        <Link
          to="/applications/$appId"
          params={{ appId: app.id }}
          className="btn btn-secondary btn-sm"
        >
          <Settings />
          Manage
        </Link>
        <button
          type="button"
          className="btn btn-danger btn-sm btn-icon"
          title="Delete application"
          aria-label={`Delete ${app.name}`}
          onClick={() => setDeleteConfirm(true)}
        >
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

// ── Integration guide ─────────────────────────────────────────────────────────

const GUIDE_STEPS: { n: string; text: ReactNode }[] = [
  { n: "1", text: "Create an application — use development for local SDKs, production for deployed apps." },
  { n: "2", text: "Add your app's origin to allowed origins so CORS is permitted for SDK requests." },
  { n: "3", text: <>Pass the publishable key to your provider: <code>{'<KovaAuthProvider publishableKey="pk_dev_..." />'}</code></> },
  { n: "4", text: <>The SDK forwards it as <code>X-Publishable-Key</code> — the server validates it on every request.</> },
  { n: "5", text: <>The secret key (<code>sk_*</code>) is for server-side use only — webhook signing, token issuance, etc.</> },
];

function IntegrationGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card card-flush" style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="panel-header"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ width: "100%", cursor: "pointer", textAlign: "start", borderBlockEndWidth: open ? 1 : 0 }}
      >
        <span className="panel-title"><Key /> SDK integration guide</span>
        {open ? <ChevronDown className="text-tertiary" size={16} /> : <ChevronRight className="text-tertiary" size={16} />}
      </button>
      {open && (
        <div className="panel-body stack-sm">
          {GUIDE_STEPS.map(({ n, text }) => (
            <div key={n} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
              <span className="avatar text-sm tabular" style={{ width: 22, height: 22 }} aria-hidden="true">{n}</span>
              <p className="text-sm text-secondary min-w-0" style={{ lineHeight: 1.6 }}>{text}</p>
            </div>
          ))}
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
    <div>
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

      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">SDK</p>
          <h1 className="page-title">Applications</h1>
          {isLoading ? (
            <p className="page-subtitle"><span className="skeleton" style={{ height: 14, width: 120 }} /></p>
          ) : (
            <p className="page-subtitle tabular">{`${apps.length} registered app${apps.length !== 1 ? "s" : ""}`}</p>
          )}
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus /> New application
          </button>
        </div>
      </header>

      <IntegrationGuide />

      {error && (
        <p className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle /> {error.message}
        </p>
      )}

      {isLoading && (
        <div className="card card-flush">
          <div className="skeleton-rows" role="status" aria-label="Loading applications">
            <span className="skeleton" style={{ height: 36 }} />
            <span className="skeleton" style={{ height: 36 }} />
          </div>
        </div>
      )}

      {!isLoading && !error && apps.length === 0 && (
        <div className="card card-flush">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Layers /></span>
            <p className="empty-state-title">No applications yet</p>
            <p className="empty-state-body">
              Create your first application to get a publishable key for your SDK.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus /> Create application
            </button>
          </div>
        </div>
      )}

      {apps.length > 0 && (
        <div className="card card-flush">
          {apps.map(app => (
            <AppCard
              key={app.id}
              app={app}
              onDelete={(id, name) => deleteApp.mutate({ id, confirmedName: name })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal, ModalHeader, ModalScrollBody } from "@/components/Modal";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
  useWebhooks,
  type WebhookEndpoint,
} from "@/hooks/use-webhooks";
import { webhookKeys } from "@/lib/query-keys";
import { sentenceCase } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Plus,
  RotateCcw,
  Send,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Webhook,
  Zap,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/webhooks")({
  component: WebhooksPage,
});

// Types are now imported from @/hooks/use-webhooks — keeping AuditAction locally
// for the CreateEndpointModal event catalogue which still needs it.
type AuditAction =
  | "user.signIn" | "user.signOut" | "user.signUp"
  | "user.passwordChanged" | "user.passwordSet" | "user.emailVerified"
  | "user.avatarUpdated" | "user.wallpaperUpdated"
  | "twoFactor.enabled" | "twoFactor.disabled" | "twoFactor.challengePassed"
  | "apiKey.created" | "apiKey.revoked" | "apiKey.allExpiredDeleted"
  | "session.revoked" | "session.revokeAll" | "session.expired"
  | "org.created" | "org.updated" | "org.deleted"
  | "member.invited" | "member.joined" | "member.removed" | "member.roleChanged"
  | "admin.userBanned" | "admin.userUnbanned" | "admin.userDeleted"
  | "admin.roleChanged" | "admin.passwordReset"
  | "device.approved";

// ── Event catalogue ──────────────────────────────────────────────────────────

type EventCategory = "auth" | "admin" | "org" | "key" | "session" | "2fa";

interface EventDef {
  action: AuditAction;
  label: string;
  description: string;
  category: EventCategory;
}

const EVENT_CATALOG: EventDef[] = [
  { action: "user.signIn", label: "User signed in", description: "Fired on every successful sign-in.", category: "auth" },
  { action: "user.signOut", label: "User signed out", description: "Fired when a user signs out.", category: "auth" },
  { action: "user.signUp", label: "User registered", description: "Fired when a new account is created.", category: "auth" },
  { action: "user.passwordChanged", label: "Password changed", description: "User updated their password via settings.", category: "auth" },
  { action: "user.passwordSet", label: "Password set", description: "OAuth-only user added a password for the first time.", category: "auth" },
  { action: "user.emailVerified", label: "Email verified", description: "User clicked the email verification link.", category: "auth" },
  { action: "user.avatarUpdated", label: "Avatar updated", description: "User or admin changed the profile photo.", category: "auth" },
  { action: "user.wallpaperUpdated", label: "Wallpaper updated", description: "User set, replaced, or cleared their wallpaper.", category: "auth" },
  { action: "twoFactor.enabled", label: "2FA enabled", description: "Two-factor authentication was switched on.", category: "2fa" },
  { action: "twoFactor.disabled", label: "2FA disabled", description: "Two-factor authentication was switched off.", category: "2fa" },
  { action: "twoFactor.challengePassed", label: "2FA challenge passed", description: "User passed a 2FA step successfully.", category: "2fa" },
  { action: "device.approved", label: "Machine approved", description: "An admin approved a bootstrap machine challenge.", category: "2fa" },
  { action: "apiKey.created", label: "API key created", description: "A new API key was issued.", category: "key" },
  { action: "apiKey.revoked", label: "API key revoked", description: "An API key was deleted.", category: "key" },
  { action: "apiKey.allExpiredDeleted", label: "Expired keys removed", description: "Batch sweep removed all expired API keys.", category: "key" },
  { action: "session.revoked", label: "Session revoked", description: "Admin revoked an individual session.", category: "session" },
  { action: "session.revokeAll", label: "All sessions revoked", description: "Admin bulk-revoked all other sessions.", category: "session" },
  { action: "session.expired", label: "Session expired", description: "A session reached its TTL and expired.", category: "session" },
  { action: "org.created", label: "Org created", description: "A new organization was created.", category: "org" },
  { action: "org.updated", label: "Org updated", description: "Organization settings were changed.", category: "org" },
  { action: "org.deleted", label: "Org deleted", description: "An organization was deleted.", category: "org" },
  { action: "member.invited", label: "Member invited", description: "An invitation was sent to join an org.", category: "org" },
  { action: "member.joined", label: "Member joined", description: "A user accepted an invitation and joined.", category: "org" },
  { action: "member.removed", label: "Member removed", description: "A member was removed from an org.", category: "org" },
  { action: "member.roleChanged", label: "Role changed", description: "A member's org role was updated.", category: "org" },
  { action: "admin.userBanned", label: "User banned", description: "Admin banned a user account.", category: "admin" },
  { action: "admin.userUnbanned", label: "User unbanned", description: "Admin lifted a ban.", category: "admin" },
  { action: "admin.userDeleted", label: "User deleted", description: "Admin permanently deleted a user account.", category: "admin" },
  { action: "admin.roleChanged", label: "Admin role changed", description: "Admin promoted or demoted a user role.", category: "admin" },
  { action: "admin.passwordReset", label: "Password reset sent", description: "Admin forced a password reset email.", category: "admin" },
];

// The dot is decoration only: the category label always sits next to it.
const CATEGORY_META: Record<EventCategory, { label: string; color: string }> = {
  auth: { label: "Auth", color: "var(--color-accent-text)" },
  "2fa": { label: "2FA", color: "var(--color-success-text)" },
  key: { label: "API key", color: "var(--color-warning-text)" },
  session: { label: "Session", color: "var(--color-text-secondary)" },
  org: { label: "Org", color: "var(--color-text-tertiary)" },
  admin: { label: "Admin", color: "var(--color-danger-text)" },
};

const CATEGORIES_BY_EVENT = Object.fromEntries(
  EVENT_CATALOG.map(e => [e.action, e.category])
) as Record<AuditAction, EventCategory>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function truncUrl(url: string, max = 52): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "…";
}

function parsedEvents(ep: WebhookEndpoint): string {
  if ((ep.eventList as string[]).includes("*")) return "All events";
  return `${ep.eventList.length} event${ep.eventList.length !== 1 ? "s" : ""}`;
}

function healthStatus(ep: WebhookEndpoint): "healthy" | "degraded" | "down" | "idle" {
  if (ep.failureCount > 3) return "down";
  if (ep.lastFailure && (!ep.lastSuccess || ep.lastFailure > ep.lastSuccess)) return "degraded";
  if (ep.lastSuccess) return "healthy";
  return "idle";
}

// ── Secret reveal modal ──────────────────────────────────────────────────────

function SecretRevealModal({ secret, endpointUrl, onClose }: {
  secret: string;
  endpointUrl: string;
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
    <Modal onClose={onClose} maxWidth={560} scrollableBody>
      <ModalHeader
        title="Endpoint created — save your secret"
        subtitle="This secret will never be shown again after you close this dialog."
        icon={<span className="icon-tile tone-success" aria-hidden="true"><Shield /></span>}
      />

      <ModalScrollBody>
        <div className="modal-body">
          <div className="form-group">
            <p className="form-label">Endpoint</p>
            <div className="code-block">{endpointUrl}</div>
          </div>

          <div className="form-group">
            <p className="form-label">Signing secret (HMAC-SHA256)</p>
            <div className="code-block row" style={{ alignItems: "flex-start" }}>
              <span
                className="min-w-0"
                style={{
                  flex: 1,
                  filter: visible ? "none" : "blur(5px)",
                  userSelect: visible ? "text" : "none",
                }}
              >
                {secret}
              </span>
              <button
                type="button"
                className="btn btn-subtle btn-icon btn-sm"
                onClick={() => setVisible(v => !v)}
                title={visible ? "Hide secret" : "Reveal secret"}
                aria-label={visible ? "Hide secret" : "Reveal secret"}
                aria-pressed={visible}
              >
                {visible ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <p className="form-hint">
              Verify payloads: <code>X-Webhook-Signature</code> = <code>sha256=HMAC(secret, body)</code>
            </p>
          </div>

          <div className="form-group">
            <p className="form-label">Verification example (Node.js)</p>
            <pre className="code-block" style={{ overflow: "auto", whiteSpace: "pre" }}>{`import { createHmac } from "crypto";

function verify(rawBody, sigHeader) {
  const expected = "sha256=" +
    createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(rawBody).digest("hex");
  return expected === sigHeader;
}`}</pre>
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

// ── Create endpoint modal ────────────────────────────────────────────────────

function CreateEndpointModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (ep: WebhookEndpoint, secret: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<AuditAction>>(new Set());
  const [allEvents, setAllEvents] = useState(true);
  const [error, setError] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["auth"]));
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => urlRef.current?.focus(), 50); }, []);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(s => {
      const n = new Set(s);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  };

  const toggleEvent = (action: AuditAction, checked: boolean) => {
    setSelectedEvents(s => {
      const n = new Set(s);
      checked ? n.add(action) : n.delete(action);
      return n;
    });
  };

  const createWebhook = useCreateWebhook();

  const createEndpoint = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) { setError("URL is required"); return; }
    setError("");
    const events = allEvents ? ["*"] : Array.from(selectedEvents);
    createWebhook.mutate(
      { url: trimmedUrl, events },
      {
        onSuccess: (result) => onCreated(result.endpoint as WebhookEndpoint, result.rawSecret),
        onError: (e) => setError(e.message ?? "Failed to create endpoint"),
      },
    );
  };

  const loading = createWebhook.isPending;

  const categorized = Object.entries(
    EVENT_CATALOG.reduce<Record<string, EventDef[]>>((acc, ev) => {
      (acc[ev.category] ??= []).push(ev);
      return acc;
    }, {})
  ) as [EventCategory, EventDef[]][];

  return (
    <Modal onClose={onClose} maxWidth={600} scrollableBody>
      <ModalHeader
        title="Create webhook endpoint"
        subtitle="Subscribe to platform events via HTTPS POST."
        icon={<span className="icon-tile" aria-hidden="true"><Webhook /></span>}
      />

      <ModalScrollBody>
        <div className="modal-body">
          {error && <p className="alert alert-danger" role="alert"><AlertTriangle /> {error}</p>}

          <div className="form-group">
            <label className="form-label" htmlFor="webhook-url">Endpoint URL</label>
            <input
              id="webhook-url"
              ref={urlRef}
              className="input input-mono"
              placeholder="https://your-app.com/webhooks/kova-auth"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void createEndpoint()}
            />
            <p className="form-hint">Must be HTTPS (HTTP is allowed for localhost).</p>
          </div>

          <div className="form-group">
            <p className="form-label" id="webhook-events-label">Event subscriptions</p>
            <div className="segmented" role="group" aria-labelledby="webhook-events-label">
              <button type="button" className="segmented-option" aria-pressed={allEvents} onClick={() => setAllEvents(true)}>
                All events
              </button>
              <button type="button" className="segmented-option" aria-pressed={!allEvents} onClick={() => setAllEvents(false)}>
                Select events
              </button>
            </div>

            {!allEvents && (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", marginTop: 8, overflow: "hidden" }}>
                {categorized.map(([cat, evs], ci) => {
                  const meta = CATEGORY_META[cat];
                  const expanded = expandedCategories.has(cat);
                  const checkedCount = evs.filter(e => selectedEvents.has(e.action)).length;
                  return (
                    <div
                      key={cat}
                      style={{ borderBlockEnd: ci < categorized.length - 1 ? "1px solid var(--color-border)" : "none", padding: 4 }}
                    >
                      <button
                        type="button"
                        className="menu-item"
                        aria-expanded={expanded}
                        onClick={() => toggleCategory(cat)}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: meta.color }} aria-hidden="true" />
                        <span className="text-strong" style={{ flex: 1 }}>{meta.label}</span>
                        {checkedCount > 0 && (
                          <span className="badge badge-info tabular">{checkedCount}/{evs.length}</span>
                        )}
                        {expanded ? <ChevronDown /> : <ChevronRight />}
                      </button>

                      {expanded && evs.map(ev => (
                        <label
                          key={ev.action}
                          className="row"
                          style={{ alignItems: "flex-start", gap: 10, padding: "8px 10px 8px 28px", cursor: "pointer" }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedEvents.has(ev.action)}
                            onChange={e => toggleEvent(ev.action, e.target.checked)}
                            style={{ marginTop: 2, flexShrink: 0 }}
                          />
                          <span className="min-w-0">
                            <span className="text-strong" style={{ display: "block" }}>{ev.label}</span>
                            <span className="text-mono text-sm text-tertiary" style={{ display: "block" }}>{ev.action}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ModalScrollBody>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || (!allEvents && selectedEvents.size === 0)}
          onClick={() => void createEndpoint()}
        >
          {loading ? "Creating…" : <><Plus /> Create endpoint</>}
        </button>
      </div>
    </Modal>
  );
}

// ── Delivery log / details modal ─────────────────────────────────────────────

const HEALTH_BADGE: Record<ReturnType<typeof healthStatus>, string> = {
  healthy: "badge-success",
  degraded: "badge-warning",
  down: "badge-danger",
  idle: "badge-neutral",
};

function DeliveryLogModal({ endpoint, onClose }: {
  endpoint: WebhookEndpoint;
  onClose: () => void;
}) {
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number } | null>(null);

  const sendTest = async () => {
    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/webhooks/endpoints/${endpoint.id}/test`, { method: "POST", credentials: "include" });
      const data = await res.json() as { ok: boolean; status: number };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, status: 0 });
    } finally {
      setSendingTest(false);
    }
  };

  const status = healthStatus(endpoint);
  const failing = endpoint.failureCount > 3;

  return (
    <Modal onClose={onClose} maxWidth={580} scrollableBody>
      <ModalHeader
        title="Delivery status"
        subtitle={<span className="text-mono truncate" style={{ display: "block" }}>{endpoint.url}</span>}
        icon={<span className="icon-tile tone-neutral" aria-hidden="true"><Activity /></span>}
      />

      <ModalScrollBody>
        <div className="modal-body">
          <div className="card card-flush">
            <div className="kv-row">
              <span className="kv-label">Health</span>
              <span className="kv-value"><span className={`badge ${HEALTH_BADGE[status]}`}>{sentenceCase(status)}</span></span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Last success</span>
              <span className="kv-value">{relativeTime(endpoint.lastSuccess)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Last failure</span>
              <span className={`kv-value ${endpoint.lastFailure ? "text-danger" : "text-tertiary"}`}>{relativeTime(endpoint.lastFailure)}</span>
            </div>
          </div>

          {endpoint.failureCount > 0 && (
            <div className={`alert ${failing ? "alert-danger" : "alert-warning"}`} role="alert">
              <AlertTriangle />
              <div>
                <p className="text-strong">
                  {endpoint.failureCount} consecutive failure{endpoint.failureCount !== 1 ? "s" : ""}
                </p>
                <p className="text-sm text-secondary">
                  {failing
                    ? "Endpoint is returning errors. Check your server and ensure it responds 2xx."
                    : "Recent delivery failed. Verify the endpoint responds within 15 seconds."}
                </p>
              </div>
            </div>
          )}

          <div className="form-group">
            <p className="form-label">Subscribed events</p>
            {(endpoint.eventList as string[]).includes("*") ? (
              <div>
                <span className="badge badge-info"><Zap /> All events</span>
              </div>
            ) : (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", maxHeight: 180, overflowY: "auto" }}>
                {(endpoint.eventList as AuditAction[]).map((action, i) => {
                  const cat = CATEGORIES_BY_EVENT[action];
                  const meta = cat ? CATEGORY_META[cat] : null;
                  const def = EVENT_CATALOG.find(e => e.action === action);
                  return (
                    <div
                      key={action}
                      className="row"
                      style={{
                        gap: 10,
                        padding: "8px 12px",
                        borderBlockEnd: i < endpoint.eventList.length - 1 ? "1px solid var(--color-border)" : "none",
                      }}
                    >
                      {meta && <span style={{ width: 6, height: 6, borderRadius: 2, background: meta.color, flexShrink: 0 }} aria-hidden="true" />}
                      <span className="text-strong min-w-0" style={{ flex: 1 }}>{def?.label ?? action}</span>
                      <code>{action}</code>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card stack-sm">
            <div className="row-between" style={{ flexWrap: "wrap" }}>
              <div className="min-w-0">
                <p className="text-h3">Send test ping</p>
                <p className="text-sm text-secondary">
                  Fires a signed <code>test.ping</code> payload to verify delivery.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={sendingTest} onClick={() => void sendTest()}>
                <Send /> {sendingTest ? "Sending…" : "Send ping"}
              </button>
            </div>
            {testResult && (
              <p className={`alert ${testResult.ok ? "alert-success" : "alert-danger"}`} role={testResult.ok ? "status" : "alert"}>
                {testResult.ok ? <Check /> : <AlertTriangle />}
                {testResult.ok ? `Success — HTTP ${testResult.status}` : testResult.status === 0 ? "Network error — endpoint unreachable" : `Failed — HTTP ${testResult.status}`}
              </p>
            )}
          </div>

          <div className="form-group">
            <p className="form-label">Payload headers</p>
            <div className="code-block" style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: 16 }}>
              {[
                ["Content-Type", "application/json"],
                ["X-Webhook-Signature", "sha256=<hmac-hex>"],
                ["X-Webhook-Event", "<event-name>"],
                ["X-Webhook-Delivery", "<delivery-id>"],
                ["User-Agent", "kova-auth-webhooks/1.0"],
              ].map(([k, v]) => (
                <Fragment key={k}>
                  <span className="text-tertiary">{k}</span>
                  <span>{v}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </ModalScrollBody>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ── Endpoint row ─────────────────────────────────────────────────────────────

function EndpointCard({ ep, onDelete, onToggle, onViewLog }: {
  ep: WebhookEndpoint;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onViewLog: (ep: WebhookEndpoint) => void;
}) {
  // deleting/toggling are now driven by the parent's optimistic mutation hooks.
  // We only keep deleteConfirm for the ConfirmModal gate.
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleting = false;
  const toggling = false;
  const status = healthStatus(ep);

  const handleDelete = () => {
    setDeleteConfirm(false);
    onDelete(ep.id);
  };

  const handleToggle = () => {
    onToggle(ep.id, ep.enabled === 0);
  };

  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      {deleteConfirm && (
        <ConfirmModal
          title="Delete webhook endpoint?"
          body={`${ep.url} will be permanently removed. All delivery history will be lost.`}
          confirmLabel="Delete endpoint"
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeleteConfirm(false)}
        />
      )}

      <button
        type="button"
        className="btn btn-subtle btn-icon"
        onClick={() => void handleToggle()}
        disabled={toggling}
        title={ep.enabled ? "Disable endpoint" : "Enable endpoint"}
        aria-label={ep.enabled ? "Disable endpoint" : "Enable endpoint"}
        aria-pressed={!!ep.enabled}
      >
        {ep.enabled ? <ToggleRight className="text-accent" /> : <ToggleLeft />}
      </button>

      <div className="list-row-main stack-sm">
        <div className="row">
          <Globe className="text-tertiary" size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span className="text-mono text-strong truncate" title={ep.url}>{ep.url}</span>
          <a
            href={ep.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-subtle btn-icon btn-sm"
            aria-label="Open endpoint URL in a new tab"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink />
          </a>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className={`badge ${(ep.eventList as string[]).includes("*") ? "badge-info" : "badge-neutral"}`}>
            {(ep.eventList as string[]).includes("*") ? "All events" : `${ep.eventList.length} event${ep.eventList.length !== 1 ? "s" : ""}`}
          </span>
          {ep.enabled ? (
            <span className={`badge ${HEALTH_BADGE[status]}`}>{sentenceCase(status)}</span>
          ) : (
            <span className="badge badge-neutral">Disabled</span>
          )}
          {ep.failureCount > 0 && ep.failureCount <= 3 && (
            <span className="badge badge-warning">{ep.failureCount} fail{ep.failureCount !== 1 ? "s" : ""}</span>
          )}
          <span className="text-sm text-tertiary">
            Last delivery: {relativeTime(ep.lastSuccess ?? ep.lastFailure)}
          </span>
        </div>
        {ep.failureCount > 3 && (
          <p className="alert alert-danger" role="alert">
            <AlertTriangle />
            {ep.failureCount} consecutive delivery failures — check your endpoint
          </p>
        )}
      </div>

      <div className="list-row-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onViewLog(ep)}>
          <Activity /> Details
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm btn-icon"
          disabled={deleting}
          onClick={() => setDeleteConfirm(true)}
          title="Delete endpoint"
          aria-label="Delete endpoint"
        >
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

// ── Event Catalog panel ───────────────────────────────────────────────────────

function EventCatalogPanel() {
  const [open, setOpen] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const toggleCat = (cat: string) =>
    setExpandedCats(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const categorized = Object.entries(
    EVENT_CATALOG.reduce<Record<string, EventDef[]>>((acc, ev) => {
      (acc[ev.category] ??= []).push(ev);
      return acc;
    }, {})
  ) as [EventCategory, EventDef[]][];

  return (
    <div className="card card-flush" style={{ marginTop: 20 }}>
      <div className="panel-header" style={open ? undefined : { borderBlockEnd: "none" }}>
        <h2 className="panel-title">
          <Zap />
          Event catalog
          <span className="badge badge-neutral tabular">{EVENT_CATALOG.length} events</span>
        </h2>
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          aria-expanded={open}
          aria-controls="webhook-event-catalog"
          onClick={() => setOpen(v => !v)}
        >
          {open ? "Hide" : "Show"} {open ? <ChevronDown /> : <ChevronRight />}
        </button>
      </div>

      {open && (
        <div id="webhook-event-catalog" style={{ padding: 8 }}>
          {categorized.map(([cat, evs]) => {
            const meta = CATEGORY_META[cat];
            const expanded = expandedCats.has(cat);
            return (
              <div key={cat}>
                <button
                  type="button"
                  className="menu-item"
                  aria-expanded={expanded}
                  onClick={() => toggleCat(cat)}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} aria-hidden="true" />
                  <span className="text-strong" style={{ flex: 1 }}>{meta.label}</span>
                  <span className="text-sm text-tertiary tabular">{evs.length} event{evs.length !== 1 ? "s" : ""}</span>
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </button>
                {expanded && (
                  <div className="stack-sm" style={{ padding: "4px 10px 10px 38px" }}>
                    {evs.map(ev => (
                      <div key={ev.action} className="row" style={{ alignItems: "baseline", flexWrap: "wrap", columnGap: 12, rowGap: 2 }}>
                        <code style={{ flex: "0 1 220px" }}>{ev.action}</code>
                        <span className="text-sm text-secondary" style={{ flex: "1 1 200px" }}>{ev.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function WebhooksPage() {
  const qc = useQueryClient();

  const { data: endpoints = [], isLoading: loading, error } = useWebhooks();
  const deleteMut = useDeleteWebhook();
  const toggleMut = useToggleWebhook();

  const [showCreate, setShowCreate] = useState(false);
  const [revealSecret, setRevealSecret] = useState<{ secret: string; url: string } | null>(null);
  const [viewLogEp, setViewLogEp] = useState<WebhookEndpoint | null>(null);

  const handleCreated = (ep: WebhookEndpoint, secret: string) => {
    setShowCreate(false);
    setRevealSecret({ secret, url: ep.url });
    // Cache invalidation already done inside useCreateWebhook
  };

  const handleDelete = (id: string) => deleteMut.mutate({ id });
  const handleToggle = (id: string, enabled: boolean) => toggleMut.mutate({ id, enabled });

  const activeCount = endpoints.filter((ep: WebhookEndpoint) => ep.enabled === 1).length;
  const failingCount = endpoints.filter((ep: WebhookEndpoint) => ep.failureCount > 3).length;

  return (
    <div>
      {showCreate && <CreateEndpointModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {revealSecret && <SecretRevealModal secret={revealSecret.secret} endpointUrl={revealSecret.url} onClose={() => setRevealSecret(null)} />}
      {viewLogEp && <DeliveryLogModal endpoint={viewLogEp} onClose={() => setViewLogEp(null)} />}

      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Integrations</p>
          <h1 className="page-title">Webhooks</h1>
          <p className="page-subtitle">
            Receive signed HTTP POST payloads on platform events — Stripe/GitHub webhook format.
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => void qc.invalidateQueries({ queryKey: webhookKeys.all })}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh webhooks"
          >
            <RotateCcw className={loading ? "spin" : ""} />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus /> New endpoint
          </button>
        </div>
      </header>

      {endpoints.length > 0 && (
        <div className="stat-grid">
          {[
            { label: "Total", value: endpoints.length, icon: Webhook, tone: "" },
            { label: "Active", value: activeCount, icon: Check, tone: "tone-success" },
            { label: "Failing", value: failingCount, icon: AlertTriangle, tone: failingCount > 0 ? "tone-danger" : "tone-neutral" },
          ].map(s => (
            <div key={s.label} className="card stat-card">
              <span className={`icon-tile ${s.tone}`} aria-hidden="true"><s.icon strokeWidth={1.75} /></span>
              <div>
                <p className="stat-label">{s.label}</p>
                <p className="stat-value">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle /> {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {loading ? (
        <div className="card card-flush">
          <div className="skeleton-rows" role="status" aria-label="Loading webhook endpoints">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        </div>
      ) : endpoints.length === 0 ? (
        <div className="card card-flush">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Webhook /></span>
            <p className="empty-state-title">No webhook endpoints yet</p>
            <p className="empty-state-body">
              Webhook endpoints receive signed HTTP POST payloads whenever platform events occur.
              Use them to sync your database, send Slack alerts, or trigger CI pipelines.
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(true)}>
              <Plus /> Create first endpoint
            </button>
          </div>
        </div>
      ) : (
        <div className="card card-flush">
          {endpoints.map(ep => (
            <EndpointCard key={ep.id} ep={ep} onDelete={handleDelete} onToggle={handleToggle} onViewLog={setViewLogEp} />
          ))}
        </div>
      )}

      <EventCatalogPanel />

      <section className="card card-flush" style={{ marginTop: 16 }} aria-labelledby="retry-policy-title">
        <div className="panel-header">
          <h2 className="panel-title" id="retry-policy-title">Retry policy</h2>
        </div>
        <div className="panel-body">
        <ul className="text-sm text-secondary" style={{ lineHeight: 1.8, paddingInlineStart: 18 }}>
          <li>3 delivery attempts with exponential back-off: 1 s → 2 s → 4 s</li>
          <li><code>4xx</code> responses are permanent errors — no retry</li>
          <li><code>5xx</code> and network errors trigger the next attempt</li>
          <li>Endpoints must respond within 15 seconds with a 2xx status</li>
          <li>Delivery is fire-and-forget — it never delays the auth response</li>
          <li><code>failureCount</code> resets to 0 on any successful delivery</li>
        </ul>
        </div>
      </section>
    </div>
  );
}

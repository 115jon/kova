import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
  useWebhooks,
  type WebhookEndpoint,
} from "@/hooks/use-webhooks";
import { webhookKeys } from "@/lib/query-keys";
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
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/webhooks")({
  component: WebhooksPage,
});

// Types are now imported from @/hooks/use-webhooks — keeping AuditAction locally
// for the CreateEndpointModal event catalogue which still needs it.
type AuditAction =
  | "user.signIn" | "user.signOut" | "user.signUp"
  | "user.passwordChanged" | "user.passwordSet" | "user.emailVerified"
  | "user.avatarUpdated"
  | "twoFactor.enabled" | "twoFactor.disabled" | "twoFactor.challengePassed"
  | "apiKey.created" | "apiKey.revoked" | "apiKey.allExpiredDeleted"
  | "session.revoked" | "session.revokeAll" | "session.expired"
  | "org.created" | "org.updated" | "org.deleted"
  | "member.invited" | "member.joined" | "member.removed" | "member.roleChanged"
  | "admin.userBanned" | "admin.userUnbanned" | "admin.userDeleted"
  | "admin.roleChanged" | "admin.passwordReset";

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
  { action: "twoFactor.enabled", label: "2FA enabled", description: "Two-factor authentication was switched on.", category: "2fa" },
  { action: "twoFactor.disabled", label: "2FA disabled", description: "Two-factor authentication was switched off.", category: "2fa" },
  { action: "twoFactor.challengePassed", label: "2FA challenge passed", description: "User passed a 2FA step successfully.", category: "2fa" },
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

const CATEGORY_META: Record<EventCategory, { label: string; color: string }> = {
  auth: { label: "Auth", color: "var(--color-accent)" },
  "2fa": { label: "2FA", color: "var(--color-green)" },
  key: { label: "API Key", color: "var(--color-amber)" },
  session: { label: "Session", color: "#a78bfa" },
  org: { label: "Org", color: "#f472b6" },
  admin: { label: "Admin", color: "var(--color-red)" },
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
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 6, flexShrink: 0,
            background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Shield size={16} color="var(--color-green)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.9rem" }}>
              Endpoint created — save your secret
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>
              This secret will never be shown again after you close this dialog.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="modal-body" style={{ gap: 14 }}>
        <div>
          <p className="form-label" style={{ marginBottom: 6 }}>Endpoint</p>
          <div style={{
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
            fontSize: "0.76rem", color: "var(--color-text-secondary)", wordBreak: "break-all",
          }}>
            {endpointUrl}
          </div>
        </div>

        <div>
          <p className="form-label" style={{ marginBottom: 6 }}>Signing secret (HMAC-SHA256)</p>
          <div style={{
            background: "var(--color-surface-raised)", border: "1px solid rgba(52,211,153,0.25)",
            borderRadius: 4, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.76rem",
              color: "var(--color-green)", wordBreak: "break-all",
              filter: visible ? "none" : "blur(5px)",
              transition: "filter 0.15s",
              userSelect: visible ? "text" : "none",
            }}>
              {secret}
            </span>
            <button className="btn btn-ghost" style={{ padding: "4px 6px", flexShrink: 0 }}
              onClick={() => setVisible(v => !v)} title={visible ? "Hide" : "Reveal"}>
              {visible ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="form-hint" style={{ marginTop: 5 }}>
            Verify payloads: <code>X-Webhook-Signature</code> = <code>sha256=HMAC(secret, body)</code>
          </p>
        </div>

        <div>
          <p className="form-label" style={{ marginBottom: 6 }}>Verification example (Node.js)</p>
          <pre style={{
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "10px 12px", fontFamily: "var(--font-mono)",
            fontSize: "0.72rem", color: "var(--color-text-secondary)", lineHeight: 1.7,
            overflow: "auto", whiteSpace: "pre",
          }}>{`import { createHmac } from "crypto";

function verify(rawBody, sigHeader) {
  const expected = "sha256=" +
    createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(rawBody).digest("hex");
  return expected === sigHeader;
}`}</pre>
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => void copy()}>
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy secret</>}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>
          Done — I&apos;ve saved it
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
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, flexShrink: 0,
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Webhook size={15} color="var(--color-accent)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.9rem" }}>
              Create webhook endpoint
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>
              Subscribe to platform events via HTTPS POST.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="modal-body" style={{ gap: 18 }}>
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
            <label className="form-label">Endpoint URL</label>
            <input ref={urlRef} className="input"
              placeholder="https://your-app.com/webhooks/ralph-auth"
              value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void createEndpoint()} />
            <p className="form-hint">Must be HTTPS (HTTP is allowed for localhost).</p>
          </div>

          <div>
            <p className="form-label" style={{ marginBottom: 8 }}>Event subscriptions</p>
            <button onClick={() => setAllEvents(v => !v)} style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 12px",
              background: allEvents ? "var(--color-accent-glow)" : "var(--color-surface-raised)",
              border: `1px solid ${allEvents ? "rgba(59,130,246,0.25)" : "var(--color-border)"}`,
              borderRadius: 4, cursor: "pointer", marginBottom: 8,
              transition: "background 0.12s, border-color 0.12s",
            }}>
              <Zap size={14} color={allEvents ? "var(--color-accent)" : "var(--color-text-tertiary)"} />
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: allEvents ? "var(--color-accent)" : "var(--color-text-primary)", textAlign: "left", fontWeight: 500 }}>
                All events (wildcard)
              </span>
              {allEvents && <Check size={13} color="var(--color-accent)" />}
            </button>

            {!allEvents && (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 4, overflow: "hidden" }}>
                {categorized.map(([cat, evs]) => {
                  const meta = CATEGORY_META[cat];
                  const expanded = expandedCategories.has(cat);
                  const checkedCount = evs.filter(e => selectedEvents.has(e.action)).length;
                  return (
                    <div key={cat}>
                      <button onClick={() => toggleCategory(cat)} style={{
                        display: "flex", alignItems: "center", gap: 9,
                        width: "100%", padding: "8px 12px",
                        background: "transparent", border: "none",
                        borderBottom: expanded ? "1px solid var(--color-border)" : "none",
                        cursor: "pointer",
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: meta.color }} />
                        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.76rem", fontWeight: 600, color: "var(--color-text-primary)", textAlign: "left" }}>
                          {meta.label}
                        </span>
                        {checkedCount > 0 && (
                          <span className="badge badge-blue" style={{ fontSize: "0.58rem" }}>{checkedCount}/{evs.length}</span>
                        )}
                        {expanded ? <ChevronDown size={11} color="var(--color-text-tertiary)" /> : <ChevronRight size={11} color="var(--color-text-tertiary)" />}
                      </button>

                      {expanded && evs.map((ev, i) => (
                        <label key={ev.action} style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "8px 12px 8px 28px", cursor: "pointer",
                          borderBottom: i < evs.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          <input type="checkbox" checked={selectedEvents.has(ev.action)}
                            onChange={e => toggleEvent(ev.action, e.target.checked)}
                            style={{ marginTop: 2, accentColor: "var(--color-accent)", flexShrink: 0 }} />
                          <div>
                            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", fontWeight: 500, color: "var(--color-text-primary)" }}>{ev.label}</p>
                            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>{ev.action}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-primary" disabled={loading || (!allEvents && selectedEvents.size === 0)}
          onClick={() => void createEndpoint()}>
          {loading ? "Creating…" : <><Plus size={13} /> Create endpoint</>}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Delivery log / details modal ─────────────────────────────────────────────

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
  const statusColors: Record<typeof status, string> = {
    healthy: "var(--color-green)",
    degraded: "var(--color-amber)",
    down: "var(--color-red)",
    idle: "var(--color-text-tertiary)",
  };

  return (
    <Modal onClose={onClose} maxWidth={580} scrollableBody>
      <div className="modal-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 5, flexShrink: 0,
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Activity size={14} color="var(--color-text-secondary)" />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.86rem" }}>
              Delivery status
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", color: "var(--color-text-tertiary)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {endpoint.url}
            </p>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ marginLeft: "auto", padding: 5 }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="modal-body" style={{ gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              { label: "Health", value: status.charAt(0).toUpperCase() + status.slice(1), color: statusColors[status] },
              { label: "Last success", value: relativeTime(endpoint.lastSuccess), color: "var(--color-text-primary)" },
              { label: "Last failure", value: relativeTime(endpoint.lastFailure), color: endpoint.lastFailure ? "var(--color-red)" : "var(--color-text-tertiary)" },
            ].map(s => (
              <div key={s.label} style={{
                background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "12px 14px",
              }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{s.label}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 700, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {endpoint.failureCount > 0 && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: endpoint.failureCount > 3 ? "var(--color-red-dim)" : "var(--color-amber-dim)",
              border: `1px solid ${endpoint.failureCount > 3 ? "rgba(248,113,113,0.2)" : "rgba(251,191,36,0.2)"}`,
              borderRadius: 4, padding: "10px 12px",
            }}>
              <AlertTriangle size={14} color={endpoint.failureCount > 3 ? "var(--color-red)" : "var(--color-amber)"} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600, color: endpoint.failureCount > 3 ? "var(--color-red)" : "var(--color-amber)" }}>
                  {endpoint.failureCount} consecutive failure{endpoint.failureCount !== 1 ? "s" : ""}
                </p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                  {endpoint.failureCount > 3
                    ? "Endpoint is returning errors. Check your server and ensure it responds 2xx."
                    : "Recent delivery failed. Verify the endpoint responds within 15 seconds."}
                </p>
              </div>
            </div>
          )}

          <div>
            <p className="form-label" style={{ marginBottom: 8 }}>Subscribed events</p>
            {(endpoint.eventList as string[]).includes("*") ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--color-accent-glow)", border: "1px solid rgba(59,130,246,0.15)",
                borderRadius: 4, padding: "8px 12px",
              }}>
                <Zap size={13} color="var(--color-accent)" />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-accent)", fontWeight: 500 }}>All events (wildcard)</span>
              </div>
            ) : (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 4, maxHeight: 180, overflowY: "auto" }}>
                {(endpoint.eventList as AuditAction[]).map((action, i) => {
                  const cat = CATEGORIES_BY_EVENT[action];
                  const meta = cat ? CATEGORY_META[cat] : null;
                  const def = EVENT_CATALOG.find(e => e.action === action);
                  return (
                    <div key={action} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                      borderBottom: i < endpoint.eventList.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                      {meta && <span style={{ width: 6, height: 6, borderRadius: 2, background: meta.color, flexShrink: 0 }} />}
                      <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-primary)" }}>{def?.label ?? action}</span>
                      <code style={{ fontSize: "0.66rem" }}>{action}</code>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "14px 16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600, color: "var(--color-text-primary)" }}>Send test ping</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 2 }}>
                  Fires a signed <code>test.ping</code> payload to verify delivery.
                </p>
              </div>
              <button className="btn btn-ghost" disabled={sendingTest} onClick={() => void sendTest()} style={{ gap: 6 }}>
                <Send size={13} /> {sendingTest ? "Sending…" : "Send ping"}
              </button>
            </div>
            {testResult && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: testResult.ok ? "var(--color-green-dim)" : "var(--color-red-dim)",
                border: `1px solid ${testResult.ok ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                borderRadius: 3, padding: "6px 10px", marginTop: 8,
              }}>
                {testResult.ok ? <Check size={12} color="var(--color-green)" /> : <AlertTriangle size={12} color="var(--color-red)" />}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: testResult.ok ? "var(--color-green)" : "var(--color-red)" }}>
                  {testResult.ok ? `Success — HTTP ${testResult.status}` : testResult.status === 0 ? "Network error — endpoint unreachable" : `Failed — HTTP ${testResult.status}`}
                </span>
              </div>
            )}
          </div>

          <div>
            <p className="form-label" style={{ marginBottom: 6 }}>Payload headers</p>
            <div style={{
              background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
              borderRadius: 4, padding: "10px 14px", fontFamily: "var(--font-mono)",
              fontSize: "0.72rem", color: "var(--color-text-secondary)", lineHeight: 1.9,
            }}>
              {[
                ["Content-Type", "application/json"],
                ["X-Webhook-Signature", "sha256=<hmac-hex>"],
                ["X-Webhook-Event", "<event-name>"],
                ["X-Webhook-Delivery", "<delivery-id>"],
                ["User-Agent", "ralph-auth-webhooks/1.0"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 16 }}>
                  <span style={{ color: "var(--color-text-tertiary)", minWidth: 190 }}>{k}</span>
                  <span style={{ color: "var(--color-text-primary)" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ── Endpoint card ────────────────────────────────────────────────────────────

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

  const statusDot: Record<typeof status, string> = {
    healthy: "var(--color-green)",
    degraded: "var(--color-amber)",
    down: "var(--color-red)",
    idle: "var(--color-text-tertiary)",
  };

  const handleDelete = () => {
    setDeleteConfirm(false);
    onDelete(ep.id);
  };

  const handleToggle = () => {
    onToggle(ep.id, ep.enabled === 0);
  };

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
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
      {ep.failureCount > 3 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "7px 10px",
        }}>
          <AlertTriangle size={12} color="var(--color-red)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-red)", fontWeight: 600 }}>
            {ep.failureCount} consecutive delivery failures — check your endpoint
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 2 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: ep.enabled ? statusDot[status] : "var(--color-text-tertiary)",
            boxShadow: ep.enabled && status !== "idle" ? `0 0 6px ${statusDot[status]}` : "none",
            transition: "background 0.2s",
          }} />
          <button onClick={() => void handleToggle()} disabled={toggling}
            title={ep.enabled ? "Disable" : "Enable"}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, opacity: toggling ? 0.5 : 1 }}>
            {ep.enabled
              ? <ToggleRight size={22} color="var(--color-accent)" />
              : <ToggleLeft size={22} color="var(--color-text-tertiary)" />
            }
          </button>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <Globe size={13} color="var(--color-text-tertiary)" />
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 600,
              color: "var(--color-text-primary)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={ep.url}>
              {ep.url.length > 52 ? ep.url.slice(0, 51) + "…" : ep.url}
            </span>
            <a href={ep.url} target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}
              onClick={e => e.stopPropagation()}>
              <ExternalLink size={11} />
            </a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={`badge ${(ep.eventList as string[]).includes("*") ? "badge-blue" : "badge-gray"}`}>
              {(ep.eventList as string[]).includes("*") ? "All events" : `${ep.eventList.length} event${ep.eventList.length !== 1 ? "s" : ""}`}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>
              Last delivery: {relativeTime(ep.lastSuccess ?? ep.lastFailure)}
            </span>
            {ep.failureCount > 0 && ep.failureCount <= 3 && (
              <span className="badge badge-yellow">{ep.failureCount} fail{ep.failureCount !== 1 ? "s" : ""}</span>
            )}
            {!ep.enabled && <span className="badge badge-gray">disabled</span>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button className="btn btn-ghost" style={{ padding: "5px 9px", fontSize: "0.74rem" }} onClick={() => onViewLog(ep)}>
            <Activity size={12} /> Details
          </button>
          <button className="btn btn-danger" style={{ padding: "5px 9px", fontSize: "0.74rem" }}
            disabled={deleting} onClick={() => setDeleteConfirm(true)} title="Delete endpoint">
            <Trash2 size={12} />
          </button>
        </div>
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
    <div className="card" style={{ marginTop: 20 }}>
      <button onClick={() => setOpen(v => !v)} className="panel-header"
        style={{ width: "100%", cursor: "pointer", background: "none", border: "none", textAlign: "left" }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)")}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "")}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={13} color="var(--color-text-secondary)" />
          <span className="panel-title">Event catalog</span>
          <span className="badge badge-gray">{EVENT_CATALOG.length} events</span>
        </div>
        {open ? <ChevronDown size={13} color="var(--color-text-tertiary)" /> : <ChevronRight size={13} color="var(--color-text-tertiary)" />}
      </button>

      {open && (
        <div style={{ padding: "4px 0 12px" }}>
          {categorized.map(([cat, evs]) => {
            const meta = CATEGORY_META[cat];
            const expanded = expandedCats.has(cat);
            return (
              <div key={cat}>
                <button onClick={() => toggleCat(cat)} style={{
                  display: "flex", alignItems: "center", gap: 9,
                  width: "100%", padding: "7px 18px",
                  background: "none", border: "none", cursor: "pointer",
                }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)")}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "")}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.77rem", fontWeight: 600, color: "var(--color-text-primary)", textAlign: "left" }}>{meta.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--color-text-tertiary)" }}>{evs.length} event{evs.length !== 1 ? "s" : ""}</span>
                  {expanded ? <ChevronDown size={11} color="var(--color-text-tertiary)" /> : <ChevronRight size={11} color="var(--color-text-tertiary)" />}
                </button>
                {expanded && (
                  <div style={{ paddingLeft: 36, paddingRight: 18 }}>
                    {evs.map(ev => (
                      <div key={ev.action} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <code style={{ fontSize: "0.72rem", color: meta.color, minWidth: 190, flexShrink: 0 }}>{ev.action}</code>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>{ev.description}</span>
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
    <div className="animate-in">
      {showCreate && <CreateEndpointModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {revealSecret && <SecretRevealModal secret={revealSecret.secret} endpointUrl={revealSecret.url} onClose={() => setRevealSecret(null)} />}
      {viewLogEp && <DeliveryLogModal endpoint={viewLogEp} onClose={() => setViewLogEp(null)} />}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Integrations</p>
          <h1 className="page-title">Webhooks</h1>
          <p className="page-subtitle">
            Receive signed HTTP POST payloads on platform events — Stripe/GitHub webhook format.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => void qc.invalidateQueries({ queryKey: webhookKeys.all })} disabled={loading} title="Refresh">
            <RotateCcw size={14} className={loading ? "spin" : ""} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New endpoint
          </button>
        </div>
      </div>

      {endpoints.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Total", value: endpoints.length, color: "var(--color-text-primary)" },
            { label: "Active", value: activeCount, color: "var(--color-green)" },
            { label: "Failing", value: failingCount, color: failingCount > 0 ? "var(--color-red)" : "var(--color-text-tertiary)" },
          ].map(s => (
            <div key={s.label} style={{
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: 5, padding: "10px 16px", display: "flex", gap: 10, alignItems: "center",
            }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 700, color: s.color }}>{s.value}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 13px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
        }}>
          <AlertTriangle size={13} /> {error instanceof Error ? error.message : error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 56 }}>
          <div className="loading" style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", fontSize: "0.78rem" }}>Loading…</div>
        </div>
      ) : endpoints.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 40, height: 40, borderRadius: 6, margin: "0 auto 14px",
            background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Webhook size={18} color="var(--color-accent)" />
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, letterSpacing: "-0.02em" }}>
            No webhook endpoints yet
          </p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", maxWidth: 380, margin: "0 auto 18px" }}>
            Webhook endpoints receive signed HTTP POST payloads whenever platform events occur.
            Use them to sync your database, send Slack alerts, or trigger CI pipelines.
          </p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Create first endpoint
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {endpoints.map(ep => (
            <EndpointCard key={ep.id} ep={ep} onDelete={handleDelete} onToggle={handleToggle} onViewLog={setViewLogEp} />
          ))}
        </div>
      )}

      <EventCatalogPanel />

      <div className="card" style={{ marginTop: 16, padding: 18 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Retry policy</p>
        <ul style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", lineHeight: 2, paddingLeft: 18 }}>
          <li>3 delivery attempts with exponential back-off: 1 s → 2 s → 4 s</li>
          <li><code>4xx</code> responses are permanent errors — no retry</li>
          <li><code>5xx</code> and network errors trigger the next attempt</li>
          <li>Endpoints must respond within 15 seconds with a 2xx status</li>
          <li>Delivery is fire-and-forget — it never delays the auth response</li>
          <li><code>failureCount</code> resets to 0 on any successful delivery</li>
        </ul>
      </div>
    </div>
  );
}

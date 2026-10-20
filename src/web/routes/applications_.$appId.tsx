import { AppLogo } from "@/components/AppLogo";
import { ProviderIcon } from "@/components/BrandIcons";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal, ModalHeader } from "@/components/Modal";
import { UserAvatar } from "@/components/UserAvatar";
import {
  useApplication,
  useAppMembers, useAppOAuthProviders,
  useAppStats,
  useBanMember, useBillingCheckout, useBillingPortal,
  useChangeMemberRole, useDeleteApplication, useDeleteFavicon,
  useDeleteLogo, useRemoveMember, useRotateSecret,
  useSetOAuthProviders,
  useSuspendApp, useUnbanMember, useUnsuspendApp,
  useUpdateApplication, useUploadFavicon, useUploadLogo,
  type Application, type AppOAuthProvider,
} from "@/hooks/use-applications";
import { useSession } from "@/lib/auth-client";
import { CONFIGURED_PROVIDERS, type ProviderId } from "@/lib/providers";
import { relativeTime, sentenceCase } from "@/lib/utils";
import { appSignInLook, DEFAULT_BACKGROUND, DEFAULT_PRIMARY } from "@/lib/app-sign-in";
import { appSignInUrl } from "../../worker/lib/sign-in-url";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, AlertTriangle, ArrowLeft, Ban, CheckCircle,
  ChevronLeft, ChevronRight,
  Copy, CreditCard, Eye, EyeOff, Globe, ImageIcon,
  Key, Layers, Lock,
  Mail, Palette, RefreshCw, Search, Settings,
  ShieldAlert, ShieldOff, SlidersHorizontal,
  Trash2, TrendingUp, Users, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
// AppOAuthProvider used as type only — ensure no unused import warning
type _AOPType = AppOAuthProvider;

export const Route = createFileRoute("/applications_/$appId")({
  component: AppDetailPage,
});

type Tab = "overview" | "users" | "appearance" | "providers" | "email" | "billing" | "settings";

// Same list the server accepts for logos.
const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const APP_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const APP_FAVICON_MAX_BYTES = 512 * 1024;
const APP_LOGO_MAX_LABEL = "2 MB";
const APP_FAVICON_MAX_LABEL = "512 KB";

// ── Small reusable components ─────────────────────────────────────────────────

function ErrBanner({ msg }: { msg: string }) {
  return (
    <p className="alert alert-danger" role="alert">
      <AlertCircle /> {msg}
    </p>
  );
}

function OkBanner({ msg }: { msg: string }) {
  return (
    <p className="alert alert-success" role="status">
      <CheckCircle /> {msg}
    </p>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const TONE: Record<string, string> = {
    free: "badge-neutral", starter: "badge-info",
    pro: "badge-warning", enterprise: "badge-success",
  };
  return <span className={`badge ${TONE[plan] ?? "badge-neutral"}`}>{sentenceCase(plan)}</span>;
}

function StatCard({ label, value, icon: Icon, tone = "", loading = false }: {
  label: string; value: number | string; icon: React.ElementType; tone?: string; loading?: boolean;
}) {
  return (
    <div className="card stat-card">
      <span className={`icon-tile ${tone}`} aria-hidden="true"><Icon strokeWidth={1.75} /></span>
      <div>
        <p className="stat-label">{label}</p>
        {loading ? <span className="skeleton" style={{ height: 28, width: 48 }} /> : <p className="stat-value">{value}</p>}
      </div>
    </div>
  );
}

// On/off control. Track and knob use theme tokens; state is exposed via role="switch".
function Switch({ checked, onChange, disabled = false, label }: {
  checked: boolean; onChange: () => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="switch"
    />
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={copy} title={label ?? "Copy"}>
      {copied ? <CheckCircle className="text-success" /> : <Copy />}
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ app }: { app: Application }) {
  const { data: stats, isLoading } = useAppStats(app.id);

  return (
    <div className="stack-lg">
      {/* Stats row */}
      <div className="stat-grid" style={{ marginBottom: 0 }}>
        <StatCard label="Users" value={stats?.total_users ?? 0} loading={isLoading} icon={Users} />
        <StatCard label="Orgs" value={stats?.total_orgs ?? 0} loading={isLoading} icon={Layers} tone="tone-neutral" />
        <StatCard label="Logins (24h)" value={stats?.logins_24h ?? 0} loading={isLoading} icon={TrendingUp} tone="tone-success" />
        <StatCard label="Active sessions" value={stats?.active_sessions ?? 0} loading={isLoading} icon={Globe} tone="tone-neutral" />
      </div>

      {/* Keys panel */}
      <section className="card card-flush" aria-labelledby="app-keys">
        <div className="panel-header"><h2 className="panel-title" id="app-keys"><Key /> API keys</h2></div>
        <KeyRow label="Publishable key" value={app.publishable_key} mono />
        <KeyRow label="Environment" value={sentenceCase(app.environment)} />
        <KeyRow label="Plan" value={<PlanBadge plan={app.plan} />} />
        {app.suspended_at && (
          <div className="panel-body">
            <p className="alert alert-danger" role="status">
              <ShieldAlert /> Suspended {relativeTime(new Date(app.suspended_at).toISOString())}
            </p>
          </div>
        )}
      </section>

      <SignInUrlsPanel app={app} />
    </div>
  );
}

function UrlRow({ label, url, open = true }: { label: string; url: string; open?: boolean }) {
  return (
    <div className="stack-sm">
      <span className="form-label" style={{ overflowWrap: "anywhere" }}>{label}</span>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <code className="code-block" style={{ flex: "1 1 240px" }}>
          {url}
        </code>
        <CopyBtn value={url} />
        {open && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            <Globe /> Open
          </a>
        )}
      </div>
    </div>
  );
}

// The dashboard is served from AUTH_URL, so its origin is the auth URL integrators use.
function SignInUrlsPanel({ app }: { app: Application }) {
  if (typeof window === "undefined") return null;
  const authOrigin = window.location.origin;
  const aliasHost = app.custom_domain ?? (app.auth_slug ? `${app.auth_slug}.${window.location.host}` : null);

  return (
    <section className="card card-flush" aria-labelledby="app-signin-urls">
      <div className="panel-header"><h2 className="panel-title" id="app-signin-urls"><Globe /> Sign-in URL</h2></div>
      <div className="panel-body stack">
        <p className="text-sm text-secondary">
          Send users to this page. It shows this app&apos;s Appearance and Providers settings, then returns
          to the redirect URL with <code>?kova_auth_code=…</code>. With <code>@115jon/kova-react</code>, build the
          link with <code>createHostedSignInUrl({"{ authUrl, publishableKey, redirectUrl }"})</code> so the SDK
          accepts the returned code. The URLs below are for previews and custom integrations, which must send
          their own <code>state</code> and check it on return.
        </p>
        {app.redirect_uris.length > 0 ? (
          app.redirect_uris.map(uri => (
            <UrlRow key={uri} label={`Returns to ${uri}`} url={appSignInUrl(authOrigin, app.publishable_key, uri)} />
          ))
        ) : (
          <p className="alert alert-warning" role="status">
            <AlertTriangle />
            No redirect URIs yet. Add your app&apos;s callback (for example https://app.example.com/auth/callback or myapp://auth) in Settings to get a working URL.
          </p>
        )}
        <UrlRow label="Preview (no redirect)" url={appSignInUrl(authOrigin, app.publishable_key)} />
        <UrlRow label="Auth URL (SDK authUrl, KOVA_AUTH_URL)" url={authOrigin} open={false} />
        {aliasHost && (
          <>
            <UrlRow label="Hosted alias" url={`https://${aliasHost}/sign-in`} />
            <p className="text-sm text-tertiary">
              A short per-app address that forwards to the sign-in page above. Append{" "}
              <code>?redirect_url=…</code> to return to your app. With <code>@115jon/kova-react</code>, build the
              link with <code>createHostedSignInUrl({"{ authUrl, publishableKey, redirectUrl }"})</code>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function KeyRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const isKey = typeof value === "string" && mono;
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <div className="kv-value">
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {isKey ? <span className="mono-chip" style={{ minWidth: 0 }}>{value}</span> : value}
          {isKey && <CopyBtn value={value} />}
        </div>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ app }: { app: Application }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { data, isLoading } = useAppMembers(app.id, page, search, role);
  const ban = useBanMember();
  const unban = useUnbanMember();
  const changeRole = useChangeMemberRole();
  const remove = useRemoveMember();
  const [confirm, setConfirm] = useState<{ title: string; body: string; onConfirm: () => void } | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="stack">
      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body} confirmLabel="Confirm"
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onClose={() => setConfirm(null)} />
      )}

      {/* Filters */}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <form onSubmit={handleSearch} className="row" style={{ flex: "1 1 240px" }}>
          <div className="input-icon" style={{ flex: 1 }}>
            <Search aria-hidden="true" />
            <input className="input" aria-label="Search members by name or email"
              placeholder="Search by name or email…" value={searchInput}
              onChange={e => setSearchInput(e.target.value)} />
          </div>
          <button className="btn btn-secondary" type="submit">Search</button>
        </form>
        <select className="select" aria-label="Filter by role" style={{ width: 150 }}
          value={role} onChange={e => { setRole(e.target.value); setPage(1); }}>
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </div>

      {/* Table */}
      <div className="card card-flush">
        {isLoading ? (
          <div className="skeleton-rows" role="status" aria-label="Loading members">
            <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div>
        ) : !data?.members.length ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Users /></span>
            <p className="empty-state-title">No members yet</p>
            <p className="empty-state-body">People who sign up to this app appear here.</p>
          </div>
        ) : (
          <table className="data-table is-stackable">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Sessions</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.members.map(m => (
                <tr key={m.membershipId}>
                  <td data-label="User">
                    <Link
                      to="/applications/$appId/users/$userId"
                      params={{ appId: app.id, userId: m.userId }}
                      className="row"
                      style={{ gap: 10, textDecoration: "none" }}
                    >
                      <UserAvatar src={m.image} name={m.name ?? m.email ?? "?"} size={28} />
                      <div className="min-w-0">
                        <p className="text-strong truncate">
                          {m.name ?? "—"}
                          {m.banned ? <span className="badge badge-danger" style={{ marginInlineStart: 6 }}>Banned</span> : null}
                        </p>
                        <p className="text-mono text-tertiary truncate">{m.email}</p>
                      </div>
                    </Link>
                  </td>
                  <td data-label="Role">
                    <select className="select" aria-label={`Role for ${m.name ?? m.email}`} style={{ height: 32, width: 120 }}
                      value={m.role}
                      onChange={e => changeRole.mutate({ appId: app.id, userId: m.userId, role: e.target.value })}>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td data-label="Joined" className="cell-meta">
                    {relativeTime(new Date(m.joinedAt).toISOString())}
                  </td>
                  <td data-label="Sessions" className="cell-num">{m.sessionCount}</td>
                  <td className="cell-actions">
                    <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      {m.banned ? (
                        <button type="button" className="btn btn-secondary btn-sm" title="Unban"
                          onClick={() => setConfirm({ title: "Unban user?", body: `Remove ban from ${m.name ?? m.email}?`, onConfirm: () => unban.mutate({ appId: app.id, userId: m.userId }) })}>
                          <ShieldOff /> Unban
                        </button>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm" title="Ban"
                          onClick={() => setConfirm({ title: `Ban ${m.name ?? m.email}?`, body: "All their sessions will be revoked.", onConfirm: () => ban.mutate({ appId: app.id, userId: m.userId }) })}>
                          <Ban /> Ban
                        </button>
                      )}
                      <button type="button" className="btn btn-danger btn-sm btn-icon" title="Remove from app"
                        aria-label={`Remove ${m.name ?? m.email} from app`}
                        onClick={() => setConfirm({ title: "Remove member?", body: `${m.name ?? m.email} will lose access to this app.`, onConfirm: () => remove.mutate({ appId: app.id, userId: m.userId }) })}>
                        <X />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.pagination.pages > 1 && (
          <div className="panel-footer">
            <span className="text-sm text-tertiary tabular">
              Page {data.pagination.page} of {data.pagination.pages}
            </span>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft />
            </button>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Next page" disabled={page >= data.pagination.pages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Appearance Tab ────────────────────────────────────────────────────────────

type AppearanceForm = {
  display_name: string;
  primary_color: string;
  background_color: string;
  theme: "dark" | "light" | "auto";
  hide_branding: boolean;
  home_url: string;
  terms_url: string;
  privacy_url: string;
};

// Preview tile for an uploaded logo or favicon (the image itself is app data).
const assetTile: React.CSSProperties = {
  alignItems: "center", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
  display: "flex", justifyContent: "center", overflow: "hidden",
};

// Native colour input: the swatch shows the app's chosen colour.
const colorPicker: React.CSSProperties = {
  background: "var(--color-surface-raised)", border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-md)", cursor: "pointer", flexShrink: 0, height: 40, padding: 2, width: 40,
};

function AppearanceTab({ app, isPlatformAdmin = false, onFormChange }: { app: Application; isPlatformAdmin?: boolean; onFormChange?: (f: AppearanceForm) => void }) {
  const update = useUpdateApplication();
  const uploadLogo = useUploadLogo();
  const deleteLogo = useDeleteLogo();
  const uploadFavicon = useUploadFavicon();
  const deleteFavicon = useDeleteFavicon();
  const logoRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);

  const [form, setFormRaw] = useState<AppearanceForm>({
    display_name: app.display_name ?? "",
    primary_color: app.primary_color ?? DEFAULT_PRIMARY,
    background_color: app.background_color ?? DEFAULT_BACKGROUND[app.theme === "light" ? "light" : "dark"],
    theme: app.theme ?? "dark",
    hide_branding: app.hide_branding ?? false,
    home_url: app.home_url ?? "",
    terms_url: app.terms_url ?? "",
    privacy_url: app.privacy_url ?? "",
  });

  // Wrapper that also notifies parent for live preview
  const setForm = (updater: (f: AppearanceForm) => AppearanceForm) => {
    setFormRaw(prev => {
      const next = updater(prev);
      onFormChange?.(next);
      return next;
    });
  };

  const canHideBranding = isPlatformAdmin || app.plan !== "free";
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const uploadAsset = async (kind: "logo" | "favicon", file: File) => {
    setOk(""); setErr("");
    const maxBytes = kind === "logo" ? APP_LOGO_MAX_BYTES : APP_FAVICON_MAX_BYTES;
    const maxLabel = kind === "logo" ? APP_LOGO_MAX_LABEL : APP_FAVICON_MAX_LABEL;
    if (file.size > maxBytes) {
      setErr(`${kind === "logo" ? "Logo" : "Favicon"} is too large. Maximum size is ${maxLabel}.`);
      return;
    }
    if (kind === "logo" && !LOGO_TYPES.includes(file.type)) {
      setErr("Logo must be a JPEG, PNG or WebP image.");
      return;
    }
    if (kind === "favicon" && !["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/webp"].includes(file.type) && !/\.(png|ico|webp)$/i.test(file.name)) {
      setErr("Favicon must be a PNG, ICO or WebP image.");
      return;
    }
    try {
      if (kind === "logo") {
        await uploadLogo.mutateAsync({ id: app.id, file });
        setOk("Logo uploaded.");
      } else {
        await uploadFavicon.mutateAsync({ id: app.id, file });
        setOk("Favicon uploaded.");
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setOk(""); setErr("");
    try {
      await update.mutateAsync({ id: app.id, ...form, display_name: form.display_name || null });
      setOk("Appearance saved.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <form onSubmit={save} className="stack-lg">
      {/* Logo / Favicon */}
      <section className="card card-flush" aria-labelledby="appearance-assets">
        <div className="panel-header"><h2 className="panel-title" id="appearance-assets"><ImageIcon /> Brand assets</h2></div>
        <div className="panel-body" style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          {/* Logo */}
          <div className="stack-sm" style={{ alignItems: "flex-start" }}>
            <span className="form-label">Logo</span>
            <div style={{ ...assetTile, borderRadius: "var(--radius-md)", height: 80, width: 80 }}>
              {app.logo_url ? <img src={app.logo_url} alt="Current logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ImageIcon size={24} className="text-tertiary" strokeWidth={1.5} aria-hidden="true" />}
            </div>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoRef.current?.click()} disabled={uploadLogo.isPending}>
                {uploadLogo.isPending ? "Uploading…" : "Upload"}
              </button>
              {app.logo_url && <button type="button" className="btn btn-danger btn-sm btn-icon" aria-label="Remove logo" title="Remove logo" onClick={() => deleteLogo.mutate({ id: app.id })}><Trash2 /></button>}
            </div>
            <input ref={logoRef} type="file" accept={LOGO_TYPES.join(",")} aria-label="Upload logo" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset("logo", f); e.currentTarget.value = ""; }} />
          </div>

          {/* Favicon */}
          <div className="stack-sm" style={{ alignItems: "flex-start" }}>
            <span className="form-label">Favicon</span>
            <div style={{ ...assetTile, borderRadius: "var(--radius-sm)", height: 40, width: 40 }}>
              {app.favicon_url ? <img src={app.favicon_url} alt="Current favicon" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ImageIcon size={16} className="text-tertiary" strokeWidth={1.5} aria-hidden="true" />}
            </div>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => faviconRef.current?.click()} disabled={uploadFavicon.isPending}>
                {uploadFavicon.isPending ? "Uploading…" : "Upload"}
              </button>
              {app.favicon_url && <button type="button" className="btn btn-danger btn-sm btn-icon" aria-label="Remove favicon" title="Remove favicon" onClick={() => deleteFavicon.mutate({ id: app.id })}><Trash2 /></button>}
            </div>
            <input ref={faviconRef} type="file" accept=".png,.ico,.webp,image/png,image/x-icon,image/vnd.microsoft.icon,image/webp" aria-label="Upload favicon" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset("favicon", f); e.currentTarget.value = ""; }} />
          </div>
        </div>
      </section>

      {/* Branding fields */}
      <section className="card card-flush" aria-labelledby="appearance-theme">
        <div className="panel-header"><h2 className="panel-title" id="appearance-theme"><Palette /> Theme and colors</h2></div>
        <div className="panel-body stack">
          <div className="form-group">
            <label className="form-label" htmlFor="app-display-name">Display name</label>
            <input id="app-display-name" className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder={app.name} />
            <p className="form-hint">Shown on the sign-in card.</p>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="app-primary-color">Primary color</label>
              <div className="row">
                <input type="color" aria-label="Primary color picker" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} style={colorPicker} />
                <input id="app-primary-color" className="input input-mono" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="app-background-color">Background color</label>
              <div className="row">
                <input type="color" aria-label="Background color picker" value={form.background_color} onChange={e => setForm(f => ({ ...f, background_color: e.target.value }))} style={colorPicker} />
                <input id="app-background-color" className="input input-mono" value={form.background_color} onChange={e => setForm(f => ({ ...f, background_color: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="app-theme">Theme</label>
            <select id="app-theme" className="select" value={form.theme} onChange={e => setForm(f => ({ ...f, theme: e.target.value as "dark" | "light" | "auto" }))}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="auto">Auto (follow system)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="app-home-url">Home URL</label>
            <input id="app-home-url" className="input input-mono" type="url" value={form.home_url} onChange={e => setForm(f => ({ ...f, home_url: e.target.value }))} placeholder="https://yourapp.com" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="app-terms-url">Terms of service URL</label>
              <input id="app-terms-url" className="input input-mono" type="url" value={form.terms_url} onChange={e => setForm(f => ({ ...f, terms_url: e.target.value }))} placeholder="https://yourapp.com/terms" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="app-privacy-url">Privacy policy URL</label>
              <input id="app-privacy-url" className="input input-mono" type="url" value={form.privacy_url} onChange={e => setForm(f => ({ ...f, privacy_url: e.target.value }))} placeholder="https://yourapp.com/privacy" />
            </div>
          </div>
        </div>
      </section>

      {/* Hide branding toggle — Starter+ */}
      <section className="card card-flush" aria-labelledby="appearance-branding">
        <div className="panel-header">
          <h2 className="panel-title" id="appearance-branding">Powered-by branding</h2>
          <div className="row">
            {!canHideBranding && <span className="badge badge-warning">Starter+</span>}
            {isPlatformAdmin && <span className="badge badge-success">Admin override</span>}
          </div>
        </div>
        <div className="panel-body stack">
          <p className="text-sm text-secondary">
            Shows &quot;Secured by Kova&quot; in the sign-in footer. Paid plans can hide it.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Switch
              label="Hide the Secured by Kova footer"
              checked={form.hide_branding}
              disabled={!canHideBranding}
              onChange={() => setForm(f => ({ ...f, hide_branding: !f.hide_branding }))}
            />
            <span className="text-secondary">
              {form.hide_branding ? "Branding hidden" : 'Show "Secured by Kova"'}
            </span>
          </div>
        </div>
      </section>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save appearance"}</button>
      </div>
    </form>
  );
}

// ── Email Tab ─────────────────────────────────────────────────────────────────

function EmailTab({ app }: { app: Application }) {
  const update = useUpdateApplication();
  const [form, setForm] = useState({
    from_name: app.from_name ?? "",
    from_email: app.from_email ?? "",
    support_email: app.support_email ?? "",
    smtp_host: app.smtp_host ?? "",
    smtp_port: app.smtp_port ?? 587,
    smtp_user: app.smtp_user ?? "",
    smtp_secure: app.smtp_secure ?? true,
  });
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setOk(""); setErr("");
    try {
      await update.mutateAsync({ id: app.id, from_name: form.from_name || null, from_email: form.from_email || null, support_email: form.support_email || null, smtp_host: form.smtp_host || null, smtp_port: form.smtp_port, smtp_user: form.smtp_user || null, smtp_secure: form.smtp_secure });
      setOk("Email settings saved.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <form onSubmit={save} className="stack-lg">
      <section className="card card-flush" aria-labelledby="email-sender">
        <div className="panel-header"><h2 className="panel-title" id="email-sender"><Mail /> Sender identity</h2></div>
        <div className="panel-body stack">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="email-from-name">From name</label>
              <input id="email-from-name" className="input" value={form.from_name} onChange={e => setForm(f => ({ ...f, from_name: e.target.value }))} placeholder="Your App" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="email-from-email">From email</label>
              <input id="email-from-email" className="input" type="email" value={form.from_email} onChange={e => setForm(f => ({ ...f, from_email: e.target.value }))} placeholder="noreply@yourapp.com" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="email-support">Support email</label>
            <input id="email-support" className="input" type="email" value={form.support_email} onChange={e => setForm(f => ({ ...f, support_email: e.target.value }))} placeholder="support@yourapp.com" />
          </div>
        </div>
      </section>

      <section className="card card-flush" aria-labelledby="email-smtp">
        <div className="panel-header">
          <h2 className="panel-title" id="email-smtp"><Settings /> Custom SMTP</h2>
          <span className="badge badge-warning">Pro+</span>
        </div>
        <div className="panel-body stack">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="email-smtp-host">SMTP host</label>
              <input id="email-smtp-host" className="input input-mono" value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} placeholder="smtp.mailgun.org" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="email-smtp-port">Port</label>
              <input id="email-smtp-port" className="input" type="number" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="email-smtp-user">SMTP username</label>
            <input id="email-smtp-user" className="input" value={form.smtp_user} onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))} placeholder="apikey" />
          </div>
          <label className="row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={form.smtp_secure} onChange={e => setForm(f => ({ ...f, smtp_secure: e.target.checked }))} />
            <span className="text-secondary">TLS / Secure (recommended)</span>
          </label>
        </div>
      </section>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save email settings"}</button>
      </div>
    </form>
  );
}

// ── Billing Tab ───────────────────────────────────────────────────────────────

const PLANS = [
  { id: "free", label: "Free", price: "$0/mo", features: ["Up to 100 users", "1 org", "Basic branding"] },
  { id: "starter", label: "Starter", price: "$29/mo", features: ["Up to 1,000 users", "5 orgs", "Custom domain", "Custom SMTP"] },
  { id: "pro", label: "Pro", price: "$99/mo", features: ["Unlimited users", "Unlimited orgs", "Advanced analytics", "Priority support"] },
  { id: "enterprise", label: "Enterprise", price: "Custom", features: ["SLA", "SSO/SAML", "Dedicated infrastructure", "Custom contracts"] },
];

function BillingTab({ app }: { app: Application }) {
  const checkout = useBillingCheckout();
  const portal = useBillingPortal();
  const [err, setErr] = useState("");

  const handlePlan = async (priceEnvKey: string) => {
    setErr("");
    try {
      const priceId = (window as unknown as Record<string, string>)[priceEnvKey] ?? priceEnvKey;
      const { url } = await checkout.mutateAsync({ id: app.id, priceId });
      window.location.href = url;
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  const handlePortal = async () => {
    setErr("");
    try {
      const { url } = await portal.mutateAsync({ id: app.id });
      window.location.href = url;
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="stack-lg">
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div className="stack-sm">
          <h2 className="text-h3">Current plan</h2>
          <div className="row">
            <PlanBadge plan={app.plan} />
            {app.plan_expires_at && (
              <span className="text-sm text-tertiary">
                Renews {new Date(app.plan_expires_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {app.stripe_customer_id && (
          <button type="button" className="btn btn-secondary" onClick={handlePortal} disabled={portal.isPending}>
            <CreditCard /> {portal.isPending ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      {err && <ErrBanner msg={err} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
        {PLANS.map(plan => {
          const isCurrent = app.plan === plan.id;
          return (
            <div key={plan.id} className="card stack" style={{ gap: 12, borderColor: isCurrent ? "var(--color-accent)" : undefined }}>
              <div>
                <div className="row-between">
                  <h3 className="text-h3">{plan.label}</h3>
                  {isCurrent && <span className="badge badge-info">Current</span>}
                </div>
                <p className="text-secondary tabular" style={{ marginTop: 2 }}>{plan.price}</p>
              </div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.features.map(f => (
                  <li key={f} className="row" style={{ alignItems: "flex-start" }}>
                    <CheckCircle size={14} className="text-success" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span className="text-sm text-secondary">{f}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent && plan.id !== "free" && plan.id !== "enterprise" && (
                <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: "auto" }}
                  onClick={() => handlePlan(`VITE_STRIPE_PRICE_${plan.id.toUpperCase()}`)}
                  disabled={checkout.isPending}>
                  Upgrade to {plan.label}
                </button>
              )}
              {plan.id === "enterprise" && !isCurrent && (
                <a href="mailto:sales@example.com" className="btn btn-secondary btn-block" style={{ marginTop: "auto" }}>Contact sales</a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mirrors the app-branded /sign-in?pk=… page (src/web/routes/sign-in.tsx) with
// unsaved form values, using the same colors, so edits show before they are saved.
// The card's colours are the app's own data (look.* / v.*), not Kova chrome.
function LoginPreview({ app, primaryColor, backgroundColor, theme, logoUrl, displayName, enabledProviders, hideBranding = false, isDevMode = false }: {
  app: Application;
  primaryColor: string;
  backgroundColor: string;
  theme: "dark" | "light" | "auto";
  logoUrl: string | null;
  displayName: string;
  enabledProviders: string[];
  hideBranding?: boolean;
  isDevMode?: boolean;
}) {
  const prefersDark = typeof window === "undefined" || window.matchMedia("(prefers-color-scheme: dark)").matches;
  const look = appSignInLook({ primaryColor, backgroundColor, theme }, prefersDark);
  const v = look.variables;
  const name = displayName || app.name;
  const providers = CONFIGURED_PROVIDERS.filter(p => enabledProviders.includes(p.id));
  const field: React.CSSProperties = {
    background: v.colorSurfaceRaised, border: `1px solid ${v.colorBorder}`, borderRadius: 8,
    padding: "8px 10px", fontSize: 12, lineHeight: 1.4, color: v.colorTextTertiary,
  };
  const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: v.colorTextSecondary, margin: "0 0 4px" };

  return (
    <div style={{ flex: "0 1 320px", minWidth: 0, position: "sticky", top: 20, alignSelf: "flex-start" }}>
      <p className="text-overline" style={{ marginBottom: 10 }}>Sign-in page preview</p>
      <div aria-hidden="true" style={{
        background: `radial-gradient(ellipse 90% 55% at 50% -18%, color-mix(in oklab, ${look.primary} ${look.backdrop === "dark" ? 12 : 10}%, transparent), transparent 72%), ${look.background}`,
        borderRadius: "var(--radius-lg)", padding: "24px 16px 14px", border: "1px solid var(--color-border)", fontFamily: "var(--font-sans)",
      }}>
        <div style={{ background: v.colorSurface, border: `1px solid ${v.colorBorder}`, borderRadius: 14, boxShadow: v.shadow, padding: "20px 16px 14px" }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            {logoUrl ? (
              <img src={logoUrl} alt="" style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 8, display: "block", margin: "0 auto 10px" }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, margin: "0 auto 10px", background: `color-mix(in oklab, ${look.primary} 16%, transparent)`, border: `1px solid color-mix(in oklab, ${look.primary} 40%, transparent)`, color: look.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 }}>
                {name.trim().charAt(0).toUpperCase() || "?"}
              </div>
            )}
            <p style={{ fontWeight: 600, fontSize: 14, color: v.colorText, margin: 0, overflowWrap: "anywhere" }}>Sign in to {name}</p>
            <p style={{ fontSize: 12, color: v.colorTextSecondary, margin: "3px 0 0" }}>Welcome back. Choose your sign-in method.</p>
          </div>

          {providers.length > 0 && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {providers.map(p => (
                  <div key={p.id} style={{ ...field, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: v.colorText, fontWeight: 500 }}>
                    <span style={{ display: "inline-flex", color: v.colorText }}><ProviderIcon id={p.id} size={16} /></span>
                    Continue with {p.name}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }}>
                <div style={{ flex: 1, height: 1, background: v.colorBorder }} />
                <span style={{ fontSize: 12, color: v.colorTextTertiary }}>or</span>
                <div style={{ flex: 1, height: 1, background: v.colorBorder }} />
              </div>
            </>
          )}

          <div style={{ display: "flex", borderBottom: `1px solid ${v.colorBorder}`, marginBottom: 10 }}>
            {["Password", "Magic link", "Passkey"].map((tab, i) => (
              <span key={tab} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 500, padding: "6px 0", color: i === 0 ? v.colorText : v.colorTextTertiary, borderBottom: `2px solid ${i === 0 ? look.primary : "transparent"}` }}>{tab}</span>
            ))}
          </div>
          <p style={fieldLabel}>Email address</p>
          <div style={{ ...field, marginBottom: 8 }}>you@example.com</div>
          <p style={fieldLabel}>Password</p>
          <div style={{ ...field, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            ••••••••<Lock size={12} />
          </div>
          {/* "white" mirrors the SDK card's primary button label, which is white on any app colour. */}
          <div style={{ background: look.primary, color: "white", borderRadius: 8, padding: "8px", fontSize: 12, fontWeight: 500, textAlign: "center" }}>
            Continue
          </div>
          {!hideBranding && (
            <p style={{ textAlign: "center", fontSize: 12, color: v.colorTextTertiary, margin: "10px 0 0" }}>Secured by Kova</p>
          )}
        </div>
        {isDevMode && (
          <p className="text-sm text-warning" style={{ textAlign: "center", margin: "10px 0 0", fontWeight: 500 }}>
            Development
          </p>
        )}
      </div>
    </div>
  );
}

// Providers that our platform has actually configured OAuth credentials for.
// Apple and Facebook are shown in the list but default to OFF since we haven't
// set up their credentials yet. This prevents them appearing enabled on every
// fresh app load even though they'd fail at runtime.
const PLATFORM_CONFIGURED_PROVIDERS = new Set(["google", "github", "discord", "microsoft"]);

const PROVIDER_META: { id: ProviderId; label: string; description: string; platformReady: boolean }[] = [
  { id: "google", label: "Google", description: "Sign in with Google — works with Gmail and Google Workspace accounts.", platformReady: true },
  { id: "github", label: "GitHub", description: "Sign in with GitHub — popular with developer-focused apps.", platformReady: true },
  { id: "discord", label: "Discord", description: "Sign in with Discord — great for gaming and community apps.", platformReady: true },
  { id: "microsoft", label: "Microsoft", description: "Sign in with Microsoft — supports personal and Azure AD accounts.", platformReady: true },
  { id: "apple", label: "Apple", description: "Sign in with Apple — required when other social logins are offered on iOS.", platformReady: false },
  { id: "facebook", label: "Facebook", description: "Sign in with Facebook — large user base worldwide.", platformReady: false },
];


function ProvidersTab({ app, onProvidersChange }: { app: Application; onProvidersChange?: (ids: string[]) => void }) {
  const { data: serverProviders, isLoading } = useAppOAuthProviders(app.id);
  const setProviders = useSetOAuthProviders();

  const [local, setLocalRaw] = useState<Record<string, boolean>>({});
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  // Sync from server on load. If no row exists for a provider, default to
  // whether our platform has actually configured that provider.
  useEffect(() => {
    if (!serverProviders) return;
    const serverMap = new Map(serverProviders.map(p => [p.id, p.enabled]));
    const map: Record<string, boolean> = {};
    for (const p of PROVIDER_META) {
      map[p.id] = serverMap.has(p.id) ? serverMap.get(p.id)! : PLATFORM_CONFIGURED_PROVIDERS.has(p.id);
    }
    setLocalRaw(map);
    onProvidersChange?.(Object.entries(map).filter(([, v]) => v).map(([k]) => k));
  }, [serverProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setLocalRaw(prev => {
    const next = { ...prev, [id]: !prev[id] };
    onProvidersChange?.(Object.entries(next).filter(([, v]) => v).map(([k]) => k));
    return next;
  });

  const save = async () => {
    setOk(""); setErr("");
    const providers = PROVIDER_META.map(p => ({ id: p.id, enabled: local[p.id] ?? PLATFORM_CONFIGURED_PROVIDERS.has(p.id) }));
    try {
      await setProviders.mutateAsync({ appId: app.id, providers });
      setOk("Provider settings saved.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  if (isLoading) return (
    <div className="card card-flush">
      <div className="skeleton-rows" role="status" aria-label="Loading providers">
        <span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
      </div>
    </div>
  );

  return (
    <div className="stack">
      <section className="card card-flush" aria-labelledby="providers-oauth">
        <div className="panel-header"><h2 className="panel-title" id="providers-oauth"><SlidersHorizontal /> OAuth providers</h2></div>
        <div className="panel-body">
          <p className="text-sm text-secondary">
            Controls which social buttons appear on the app&apos;s sign-in page and in the SDK.
            Turning all of them off leaves email, passkey, and email-link sign-in.
          </p>
        </div>

        <div style={{ borderBlockStart: "1px solid var(--color-border)" }}>
          {PROVIDER_META.map(p => {
            const enabled = local[p.id] ?? PLATFORM_CONFIGURED_PROVIDERS.has(p.id);
            return (
              <div key={p.id} className="list-row">
                <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, opacity: enabled ? 1 : 0.5 }}>
                  <ProviderIcon id={p.id} size={20} />
                </span>
                <div className="list-row-main">
                  <div className="row">
                    <p className="list-row-title">{p.label}</p>
                    {!p.platformReady && <span className="badge badge-warning">Not configured</span>}
                  </div>
                  <p className="text-sm text-secondary">{p.description}</p>
                </div>
                <div className="list-row-actions">
                  <Switch label={`${p.label} sign-in`} checked={enabled} onChange={() => toggle(p.id)} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={setProviders.isPending}>
          {setProviders.isPending ? "Saving…" : "Save provider settings"}
        </button>
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ app }: { app: Application }) {
  const update = useUpdateApplication();
  const del = useDeleteApplication();
  const suspend = useSuspendApp();
  const unsuspend = useUnsuspendApp();
  const rotateSecret = useRotateSecret();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: app.name, allowed_origins: app.allowed_origins.join("\n"), redirect_uris: app.redirect_uris.join("\n") });
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [rawSecret, setRawSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setOk(""); setErr("");
    try {
      await update.mutateAsync({ id: app.id, name: form.name, allowed_origins: form.allowed_origins.split("\n").map(s => s.trim()).filter(Boolean), redirect_uris: form.redirect_uris.split("\n").map(s => s.trim()).filter(Boolean) });
      setOk("Settings saved.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== app.name) return;
    try {
      await del.mutateAsync({ id: app.id, confirmedName: app.name });
      navigate({ to: "/applications" });
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Delete failed"); }
  };

  const handleRotate = async () => {
    try {
      const { rawSecretKey } = await rotateSecret.mutateAsync({ id: app.id });
      setRawSecret(rawSecretKey);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Rotate failed"); }
  };

  return (
    <div className="stack-lg">
      {/* General */}
      <form onSubmit={save} className="card card-flush" aria-labelledby="settings-general">
        <div className="panel-header"><h2 className="panel-title" id="settings-general"><Settings /> General</h2></div>
        <div className="panel-body stack">
          <div className="form-group">
            <label className="form-label" htmlFor="settings-name">App name</label>
            <input id="settings-name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-origins">Allowed origins</label>
            <textarea id="settings-origins" className="input input-mono" value={form.allowed_origins} onChange={e => setForm(f => ({ ...f, allowed_origins: e.target.value }))} placeholder="https://yourapp.com" />
            <p className="form-hint">One per line.</p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-redirects">Redirect URIs</label>
            <textarea id="settings-redirects" className="input input-mono" value={form.redirect_uris} onChange={e => setForm(f => ({ ...f, redirect_uris: e.target.value }))} placeholder="https://yourapp.com/auth/callback" />
            <p className="form-hint">One per line.</p>
          </div>
          {ok && <OkBanner msg={ok} />}
          {err && <ErrBanner msg={err} />}
        </div>
        <div className="panel-footer">
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>

      {/* Secret key */}
      <section className="card card-flush" aria-labelledby="settings-secret">
        <div className="panel-header"><h2 className="panel-title" id="settings-secret"><Key /> Secret key</h2></div>
        <div className="panel-body stack">
          {rawSecret ? (
            <>
              <p className="alert alert-warning" role="status"><AlertTriangle /> Copy this secret now. It will not be shown again.</p>
              <div className="code-block row">
                <span className="text-mono" style={{ flex: 1 }}>
                  {showSecret ? rawSecret : rawSecret.slice(0, 10) + "•".repeat(24)}
                </span>
                <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={showSecret ? "Hide secret" : "Show secret"} onClick={() => setShowSecret(s => !s)}>
                  {showSecret ? <EyeOff /> : <Eye />}
                </button>
                <CopyBtn value={rawSecret} />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-secondary">Rotating the secret key will immediately invalidate the current key. Any SDK consumers using the old secret will be locked out.</p>
              <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={handleRotate} disabled={rotateSecret.isPending}>
                <RefreshCw className={rotateSecret.isPending ? "spin" : undefined} /> {rotateSecret.isPending ? "Rotating…" : "Rotate secret key"}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Suspend */}
      <section className="card card-flush" aria-labelledby="settings-suspend">
        <div className="panel-header"><h2 className="panel-title" id="settings-suspend"><AlertTriangle /> Suspend application</h2></div>
        <div className="panel-body stack">
          {app.suspended_at ? (
            <p className="alert alert-warning" role="status"><ShieldAlert /> This application is currently suspended. SDK sign-ins will be blocked.</p>
          ) : (
            <p className="text-sm text-secondary">Suspending will block all SDK sign-ins and show an error to end users. The app data is preserved.</p>
          )}
          {app.suspended_at ? (
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => unsuspend.mutate({ id: app.id })} disabled={unsuspend.isPending}>
              <ShieldOff /> {unsuspend.isPending ? "Unsuspending…" : "Unsuspend application"}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => suspend.mutate({ id: app.id })} disabled={suspend.isPending}>
              <ShieldAlert /> {suspend.isPending ? "Suspending…" : "Suspend application"}
            </button>
          )}
        </div>
      </section>

      {/* Delete */}
      <section className="card card-flush" aria-labelledby="settings-delete">
        <div className="panel-header"><h2 className="panel-title" id="settings-delete"><Trash2 /> Delete application</h2></div>
        <div className="panel-body stack">
          <p className="text-sm text-secondary">
            Permanently deletes the application and all associated users, sessions, and branding data. This action is irreversible.
          </p>
          <button type="button" className="btn btn-danger" style={{ alignSelf: "flex-start" }} onClick={() => setDeleteModal(true)}>
            <Trash2 /> Delete application
          </button>
        </div>
      </section>

      {/* Delete Modal */}
      {deleteModal && (
        <Modal onClose={() => setDeleteModal(false)} maxWidth={460}>
          <ModalHeader
            title="Delete application"
            icon={<span className="icon-tile tone-danger" aria-hidden="true"><Trash2 /></span>}
          />
          <div className="modal-body">
            <p className="text-secondary">
              Are you sure you want to delete <strong className="text-strong">{app.name}</strong>? This will delete all associated users, sessions, branding, and data. This action is irreversible.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-delete-confirm">Type <span className="text-strong">{app.name}</span> to confirm</label>
              <input id="settings-delete-confirm" className="input" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} autoFocus placeholder={app.name} />
            </div>
            {err && <ErrBanner msg={err} />}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteModal(false)}>Cancel</button>
            <button type="button" className="btn btn-danger"
              disabled={deleteConfirm !== app.name || del.isPending} onClick={handleDelete}>
              <Trash2 /> {del.isPending ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AppDetailPage() {
  const { appId } = Route.useParams();
  const { data: app, isLoading, error } = useApplication(appId);
  const { data: session } = useSession();
  // Platform admins bypass all plan gates in the dashboard.
  const isPlatformAdmin = session?.user?.role === "admin";
  const [tab, setTab] = useState<Tab>("overview");

  // Live form state — bubbled up from AppearanceTab / ProvidersTab for the preview
  const [liveAppearance, setLiveAppearance] = useState<AppearanceForm | null>(null);
  const [liveProviders, setLiveProviders] = useState<string[] | null>(null);
  // Saved provider state, so the Appearance preview is right before the
  // Providers tab has been opened.
  const { data: savedProviderRows } = useAppOAuthProviders(appId);
  const savedProviders = PROVIDER_META
    .filter(p => savedProviderRows?.find(r => r.id === p.id)?.enabled ?? PLATFORM_CONFIGURED_PROVIDERS.has(p.id))
    .map(p => p.id);

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: TrendingUp },
    { id: "users", label: "Users", icon: Users },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "providers", label: "Providers", icon: SlidersHorizontal },
    { id: "email", label: "Email", icon: Mail },
    { id: "billing", label: "Billing", icon: CreditCard },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  if (isLoading) return (
    <div role="status" aria-label="Loading application">
      <span className="skeleton" style={{ height: 14, width: 140, marginBottom: 16 }} />
      <div className="row" style={{ gap: 12, marginBottom: 24 }}>
        <span className="skeleton" style={{ height: 40, width: 40, borderRadius: "var(--radius-md)", flexShrink: 0 }} />
        <span className="skeleton" style={{ height: 28, width: 240 }} />
      </div>
      <span className="skeleton" style={{ height: 40, width: "100%", marginBottom: 24 }} />
      <span className="skeleton" style={{ height: 160, width: "100%", borderRadius: "var(--radius-lg)" }} />
    </div>
  );

  if (error || !app) return (
    <div>
      <Link to="/applications" className="back-link"><ArrowLeft /> Back to applications</Link>
      <ErrBanner msg={error?.message ?? "Application not found"} />
    </div>
  );

  const preview = (
    <LoginPreview
      app={app}
      primaryColor={liveAppearance?.primary_color ?? app.primary_color ?? DEFAULT_PRIMARY}
      backgroundColor={liveAppearance?.background_color ?? app.background_color
        ?? DEFAULT_BACKGROUND[(liveAppearance?.theme ?? app.theme) === "light" ? "light" : "dark"]}
      theme={liveAppearance?.theme ?? app.theme ?? "dark"}
      logoUrl={app.logo_url}
      displayName={liveAppearance?.display_name || app.display_name || app.name}
      enabledProviders={liveProviders ?? savedProviders}
      hideBranding={liveAppearance?.hide_branding ?? app.hide_branding ?? false}
      isDevMode={app.environment === "development"}
    />
  );

  return (
    <div>
      <Link to="/applications" className="back-link"><ArrowLeft /> Back to applications</Link>

      {/* Header */}
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Application</p>
          <div className="row" style={{ gap: 12 }}>
            <AppLogo name={app.display_name ?? app.name} logoUrl={app.logo_url} />
            <div className="min-w-0">
              <h1 className="page-title">{app.display_name ?? app.name}</h1>
              <p className="page-subtitle">
                <span className="text-mono">{app.publishable_key}</span> · {sentenceCase(app.environment)}
              </p>
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <PlanBadge plan={app.plan} />
          {app.suspended_at && <span className="badge badge-danger">Suspended</span>}
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Application sections">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <t.icon size={14} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel" aria-label={TABS.find(t => t.id === tab)?.label} style={{ marginTop: "var(--space-6)" }}>
        {tab === "overview" && <OverviewTab app={app} />}
        {tab === "users" && <UsersTab app={app} />}
        {tab === "appearance" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 360px", minWidth: 0 }}>
              <AppearanceTab app={app} isPlatformAdmin={isPlatformAdmin} onFormChange={setLiveAppearance} />
            </div>
            {preview}
          </div>
        )}
        {tab === "providers" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 360px", minWidth: 0 }}>
              <ProvidersTab app={app} onProvidersChange={setLiveProviders} />
            </div>
            {preview}
          </div>
        )}
        {tab === "email" && <EmailTab app={app} />}
        {tab === "billing" && <BillingTab app={app} />}
        {tab === "settings" && <SettingsTab app={app} />}
      </div>
    </div>
  );
}

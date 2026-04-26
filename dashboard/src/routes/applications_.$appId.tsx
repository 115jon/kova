import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
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
import { relativeTime } from "@/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, AlertTriangle, ArrowLeft, Ban, CheckCircle,
  Copy, CreditCard, Eye, EyeOff, Globe, ImageIcon,
  Key, Layers, Lock,
  Mail, Palette, RefreshCw, Settings,
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

// ── Small reusable components ─────────────────────────────────────────────────

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
      borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
      color: "var(--color-red)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
    }}>
      <AlertCircle size={12} /> {msg}
    </div>
  );
}

function OkBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
      borderRadius: 4, padding: "8px 12px", fontFamily: "var(--font-mono)",
      color: "var(--color-green)", fontSize: "0.76rem", display: "flex", alignItems: "center", gap: 6,
    }}>
      <CheckCircle size={12} /> {msg}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const COLOR: Record<string, string> = {
    free: "var(--color-text-tertiary)", starter: "var(--color-accent)",
    pro: "var(--color-amber)", enterprise: "var(--color-green)",
  };
  const color = COLOR[plan] ?? "var(--color-text-tertiary)";
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: "0.68rem", fontWeight: 700,
      color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      borderRadius: 3, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{plan}</span>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
  return (
    <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</p>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: `color-mix(in srgb, ${color} 12%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={14} color={color} />
        </div>
      </div>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "1.6rem", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1 }}>{value}</p>
    </div>
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
    <button className="btn btn-ghost" style={{ padding: "3px 7px", fontSize: "0.72rem", gap: 4 }} onClick={copy} title={label ?? "Copy"}>
      {copied ? <CheckCircle size={12} color="var(--color-green)" /> : <Copy size={12} />}
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ app }: { app: Application }) {
  const { data: stats, isLoading } = useAppStats(app.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        <StatCard label="Users" value={isLoading ? "—" : (stats?.total_users ?? 0)} icon={Users} color="var(--color-accent)" />
        <StatCard label="Orgs" value={isLoading ? "—" : (stats?.total_orgs ?? 0)} icon={Layers} color="var(--color-amber)" />
        <StatCard label="Logins 24h" value={isLoading ? "—" : (stats?.logins_24h ?? 0)} icon={TrendingUp} color="var(--color-green)" />
        <StatCard label="Active Sessions" value={isLoading ? "—" : (stats?.active_sessions ?? 0)} icon={Globe} color="var(--color-red)" />
      </div>

      {/* Keys panel */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="panel-header"><p className="panel-title">API Keys</p></div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <KeyRow label="Publishable key" value={app.publishable_key} mono />
          <KeyRow label="Environment" value={app.environment} />
          <KeyRow label="Plan" value={<PlanBadge plan={app.plan} />} />
          {app.suspended_at && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-red-dim)", borderRadius: 4, border: "1px solid rgba(248,113,113,0.2)" }}>
              <ShieldAlert size={13} color="var(--color-red)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-red)" }}>
                Suspended {relativeTime(new Date(app.suspended_at).toISOString())}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Auth subdomain panel */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="panel-header"><p className="panel-title">Auth Domain</p></div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {app.auth_slug ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-secondary)", flexShrink: 0 }}>Sign-in URL</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
                    {app.auth_slug}.auth.115jon.site
                  </code>
                  <CopyBtn value={`https://${app.auth_slug}.auth.115jon.site`} label="Copy URL" />
                  <a
                    href={`https://${app.auth_slug}.auth.115jon.site/sign-in`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost"
                    style={{ padding: "3px 7px", fontSize: "0.72rem" }}
                  >
                    <Globe size={11} /> Open
                  </a>
                </div>
              </div>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", margin: 0 }}>
                Auth slug is <strong style={{ color: "var(--color-text-secondary)" }}>immutable</strong> — changing it would break existing redirect configs. Custom domains can be set in Settings.
              </p>
            </>
          ) : (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-tertiary)", margin: 0 }}>
              Auth slug not yet assigned. Recreate the app or apply migration 0018.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const isString = typeof value === "string";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-secondary)", flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {isString ? (
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
            {mono ? value : value}
          </code>
        ) : value}
        {isString && <CopyBtn value={value} />}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body} confirmLabel="Confirm"
          onConfirm={() => { confirm.onConfirm(); setConfirm(null); }}
          onClose={() => setConfirm(null)} />
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 6, flex: 1, minWidth: 200 }}>
          <input className="input" style={{ flex: 1, fontSize: "0.8rem", padding: "5px 10px" }}
            placeholder="Search by name or email…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)} />
          <button className="btn btn-ghost" type="submit" style={{ padding: "5px 10px", fontSize: "0.78rem" }}>Search</button>
        </form>
        <select className="input" style={{ fontSize: "0.78rem", padding: "5px 10px", maxWidth: 130, appearance: "none" }}
          value={role} onChange={e => { setRole(e.target.value); setPage(1); }}>
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading ? (
          <div className="loading empty-state" style={{ fontSize: "0.78rem" }}>Loading members…</div>
        ) : !data?.members.length ? (
          <div className="empty-state"><Users size={18} strokeWidth={1.5} style={{ marginBottom: 10 }} /><p>No members yet.</p></div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["User", "Role", "Joined", "Sessions", ""].map(h => (
                  <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: "0.6rem", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m, i) => (
                <tr key={m.membershipId} style={{ borderBottom: i < data.members.length - 1 ? "1px solid var(--color-border)" : "none" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <UserAvatar src={m.image} name={m.name ?? m.email ?? "?"} size={28} style={{ flexShrink: 0 }} />
                      <div>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
                          {m.name ?? "—"}
                          {m.banned ? <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: "0.63rem", background: "var(--color-red-dim)", color: "var(--color-red)", borderRadius: 3, padding: "1px 5px", border: "1px solid rgba(248,113,113,0.2)" }}>banned</span> : null}
                        </p>
                        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <select className="input" style={{ fontSize: "0.73rem", padding: "3px 7px", appearance: "none", cursor: "pointer" }}
                      value={m.role}
                      onChange={e => changeRole.mutate({ appId: app.id, userId: m.userId, role: e.target.value })}>
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: "0.71rem", color: "var(--color-text-tertiary)" }}>
                    {relativeTime(new Date(m.joinedAt).toISOString())}
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-secondary)" }}>{m.sessionCount}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {m.banned ? (
                        <button className="btn btn-ghost" title="Unban" style={{ padding: "3px 7px", fontSize: "0.72rem" }}
                          onClick={() => setConfirm({ title: "Unban user?", body: `Remove ban from ${m.name ?? m.email}?`, onConfirm: () => unban.mutate({ appId: app.id, userId: m.userId }) })}>
                          <ShieldOff size={12} /> Unban
                        </button>
                      ) : (
                        <button className="btn btn-ghost" title="Ban" style={{ padding: "3px 7px", fontSize: "0.72rem", color: "var(--color-amber)" }}
                          onClick={() => setConfirm({ title: `Ban ${m.name ?? m.email}?`, body: "All their sessions will be revoked.", onConfirm: () => ban.mutate({ appId: app.id, userId: m.userId }) })}>
                          <Ban size={12} /> Ban
                        </button>
                      )}
                      <button className="btn btn-ghost" title="Remove from app" style={{ padding: "3px 6px", color: "var(--color-red)" }}
                        onClick={() => setConfirm({ title: "Remove member?", body: `${m.name ?? m.email} will lose access to this app.`, onConfirm: () => remove.mutate({ appId: app.id, userId: m.userId }) })}>
                        <X size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.pagination.pages > 1 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.71rem", color: "var(--color-text-tertiary)" }}>
              Page {data.pagination.page} / {data.pagination.pages}
            </span>
            <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: "0.73rem" }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
            <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: "0.73rem" }} disabled={page >= data.pagination.pages} onClick={() => setPage(p => p + 1)}>Next</button>
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
    primary_color: app.primary_color ?? "#3b82f6",
    background_color: app.background_color ?? "#0f172a",
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setOk(""); setErr("");
    try {
      await update.mutateAsync({ id: app.id, ...form, display_name: form.display_name || null });
      setOk("Appearance saved.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Logo / Favicon */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="panel-title">Brand Assets</p>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {/* Logo */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-secondary)" }}>Logo</span>
            <div style={{ width: 80, height: 80, borderRadius: 10, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {app.logo_url ? <img src={app.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ImageIcon size={24} color="var(--color-text-tertiary)" strokeWidth={1.5} />}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "4px 9px" }} onClick={() => logoRef.current?.click()} disabled={uploadLogo.isPending}>
                {uploadLogo.isPending ? "Uploading…" : "Upload"}
              </button>
              {app.logo_url && <button type="button" className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }} onClick={() => deleteLogo.mutate({ id: app.id })}><Trash2 size={12} /></button>}
            </div>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate({ id: app.id, file: f }); }} />
          </div>

          {/* Favicon */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-secondary)" }}>Favicon</span>
            <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {app.favicon_url ? <img src={app.favicon_url} alt="favicon" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ImageIcon size={16} color="var(--color-text-tertiary)" strokeWidth={1.5} />}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "4px 9px" }} onClick={() => faviconRef.current?.click()} disabled={uploadFavicon.isPending}>
                {uploadFavicon.isPending ? "…" : "Upload"}
              </button>
              {app.favicon_url && <button type="button" className="btn btn-ghost" style={{ padding: "4px 6px", color: "var(--color-red)" }} onClick={() => deleteFavicon.mutate({ id: app.id })}><Trash2 size={12} /></button>}
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFavicon.mutate({ id: app.id, file: f }); }} />
          </div>
        </div>
      </div>

      {/* Branding fields */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="panel-title"><Palette size={14} />Theme & Colors</p>
        <div className="form-group">
          <label className="form-label">Display name <span style={{ color: "var(--color-text-tertiary)" }}>(shown in sign-in card)</span></label>
          <input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder={app.name} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Primary color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} style={{ width: 36, height: 36, borderRadius: 6, border: "1px solid var(--color-border)", cursor: "pointer", padding: 2, background: "var(--color-surface-raised)" }} />
              <input className="input" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }} value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Background color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={form.background_color} onChange={e => setForm(f => ({ ...f, background_color: e.target.value }))} style={{ width: 36, height: 36, borderRadius: 6, border: "1px solid var(--color-border)", cursor: "pointer", padding: 2, background: "var(--color-surface-raised)" }} />
              <input className="input" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }} value={form.background_color} onChange={e => setForm(f => ({ ...f, background_color: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Theme</label>
          <select className="input" style={{ appearance: "none", cursor: "pointer" }} value={form.theme} onChange={e => setForm(f => ({ ...f, theme: e.target.value as "dark" | "light" | "auto" }))}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="auto">Auto (follow system)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Home URL</label>
          <input className="input" type="url" value={form.home_url} onChange={e => setForm(f => ({ ...f, home_url: e.target.value }))} placeholder="https://yourapp.com" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Terms of Service URL</label>
            <input className="input" type="url" value={form.terms_url} onChange={e => setForm(f => ({ ...f, terms_url: e.target.value }))} placeholder="https://yourapp.com/terms" />
          </div>
          <div className="form-group">
            <label className="form-label">Privacy Policy URL</label>
            <input className="input" type="url" value={form.privacy_url} onChange={e => setForm(f => ({ ...f, privacy_url: e.target.value }))} placeholder="https://yourapp.com/privacy" />
          </div>
        </div>
      </div>

      {/* Hide branding toggle — Starter+ */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p className="panel-title" style={{ margin: 0 }}>Powered by branding</p>
          {!canHideBranding && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--color-amber)", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 3, padding: "1px 6px" }}>Starter+</span>
          )}
          {isPlatformAdmin && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--color-green)", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 3, padding: "1px 6px" }}>Admin override</span>
          )}
        </div>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", margin: 0 }}>
          When enabled, a "Powered by ralph-auth" badge appears in the sign-in footer. Disable it on paid plans.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: canHideBranding ? "pointer" : "not-allowed", opacity: canHideBranding ? 1 : 0.45, userSelect: "none" }}>
          <div
            onClick={() => canHideBranding && setForm(f => ({ ...f, hide_branding: !f.hide_branding }))}
            style={{
              position: "relative", width: 38, height: 22, flexShrink: 0,
              background: form.hide_branding ? "var(--color-accent)" : "var(--color-border-strong)",
              borderRadius: 11, transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: 3, left: form.hide_branding ? 19 : 3,
              width: 16, height: 16, borderRadius: "50%",
              background: "#fff", transition: "left 0.2s",
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
            }} />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)" }}>
            {form.hide_branding ? "Branding hidden" : 'Show "Powered by ralph-auth"'}
          </span>
        </label>
      </div>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="panel-title"><Mail size={14} />Sender Identity</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">From name</label>
            <input className="input" value={form.from_name} onChange={e => setForm(f => ({ ...f, from_name: e.target.value }))} placeholder="Your App" />
          </div>
          <div className="form-group">
            <label className="form-label">From email</label>
            <input className="input" type="email" value={form.from_email} onChange={e => setForm(f => ({ ...f, from_email: e.target.value }))} placeholder="noreply@yourapp.com" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Support email</label>
          <input className="input" type="email" value={form.support_email} onChange={e => setForm(f => ({ ...f, support_email: e.target.value }))} placeholder="support@yourapp.com" />
        </div>
      </div>

      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p className="panel-title" style={{ margin: 0 }}>Custom SMTP</p>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.63rem", color: "var(--color-amber)", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 3, padding: "1px 6px" }}>Pro+</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">SMTP host</label>
            <input className="input" value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} placeholder="smtp.mailgun.org" />
          </div>
          <div className="form-group">
            <label className="form-label">Port</label>
            <input className="input" type="number" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: Number(e.target.value) }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">SMTP username</label>
          <input className="input" value={form.smtp_user} onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))} placeholder="apikey" />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.smtp_secure} onChange={e => setForm(f => ({ ...f, smtp_secure: e.target.checked }))} style={{ accentColor: "var(--color-accent)", width: 14, height: 14 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-secondary)" }}>TLS / Secure (recommended)</span>
        </label>
      </div>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "0.95rem", color: "var(--color-text-primary)" }}>Current plan</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <PlanBadge plan={app.plan} />
            {app.plan_expires_at && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.69rem", color: "var(--color-text-tertiary)" }}>
                Renews {new Date(app.plan_expires_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {app.stripe_customer_id && (
          <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={handlePortal} disabled={portal.isPending}>
            <CreditCard size={13} /> {portal.isPending ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      {err && <ErrBanner msg={err} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        {PLANS.map(plan => {
          const isCurrent = app.plan === plan.id;
          return (
            <div key={plan.id} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, border: isCurrent ? "1px solid var(--color-accent)" : undefined, position: "relative" }}>
              {isCurrent && <div style={{ position: "absolute", top: 10, right: 10, fontFamily: "var(--font-mono)", fontSize: "0.6rem", background: "var(--color-accent-dim)", color: "var(--color-accent)", borderRadius: 3, padding: "2px 6px", border: "1px solid rgba(59,130,246,0.25)" }}>CURRENT</div>}
              <div>
                <p style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "0.9rem", color: "var(--color-text-primary)" }}>{plan.label}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--color-text-secondary)", marginTop: 2 }}>{plan.price}</p>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CheckCircle size={11} color="var(--color-green)" />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.69rem", color: "var(--color-text-secondary)" }}>{f}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent && plan.id !== "free" && plan.id !== "enterprise" && (
                <button className="btn btn-primary" style={{ fontSize: "0.76rem", marginTop: "auto" }}
                  onClick={() => handlePlan(`VITE_STRIPE_PRICE_${plan.id.toUpperCase()}`)}
                  disabled={checkout.isPending}>
                  Upgrade to {plan.label}
                </button>
              )}
              {plan.id === "enterprise" && !isCurrent && (
                <a href="mailto:sales@example.com" className="btn btn-ghost" style={{ fontSize: "0.76rem", textAlign: "center" }}>Contact sales</a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Provider icon map — inline SVG data URIs so no external dependency
const PREV_ICONS: Record<string, React.ReactElement> = {
  google: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="white">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
      <rect width="24" height="24" rx="5" fill="#5865F2" />
      <path fill="white" d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0 11.12 11.12 0 0 0-.54-1.09.07.07 0 0 0-.07-.03c-1.5.26-2.93.71-4.27 1.33a.06.06 0 0 0-.028.025C2.446 8.895 1.706 12.37 2.01 15.8c.001.015.01.03.02.04a16.68 16.68 0 0 0 4.99 2.52c.03.01.06 0 .07-.02.38-.52.72-1.07 1.02-1.65.02-.03.01-.07-.03-.08a10.98 10.98 0 0 1-1.56-.74c-.03-.02-.04-.06-.01-.09l.31-.24c.02-.02.05-.02.07-.01 3.28 1.5 6.83 1.5 10.07 0a.07.07 0 0 1 .07.01l.31.24c.03.03.02.07-.01.09-.5.29-1.02.54-1.56.74-.04.01-.05.05-.03.08.3.58.64 1.13 1.01 1.65.02.02.05.03.08.02a16.62 16.62 0 0 0 5-2.52c.01-.01.02-.02.02-.04.36-3.72-.6-6.95-2.55-9.83a.05.05 0 0 0-.027-.024zM8.52 13.9c-1.04 0-1.9-.95-1.9-2.12 0-1.17.84-2.12 1.9-2.12 1.07 0 1.91.96 1.9 2.12 0 1.17-.84 2.12-1.9 2.12zm7 0c-1.04 0-1.9-.95-1.9-2.12 0-1.17.84-2.12 1.9-2.12 1.07 0 1.91.96 1.9 2.12 0 1.17-.83 2.12-1.9 2.12z" />
    </svg>
  ),
  microsoft: (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none">
      <path d="M11.4 11.4H2V2h9.4v9.4z" fill="#F35325" />
      <path d="M22 11.4h-9.4V2H22v9.4z" fill="#81BC06" />
      <path d="M11.4 22H2v-9.4h9.4V22z" fill="#05A6F0" />
      <path d="M22 22h-9.4v-9.4H22V22z" fill="#FFBA08" />
    </svg>
  ),
};

const PREV_PROVIDER_LABEL: Record<string, string> = {
  google: "Google", github: "GitHub", discord: "Discord",
  microsoft: "Microsoft", apple: "Apple", facebook: "Facebook",
};

function LoginPreview({ app, primaryColor, backgroundColor, logoUrl, displayName, enabledProviders, hideBranding = false, isDevMode = false }: {
  app: Application;
  primaryColor: string;
  backgroundColor: string;
  logoUrl: string | null;
  displayName: string;
  enabledProviders: string[];
  hideBranding?: boolean;
  isDevMode?: boolean;
}) {
  const [activeTab, setActiveTab] = useState("email");
  const bg = backgroundColor || "#0a0a0a";
  const primary = primaryColor || "#3b82f6";
  const surf = "#111111";
  const surfRaised = "#1a1a1a";
  const border = "rgba(255,255,255,0.08)";
  const borderStrong = "rgba(255,255,255,0.14)";
  const textP = "#f5f5f5";
  const textS = "#a0a0a0";
  const textT = "#606060";
  const mono = "'JetBrains Mono', 'Fira Code', monospace";
  const name = displayName || app.name;
  const providers = enabledProviders.length > 0
    ? enabledProviders
    : ["google", "github", "discord", "microsoft"];

  return (
    <div style={{ flex: "0 0 300px", position: "sticky", top: 20, alignSelf: "flex-start" }}>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Live preview</p>
      {/* Outer bg shell — matches SDK's data-ra-root background */}
      <div style={{ background: bg, borderRadius: 14, padding: "28px 18px", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 24px 64px rgba(0,0,0,0.7)" }}>
        {/* Card shell — matches [data-ra-element="card"] */}
        <div style={{ background: surf, border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden", maxWidth: 380, margin: "0 auto", boxShadow: "0 24px 48px rgba(0,0,0,0.45)" }}>

          {/* CardHeader */}
          <div style={{ padding: "22px 22px 0" }}>
            {logoUrl ? (
              <img src={logoUrl} alt="" style={{ width: 32, height: 32, objectFit: "contain", marginBottom: 12, borderRadius: 6 }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 6, background: `color-mix(in srgb, ${primary} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${primary} 25%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <Globe size={15} color={primary} />
              </div>
            )}
            <p style={{ fontFamily: mono, fontWeight: 700, fontSize: "0.95rem", color: textP, margin: "0 0 5px", letterSpacing: "-0.025em" }}>Sign in</p>
            <p style={{ fontFamily: mono, fontSize: "0.72rem", color: textS, margin: "0 0 18px", lineHeight: 1.6 }}>
              Welcome back. Choose your sign-in method.
            </p>
          </div>

          {/* CardBody */}
          <div style={{ padding: "0 22px 18px" }}>
            {/* Social buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
              {providers.slice(0, 4).map(pid => (
                <div key={pid} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", background: surfRaised, border: `1px solid ${border}`, borderRadius: 5, cursor: "default" }}>
                  {PREV_ICONS[pid] ?? <div style={{ width: 16, height: 16, borderRadius: 3, background: primary, opacity: 0.6 }} />}
                  <span style={{ fontFamily: mono, fontSize: "0.76rem", fontWeight: 500, color: textP }}>
                    Continue with {PREV_PROVIDER_LABEL[pid] ?? pid}
                  </span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: border }} />
              <span style={{ fontFamily: mono, fontSize: "0.65rem", color: textT }}>or</span>
              <div style={{ flex: 1, height: 1, background: border }} />
            </div>

            {/* Method tabs */}
            <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${border}`, marginBottom: 16 }}>
              {[{ id: "email", label: "Password" }, { id: "magic", label: "Magic Link" }, { id: "passkey", label: "Passkey" }].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  flex: 1, background: "transparent", border: "none",
                  borderBottom: `2px solid ${activeTab === t.id ? primary : "transparent"}`,
                  padding: "7px 8px", cursor: "pointer",
                  fontFamily: mono, fontSize: "0.72rem", fontWeight: 500,
                  color: activeTab === t.id ? primary : textT,
                  transition: "color 0.15s, border-color 0.15s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Email+password form */}
            {activeTab === "email" && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 500, color: textS, marginBottom: 5, letterSpacing: "-0.01em" }}>Email address</p>
                  <div style={{ background: surfRaised, border: `1px solid ${border}`, borderRadius: 5, padding: "8px 11px", fontFamily: mono, fontSize: "0.8rem", color: textT }}>you@example.com</div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 500, color: textS, marginBottom: 5, letterSpacing: "-0.01em" }}>Password</p>
                  <div style={{ background: surfRaised, border: `1px solid ${border}`, borderRadius: 5, padding: "8px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: mono, fontSize: "0.82rem", color: textT }}>••••••••••••</span>
                    <Lock size={11} color={textT} />
                  </div>
                </div>
                <div style={{ background: primary, color: "#fff", borderRadius: 5, padding: "9px 14px", fontFamily: mono, fontSize: "0.82rem", fontWeight: 600, textAlign: "center", cursor: "default", letterSpacing: "-0.01em" }}>
                  Continue
                </div>
              </>
            )}

            {activeTab === "magic" && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 500, color: textS, marginBottom: 5 }}>Email address</p>
                  <div style={{ background: surfRaised, border: `1px solid ${border}`, borderRadius: 5, padding: "8px 11px", fontFamily: mono, fontSize: "0.8rem", color: textT }}>you@example.com</div>
                </div>
                <div style={{ background: primary, color: "#fff", borderRadius: 5, padding: "9px 14px", fontFamily: mono, fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "default" }}>
                  <Mail size={14} /> Send sign-in link
                </div>
              </>
            )}

            {activeTab === "passkey" && (
              <div style={{ background: surfRaised, border: `1px solid ${border}`, borderRadius: 5, padding: "9px 14px", fontFamily: mono, fontSize: "0.82rem", fontWeight: 600, color: textP, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "default" }}>
                <span style={{ fontSize: "1rem" }}>🪪</span> Sign in with passkey
              </div>
            )}
          </div>

          {/* CardFooter */}
          <div style={{ padding: "10px 22px 16px", textAlign: "center", borderTop: `1px solid ${borderStrong}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div>
              <span style={{ fontFamily: mono, fontSize: "0.74rem", color: textT }}>Don't have an account? </span>
              <span style={{ fontFamily: mono, fontSize: "0.74rem", color: primary, cursor: "default" }}>Sign up</span>
            </div>
            {/* Branding badge */}
            {!hideBranding && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" fill={primary} opacity="0.9" />
                  <path d="M8 16V8h5a3 3 0 0 1 0 6H8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontFamily: mono, fontSize: "0.64rem", color: textT }}>Secured by ralph-auth</span>
              </div>
            )}
            {/* Dev instance badge */}
            {isDevMode && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, paddingTop: 6, borderTop: `1px dashed rgba(255,255,255,0.1)`, width: "100%", justifyContent: "center" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                <span style={{ fontFamily: mono, fontSize: "0.6rem", color: "#f59e0b", letterSpacing: "0.05em", fontWeight: 600 }}>DEVELOPMENT INSTANCE</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



// Providers that our platform has actually configured OAuth credentials for.
// Apple and Facebook are shown in the list but default to OFF since we haven't
// set up their credentials yet. This prevents them appearing enabled on every
// fresh app load even though they'd fail at runtime.
const PLATFORM_CONFIGURED_PROVIDERS = new Set(["google", "github", "discord", "microsoft"]);

const PROVIDER_META: { id: string; label: string; description: string; platformReady: boolean }[] = [
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
      setOk("Provider settings saved. Changes appear in the SDK within 5 minutes (KV cache TTL).");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  if (isLoading) return <div className="loading empty-state" style={{ fontSize: "0.78rem" }}>Loading providers…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <p className="panel-title" style={{ margin: 0 }}><SlidersHorizontal size={14} />OAuth Providers</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", marginTop: 4 }}>
            Controls which sign-in buttons appear in the SDK. If none are enabled, all are shown (fallback).
            Changes take effect within 5 minutes (KV cache).
          </p>
        </div>

        {PROVIDER_META.map(p => {
          const enabled = local[p.id] ?? PLATFORM_CONFIGURED_PROVIDERS.has(p.id);
          const isReady = p.platformReady;
          return (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              padding: "12px 14px",
              background: enabled ? "var(--color-surface-raised)" : "transparent",
              border: `1px solid ${enabled ? "var(--color-border-strong)" : "var(--color-border)"}`,
              borderRadius: 8, transition: "background 0.15s, border-color 0.15s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {PREV_ICONS[p.id] ? (
                  <div style={{ width: 18, height: 18, opacity: enabled ? 1 : 0.35, transition: "opacity 0.15s", flexShrink: 0 }}>{PREV_ICONS[p.id]}</div>
                ) : (
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: "var(--color-border)", opacity: enabled ? 1 : 0.35 }} />
                )}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <p style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.82rem", color: enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>{p.label}</p>
                    {!isReady && <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--color-amber)", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 3, padding: "1px 5px" }}>Not configured</span>}
                  </div>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>{p.description}</p>
                </div>
              </div>
              {/* Toggle switch */}
              <button
                type="button"
                onClick={() => toggle(p.id)}
                style={{
                  position: "relative", width: 38, height: 22, flexShrink: 0,
                  background: enabled ? "var(--color-accent)" : "var(--color-border-strong)",
                  borderRadius: 11, border: "none", cursor: "pointer",
                  transition: "background 0.2s",
                }}
                aria-checked={enabled}
                role="switch"
              >
                <span style={{
                  position: "absolute", top: 3, left: enabled ? 19 : 3,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#fff", transition: "left 0.2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }} />
              </button>
            </div>
          );
        })}
      </div>

      {ok && <OkBanner msg={ok} />}
      {err && <ErrBanner msg={err} />}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" style={{ fontSize: "0.78rem" }} onClick={() => void save()} disabled={setProviders.isPending}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* General */}
      <form onSubmit={save} className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="panel-title"><Settings size={14} />General</p>
        <div className="form-group">
          <label className="form-label">App name</label>
          <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="form-group">
          <label className="form-label">Allowed origins <span style={{ color: "var(--color-text-tertiary)" }}>(one per line)</span></label>
          <textarea className="input" style={{ minHeight: 80, fontFamily: "var(--font-mono)", fontSize: "0.78rem", resize: "vertical" }} value={form.allowed_origins} onChange={e => setForm(f => ({ ...f, allowed_origins: e.target.value }))} placeholder="https://yourapp.com" />
        </div>
        <div className="form-group">
          <label className="form-label">Redirect URIs <span style={{ color: "var(--color-text-tertiary)" }}>(one per line)</span></label>
          <textarea className="input" style={{ minHeight: 70, fontFamily: "var(--font-mono)", fontSize: "0.78rem", resize: "vertical" }} value={form.redirect_uris} onChange={e => setForm(f => ({ ...f, redirect_uris: e.target.value }))} placeholder="https://yourapp.com/auth/callback" />
        </div>
        {ok && <OkBanner msg={ok} />}
        {err && <ErrBanner msg={err} />}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>

      {/* Secret key */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="panel-title"><Key size={14} />Secret Key</p>
        {rawSecret ? (
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-amber)", marginBottom: 8 }}>⚠ Copy this secret now — it will not be shown again.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 12px" }}>
              <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-accent)", wordBreak: "break-all" }}>
                {showSecret ? rawSecret : rawSecret.slice(0, 10) + "•".repeat(24)}
              </code>
              <button className="btn btn-ghost" style={{ padding: "3px 6px" }} onClick={() => setShowSecret(s => !s)}>{showSecret ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              <CopyBtn value={rawSecret} />
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-tertiary)", marginBottom: 10 }}>Rotating the secret key will immediately invalidate the current key. Any SDK consumers using the old secret will be locked out.</p>
            <button className="btn btn-ghost" style={{ fontSize: "0.76rem", color: "var(--color-amber)" }} onClick={handleRotate} disabled={rotateSecret.isPending}>
              <RefreshCw size={13} /> {rotateSecret.isPending ? "Rotating…" : "Rotate secret key"}
            </button>
          </div>
        )}
      </div>

      {/* Suspend */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, border: "1px solid rgba(251,191,36,0.15)" }}>
        <p className="panel-title" style={{ color: "var(--color-amber)" }}><AlertTriangle size={14} />Suspend Application</p>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-tertiary)" }}>
          {app.suspended_at ? "This application is currently suspended. SDK sign-ins will be blocked." : "Suspending will block all SDK sign-ins and show an error to end users. The app data is preserved."}
        </p>
        {app.suspended_at ? (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: "0.76rem" }} onClick={() => unsuspend.mutate({ id: app.id })} disabled={unsuspend.isPending}>
            <ShieldOff size={13} /> {unsuspend.isPending ? "Unsuspending…" : "Unsuspend application"}
          </button>
        ) : (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: "0.76rem", color: "var(--color-amber)" }} onClick={() => suspend.mutate({ id: app.id })} disabled={suspend.isPending}>
            <ShieldAlert size={13} /> {suspend.isPending ? "Suspending…" : "Suspend application"}
          </button>
        )}
      </div>

      {/* Delete */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, border: "1px solid rgba(248,113,113,0.2)" }}>
        <p className="panel-title" style={{ color: "var(--color-red)" }}><Trash2 size={14} />Delete Application</p>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.73rem", color: "var(--color-text-tertiary)" }}>
          Permanently deletes the application and all associated users, sessions, and branding data. This action is irreversible.
        </p>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: "0.76rem", color: "var(--color-red)" }} onClick={() => setDeleteModal(true)}>
          <Trash2 size={13} /> Delete application
        </button>
      </div>

      {/* Delete Modal */}
      {deleteModal && (
        <Modal onClose={() => setDeleteModal(false)} maxWidth={460}>
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--color-red-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Trash2 size={15} color="var(--color-red)" />
              </div>
              <p className="panel-title" style={{ color: "var(--color-red)" }}>Delete application</p>
            </div>
            <button className="btn btn-ghost" style={{ padding: 5, marginLeft: "auto" }} onClick={() => setDeleteModal(false)}><X size={13} /></button>
          </div>
          <div className="modal-body">
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-text-secondary)", marginBottom: 14 }}>
              Are you sure you want to delete <strong style={{ color: "var(--color-text-primary)" }}>{app.name}</strong>? This will delete all associated users, sessions, branding, and data. This action is irreversible.
            </p>
            <div className="form-group">
              <label className="form-label">Type <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>"{app.name}"</span> to confirm</label>
              <input className="input" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} autoFocus placeholder={app.name} />
            </div>
            {err && <ErrBanner msg={err} />}
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDeleteModal(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center", background: "var(--color-red)", borderColor: "var(--color-red)" }}
              disabled={deleteConfirm !== app.name || del.isPending} onClick={handleDelete}>
              <Trash2 size={13} /> {del.isPending ? "Deleting…" : "Delete permanently"}
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
    <div style={{ padding: 32 }}>
      <div className="loading empty-state" style={{ fontSize: "0.82rem" }}>Loading application…</div>
    </div>
  );

  if (error || !app) return (
    <div style={{ padding: 32 }}>
      <ErrBanner msg={error?.message ?? "Application not found"} />
    </div>
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Link to="/applications" style={{ color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", marginTop: 2 }}>
          <ArrowLeft size={16} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {app.logo_url ? (
              <img src={app.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Globe size={16} color="var(--color-accent)" />
              </div>
            )}
            <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "1.2rem", color: "var(--color-text-primary)", margin: 0 }}>
              {app.display_name ?? app.name}
            </h1>
            <PlanBadge plan={app.plan} />
            {app.suspended_at && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", background: "var(--color-red-dim)", color: "var(--color-red)", borderRadius: 3, padding: "2px 7px", border: "1px solid rgba(248,113,113,0.2)" }}>
                SUSPENDED
              </span>
            )}
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)", marginTop: 4 }}>
            {app.publishable_key} · {app.environment}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t.id} className="btn btn-ghost" onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px", fontSize: "0.78rem", borderRadius: "6px 6px 0 0",
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
              borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            }}>
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab app={app} />}
      {tab === "users" && <UsersTab app={app} />}
      {tab === "appearance" && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <AppearanceTab app={app} isPlatformAdmin={isPlatformAdmin} onFormChange={setLiveAppearance} />
          </div>
          <LoginPreview
            app={app}
            primaryColor={liveAppearance?.primary_color ?? app.primary_color ?? "#3b82f6"}
            backgroundColor={liveAppearance?.background_color ?? app.background_color ?? "#0a0a0a"}
            logoUrl={app.logo_url}
            displayName={liveAppearance?.display_name || app.display_name || app.name}
            enabledProviders={liveProviders ?? []}
            hideBranding={liveAppearance?.hide_branding ?? app.hide_branding ?? false}
            isDevMode={app.environment === "development"}
          />
        </div>
      )}
      {tab === "providers" && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProvidersTab app={app} onProvidersChange={setLiveProviders} />
          </div>
          <LoginPreview
            app={app}
            primaryColor={liveAppearance?.primary_color ?? app.primary_color ?? "#3b82f6"}
            backgroundColor={liveAppearance?.background_color ?? app.background_color ?? "#0a0a0a"}
            logoUrl={app.logo_url}
            displayName={liveAppearance?.display_name || app.display_name || app.name}
            enabledProviders={liveProviders ?? []}
            hideBranding={liveAppearance?.hide_branding ?? app.hide_branding ?? false}
            isDevMode={app.environment === "development"}
          />
        </div>
      )}
      {tab === "email" && <EmailTab app={app} />}
      {tab === "billing" && <BillingTab app={app} />}
      {tab === "settings" && <SettingsTab app={app} />}
    </div>
  );
}

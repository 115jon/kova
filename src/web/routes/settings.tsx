import { AvatarUpload } from "@/components/AvatarUpload";
import { ProviderIcon } from "@/components/BrandIcons";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { AUTH_URL, authClient, listAccounts, passkey, signOut, twoFactor, updateUser, useSession } from "@/lib/auth-client";
import { validatePassword } from "@/lib/password";
import { sentenceCase } from "@/lib/utils";
import { setThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import type { ProviderId } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, Check, CheckCircle, Clock, Palette,
  Copy,
  Eye, EyeOff, Fingerprint, KeyRound, Lock, LogOut, PlusCircle,
  Server, Settings, Shield, Sliders, Smartphone, Trash2, User, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

// ── Linked accounts hook ──────────────────────────────────────────────────────

type LinkedAccount = { id: string; providerId: string; accountId: string; };

function useLinkedAccounts() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReady(false);
    listAccounts()
      .then((res) => { setAccounts((res.data as LinkedAccount[]) ?? []); })
      .catch(() => setAccounts([]))
      .finally(() => setReady(true));
  }, [tick]);

  const refetch = () => setTick(t => t + 1);

  const hasCredential = accounts.some(a => a.providerId === "credential");
  const oauthProviders = accounts.filter(a => a.providerId !== "credential");

  return { accounts, hasCredential, oauthProviders, ready, refetch };
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <section className="card card-flush">
      <div className="panel-header">
        <h2 className="panel-title">{icon}{title}</h2>
      </div>
      {children}
    </section>
  );
}


function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className={mono ? "kv-value text-mono" : "kv-value"}>{value}</span>
    </div>
  );
}

// ── 2FA Setup Card ────────────────────────────────────────────────────────────

type TwoFaStep = "idle" | "password" | "qr" | "verify" | "backupCodes" | "done";

function TwoFactorSection({ hasCredential }: { hasCredential: boolean }) {
  const { data: session, refetch } = useSession();
  const enabled = !!(session?.user as any)?.twoFactorEnabled;

  const [step, setStep] = useState<TwoFaStep>("idle");
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep("idle"); setPassword(""); setTotpUri(""); setSecret("");
    setBackupCodes([]); setVerifyCode(""); setError(""); setShowSecret(false);
  };

  const handleEnable = async (pwd?: string) => {
    const typed = pwd?.trim() ?? "";
    if (hasCredential && !typed) {
      setError("Password is required");
      return;
    }
    setError(""); setLoading(true);
    try {
      const res = await twoFactor.enable(typed ? { password: typed } : {});
      if (res.error) {
        throw new Error(
          res.error.message || res.error.code || res.error.statusText || "Could not start 2FA",
        );
      }
      const uri: string = res.data?.totpURI ?? "";
      setTotpUri(uri);
      const match = uri.match(/secret=([A-Z2-7]+)/i);
      setSecret(match?.[1] ?? "");
      setBackupCodes(res.data?.backupCodes ?? []);
      setStep("qr");
    } catch (e: any) {
      setError(e?.message ?? "Failed to enable 2FA");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (verifyCode.length < 6) return;
    setError(""); setLoading(true);
    try {
      const res = await twoFactor.verifyTotp({ code: verifyCode });
      if (res.error) throw new Error(res.error.message);
      setStep("backupCodes");
      refetch?.();
    } catch (e: any) {
      setError(e?.message ?? "Invalid code — try again");
      setVerifyCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (pwd?: string) => {
    setError(""); setLoading(true);
    try {
      const body = hasCredential && pwd ? { password: pwd } : {};
      const res = await twoFactor.disable(body);
      if (res.error) throw new Error(res.error.message);
      reset();
      refetch?.();
    } catch (e: any) {
      setError(e?.message ?? "Failed to disable 2FA");
    } finally {
      setLoading(false);
    }
  };

  const copyBackupCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel-body stack">
      <div className="row-between">
        <div className="row" style={{ gap: 12 }}>
          <span className={enabled ? "icon-tile tone-success" : "icon-tile"} aria-hidden="true">
            {enabled ? <CheckCircle /> : <Smartphone />}
          </span>
          <div className="min-w-0">
            <p className="text-strong">Authenticator app</p>
            <p className="text-sm text-secondary">
              {enabled ? "2FA is active — sign-ins require a TOTP code" : "Protect your account with Google Authenticator or Authy"}
            </p>
          </div>
        </div>
        {enabled
          ? <span className="badge badge-success"><CheckCircle aria-hidden="true" /> Enabled</span>
          : <span className="badge badge-neutral">Disabled</span>
        }
      </div>

      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}

      {/* ── Idle state ── */}

      {step === "idle" && !enabled && (
        <button
          className="btn btn-primary"
          disabled={loading}
          onClick={() => {
            if (hasCredential) setStep("password");
            else void handleEnable();
          }}
          style={{ alignSelf: "flex-start" }}
          type="button"
        >
          <Smartphone /> Set up authenticator app
        </button>
      )}

      {step === "idle" && enabled && (
        <button
          className="btn btn-danger"
          onClick={() => {
            if (hasCredential) setStep("password");
            else void handleDisable();
          }}
          style={{ alignSelf: "flex-start" }}
          type="button"
        >
          <X /> Disable 2FA
        </button>
      )}

      {step === "password" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const typed = String(new FormData(e.currentTarget).get("password") ?? "");
            const pwd = typed || password;
            if (enabled) void handleDisable(pwd);
            else void handleEnable(pwd);
          }}
        >
          <p className="text-secondary">
            {enabled ? "Enter your password to disable 2FA:" : "Enter your password to start setup:"}
          </p>
          <input
            autoFocus
            autoComplete="current-password"
            aria-label="Current password"
            className="input"
            name="password"
            type="password"
            placeholder="Your current password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <div className="row">
            <button
              className={enabled ? "btn btn-danger" : "btn btn-primary"}
              disabled={loading}
              type="submit"
            >
              {loading ? "Please wait…" : enabled ? "Confirm & disable" : "Continue"}
            </button>
            <button className="btn btn-secondary" onClick={reset} type="button">Cancel</button>
          </div>
        </form>
      )}

      {step === "qr" && (
        <div className="stack">
          <p className="text-secondary">
            Scan this QR code with <strong className="text-strong">Google Authenticator</strong>,{" "}
            <strong className="text-strong">Authy</strong>, or any TOTP app.
          </p>
          {/* Literal black on white: the code must stay scannable in both themes. */}
          {totpUri && (
            <QRCodeSVG
              value={totpUri}
              size={196}
              level="M"
              fgColor="#000000"
              bgColor="#ffffff"
              marginSize={4}
              aria-label="Authenticator setup QR code"
              style={{ alignSelf: "flex-start", borderRadius: "var(--radius-md)" }}
            />
          )}

          {/* Manual entry */}
          <div className="form-group">
            <p className="form-label">Can't scan? Enter the key manually</p>
            <div className="row">
              <code className="min-w-0" style={{ flex: 1, padding: "8px 12px" }}>
                {showSecret ? secret : "•".repeat(secret.length)}
              </code>
              <button
                aria-label={showSecret ? "Hide key" : "Show key"}
                className="btn btn-secondary btn-icon"
                onClick={() => setShowSecret(s => !s)}
                type="button"
              >
                {showSecret ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary" onClick={() => setStep("verify")} type="button">
            I've scanned it → Continue
          </button>
          <button className="btn btn-secondary" onClick={reset} type="button">Cancel</button>
        </div>
      )}

      {step === "verify" && (
        <div className="stack">
          <p className="text-secondary">
            Enter the 6-digit code from your authenticator app to confirm setup:
          </p>
          <input
            autoFocus
            aria-label="6-digit code"
            className="input input-mono"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={verifyCode}
            onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={e => e.key === "Enter" && handleVerify()}
            style={{ textAlign: "center", letterSpacing: "0.3em" }}
          />
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={loading || verifyCode.length < 6}
              onClick={handleVerify}
              style={{ flex: 1 }}
              type="button"
            >
              {loading ? "Verifying…" : <><Check /> Confirm &amp; activate</>}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep("qr")} type="button">Back</button>
          </div>
        </div>
      )}

      {step === "backupCodes" && (
        <div className="stack">
          <p className="alert alert-warning" role="status">
            <AlertCircle />
            Save these backup codes somewhere safe. Each can only be used once if you lose access to your authenticator.
          </p>
          <div
            className="code-block"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            {backupCodes.map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-secondary" onClick={copyBackupCodes} style={{ flex: 1 }} type="button">
              {copied ? <><Check /> Copied</> : <><Copy /> Copy all</>}
            </button>
            <button className="btn btn-primary" onClick={reset} style={{ flex: 1 }} type="button">
              <CheckCircle /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Passkeys Section ─────────────────────────────────────────────────────────

type PasskeyEntry = { id: string; name?: string | null; createdAt?: number | null; deviceType?: string };

function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    passkey
      .listUserPasskeys()
      .then((res: Awaited<ReturnType<typeof passkey.listUserPasskeys>>) => setPasskeys((res.data as PasskeyEntry[]) ?? []))
      .catch(() => setPasskeys([]));
  }, [tick]);

  const handleAdd = async () => {
    setError(""); setSuccess(""); setAdding(true);
    try {
      const res = await passkey.addPasskey({ name: "My passkey" });
      if ((res as any)?.error) throw new Error((res as any).error?.message ?? "Registration failed");
      setSuccess("Passkey registered successfully!");
      setTick(t => t + 1);
    } catch (e: any) {
      if (e?.name !== "NotAllowedError") {
        setError(e?.message ?? "Registration failed. Please try again.");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(""); setSuccess("");
    try {
      const res = await passkey.deletePasskey({ id });
      if ((res as any)?.error) throw new Error((res as any).error?.message ?? "Delete failed");
      setSuccess("Passkey removed.");
      setTick(t => t + 1);
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove passkey.");
    }
  };

  return (
    <div className="panel-body stack">
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div className="min-w-0">
          <p className="text-strong">Registered passkeys</p>
          <p className="text-sm text-secondary">Sign in with Touch ID, Face ID, or a hardware security key.</p>
        </div>
        <button
          id="add-passkey-btn"
          className="btn btn-primary btn-sm"
          disabled={adding}
          onClick={handleAdd}
          type="button"
        >
          <Fingerprint /> {adding ? "Waiting…" : "Add passkey"}
        </button>
      </div>

      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}
      {success && <p className="alert alert-success" role="status"><CheckCircle /> {success}</p>}

      {passkeys.length === 0 ? (
        <div className="empty-state" style={{ padding: "var(--space-6)" }}>
          <span className="empty-state-icon" aria-hidden="true"><Fingerprint /></span>
          <p className="empty-state-title">No passkeys registered yet</p>
          <p className="empty-state-body">Add one to sign in without a password.</p>
        </div>
      ) : (
        <div className="card card-flush" style={{ boxShadow: "none" }}>
          {passkeys.map(pk => (
            <div key={pk.id} className="list-row">
              <span className="icon-tile icon-tile-sm" aria-hidden="true"><Fingerprint /></span>
              <div className="list-row-main">
                <p className="list-row-title">{pk.name ?? "Passkey"}</p>
                {pk.createdAt && (
                  <p className="text-sm text-tertiary">
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="list-row-actions">
                <button
                  aria-label="Remove passkey"
                  className="btn btn-subtle btn-icon btn-sm"
                  onClick={() => handleDelete(pk.id)}
                  style={{ color: "var(--color-danger-text)" }}
                  title="Remove passkey"
                  type="button"
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Username Section ──────────────────────────────────────────────────────────

function UsernameSection({ currentUsername }: { currentUsername?: string | null }) {
  const [username, setUsername] = useState(currentUsername ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { refetch } = useSession();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.length < 3) { setError("Username must be at least 3 characters."); return; }
    if (username.length > 32) { setError("Username must be at most 32 characters."); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { setError("Only letters, digits, _ and - allowed."); return; }
    setError(""); setLoading(true);
    try {
      const res = await authClient.updateUser({ username } as any);
      if ((res as any)?.error) throw new Error((res as any).error?.message ?? "Failed to update username");
      setSuccess(true);
      refetch?.();
      setTimeout(() => setSuccess(false), 4000);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update username.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-body stack">
      {success && <p className="alert alert-success" role="status"><CheckCircle /> Username updated</p>}
      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}
      <form onSubmit={handleSave} className="row" style={{ alignItems: "flex-end" }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="username-input">Username <span className="text-tertiary">(3–32 chars)</span></label>
          <input
            id="username-input"
            className="input"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="your-username"
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_-]+"
            autoComplete="username"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          <Check /> {loading ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}

// ── Password / Set password ───────────────────────────────────────────────────

/**
 * CredentialsSection — adapts based on whether the current user has a
 * password account ("credential" provider) or is OAuth-only.
 *
 * hasCredential = false (OAuth-only):
 *   → No currentPassword field.
 *   → Calls admin.setUserPassword({ userId, newPassword }) — the admin
 *     plugin sets passwords without requiring the existing one.
 *     All dashboard users are admins, so this is always authorized.
 *
 * hasCredential = true (email+password account exists):
 *   → Standard Change Password form calling changePassword().
 */
function CredentialsSection({ hasCredential, userId, onPasswordSet }: {
  hasCredential: boolean;
  userId: string;
  onPasswordSet?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError("Passwords don't match"); return; }
    // Client-side validation — same rules enforced server-side in set-initial-password
    const { valid, errors: pwErrors } = validatePassword(next);
    if (!valid) { setError(pwErrors[0] ?? "Password does not meet requirements"); return; }
    setError(""); setLoading(true);
    try {
      let res: any;
      if (hasCredential) {
        // Existing credential account — changePassword requires currentPassword (Zod-enforced)
        res = await authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        });
        if (res.error) throw new Error(res.error.message);
      } else {
        // OAuth-only: POST to our custom endpoint which creates a real
        // credential account row in D1 using Better Auth's hashPassword().
        // admin.setUserPassword() returns 200 but doesn't create the row.
        const r = await fetch("/api/user/set-initial-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ newPassword: next }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: "Failed to set password" })) as { error?: string };
          throw new Error(err.error ?? "Failed to set password");
        }
      }
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => setSuccess(false), 5000);
      // Re-query linked accounts so hasCredential flips → 2FA unlocks
      onPasswordSet?.();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-body stack">
      {!hasCredential && (
        <p className="alert alert-info" role="status">
          <PlusCircle />
          You signed in with an OAuth provider. Set a password to also be
          able to sign in with email + password and to enable 2FA.
        </p>
      )}

      {success && (
        <p className="alert alert-success" role="status">
          <CheckCircle />
          {hasCredential ? "Password changed. All other sessions revoked." : "Password set. You can now sign in with email + password."}
        </p>
      )}
      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}

      <form onSubmit={handleSubmit} className="stack">
        {hasCredential && (
          <div className="form-group">
            <label className="form-label" htmlFor="current-password-input">Current password</label>
            <input className="input" id="current-password-input" type="password" value={current} onChange={e => setCurrent(e.target.value)}
              required autoComplete="current-password" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="new-password-input">{hasCredential ? "New password" : "Password"}</label>
          <input className="input" id="new-password-input" type="password" value={next} onChange={e => setNext(e.target.value)}
            required autoComplete="new-password" minLength={12} />
          {!hasCredential && (
            <p className="form-hint">12+ chars, upper, lower, number, and a special character.</p>
          )}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="confirm-password-input">Confirm password</label>
          <input className="input" id="confirm-password-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            required autoComplete="new-password" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading} style={{ alignSelf: "flex-start" }}>
          <Lock /> {loading ? "Saving…" : hasCredential ? "Change password" : "Set password"}
        </button>
      </form>
    </div>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function AppearanceSection() {
  const { preference } = useTheme();
  return (
    <div className="panel-body stack-sm">
      <p className="form-label" id="theme-label">Theme</p>
      <div className="segmented" role="group" aria-labelledby="theme-label" style={{ maxWidth: 360 }}>
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="segmented-option"
            aria-pressed={preference === value}
            onClick={() => setThemePreference(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="form-hint">System follows your device. Hosted sign-in pages use each app's own theme.</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const { hasCredential, oauthProviders, ready, refetch } = useLinkedAccounts();

  const handlePasswordSet = () => refetch();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  const currentUsername = (session?.user as any)?.username as string | null | undefined;
  // localImage: optimistic preview while updateUser propagates through Better Auth
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  const hasCustomAvatar = (): boolean => {
    const img = localImage ?? (session?.user as any)?.image as string | null;
    // CDN URLs are absolute; OAuth pictures from Google/Discord are also absolute
    // but NOT routed through our CDN domain.
    return !!img && img.includes("cdn.115jon.site") || !!img && img.includes("localhost:5173");
  };

  const handleRemoveAvatar = async () => {
    setRemovingAvatar(true);
    try {
      await fetch("/api/user/avatar", { method: "DELETE", credentials: "include" });
      // Tell Better Auth to null out the image; it will fall back to the OAuth
      // picture on the next OAuth sign-in, or show initials until then.
      await updateUser({ image: null } as any);
      setLocalImage(null);
    } catch { /* silent */ } finally {
      setRemovingAvatar(false);
    }
  };

  return (
    <div>
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Account security and platform configuration</p>
        </div>
      </header>

      <div className="stack-lg">

        {/* Profile */}
        {session && (
          <SectionCard icon={<Shield />} title="Profile">
            <div className="list-row">
              <AvatarUpload
                src={localImage ?? ((session.user as any).image as string | null)}
                name={session.user.name}
                size={48}
                uploadUrl="/api/user/avatar"
                onSuccess={async (url) => {
                  setLocalImage(url);
                  // Propagate through Better Auth — invalidates KV session cache
                  // so useSession() everywhere (sidebar, etc.) sees the new image.
                  await updateUser({ image: url } as any);
                }}
              />
              <div className="list-row-main">
                <p className="list-row-title">{session.user.name}</p>
                <p className="text-sm text-secondary truncate">{session.user.email}</p>
                <div className="row" style={{ marginTop: 4, flexWrap: "wrap" }}>
                  <p className="text-sm text-tertiary">Click the avatar to change your photo</p>
                  {hasCustomAvatar() && (
                    <button
                      className="btn btn-subtle btn-sm"
                      disabled={removingAvatar}
                      onClick={handleRemoveAvatar}
                      style={{ color: "var(--color-danger-text)" }}
                      type="button"
                    >
                      {removingAvatar ? "Removing…" : "Remove photo"}
                    </button>
                  )}
                </div>
              </div>
              <span className="badge badge-info">
                {sentenceCase((session.user as any).role ?? "user")}
              </span>
            </div>
            <InfoRow label="User ID" value={session.user.id} mono />
            <InfoRow label="Email verified" value={(session.user as any).emailVerified ? "Yes" : "No"} />
            {currentUsername && <InfoRow label="Username" value={currentUsername} mono />}
            {/* Linked OAuth providers */}
            {ready && oauthProviders.length > 0 && (
              <div className="kv-row">
                <span className="kv-label">Linked providers</span>
                <div className="row" style={{ gap: 6 }}>
                  {oauthProviders.map(a => (
                    <span key={a.providerId} className="icon-tile icon-tile-sm tone-neutral" title={a.providerId}>
                      <ProviderIcon id={a.providerId as ProviderId} size={14} />
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="panel-footer" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-secondary btn-sm" onClick={handleSignOut} type="button">
                <LogOut /> Sign out
              </button>
            </div>
          </SectionCard>
        )}

        <SectionCard icon={<Palette />} title="Appearance">
          <AppearanceSection />
        </SectionCard>

        {/* Username */}
        <SectionCard icon={<User />} title="Username">
          <UsernameSection currentUsername={currentUsername} />
        </SectionCard>

        {/* Custom Fields */}
        <SectionCard icon={<Sliders />} title="Custom fields">
          <CustomFieldsSection />
        </SectionCard>

        {/* Passkeys */}
        <SectionCard icon={<Fingerprint />} title="Passkeys">
          <PasskeysSection />
        </SectionCard>

        {/* Password first — 2FA enable needs a credential account */}
        <SectionCard
          icon={<Lock />}
          title={hasCredential ? "Change password" : "Set a password"}
        >
          <CredentialsSection
            hasCredential={ready ? hasCredential : false}
            userId={session?.user.id ?? ""}
            onPasswordSet={handlePasswordSet}
          />
        </SectionCard>

        <SectionCard icon={<KeyRound />} title="Two-factor authentication">
          <TwoFactorSection hasCredential={ready ? hasCredential : false} />
        </SectionCard>

        {/* Server info */}
        <SectionCard icon={<Server />} title="Server">
          <InfoRow label="Auth server URL" value={AUTH_URL || "(proxied via Vite)"} mono />
          <InfoRow label="Auth base path" value="/api/auth" mono />
          <InfoRow label="Email verification" value="Enabled (Resend)" />
          <InfoRow label="Rate limiting" value="5 req / 60 s on sign-in" />
          <InfoRow label="2FA plugin" value="TOTP + Email OTP" />
          <InfoRow label="Passkey plugin" value="WebAuthn (biometric / hardware key)" />
          <InfoRow label="Magic link plugin" value="Enabled (10 min expiry)" />
          <InfoRow label="Bearer plugin" value="Authorization: Bearer <token>" mono />
        </SectionCard>

        {/* Session */}
        <SectionCard icon={<Clock />} title="Session">
          <InfoRow label="Session expiry" value="7 days" />
          <InfoRow label="Sliding window" value="Disabled (fixed duration)" />
          <InfoRow label="Cookie cache TTL" value="5 minutes (JWE encrypted)" />
          <InfoRow label="Multi-session" value="Up to 5 simultaneous accounts" />
        </SectionCard>

        {/* Cloudflare resources */}
        <SectionCard icon={<Settings />} title="Cloudflare resources">
          <InfoRow label="Database" value="D1 — kova-auth-db" />
          <InfoRow label="Session / rate-limit cache" value="KV — kova-auth-kv" />
          <InfoRow label="File storage" value="R2 — kova-auth-avatars" />
        </SectionCard>

      </div>
    </div>
  );
}

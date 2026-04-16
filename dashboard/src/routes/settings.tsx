import { AvatarUpload } from "@/components/AvatarUpload";
import { ProviderIcon } from "@/components/BrandIcons";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { AUTH_URL, authClient, listAccounts, passkey, signOut, twoFactor, updateUser, useSession } from "@/lib/auth-client";
import { validatePassword } from "@/lib/password";
import type { ProviderId } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, Check, CheckCircle, Clock,
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

function SectionCard({ icon, color, title, children }: {
  icon: React.ReactNode; color: string; title: string; children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="panel-header">
        {/* Icon + title grouped left — prevents space-between from splitting them */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color, display: "flex", alignItems: "center" }}>{icon}</span>
          <h2 className="panel-title">{title}</h2>
        </div>
      </div>
      {children}
    </div>
  );
}


function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid var(--color-border)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: "0.78rem", color: "var(--color-text-primary)" }}>{value}</span>
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
    // Password is required by Better Auth's Zod schema — always a string
    if (!pwd) { setError("Password is required"); return; }
    setError(""); setLoading(true);
    try {
      const res = await twoFactor.enable({ password: pwd });
      if (res.error) throw new Error(res.error.message);
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
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, flexShrink: 0,
            background: enabled ? "rgba(34,197,94,0.1)" : "rgba(99,102,241,0.1)",
            border: `1px solid ${enabled ? "rgba(34,197,94,0.2)" : "rgba(99,102,241,0.2)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {enabled ? <CheckCircle size={16} color="#22c55e" /> : <Smartphone size={16} color="#818cf8" />}
          </div>
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>
              Authenticator app
            </p>
            <p style={{ fontSize: "0.77rem", color: "#64748b" }}>
              {enabled ? "2FA is active — sign-ins require a TOTP code" : "Protect your account with Google Authenticator or Authy"}
            </p>
          </div>
        </div>
        {enabled
          ? <span className="badge badge-green"><CheckCircle size={10} /> Enabled</span>
          : <span className="badge badge-gray">Disabled</span>
        }
      </div>

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

      {/* ── Idle state ── */}

      {/* OAuth-only: must set a password first — Better Auth validates it as required string at the API/Zod level */}
      {step === "idle" && !hasCredential && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: "var(--color-amber-dim)", border: "1px solid rgba(251,191,36,0.2)",
          borderRadius: 4, padding: "10px 14px",
          fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)",
        }}>
          <AlertCircle size={14} color="#facc15" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ lineHeight: 1.6 }}>
            To enable two-factor authentication, you need a password on your account first.
            Use the{" "}
            <strong style={{ color: "#e2e8f0" }}>Set a Password</strong>{" "}
            section below, then come back here.
          </p>
        </div>
      )}

      {step === "idle" && hasCredential && !enabled && (
        <button className="btn btn-primary"
          onClick={() => setStep("password")}>
          <Smartphone size={14} /> Set up authenticator app
        </button>
      )}

      {step === "idle" && hasCredential && enabled && (
        <button className="btn btn-danger" onClick={() => setStep("password")}>
          <X size={14} /> Disable 2FA
        </button>
      )}

      {step === "password" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
            {enabled ? "Enter your password to disable 2FA:" : "Enter your password to start setup:"}
          </p>
          <input
            autoFocus
            className="input"
            type="password"
            placeholder="Your current password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (enabled ? handleDisable(password) : handleEnable(password))}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={enabled ? "btn btn-danger" : "btn btn-primary"}
              disabled={loading}
              onClick={() => enabled ? handleDisable(password) : handleEnable(password)}
            >
              {loading ? "Please wait…" : enabled ? "Confirm & disable" : "Continue"}
            </button>
            <button className="btn btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {step === "qr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.6 }}>
            Scan this QR code with <strong style={{ color: "#e2e8f0" }}>Google Authenticator</strong>,{" "}
            <strong style={{ color: "#e2e8f0" }}>Authy</strong>, or any TOTP app.
          </p>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 16,
            display: "inline-flex", alignSelf: "flex-start",
          }}>
            {totpUri && <QRCodeSVG value={totpUri} size={180} level="M" />}
          </div>

          {/* Manual entry */}
          <div>
            <p style={{ fontSize: "0.72rem", color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Can't scan? Enter key manually
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{
                flex: 1, background: "var(--color-surface-700)", borderRadius: 8,
                padding: "8px 12px", fontFamily: "monospace", fontSize: "0.85rem",
                color: showSecret ? "#c4b5fd" : "#475569",
                letterSpacing: showSecret ? "0.12em" : undefined, wordBreak: "break-all",
              }}>
                {showSecret ? secret : "•".repeat(secret.length)}
              </code>
              <button className="btn btn-ghost" style={{ padding: 8 }} onClick={() => setShowSecret(s => !s)}>
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary" onClick={() => setStep("verify")}>
            I've scanned it → Continue
          </button>
          <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={reset}>Cancel</button>
        </div>
      )}

      {step === "verify" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
            Enter the 6-digit code from your authenticator app to confirm setup:
          </p>
          <input
            autoFocus
            className="input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={verifyCode}
            onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={e => e.key === "Enter" && handleVerify()}
            style={{ textAlign: "center", fontSize: "1.6rem", letterSpacing: "0.3em", fontFamily: "monospace" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={loading || verifyCode.length < 6}
              onClick={handleVerify}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {loading ? "Verifying…" : <><Check size={14} /> Confirm & activate</>}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep("qr")}>Back</button>
          </div>
        </div>
      )}

      {step === "backupCodes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)",
            borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#facc15",
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            Save these backup codes somewhere safe. Each can only be used once if you lose access to your authenticator.
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 6, background: "var(--color-surface-raised)", borderRadius: 4,
            padding: 14, border: "1px solid var(--color-border)",
          }}>
            {backupCodes.map((c, i) => (
              <code key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>{c}</code>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={copyBackupCodes} style={{ flex: 1, justifyContent: "center" }}>
              {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy all</>}
            </button>
            <button className="btn btn-primary" onClick={reset} style={{ flex: 1, justifyContent: "center" }}>
              <CheckCircle size={13} /> Done
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
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.86rem", fontWeight: 600, color: "var(--color-text-primary)" }}>Registered passkeys</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-secondary)", marginTop: 2 }}>Sign in with Touch ID, Face ID, or a hardware security key.</p>
        </div>
        <button
          id="add-passkey-btn"
          className="btn btn-primary"
          disabled={adding}
          onClick={handleAdd}
          style={{ fontSize: "0.8rem" }}
        >
          <Fingerprint size={13} /> {adding ? "Waiting…" : "Add passkey"}
        </button>
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "8px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.76rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}
      {success && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
          borderRadius: 4, padding: "8px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-green)", fontSize: "0.76rem",
        }}>
          <CheckCircle size={13} /> {success}
        </div>
      )}

      {passkeys.length === 0 ? (
        <div style={{
          background: "var(--color-surface-raised)", borderRadius: 4, padding: "12px 16px",
          fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-tertiary)",
          textAlign: "center", border: "1px solid var(--color-border)",
        }}>
          No passkeys registered yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {passkeys.map(pk => (
            <div
              key={pk.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--color-surface-raised)", borderRadius: 4,
                padding: "9px 12px", border: "1px solid var(--color-border)",
              }}
            >
              <Fingerprint size={14} color="var(--color-accent)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {pk.name ?? "Passkey"}
                </p>
                {pk.createdAt && (
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 8px", fontSize: "0.76rem", color: "var(--color-red)" }}
                onClick={() => handleDelete(pk.id)}
                title="Remove passkey"
              >
                <Trash2 size={13} />
              </button>
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
    <div style={{ padding: 20 }}>
      {success && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
          borderRadius: 4, padding: "8px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-green)", fontSize: "0.76rem",
        }}>
          <CheckCircle size={13} /> Username updated!
        </div>
      )}
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
      <form onSubmit={handleSave} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="form-label">Username <span style={{ color: "var(--color-text-tertiary)" }}>(3–32 chars)</span></label>
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
          <Check size={13} /> {loading ? "Saving…" : "Save"}
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
    <div style={{ padding: 20 }}>
      {!hasCredential && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16,
          background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.15)",
          borderRadius: 4, padding: "10px 14px",
          fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)",
        }}>
          <PlusCircle size={14} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ lineHeight: 1.6 }}>
            You signed in with an OAuth provider. Set a password to also be
            able to sign in with email + password and to enable 2FA.
          </p>
        </div>
      )}

      {success && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
          borderRadius: 4, padding: "8px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-green)", fontSize: "0.76rem",
        }}>
          <CheckCircle size={13} />
          {hasCredential ? "Password changed. All other sessions revoked." : "Password set! You can now sign in with email + password."}
        </div>
      )}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: "0.8rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {hasCredential && (
          <div>
            <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 5 }}>Current password</label>
            <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)}
              required autoComplete="current-password" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">{hasCredential ? "New password" : "Password"}</label>
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)}
            required autoComplete="new-password" minLength={8} />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm password</label>
          <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            required autoComplete="new-password" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 4 }}>
          <Lock size={13} /> {loading ? "Saving…" : hasCredential ? "Change password" : "Set password"}
        </button>
      </form>
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
    navigate({ to: "/sign-in", search: { redirect: undefined } });
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
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <p className="section-label" style={{ marginBottom: 4 }}>Account</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Account security &amp; platform configuration</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Profile */}
        {session && (
          <SectionCard icon={<Shield size={14} />} color="var(--color-accent)" title="Profile">
            <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--color-border)" }}>
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
              <div>
                <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--color-text-primary)" }}>{session.user.name}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)" }}>{session.user.email}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--color-text-tertiary)" }}>Click avatar to change photo</p>
                  {hasCustomAvatar() && (
                    <button
                      onClick={handleRemoveAvatar}
                      disabled={removingAvatar}
                      style={{
                        all: "unset", cursor: removingAvatar ? "wait" : "pointer",
                        fontSize: "0.7rem", color: "#ef4444",
                        opacity: removingAvatar ? 0.5 : 1,
                        textDecoration: "underline", textDecorationStyle: "dotted",
                      }}
                    >
                      {removingAvatar ? "Removing…" : "Remove photo"}
                    </button>
                  )}
                </div>
              </div>
              <span className="badge badge-blue" style={{ marginLeft: "auto" }}>
                {(session.user as any).role ?? "user"}
              </span>
            </div>
            <InfoRow label="User ID" value={session.user.id} mono />
            <InfoRow label="Email verified" value={(session.user as any).emailVerified ? "Yes" : "No"} />
            {currentUsername && <InfoRow label="Username" value={currentUsername} mono />}
            {/* Linked OAuth providers */}
            {ready && oauthProviders.length > 0 && (
              <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--color-text-secondary)" }}>Linked providers</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {oauthProviders.map(a => (
                    <div key={a.providerId} title={a.providerId} style={{
                      width: 24, height: 24, borderRadius: 4,
                      background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <ProviderIcon id={a.providerId as ProviderId} size={13} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ padding: "12px 20px" }}>
              <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={handleSignOut}>
                <LogOut size={13} /> Sign out
              </button>
            </div>
          </SectionCard>
        )}

        {/* Username */}
        <SectionCard icon={<User size={14} />} color="var(--color-green)" title="Username">
          <UsernameSection currentUsername={currentUsername} />
        </SectionCard>

        {/* Custom Fields */}
        <SectionCard icon={<Sliders size={14} />} color="var(--color-accent)" title="Custom Fields">
          <CustomFieldsSection />
        </SectionCard>

        {/* Passkeys */}
        <SectionCard icon={<Fingerprint size={14} />} color="var(--color-accent)" title="Passkeys">
          <PasskeysSection />
        </SectionCard>

        {/* 2FA */}
        <SectionCard icon={<KeyRound size={14} />} color="var(--color-accent)" title="Two-Factor Authentication">
          <TwoFactorSection hasCredential={ready ? hasCredential : true} />
        </SectionCard>

        {/* Password / Set password */}
        <SectionCard
          icon={<Lock size={14} />}
          color="var(--color-green)"
          title={hasCredential ? "Change Password" : "Set a Password"}
        >
          <CredentialsSection
            hasCredential={ready ? hasCredential : true}
            userId={session?.user.id ?? ""}
            onPasswordSet={handlePasswordSet}
          />
        </SectionCard>

        {/* Server info */}
        <SectionCard icon={<Server size={14} />} color="var(--color-accent)" title="Server">
          <InfoRow label="Auth Server URL" value={AUTH_URL || "(proxied via Vite)"} mono />
          <InfoRow label="Auth Base Path" value="/api/auth" mono />
          <InfoRow label="Email Verification" value="Enabled (Resend)" />
          <InfoRow label="Rate Limiting" value="5 req / 60 s on sign-in" />
          <InfoRow label="2FA Plugin" value="TOTP + Email OTP" />
          <InfoRow label="Passkey Plugin" value="WebAuthn (biometric / hardware key)" />
          <InfoRow label="Magic Link Plugin" value="Enabled (10 min expiry)" />
          <InfoRow label="Bearer Plugin" value="Authorization: Bearer <token>" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

        {/* Session */}
        <SectionCard icon={<Clock size={14} />} color="var(--color-green)" title="Session">
          <InfoRow label="Session Expiry" value="7 days" />
          <InfoRow label="Sliding Window" value="Disabled (fixed duration)" />
          <InfoRow label="Cookie Cache TTL" value="5 minutes (JWE encrypted)" />
          <InfoRow label="Multi-Session" value="Up to 5 simultaneous accounts" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

        {/* Cloudflare resources */}
        <SectionCard icon={<Settings size={14} />} color="var(--color-amber)" title="Cloudflare Resources">
          <InfoRow label="Database" value="D1 — ralph-auth-db" />
          <InfoRow label="Session / Rate-limit Cache" value="KV — ralph-auth-kv" />
          <InfoRow label="File Storage" value="R2 — ralph-auth-avatars" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

      </div>
    </div>
  );
}

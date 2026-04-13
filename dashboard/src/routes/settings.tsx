import { ProviderIcon } from "@/components/BrandIcons";
import { AUTH_URL, authClient, signOut, useSession } from "@/lib/auth-client";
import type { ProviderId } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, Check, CheckCircle, Clock, Copy,
  Eye, EyeOff, KeyRound, Lock, LogOut, PlusCircle,
  Server, Settings, Shield, Smartphone, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

// ── Linked accounts hook ──────────────────────────────────────────────────────

type LinkedAccount = { id: string; provider: string; };

function useLinkedAccounts() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (authClient as any).listAccounts()
      .then((res: any) => {
        setAccounts(res.data ?? []);
      })
      .catch(() => setAccounts([]))
      .finally(() => setReady(true));
  }, []);

  // "credential" = email+password account exists
  const hasCredential = accounts.some(a => a.provider === "credential");
  const oauthProviders = accounts.filter(a => a.provider !== "credential");

  return { accounts, hasCredential, oauthProviders, ready };
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
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color }}>{icon}</span>
        <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 20px", borderBottom: "1px solid var(--color-border)" }}>
      <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>{label}</span>
      <span style={{ fontSize: "0.85rem", color: "#e2e8f0", fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

// ── 2FA Setup Card ────────────────────────────────────────────────────────────

type TwoFaStep = "idle" | "password" | "qr" | "verify" | "backupCodes" | "done";

function TwoFactorSection({ hasCredential }: { hasCredential: boolean }) {
  const { data: session, refetch } = useSession() as any;
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
      const res = await (authClient as any).twoFactor.enable({ password: pwd });
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
      const res = await (authClient as any).twoFactor.verifyTotp({ code: verifyCode });
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
      const res = await (authClient as any).twoFactor.disable(body);
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
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: "0.8rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* ── Idle state ── */}

      {/* OAuth-only: must set a password first — Better Auth validates it as required string at the API/Zod level */}
      {step === "idle" && !hasCredential && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)",
          borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#94a3b8",
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
            gap: 6, background: "var(--color-surface-700)", borderRadius: 8, padding: 14,
          }}>
            {backupCodes.map((c, i) => (
              <code key={i} style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "#94a3b8" }}>{c}</code>
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

// ── Password change ───────────────────────────────────────────────────────────

/**
 * CredentialsSection — adapts based on whether the current user has a
 * password account ("credential" provider) or is OAuth-only.
 *
 * hasCredential = false (Google/Discord only):
 *   → shows "Set a password" form (no currentPassword field)
 *   → explains why adding a password is useful
 *
 * hasCredential = true (email+password, possibly also linked OAuth):
 *   → shows standard Change Password form
 */
function CredentialsSection({ hasCredential }: { hasCredential: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError("Passwords don't match"); return; }
    if (next.length < 8) { setError("Password must be at least 8 characters"); return; }
    setError(""); setLoading(true);
    try {
      let res: any;
      if (hasCredential) {
        // Change existing password
        res = await (authClient as any).changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        });
      } else {
        // First-time password set for OAuth users — no current password
        res = await (authClient as any).changePassword({
          newPassword: next,
          revokeOtherSessions: false,
        });
      }
      if (res.error) throw new Error(res.error.message);
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => setSuccess(false), 4000);
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
          background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#94a3b8",
        }}>
          <PlusCircle size={14} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ lineHeight: 1.6 }}>
            You signed in with an OAuth provider and don't have a password yet.
            Adding one lets you sign in with email + password and enables
            password-protected 2FA operations.
          </p>
        </div>
      )}

      {success && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
          borderRadius: 8, padding: "8px 12px", color: "#22c55e", fontSize: "0.8rem",
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
        <div>
          <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 5 }}>
            {hasCredential ? "New password" : "Password"}
          </label>
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)}
            required autoComplete="new-password" minLength={8} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 5 }}>Confirm password</label>
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
  const { hasCredential, oauthProviders, ready } = useLinkedAccounts();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <div className="animate-in" style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>Settings</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>Account security & platform configuration</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Profile */}
        {session && (
          <SectionCard icon={<Shield size={14} />} color="#818cf8" title="Profile">
            <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--color-border)" }}>
              <div className="avatar" style={{ width: 40, height: 40, fontSize: "1rem" }}>
                {session.user.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <p style={{ fontWeight: 600, color: "#e2e8f0" }}>{session.user.name}</p>
                <p style={{ fontSize: "0.8rem", color: "#64748b" }}>{session.user.email}</p>
              </div>
              <span className="badge badge-blue" style={{ marginLeft: "auto" }}>
                {(session.user as any).role ?? "user"}
              </span>
            </div>
            <InfoRow label="User ID" value={session.user.id} mono />
            <InfoRow label="Email verified" value={(session.user as any).emailVerified ? "Yes" : "No"} />
            {/* Linked OAuth providers */}
            {ready && oauthProviders.length > 0 && (
              <div style={{ padding: "11px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Linked providers</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {oauthProviders.map(a => (
                    <div key={a.provider} title={a.provider} style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: "var(--color-surface-700)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <ProviderIcon id={a.provider as ProviderId} size={13} />
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

        {/* 2FA */}
        <SectionCard icon={<KeyRound size={14} />} color="#818cf8" title="Two-Factor Authentication">
          <TwoFactorSection hasCredential={ready ? hasCredential : true} />
        </SectionCard>

        {/* Password / Set password */}
        <SectionCard
          icon={<Lock size={14} />}
          color="#34d399"
          title={hasCredential ? "Change Password" : "Set a Password"}
        >
          <CredentialsSection hasCredential={ready ? hasCredential : true} />
        </SectionCard>

        {/* Server info */}
        <SectionCard icon={<Server size={14} />} color="#818cf8" title="Server">
          <InfoRow label="Auth Server URL" value={AUTH_URL || "(proxied via Vite)"} mono />
          <InfoRow label="Auth Base Path" value="/api/auth" mono />
          <InfoRow label="Email Verification" value="Enabled (Resend)" />
          <InfoRow label="Rate Limiting" value="5 req / 60 s on sign-in" />
          <InfoRow label="2FA Plugin" value="TOTP + Email OTP" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

        {/* Session */}
        <SectionCard icon={<Clock size={14} />} color="#34d399" title="Session">
          <InfoRow label="Session Expiry" value="30 days" />
          <InfoRow label="Update Age" value="1 day" />
          <InfoRow label="Cookie Cache TTL" value="5 minutes" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

        {/* Cloudflare resources */}
        <SectionCard icon={<Settings size={14} />} color="#facc15" title="Cloudflare Resources">
          <InfoRow label="Database" value="D1 — ralph-auth-db" />
          <InfoRow label="Session / Rate-limit Cache" value="KV — ralph-auth-kv" />
          <InfoRow label="File Storage" value="R2 — ralph-auth-avatars" />
          <div style={{ padding: "12px 20px" }} />
        </SectionCard>

      </div>
    </div>
  );
}

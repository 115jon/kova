import { ProviderIcon } from "@/components/BrandIcons";
import { authClient, getSession, signIn, twoFactor } from "@/lib/auth-client";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle,
  Fingerprint,
  KeyRound,
  Link,
  Mail,
  Shield,
  Smartphone,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

// ── 2FA challenge screen ──────────────────────────────────────────────────────

function TwoFactorChallenge({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"totp" | "otp">("totp");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const handleVerify = async () => {
    if (code.length < 6) return;
    setError("");
    setLoading(true);
    try {
      let result: Awaited<ReturnType<typeof twoFactor.verifyTotp>> | Awaited<ReturnType<typeof twoFactor.verifyOtp>>;
      if (method === "totp") {
        result = await twoFactor.verifyTotp({ code });
      } else {
        result = await twoFactor.verifyOtp({ code });
      }
      if (result?.error) throw new Error(result.error.message ?? "Invalid code");
      // Refresh the Better Auth session store so AuthGuard.useSession()
      // sees the authenticated session immediately (avoids stale-cache bounce).
      await getSession();
      navigate({ to: "/" });
    } catch (e: any) {
      setError(e?.message ?? "Invalid code. Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    setError("");
    try {
      await twoFactor.sendOtp();
      setOtpSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send code");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 5, margin: "0 auto 12px",
          background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <KeyRound size={18} color="var(--color-accent)" />
        </div>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>
          Two-factor authentication
        </h2>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)", marginTop: 4 }}>
          {method === "totp"
            ? "Enter the 6-digit code from your authenticator app"
            : otpSent ? "Enter the code sent to your email" : "We'll send a code to your email"}
        </p>
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 4, padding: "9px 12px",
          fontFamily: "var(--font-mono)", color: "var(--color-red)", fontSize: "0.77rem",
        }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* Method tabs */}
      <div style={{ display: "flex", gap: 4, background: "var(--color-surface-raised)", borderRadius: 4, padding: 3, border: "1px solid var(--color-border)" }}>
        {([
          ["totp", "Authenticator app", Smartphone],
          ["otp", "Email code", KeyRound],
        ] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            className={method === m ? "btn btn-primary" : "btn btn-ghost"}
            style={{ flex: 1, justifyContent: "center", fontSize: "0.78rem", padding: "6px 10px" }}
            onClick={() => { setMethod(m as "totp" | "otp"); setCode(""); setError(""); }}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {method === "otp" && !otpSent ? (
        <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={handleSendOtp}>
          Send code to my email
        </button>
      ) : (
        <>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={code}
            autoFocus
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={e => e.key === "Enter" && handleVerify()}
            style={{ textAlign: "center", fontSize: "1.4rem", letterSpacing: "0.3em", fontFamily: "monospace" }}
          />
          <button
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={loading || code.length < 6}
            onClick={handleVerify}
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </>
      )}

      <button
        className="btn btn-ghost"
        style={{ justifyContent: "center", fontSize: "0.8rem" }}
        onClick={onBack}
      >
        ← Back to sign in
      </button>
    </div>
  );
}

// ── Magic Link panel ──────────────────────────────────────────────────────────

function MagicLinkPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authClient.signIn.magicLink({
        email,
        // Must be absolute — Better Auth resolves relative paths against AUTH_URL
        // (port 8787), not the dashboard origin (port 5174).
        callbackURL: `${window.location.origin}/`,
        errorCallbackURL: `${window.location.origin}/sign-in`,
      });
      if (res?.error) throw new Error(res.error.message ?? "Failed to send link");
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, margin: "0 auto",
          background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <CheckCircle size={22} color="#22c55e" />
        </div>
        <div>
          <p style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>Check your inbox</p>
          <p style={{ fontSize: "0.82rem", color: "#64748b", lineHeight: 1.6 }}>
            We sent a sign-in link to <strong style={{ color: "#94a3b8" }}>{email}</strong>.
            It expires in 10 minutes.
          </p>
        </div>
        <button
          className="btn btn-ghost"
          style={{ justifyContent: "center", fontSize: "0.8rem" }}
          onClick={onBack}
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 40, height: 40, borderRadius: 5, margin: "0 auto 12px",
          background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Link size={18} color="var(--color-accent)" />
        </div>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>Email sign-in link</h2>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)", marginTop: 4 }}>
          No password needed — we'll email you a secure link
        </p>
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "10px 12px", color: "#f87171", fontSize: "0.8rem",
        }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            id="magic-link-email"
            type="email"
            className="input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@example.com"
            required
            autoFocus
            autoComplete="email"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
        >
          <Mail size={14} /> {loading ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      <button
        className="btn btn-ghost"
        style={{ justifyContent: "center", fontSize: "0.8rem" }}
        onClick={onBack}
      >
        ← Back to password sign in
      </button>
    </div>
  );
}

// ── Main sign-in page ─────────────────────────────────────────────────────────

type SignInTab = "password" | "magic-link";

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [tab, setTab] = useState<SignInTab>("password");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        // Better Auth returns a specific code when 2FA is needed
        if (res.error.code === "TWO_FACTOR_REQUIRED" || res.error.status === 403) {
          setTwoFactorRequired(true);
          return;
        }
        setError(res.error.message ?? "Invalid credentials");
      } else if ((res as any).data?.twoFactorRedirect) {
        setTwoFactorRequired(true);
      } else {
        await getSession(); // refresh session store before navigating
        navigate({ to: "/" });
      }
    } catch {
      setError("Something went wrong. Check the server is running.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskey = async () => {
    setError("");
    setPasskeyLoading(true);
    try {
      const res = await signIn.passkey();
      // passkey.signIn always returns data (even on error) per the BA docs
      if ((res as any)?.error) {
        throw new Error((res as any).error?.message ?? "Passkey sign-in failed");
      }
      await getSession();
      navigate({ to: "/" });
    } catch (e: any) {
      // User cancelled the passkey prompt — silently ignore DOMException
      if (e?.name !== "NotAllowedError") {
        setError(e?.message ?? "Passkey sign-in failed. Please try again.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSocial = async (providerId: string) => {
    setError("");
    setSocialLoading(providerId);
    try {
      const result = await signIn.social({
        provider: providerId as any,
        callbackURL: `${window.location.origin}/`,
      });
      if (result?.data?.url) {
        window.location.href = result.data.url;
        return;
      }
      throw new Error(result?.error?.message ?? "No redirect URL returned");
    } catch (e: any) {
      setError(e?.message ?? `${providerId} sign-in failed. Please try again.`);
      setSocialLoading(null);
    }
  };

  if (twoFactorRequired) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "var(--color-surface-900)", padding: 24,
      }}>
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12), transparent)" }} />
        <div className="card animate-in" style={{ width: "100%", maxWidth: 380, padding: 36 }}>
          <TwoFactorChallenge onBack={() => { setTwoFactorRequired(false); setError(""); }} />
        </div>
      </div>
    );
  }

  if (tab === "magic-link") {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "var(--color-surface-900)", padding: 24,
      }}>
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12), transparent)" }} />
        <div className="card animate-in" style={{ width: "100%", maxWidth: 380, padding: 36 }}>
          <MagicLinkPanel onBack={() => setTab("password")} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-surface-900)",
      padding: 24,
    }}>
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(59,130,246,0.08), transparent)",
      }} />

      <div className="card animate-in" style={{ width: "100%", maxWidth: 380, padding: 36 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: "var(--color-accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 10px",
          }}>
            <Shield size={16} color="#fff" strokeWidth={2.5} />
          </div>
          <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.03em" }}>
            ralph<span style={{ color: "var(--color-accent)" }}>auth</span>
          </h1>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-secondary)", marginTop: 3 }}>Admin Dashboard</p>
        </div>

        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 16, color: "#f87171",
            fontSize: "0.8rem",
          }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          <button
            id="sign-in-btn"
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Divider + alternative sign-in methods */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-text-tertiary)" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Passkey sign-in */}
          <button
            id="passkey-sign-in-btn"
            className="btn btn-ghost"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={passkeyLoading}
            onClick={handlePasskey}
          >
            <Fingerprint size={16} />
            {passkeyLoading ? "Waiting for passkey…" : "Sign in with passkey"}
          </button>

          {/* Magic link */}
          <button
            id="magic-link-btn"
            className="btn btn-ghost"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => setTab("magic-link")}
          >
            <Mail size={16} /> Email me a sign-in link
          </button>

          {/* Social providers */}
          {CONFIGURED_PROVIDERS.map(p => (
            <button
              key={p.id}
              id={`${p.id}-sign-in-btn`}
              className="btn btn-ghost"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={socialLoading === p.id}
              onClick={() => handleSocial(p.id)}
            >
              <ProviderIcon id={p.id} size={16} />
              {p.label}{socialLoading === p.id ? "…" : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

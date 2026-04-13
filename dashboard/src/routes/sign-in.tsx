import { ProviderIcon } from "@/components/BrandIcons";
import { getSession, signIn, twoFactor } from "@/lib/auth-client";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, KeyRound, Shield, Smartphone } from "lucide-react";
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
          width: 44, height: 44, borderRadius: 12, margin: "0 auto 12px",
          background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <KeyRound size={20} color="#818cf8" />
        </div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0" }}>
          Two-factor authentication
        </h2>
        <p style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>
          {method === "totp"
            ? "Enter the 6-digit code from your authenticator app"
            : otpSent ? "Enter the code sent to your email" : "We'll send a code to your email"}
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

      {/* Method tabs */}
      <div style={{ display: "flex", gap: 4, background: "var(--color-surface-700)", borderRadius: 8, padding: 4 }}>
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

// ── Main sign-in page ─────────────────────────────────────────────────────────

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

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
        background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12), transparent)",
      }} />

      <div className="card animate-in" style={{ width: "100%", maxWidth: 380, padding: 36 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: twoFactorRequired ? 0 : 28 }}>
          {!twoFactorRequired && (
            <>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "linear-gradient(135deg, #6366f1, #7c3aed)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 12px",
                boxShadow: "0 0 24px rgba(99,102,241,0.35)",
              }}>
                <Shield size={20} color="#fff" strokeWidth={2.5} />
              </div>
              <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
                ralph<span style={{ color: "#818cf8" }}>auth</span>
              </h1>
              <p style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>Admin Dashboard</p>
            </>
          )}
        </div>

        {twoFactorRequired ? (
          <TwoFactorChallenge onBack={() => { setTwoFactorRequired(false); setError(""); }} />
        ) : (
          <>
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
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 6 }}>
                  Email
                </label>
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
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500, display: "block", marginBottom: 6 }}>
                  Password
                </label>
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

            {CONFIGURED_PROVIDERS.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
                  <span style={{ fontSize: "0.75rem", color: "#475569" }}>or</span>
                  <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

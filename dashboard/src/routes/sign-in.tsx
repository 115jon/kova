import { ProviderIcon } from "@/components/BrandIcons";
import { signIn } from "@/lib/auth-client";
import { CONFIGURED_PROVIDERS } from "@/lib/providers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Shield } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Track which social provider is in-flight by id (null = none)
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Invalid credentials");
      } else {
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
        return; // page navigates away — don't clear loading state
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
      {/* Background glow */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12), transparent)",
      }} />

      <div className="card animate-in" style={{ width: "100%", maxWidth: 380, padding: 36 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
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

        {/* Social providers — driven by CONFIGURED_PROVIDERS in src/lib/providers.ts */}
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
      </div>
    </div>
  );
}

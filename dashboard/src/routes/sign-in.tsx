import { signIn } from "@/lib/auth-client";
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

  const handleGoogle = async () => {
    // signIn.social() POSTs to /api/auth/sign-in/social, gets back a
    // Google OAuth URL, then navigates the browser there.
    // CORS is configured on the auth server via trustedOrigins.
    await signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/`,
    });
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

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
          <span style={{ fontSize: "0.75rem", color: "#475569" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        </div>

        <button
          id="google-sign-in-btn"
          className="btn btn-ghost"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={handleGoogle}
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}

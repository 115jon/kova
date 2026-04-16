/**
 * AuthDemoPage — tests SignIn / SignUp components and manual email auth.
 *
 * Covers:
 *  - <SignIn> drop-in component
 *  - <SignUp> drop-in component
 *  - useSignIn() hook (manual email/password)
 *  - useSignUp() hook (manual)
 *  - Social OAuth redirect (via SDK's built-in providers list)
 */

import {
  SignIn,
  SignUp,
  useAuth,
  useSignIn,
  useSignUp,
} from "@ralph-auth/react";
import { useState } from "react";
import { Log, useLog } from "../components/Log";

type View = "signin-component" | "signup-component" | "manual";

export function AuthDemoPage() {
  const { isSignedIn, isLoaded, userId, signOut } = useAuth();
  const [view, setView] = useState<View>("signin-component");
  const { log, lines } = useLog();

  if (!isLoaded) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 40, width: 200 }} />
      </div>
    );
  }

  // ── Signed-in state ────────────────────────────────────────────────────────
  if (isSignedIn) {
    return (
      <div className="page">
        <div className="hero">
          <h1>You are <span>signed in</span> ✓</h1>
          <p>The SDK correctly returned an active session. Use the tabs to explore other features.</p>
        </div>

        <div className="cards" style={{ maxWidth: 420 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-icon">👤</div>
              <div>
                <div className="card-title">Session Info</div>
                <div className="card-subtitle">from useAuth()</div>
              </div>
            </div>
            <div className="card-body">
              <div className="kv-row">
                <span className="kv-key">isSignedIn</span>
                <span className="kv-val ok">true</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">userId</span>
                <span className="kv-val">{userId}</span>
              </div>
            </div>
            <button
              className="btn btn-danger"
              onClick={async () => {
                log("Signing out…", "info");
                await signOut();
                log("Signed out ✓", "ok");
              }}
            >
              Sign out
            </button>
            <Log lines={lines} />
          </div>
        </div>
      </div>
    );
  }

  // ── Signed-out state ───────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="hero">
        <h1>Test the <span>Auth Flow</span></h1>
        <p>Sign in with the pre-built SDK components, or use the hook-based manual form.</p>
      </div>

      <div className="tabs">
        <button
          className={`tab ${view === "signin-component" ? "active" : ""}`}
          onClick={() => setView("signin-component")}
        >
          &lt;SignIn /&gt;
        </button>
        <button
          className={`tab ${view === "signup-component" ? "active" : ""}`}
          onClick={() => setView("signup-component")}
        >
          &lt;SignUp /&gt;
        </button>
        <button
          className={`tab ${view === "manual" ? "active" : ""}`}
          onClick={() => setView("manual")}
        >
          Hook API
        </button>
      </div>

      {view === "signin-component" && (
        <div style={{ width: "100%", maxWidth: 420 }}>
          <p style={{ color: "var(--text-2)", fontSize: "0.8rem", marginBottom: 16, textAlign: "center" }}>
            Drop-in <code>&lt;SignIn&gt;</code> component from the SDK
          </p>
          <SignIn afterSignInUrl="/" />
        </div>
      )}

      {view === "signup-component" && (
        <div style={{ width: "100%", maxWidth: 420 }}>
          <p style={{ color: "var(--text-2)", fontSize: "0.8rem", marginBottom: 16, textAlign: "center" }}>
            Drop-in <code>&lt;SignUp&gt;</code> component from the SDK
          </p>
          <SignUp afterSignUpUrl="/" />
        </div>
      )}

      {view === "manual" && <ManualAuthForm onLog={log} />}

      <Log lines={lines} />
    </div>
  );
}

// ── Manual hook-based form ─────────────────────────────────────────────────────

function ManualAuthForm({ onLog }: { onLog: ReturnType<typeof useLog>["log"] }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("TestPass123!");
  const [name, setName] = useState("Test User");
  const [error, setError] = useState<string | null>(null);

  const { signIn, loading: siLoading } = useSignIn();
  const { signUp, loading: suLoading } = useSignUp();
  const loading = siLoading || suLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signin") {
        onLog(`Attempting email sign-in for ${email}…`, "info");
        await signIn.email({ email, password, callbackURL: "/" });
        onLog("Sign-in initiated ✓", "ok");
      } else {
        onLog(`Creating account for ${email}…`, "info");
        await signUp.email({ email, password, name, callbackURL: "/" });
        onLog("Account created ✓", "ok");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onLog(`Error: ${msg}`, "err");
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, width: "100%" }}>
      <div className="card-header">
        <div className="card-icon">🔑</div>
        <div>
          <div className="card-title">Hook API — useSignIn / useSignUp</div>
          <div className="card-subtitle">Manual imperative auth</div>
        </div>
      </div>

      <div className="tabs" style={{ alignSelf: "flex-start" }}>
        <button className={`tab ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")}>
          Sign In
        </button>
        <button className={`tab ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>
          Sign Up
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {mode === "signup" && (
          <div className="form-field">
            <label className="form-label">Full name</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Test User"
              required
            />
          </div>
        )}
        <div className="form-field">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="test@example.com"
            required
          />
        </div>
        <div className="form-field">
          <label className="form-label">Password</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Loading…" : mode === "signin" ? "Sign In" : "Sign Up"}
        </button>
      </form>
    </div>
  );
}

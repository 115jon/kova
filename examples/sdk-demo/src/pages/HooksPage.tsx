/**
 * HooksPage — live inspection of every SDK hook's return value.
 *
 * Covers: useAuth, useUser, useSession
 */

import { useAuth, useSession, useUser } from "@ralph-auth/react";

export function HooksPage() {
  const auth = useAuth();
  const user = useUser();
  const session = useSession();

  return (
    <div className="page">
      <div className="hero">
        <h1>SDK <span>Hooks</span></h1>
        <p>Live output of every hook — sign in on the Auth tab to see them populate.</p>
      </div>

      <div className="cards">

        {/* ── useAuth ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">🔐</div>
            <div>
              <div className="card-title">useAuth()</div>
              <div className="card-subtitle">Session session summary</div>
            </div>
          </div>
          <div className="card-body">
            <KV k="isLoaded" v={String(auth.isLoaded)} cls={auth.isLoaded ? "ok" : "warn"} />
            <KV k="isSignedIn" v={String(auth.isSignedIn)} cls={auth.isSignedIn ? "ok" : "dim"} />
            <KV k="userId" v={auth.userId ?? "null"} cls={auth.userId ? undefined : "dim"} />
            <KV k="sessionId" v={auth.sessionId ? auth.sessionId.slice(0, 20) + "…" : "null"} cls={auth.sessionId ? undefined : "dim"} />
            <KV k="orgId" v={auth.orgId ?? "null"} cls={auth.orgId ? undefined : "dim"} />
          </div>
        </div>

        {/* ── useUser ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">👤</div>
            <div>
              <div className="card-title">useUser()</div>
              <div className="card-subtitle">Full user record</div>
            </div>
          </div>
          <div className="card-body">
            <KV k="isLoaded" v={String(user.isLoaded)} cls={user.isLoaded ? "ok" : "warn"} />
            <KV k="isSignedIn" v={String(user.isSignedIn)} cls={user.isSignedIn ? "ok" : "dim"} />
            {user.user ? (
              <>
                <KV k="name" v={user.user.name} />
                <KV k="email" v={user.user.email} />
                <KV k="role" v={user.user.role ?? "null"} cls={user.user.role ? "blue" : "dim"} />
                <KV k="emailVerified" v={String(user.user.emailVerified)} cls={user.user.emailVerified ? "ok" : "warn"} />
                <KV k="twoFactor" v={String(user.user.twoFactorEnabled)} cls={user.user.twoFactorEnabled ? "ok" : "dim"} />
                <KV k="image" v={user.user.image ? "set" : "null"} cls={user.user.image ? "ok" : "dim"} />
              </>
            ) : (
              <KV k="user" v="null" cls="dim" />
            )}
          </div>
        </div>

        {/* ── useSession ──────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">🗝️</div>
            <div>
              <div className="card-title">useSession()</div>
              <div className="card-subtitle">Raw session object</div>
            </div>
          </div>
          <div className="card-body">
            <KV k="isLoaded" v={String(session.isLoaded)} cls={session.isLoaded ? "ok" : "warn"} />
            {session.session ? (
              <>
                <KV k="sessionId" v={session.session.id.slice(0, 18) + "…"} />
                <KV k="userId" v={session.session.userId.slice(0, 18) + "…"} />
                <KV k="expiresAt" v={new Date(session.session.expiresAt).toLocaleString()} />
                <KV k="ipAddress" v={session.session.ipAddress ?? "null"} cls="dim" />
                <KV k="userAgent" v={session.session.userAgent ? "set" : "null"} cls={session.session.userAgent ? undefined : "dim"} />
              </>
            ) : (
              <KV k="session" v="null" cls="dim" />
            )}
          </div>
        </div>

        {/* ── Raw JSON dump ──────────────────────────────────── */}
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-header">
            <div className="card-icon">📋</div>
            <div>
              <div className="card-title">Raw JSON</div>
              <div className="card-subtitle">useUser().user — click to expand</div>
            </div>
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-2)", userSelect: "none" }}>
              {user.user ? `{${Object.keys(user.user).length} keys}` : "null"}
            </summary>
            <pre style={{
              marginTop: 8,
              background: "#0c0c0c",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              fontSize: "0.7rem",
              fontFamily: "var(--mono)",
              color: "var(--text-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 280,
              overflowY: "auto",
            }}>
              {JSON.stringify(user.user, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function KV({
  k, v, cls,
}: { k: string; v: string; cls?: "ok" | "warn" | "err" | "dim" | "blue" }) {
  const clsMap: Record<string, string> = {
    ok: "ok", warn: "warn", err: "err", dim: "dim", blue: "",
  };
  const extraStyle = cls === "blue"
    ? { color: "#60a5fa" }
    : {};

  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={`kv-val ${cls ? clsMap[cls] ?? "" : ""}`} style={extraStyle}>
        {v}
      </span>
    </div>
  );
}

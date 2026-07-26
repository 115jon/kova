/**
 * ConnectedAccountsPage — tests useLinkedAccounts() and <ConnectedAccounts />.
 *
 * Exercises the new Tier 2 Account Linking feature end-to-end:
 *  - Shows all linked accounts via the hook
 *  - Lets user initiate new OAuth links
 *  - Embeds the <ConnectedAccounts /> drop-in component
 */

import { ConnectedAccounts, useLinkedAccounts } from "@115jon/kova-react";
import { Log, useLog } from "../components/Log";

export function ConnectedAccountsPage() {
  const { accounts, isLoaded, isUpdating, error, linkAccount, refetch } =
    useLinkedAccounts();
  const { log, lines } = useLog();

  return (
    <div className="page">
      <div className="hero">
        <h1>Connected <span>Accounts</span></h1>
        <p>
          Tests the new <code>useLinkedAccounts()</code> hook and{" "}
          <code>&lt;ConnectedAccounts /&gt;</code> component from Tier 2.
          <br />
          Sign in first to see your linked providers.
        </p>
      </div>

      <div className="cards">

        {/* ── Hook output ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">🔗</div>
            <div>
              <div className="card-title">useLinkedAccounts()</div>
              <div className="card-subtitle">Raw hook data</div>
            </div>
          </div>
          <div className="card-body">
            <div className="kv-row">
              <span className="kv-key">isLoaded</span>
              <span className={`kv-val ${isLoaded ? "ok" : "warn"}`}>{String(isLoaded)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">isUpdating</span>
              <span className={`kv-val ${isUpdating ? "warn" : "dim"}`}>{String(isUpdating)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">count</span>
              <span className="kv-val">{accounts.length}</span>
            </div>
            {error && (
              <div className="kv-row">
                <span className="kv-key">error</span>
                <span className="kv-val err">{error}</span>
              </div>
            )}
          </div>

          {/* Linked accounts list */}
          {isLoaded && accounts.length > 0 && (
            <>
              <hr className="divider" />
              <span className="section-label">Linked providers</span>
              {accounts.map((a) => (
                <div key={a.id} className="account-row">
                  <span className="badge badge-blue">{a.providerId}</span>
                  <span className="account-provider">{a.accountId}</span>
                  <span className="account-id">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </>
          )}

          {isLoaded && accounts.length === 0 && (
            <p style={{ color: "var(--text-3)", fontSize: "0.75rem" }}>
              No linked accounts yet — sign in to see them here.
            </p>
          )}

          <div className="btn-row">
            <button
              className="btn btn-secondary"
              onClick={() => {
                log("Refreshing accounts…", "info");
                refetch();
                log("Refetch triggered ✓", "ok");
              }}
            >
              ↻ Refetch
            </button>
          </div>
        </div>

        {/* ── Manual link buttons ─────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">➕</div>
            <div>
              <div className="card-title">linkAccount() API</div>
              <div className="card-subtitle">Programmatic OAuth linking</div>
            </div>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
            Clicking a provider will call <code>linkAccount({"{ provider }"}) </code>
            and redirect you through OAuth. The account will be linked when you return.
          </p>
          <div className="oauth-grid">
            {(["google", "github", "discord", "microsoft"] as const).map((p) => {
              const labels: Record<string, string> = {
                google: "Google", github: "GitHub", discord: "Discord", microsoft: "Microsoft",
              };
              const isLinked = accounts.some((a) => a.providerId === p);
              return (
                <button
                  key={p}
                  className={`btn ${isLinked ? "btn-ghost" : "btn-secondary"}`}
                  disabled={isUpdating || !isLoaded || isLinked}
                  onClick={async () => {
                    log(`Initiating link for ${p}…`, "info");
                    await linkAccount({ provider: p, callbackURL: window.location.pathname });
                  }}
                  title={isLinked ? "Already connected" : `Link ${labels[p]}`}
                >
                  {isLinked ? `✓ ${labels[p]}` : `+ ${labels[p]}`}
                </button>
              );
            })}
          </div>
          <Log lines={lines} />
        </div>

        {/* ── Drop-in component ───────────────────────────────────── */}
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-header">
            <div className="card-icon">🧩</div>
            <div>
              <div className="card-title">&lt;ConnectedAccounts /&gt;</div>
              <div className="card-subtitle">Drop-in component (same as inside UserButton)</div>
            </div>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-2)", marginBottom: 8 }}>
            This is the exact component embedded in the UserButton "Connected accounts" accordion.
            You can also use it standalone on a settings page.
          </p>
          <ConnectedAccounts
            callbackURL={window.location.pathname}
            layout="wide"
          />
        </div>
      </div>
    </div>
  );
}

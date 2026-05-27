/**
 * OrgPage — tests useOrganization() and <OrgSwitcher />.
 */

import { OrgSwitcher, useOrganization } from "@kova/react";

export function OrgPage() {
  const { organization, membership, isLoaded } = useOrganization();

  return (
    <div className="page">
      <div className="hero">
        <h1>Organization <span>Context</span></h1>
        <p>Tests <code>useOrganization()</code> and the <code>&lt;OrgSwitcher&gt;</code> component.</p>
      </div>

      <div className="cards">

        {/* ── useOrganization ─────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">🏢</div>
            <div>
              <div className="card-title">useOrganization()</div>
              <div className="card-subtitle">Active org + membership</div>
            </div>
          </div>
          <div className="card-body">
            {!isLoaded ? (
              <>
                <div className="skeleton" style={{ height: 14, width: "60%" }} />
                <div className="skeleton" style={{ height: 14, width: "80%" }} />
              </>
            ) : organization ? (
              <>
                <div className="kv-row">
                  <span className="kv-key">id</span>
                  <span className="kv-val">{organization.id.slice(0, 20)}…</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">name</span>
                  <span className="kv-val">{organization.name}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">slug</span>
                  <span className="kv-val">{organization.slug}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">logo</span>
                  <span className="kv-val dim">{organization.logo ?? "null"}</span>
                </div>
                <hr className="divider" />
                <span className="section-label">Membership</span>
                <div className="kv-row">
                  <span className="kv-key">role</span>
                  <span className="badge badge-purple">{membership?.role ?? "—"}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">userId</span>
                  <span className="kv-val dim">{membership?.userId.slice(0, 18)}…</span>
                </div>
              </>
            ) : (
              <div className="kv-row">
                <span className="kv-key">organization</span>
                <span className="kv-val dim">null — no active org</span>
              </div>
            )}
          </div>
        </div>

        {/* ── OrgSwitcher ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon">🔄</div>
            <div>
              <div className="card-title">&lt;OrgSwitcher /&gt;</div>
              <div className="card-subtitle">Drop-in org switch component</div>
            </div>
          </div>
          <div className="card-body">
            <p style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
              Click the switcher below to change your active organization.
              useOrganization() will update instantly.
            </p>
            <div style={{ marginTop: 8 }}>
              <OrgSwitcher />
            </div>
          </div>
        </div>

        {/* ── Help card ──────────────────────────────────────────── */}
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-header">
            <div className="card-icon">💡</div>
            <div>
              <div className="card-title">No org?</div>
              <div className="card-subtitle">How to test org features</div>
            </div>
          </div>
          <ol style={{ paddingLeft: 18, color: "var(--text-2)", fontSize: "0.78rem", lineHeight: 2 }}>
            <li>Sign in with an account that belongs to an organization.</li>
            <li>Open the <strong>admin dashboard</strong> → Organizations → create one if needed.</li>
            <li>Invite your test account as a member.</li>
            <li>Come back here — the org should appear in the switcher automatically.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

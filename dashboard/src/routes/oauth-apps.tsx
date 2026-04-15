import { ProviderIconBadge } from "@/components/BrandIcons";
import { SOCIAL_PROVIDERS } from "@/lib/providers";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, ExternalLink, Globe } from "lucide-react";

export const Route = createFileRoute("/oauth-apps")({
  component: OAuthAppsPage,
});

function OAuthAppsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <p className="section-label" style={{ marginBottom: 4 }}>Integrations</p>
        <h1 className="page-title">OAuth Apps</h1>
        <p className="page-subtitle">Configured social login providers</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {SOCIAL_PROVIDERS.map(p => (
          <div key={p.id} className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <ProviderIconBadge provider={p.id} size={40} />
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--color-text-primary)" }}>{p.name}</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-text-tertiary)" }}>OAuth 2.0 / OIDC</p>
              </div>
              {p.configured ? (
                <span className="badge badge-green"><CheckCircle size={10} /> Active</span>
              ) : (
                <span className="badge badge-gray">Inactive</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <p className="section-label" style={{ marginBottom: 4 }}>
                  Callback URL
                </p>
                <code style={{
                  display: "block", background: "var(--color-surface-raised)", borderRadius: 4,
                  border: "1px solid var(--color-border)",
                  padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: "0.72rem",
                  color: "var(--color-text-secondary)", wordBreak: "break-all",
                }}>
                  {p.callbackUrl}
                </code>
              </div>

              <div>
                <p style={{ fontSize: "0.7rem", color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  Scopes
                </p>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {p.scopes.map(s => (
                    <span key={s} className="badge badge-blue">{s}</span>
                  ))}
                </div>
              </div>

              {!p.configured && (
                <div style={{
                  background: "var(--color-amber-dim)", border: "1px solid rgba(251,191,36,0.2)",
                  borderRadius: 4, padding: "9px 11px",
                  fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-amber)",
                }}>
                  Add <code>{p.id.toUpperCase()}_CLIENT_ID</code> and{" "}
                  <code>{p.id.toUpperCase()}_CLIENT_SECRET</code> to{" "}
                  <code>server/.dev.vars</code> to enable.
                </div>
              )}

              <a
                href={p.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                style={{ fontSize: "0.78rem", textDecoration: "none" }}
              >
                <ExternalLink size={12} /> Open Developer Console
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Info panel */}
      <div className="card" style={{ marginTop: 24, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <Globe size={16} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 5 }}>Adding a new provider</p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Better Auth supports 40+ social providers. To add one, install the secret in your Cloudflare Worker{" "}
              (<code>wrangler secret put PROVIDER_CLIENT_ID</code>),{" "}
              then add it to <code>server/src/auth.ts</code> under <code>socialProviders</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

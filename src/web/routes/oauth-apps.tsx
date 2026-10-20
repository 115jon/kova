import { ProviderIconBadge } from "@/components/BrandIcons";
import { SOCIAL_PROVIDERS } from "@/lib/providers";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, ExternalLink, Globe, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/oauth-apps")({
  component: OAuthAppsPage,
});

function OAuthAppsPage() {
  return (
    <div>
      <header className="page-header">
        <div className="page-header-main">
          <p className="section-label">Integrations</p>
          <h1 className="page-title">OAuth apps</h1>
          <p className="page-subtitle">Configured social login providers</p>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
        {SOCIAL_PROVIDERS.map(p => (
          <div key={p.id} className="card stack">
            <div className="row" style={{ gap: 12 }}>
              <ProviderIconBadge provider={p.id} size={40} />
              <div className="min-w-0" style={{ flex: 1 }}>
                <p className="text-h3">{p.name}</p>
                <p className="text-sm text-tertiary">OAuth 2.0 / OIDC</p>
              </div>
              {p.configured ? (
                <span className="badge badge-success"><CheckCircle /> Active</span>
              ) : (
                <span className="badge badge-neutral">Inactive</span>
              )}
            </div>

            <div className="stack-sm">
              <p className="text-overline">Callback URL</p>
              <code className="code-block">{p.callbackUrl}</code>
            </div>

            <div className="stack-sm">
              <p className="text-overline">Scopes</p>
              <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {p.scopes.map(s => (
                  <span key={s} className="badge badge-info">{s}</span>
                ))}
              </div>
            </div>

            {!p.configured && (
              <p className="alert alert-warning" role="status">
                <AlertTriangle />
                <span>
                  Add <code>{p.id.toUpperCase()}_CLIENT_ID</code> and{" "}
                  <code>{p.id.toUpperCase()}_CLIENT_SECRET</code> to{" "}
                  <code>.dev.vars</code> to enable.
                </span>
              </p>
            )}

            <a
              href={p.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink /> Open developer console
            </a>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <span className="icon-tile" aria-hidden="true"><Globe /></span>
          <div className="min-w-0">
            <p className="text-h3">Adding a new provider</p>
            <p className="text-secondary" style={{ marginTop: 4 }}>
              Better Auth supports 40+ social providers. To add one, install the secret in your Cloudflare Worker{" "}
              (<code>wrangler secret put PROVIDER_CLIENT_ID</code>),{" "}
              then add it to <code>src/worker/auth.ts</code> under <code>socialProviders</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

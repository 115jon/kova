import { ProviderIconBadge } from "@/components/BrandIcons";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, ExternalLink, Globe } from "lucide-react";

export const Route = createFileRoute("/oauth-apps")({
  component: OAuthAppsPage,
});

type Provider = {
  id: "google" | "discord";
  name: string;
  color: string;
  configured: boolean;
  callbackUrl: string;
  scopes: string[];
  docsUrl: string;
};

// Callback URLs always point at the real auth server (not the Vite proxy),
// because Google/Discord redirect back to the server directly.
const AUTH_SERVER = import.meta.env.VITE_AUTH_URL || "http://localhost:8787";

const PROVIDERS: Provider[] = [
  {
    id: "google" as const,
    name: "Google",
    color: "#4285f4",
    configured: true,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/google`,
    scopes: ["openid", "email", "profile"],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    id: "discord" as const,
    name: "Discord",
    color: "#5865f2",
    configured: true,
    callbackUrl: `${AUTH_SERVER}/api/auth/callback/discord`,
    scopes: ["identify", "email"],
    docsUrl: "https://discord.com/developers/applications",
  },
];

function OAuthAppsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>OAuth Apps</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>
          Configured social login providers
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {PROVIDERS.map(p => (
          <div key={p.id} className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <ProviderIconBadge provider={p.id} size={40} />
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, color: "#e2e8f0" }}>{p.name}</p>
                <p style={{ fontSize: "0.75rem", color: "#64748b" }}>OAuth 2.0 / OIDC</p>
              </div>
              {p.configured ? (
                <span className="badge badge-green"><CheckCircle size={10} /> Active</span>
              ) : (
                <span className="badge badge-gray">Inactive</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <p style={{ fontSize: "0.7rem", color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  Callback URL
                </p>
                <code style={{
                  display: "block", background: "var(--color-surface-700)", borderRadius: 6,
                  padding: "6px 10px", fontSize: "0.75rem", color: "#94a3b8",
                  wordBreak: "break-all",
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
                  background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)",
                  borderRadius: 8, padding: "10px 12px", fontSize: "0.78rem", color: "#facc15",
                }}>
                  Add <code style={{ fontFamily: "monospace" }}>{p.id.toUpperCase()}_CLIENT_ID</code> and{" "}
                  <code style={{ fontFamily: "monospace" }}>{p.id.toUpperCase()}_CLIENT_SECRET</code> to{" "}
                  <code style={{ fontFamily: "monospace" }}>server/.dev.vars</code> to enable.
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
          <Globe size={18} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>Adding a new provider</p>
            <p style={{ fontSize: "0.83rem", color: "#64748b", lineHeight: 1.6 }}>
              Better Auth supports 40+ social providers. To add one, install the secret in your Cloudflare Worker{" "}
              (<code style={{ fontFamily: "monospace", color: "#94a3b8" }}>wrangler secret put PROVIDER_CLIENT_ID</code>),{" "}
              then add it to <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>server/src/auth.ts</code> under{" "}
              <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>socialProviders</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

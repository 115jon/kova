import { createFileRoute } from "@tanstack/react-router";
import { Key } from "lucide-react";

export const Route = createFileRoute("/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>API Keys</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>Manage server-to-server access tokens</p>
      </div>
      <div className="card" style={{ padding: 24, display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Key size={18} color="#818cf8" />
        </div>
        <div>
          <p style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>Coming soon</p>
          <p style={{ fontSize: "0.83rem", color: "#64748b", lineHeight: 1.6 }}>
            API key management requires the <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>apiKey</code> plugin from Better Auth.
            Add <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>import {"{ apiKey }"} from "better-auth/plugins"</code> to{" "}
            <code style={{ fontFamily: "monospace", color: "#94a3b8" }}>server/src/auth.ts</code> plugins array to enable it.
          </p>
        </div>
      </div>
    </div>
  );
}

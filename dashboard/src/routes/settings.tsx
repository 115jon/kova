import { createFileRoute } from "@tanstack/react-router";
import { Clock, Server, Settings, Shield } from "lucide-react";

import { AUTH_URL } from "@/lib/auth-client";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--color-border)" }}>
      <span style={{ fontSize: "0.875rem", color: "#94a3b8" }}>{label}</span>
      <span style={{ fontSize: "0.875rem", color: "#e2e8f0", fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>Settings</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: 2 }}>Auth server configuration reference</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Server info */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Server size={14} color="#818cf8" />
            <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Server</h2>
          </div>
          <Row label="Auth Server URL" value={AUTH_URL} mono />
          <Row label="Auth Base Path" value="/api/auth" mono />
          <Row label="Health Endpoint" value={`${AUTH_URL}/health`} mono />
          <div style={{ padding: "12px 20px" }} />
        </div>

        {/* Session config */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={14} color="#34d399" />
            <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Session</h2>
          </div>
          <Row label="Session Expiry" value="30 days" />
          <Row label="Update Age" value="1 day" />
          <Row label="Cookie Cache TTL" value="5 minutes" />
          <div style={{ padding: "12px 20px" }} />
        </div>

        {/* Security */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={14} color="#f87171" />
            <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Security</h2>
          </div>
          <Row label="Email Verification" value="Disabled (dev mode)" />
          <Row label="CSRF Protection" value="Enabled" />
          <Row label="Geolocation Tracking" value="Enabled (production)" />
          <Row label="IP Detection" value="Cloudflare CF-Connecting-IP" />
          <div style={{ padding: "12px 20px" }}>
            <p style={{ fontSize: "0.78rem", color: "#475569" }}>
              To change settings, edit{" "}
              <code style={{ fontFamily: "monospace", color: "#64748b" }}>server/src/auth.ts</code>{" "}
              and redeploy.
            </p>
          </div>
        </div>

        {/* Cloudflare resources */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Settings size={14} color="#facc15" />
            <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Cloudflare Resources</h2>
          </div>
          <Row label="Database" value="D1 — ralph-auth-db" />
          <Row label="Session Cache" value="KV — ralph-auth-kv" />
          <Row label="File Storage" value="R2 — ralph-auth-avatars" />
          <div style={{ padding: "12px 20px" }} />
        </div>
      </div>
    </div>
  );
}

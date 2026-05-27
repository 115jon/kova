import React from "react";
import { KovaLogo } from "./KovaLogo";
import {
  ArrowRight,
  Shield,
  Key,
  Layers,
  Lock,
  Code,
  Terminal,
  ArrowUpRight,
  Globe,
  Activity,
  CheckCircle,
} from "lucide-react";

export function LandingPage() {
  const [activeTab, setActiveTab] = React.useState<"client" | "worker">("client");
  const [copiedCode, setCopiedCode] = React.useState(false);

  const clientCode = `import { kova } from "@kova/auth";

export const auth = kova({
  clientId: process.env.KOVA_CLIENT_ID,
  domain: "auth.kova.dev",
  redirectUri: window.location.origin + "/callback"
});

// Trigger login with a single line
await auth.loginWithRedirect();`;

  const workerCode = `import { KovaWorker } from "@kova/auth/worker";

export default {
  async fetch(request, env) {
    const auth = new KovaWorker(env.KOVA_DB);
    const session = await auth.getSession(request);
    
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    return new Response(\`Hello \${session.user.name}\`);
  }
};`;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeTab === "client" ? clientCode : workerCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)",
        backgroundSize: "28px 28px",
        color: "#f0f0f0",
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* Decorative top radial ambient glow */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: "1200px",
          height: "450px",
          background: "radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Navigation Header */}
      <header
        style={{
          height: "64px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "between",
          backdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: "1200px", margin: "0 auto" }}>
          <KovaLogo size={28} variant="full" />
          
          <nav style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <a
              href="https://github.com/115jon/kova"
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "0.78rem",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-secondary)",
                textDecoration: "none",
                transition: "color 0.15s",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-secondary)")}
            >
              GitHub <ArrowUpRight size={12} />
            </a>
            <a
              href="/sign-in"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                background: "var(--color-text-primary)",
                color: "var(--color-bg)",
                border: "none",
                borderRadius: "4px",
                padding: "6px 12px",
                fontWeight: 600,
                textDecoration: "none",
                transition: "transform 0.1s, opacity 0.15s",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Console <ArrowRight size={12} />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "80px 24px 100px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "80px" }}>
          {/* Eyebrow badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: "100px",
              padding: "4px 12px",
              marginBottom: "24px",
            }}
          >
            <Shield size={12} color="var(--color-accent)" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.68rem",
                letterSpacing: "0.05em",
                color: "var(--color-accent)",
                fontWeight: 600,
              }}
            >
              EDGE-NATIVE AUTHENTICATION
            </span>
          </div>

          {/* Headline */}
          <h1
            style={{
              fontSize: "clamp(2.2rem, 5vw, 3.8rem)",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: "#ffffff",
              maxWidth: "800px",
              margin: "0 auto 20px",
            }}
          >
            Authentication built for the next web.
          </h1>

          {/* Subtext */}
          <p
            style={{
              fontSize: "clamp(1rem, 2vw, 1.12rem)",
              color: "var(--color-text-secondary)",
              lineHeight: 1.6,
              maxWidth: "580px",
              margin: "0 auto 36px",
            }}
          >
            Secure, developer-first identity management built natively for Cloudflare Workers and global edge runtimes.
          </p>

          {/* CTAs */}
          <div style={{ display: "flex", justifyContent: "center", gap: "14px" }}>
            <a
              href="/sign-in"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.82rem",
                background: "var(--color-accent)",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "12px 24px",
                fontWeight: 600,
                textDecoration: "none",
                boxShadow: "0 4px 20px rgba(59,130,246,0.2)",
                transition: "transform 0.1s, background-color 0.15s",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-accent)")}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Get Started <ArrowRight size={14} />
            </a>
            <a
              href="#features"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.82rem",
                background: "rgba(255,255,255,0.03)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: "4px",
                padding: "12px 24px",
                fontWeight: 600,
                textDecoration: "none",
                transition: "transform 0.1s, border-color 0.15s, background-color 0.15s",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border-strong)";
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border)";
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
              }}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Explore Features
            </a>
          </div>
        </div>

        {/* Bento Grid Features */}
        <section id="features" style={{ marginBottom: "120px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: "16px" }}>
            {/* Cell 1: Edge Native Performance (Col 1-8) */}
            <div
              className="card"
              style={{
                gridColumn: "span 8",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "280px",
                position: "relative",
                overflow: "hidden",
                cursor: "default",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <Globe size={18} color="var(--color-accent)" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-accent)", letterSpacing: "0.05em" }}>EDGE PERFORMANCE</span>
                </div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                  Global Sub-10ms Session Verification
                </h3>
                <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", lineHeight: 1.6, maxWidth: "480px" }}>
                  By running authentication filters directly on Cloudflare Edge, session states are verified and refreshed instantly without roundtrips to central databases.
                </p>
              </div>

              {/* Mini latency graph visualization */}
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", marginTop: "24px", height: "80px", borderBottom: "1px solid var(--color-border)", paddingBottom: "8px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "100%", height: "16px", background: "var(--color-border)", borderRadius: "2px" }} />
                  <span style={{ fontSize: "0.62rem", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", marginTop: "4px" }}>AWS</span>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "100%", height: "24px", background: "var(--color-border)", borderRadius: "2px" }} />
                  <span style={{ fontSize: "0.62rem", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", marginTop: "4px" }}>Vercel</span>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "100%", height: "70px", background: "linear-gradient(to top, rgba(59,130,246,0.1), rgba(59,130,246,0.6))", border: "1px solid var(--color-accent)", borderRadius: "2px", position: "relative" }}>
                    <span style={{ position: "absolute", top: "-18px", left: "50%", transform: "translateX(-50%)", fontSize: "0.65rem", fontFamily: "var(--font-mono)", color: "var(--color-accent)", fontWeight: "bold" }}>Kova</span>
                  </div>
                  <span style={{ fontSize: "0.62rem", fontFamily: "var(--font-mono)", color: "var(--color-accent)", fontWeight: 600, marginTop: "4px" }}>Kova Edge</span>
                </div>
              </div>
            </div>

            {/* Cell 2: Cryptographic Security (Col 9-12) */}
            <div
              className="card"
              style={{
                gridColumn: "span 4",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "280px",
                cursor: "default",
              }}
            >
              <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
                <Lock size={16} color="var(--color-accent)" />
              </div>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                  Zero-Knowledge Sessions
                </h3>
                <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  Built-in WebCrypto encryption shields session integrity. Tokens are fully tamper-proof and automatically rotated to block theft replay vectors.
                </p>
              </div>
            </div>

            {/* Cell 3: Multi-tenant / Org (Col 1-4) */}
            <div
              className="card"
              style={{
                gridColumn: "span 4",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "340px",
                cursor: "default",
              }}
            >
              <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
                <Layers size={16} color="var(--color-accent)" />
              </div>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                  B2B Multi-Tenancy
                </h3>
                <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  Scaffold complete enterprise organizations, handle role hierarchies, and define invitation-based workflows in less than ten minutes of total setup.
                </p>
              </div>
            </div>

            {/* Cell 4: Developer Experience (Col 5-12) */}
            <div
              className="card"
              style={{
                gridColumn: "span 8",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "340px",
                cursor: "default",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <Code size={18} color="var(--color-accent)" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-accent)", letterSpacing: "0.05em" }}>DEVELOPER INTERFACE</span>
                </div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "16px", fontFamily: "var(--font-mono)" }}>
                  Designed to scale with your codebase
                </h3>
              </div>

              {/* Code Tab container */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--color-border)", borderRadius: "6px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* Tabs header */}
                <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--color-border)", padding: "0 12px", background: "rgba(255,255,255,0.01)" }}>
                  <button
                    onClick={() => setActiveTab("client")}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.68rem",
                      background: "none",
                      border: "none",
                      color: activeTab === "client" ? "var(--color-accent)" : "var(--color-text-secondary)",
                      padding: "10px 14px",
                      cursor: "pointer",
                      borderBottom: activeTab === "client" ? "1.5px solid var(--color-accent)" : "none",
                      fontWeight: 600,
                    }}
                  >
                    client.ts
                  </button>
                  <button
                    onClick={() => setActiveTab("worker")}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.68rem",
                      background: "none",
                      border: "none",
                      color: activeTab === "worker" ? "var(--color-accent)" : "var(--color-text-secondary)",
                      padding: "10px 14px",
                      cursor: "pointer",
                      borderBottom: activeTab === "worker" ? "1.5px solid var(--color-accent)" : "none",
                      fontWeight: 600,
                    }}
                  >
                    worker.ts
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={handleCopy}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.65rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "3px",
                      color: "var(--color-text-secondary)",
                      padding: "3px 8px",
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--color-text-primary)";
                      e.currentTarget.style.borderColor = "var(--color-border-strong)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--color-text-secondary)";
                      e.currentTarget.style.borderColor = "var(--color-border)";
                    }}
                  >
                    {copiedCode ? "Copied!" : "Copy"}
                  </button>
                </div>
                {/* Tab content */}
                <pre
                  style={{
                    padding: "16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                    color: "#a9b1d6",
                    lineHeight: 1.5,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    textAlign: "left",
                    margin: 0,
                  }}
                >
                  <code>{activeTab === "client" ? clientCode : workerCode}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "48px 24px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "20px" }}>
          <div>
            <KovaLogo size={24} variant="full" />
            <p style={{ fontSize: "0.72rem", color: "var(--color-text-tertiary)", marginTop: "8px", fontFamily: "var(--font-mono)" }}>
              © {new Date().getFullYear()} Kova Technologies, Inc. All rights reserved.
            </p>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--color-green)", boxShadow: "0 0 10px var(--color-green)" }} />
            <span style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
              All systems operational
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

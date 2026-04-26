/**
 * App.tsx — Root of the @ralph-auth/react SDK demo.
 *
 * Wraps the app in <RalphAuthProvider> and routes between
 * the demo pages.  No router library needed — just a simple
 * useState-based page switcher so the demo stays zero-dep outside
 * of the SDK itself.
 */

import { RalphAuthProvider, UserButton } from "@ralph-auth/react";
import { useState } from "react";
import { AuthDemoPage } from "./pages/AuthDemoPage";
import { ConnectedAccountsPage } from "./pages/ConnectedAccountsPage";
import { HooksPage } from "./pages/HooksPage";
import { OrgPage } from "./pages/OrgPage";

// ── SDK configuration ─────────────────────────────────────────────────────────
//
// Values are injected at build time via Vite env variables:
//   VITE_AUTH_URL         — the ralph-auth server origin
//   VITE_PUBLISHABLE_KEY  — the per-app publishable key from the Admin Dashboard
//
// Dev:  set in examples/sdk-demo/.env          (VITE_AUTH_URL=https://auth.lvh.me)
// Prod: set in examples/sdk-demo/.env.production (VITE_AUTH_URL=https://auth.115jon.site)
//
// NEVER fall back to window.location.origin — the SDK demo has no auth API routes.
const AUTH_URL = import.meta.env.VITE_AUTH_URL as string;
if (!AUTH_URL) {
  console.error(
    "[sdk-demo] VITE_AUTH_URL is not set. " +
    "Create examples/sdk-demo/.env with VITE_AUTH_URL=https://auth.lvh.me"
  );
}

const PUBLISHABLE_KEY =
  import.meta.env.VITE_PUBLISHABLE_KEY ?? "pk_dev_sYq5sn1jU9MTMSHKx4QdkZJf";

type Page = "auth" | "hooks" | "org" | "linked";

const NAV: { id: Page; label: string }[] = [
  { id: "auth", label: "Auth Flow" },
  { id: "hooks", label: "Hooks" },
  { id: "org", label: "Organization" },
  { id: "linked", label: "Connected Accounts" },
];

export default function App() {
  const [page, setPage] = useState<Page>("auth");

  return (
    <RalphAuthProvider
      authUrl={AUTH_URL}
      publishableKey={PUBLISHABLE_KEY}
      afterSignInUrl="/"
      afterSignUpUrl="/"
      afterSignOutUrl="/"
      oauthProviders={[
        { id: "google", label: "Google" },
        { id: "github", label: "GitHub" },
        { id: "discord", label: "Discord" },
        { id: "microsoft", label: "Microsoft" },
      ]}
    >
      <div className="app">
        {/* ── Navbar ─────────────────────────────────────────────────── */}
        <nav className="navbar">
          <div className="navbar-brand">
            <span className="dot" />
            ralph-auth SDK demo
          </div>

          {/* Tabs */}
          <div className="tabs">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`tab ${page === n.id ? "active" : ""}`}
                onClick={() => setPage(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>

          {/* UserButton lives in the navbar — the main SDK component under test */}
          <div className="navbar-right">
            <UserButton
              appearance={{
                elements: {
                  userButtonTrigger: { fontSize: "0.82rem" },
                },
              }}
            />
          </div>
        </nav>

        {/* ── Page ───────────────────────────────────────────────────── */}
        <main>
          {page === "auth" && <AuthDemoPage />}
          {page === "hooks" && <HooksPage />}
          {page === "org" && <OrgPage />}
          {page === "linked" && <ConnectedAccountsPage />}
        </main>
      </div>
    </RalphAuthProvider>
  );
}

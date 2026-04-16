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
// Because we're running behind the Vite proxy (see vite.config.ts),
// all /api/* requests resolve to http://localhost:8787.
// So we point authUrl at the current origin and the proxy handles the rest.
const AUTH_URL = "http://localhost:8787";

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
      afterSignInUrl="/"
      afterSignUpUrl="/"
      afterSignOutUrl="/"
      oauthProviders={[
        { id: "google", name: "Google" },
        { id: "github", name: "GitHub" },
        { id: "discord", name: "Discord" },
        { id: "microsoft", name: "Microsoft" },
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

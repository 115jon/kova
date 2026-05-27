import { createFileRoute, Link } from "@tanstack/react-router";
import { KovaLogo } from "@/components/KovaLogo";
import { AlertCircle, ArrowLeft, Shield } from "lucide-react";

export const Route = createFileRoute("/auth-error")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: (search.error as string | undefined) ?? "unknown_error",
  }),
  component: AuthErrorPage,
});

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  internal_server_error: {
    title: "Authentication failed",
    description:
      "Something went wrong on our end while processing your sign-in. Please try again or use a different method.",
  },
  access_denied: {
    title: "Access denied",
    description:
      "You denied permission to the requested account. If this was a mistake, try signing in again.",
  },
  oauth_error: {
    title: "OAuth error",
    description:
      "The sign-in provider returned an error. Please try again or contact support.",
  },
  unknown_error: {
    title: "Unexpected error",
    description:
      "An unexpected error occurred during sign-in. Please try again.",
  },
};

function AuthErrorPage() {
  const { error } = Route.useSearch();
  const info =
    ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown_error;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-surface-900)",
        padding: 24,
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(239,68,68,0.08), transparent)",
        }}
      />

      <div
        className="card animate-in"
        style={{ width: "100%", maxWidth: 380, padding: 36 }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <KovaLogo size={36} variant="full" />
        </div>

        {/* Error card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertCircle size={22} color="#f87171" />
          </div>
          <div>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--color-text-primary)",
                marginBottom: 8,
              }}
            >
              {info.title}
            </h2>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                color: "var(--color-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              {info.description}
            </p>
            {error !== "unknown_error" && (
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  color: "var(--color-text-tertiary)",
                  marginTop: 8,
                }}
              >
                Error code: <code>{error}</code>
              </p>
            )}
          </div>
        </div>

        <Link to="/sign-in">
          <button
            className="btn btn-ghost"
            style={{ width: "100%", justifyContent: "center" }}
          >
            <ArrowLeft size={14} /> Back to sign in
          </button>
        </Link>
      </div>
    </div>
  );
}

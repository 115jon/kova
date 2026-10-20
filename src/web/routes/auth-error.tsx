import { createFileRoute, Link } from "@tanstack/react-router";
import { KovaLogo } from "@/components/KovaLogo";
import { ArrowLeft } from "lucide-react";

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
    ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES] ?? {
      title: "Unexpected error",
      description: "An unexpected error occurred during sign-in. Please try again.",
    };

  return (
    <main className="center-screen">
      <div className="card public-card stack">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <KovaLogo size={48} />
        </div>

        <div className="stack-sm" style={{ textAlign: "center" }}>
          <h1 className="text-h2">{info.title}</h1>
          <p className="text-secondary">{info.description}</p>
          {error !== "unknown_error" && (
            <p className="text-sm text-tertiary">
              Error code: <code>{error}</code>
            </p>
          )}
        </div>

        <Link className="btn btn-secondary btn-block" to="/sign-in">
          <ArrowLeft /> Back to sign in
        </Link>
      </div>
    </main>
  );
}

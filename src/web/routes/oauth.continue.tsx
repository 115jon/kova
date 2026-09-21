import { KovaLogo } from "@/components/KovaLogo";
import { UserAvatar } from "@/components/UserAvatar";
import { multiSession, useSession } from "@/lib/auth-client";
import {
  buildSignInReturnPath,
  persistOauthContinueSearch,
  restoreOauthContinueSearch,
} from "@/lib/sign-in-redirect";
import { buildAuthorizeUrlAfterAccountSelected } from "../../worker/lib/oidc-account-picker";
import { createFileRoute } from "@tanstack/react-router";
import { PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";

type DeviceSession = {
  session: { token: string };
  user: { id: string; name?: string | null; email: string; image?: string | null };
};

export const Route = createFileRoute("/oauth/continue")({
  validateSearch: (search: Record<string, unknown>): Record<string, string | undefined> => {
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string") next[key] = value;
    }
    return next;
  },
  component: OauthContinuePage,
});

function continueSearch(): string {
  return restoreOauthContinueSearch(window.location.search);
}

function continuePath(): string {
  return `/oauth/continue${continueSearch()}`;
}

function signInForAnotherAccount(): string {
  persistOauthContinueSearch(window.location.search);
  return buildSignInReturnPath({ redirect_url: continuePath(), add_account: "1" });
}

function signInToContinue(): string {
  return buildSignInReturnPath({ redirect_url: continuePath() });
}

function OauthContinuePage() {
  const { data: session, isPending } = useSession();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const restored = continueSearch();
    if (restored && restored !== window.location.search) {
      window.history.replaceState(null, "", `/oauth/continue${restored}`);
    }
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    multiSession.listDeviceSessions()
      .then((res: Awaited<ReturnType<typeof multiSession.listDeviceSessions>>) => {
        setSessions((res.data as DeviceSession[] | null) ?? []);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }, [session?.user]);

  const finishWithAccount = async (sessionToken?: string) => {
    if (switching) return;
    setError("");
    setSwitching(sessionToken ?? "current");
    try {
      if (sessionToken) {
        await multiSession.setActive({ sessionToken });
      }
      window.location.assign(
        buildAuthorizeUrlAfterAccountSelected(window.location.origin, continueSearch()),
      );
    } catch (e: unknown) {
      setSwitching(null);
      setError(e instanceof Error ? e.message : "Could not switch accounts. Try again.");
    }
  };

  const accounts = sessions.length > 0
    ? sessions
    : session?.user
      ? [{
          session: { token: "" },
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          },
        }]
      : [];

  return (
    <div
      className="public-auth-shell"
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
        className="public-auth-ambient"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12), transparent)",
        }}
      />
      <div className="card public-auth-card animate-in" style={{ width: "100%", maxWidth: 400, padding: 36 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <KovaLogo size={36} variant="full" />
          <h1
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              margin: "18px 0 6px",
              letterSpacing: "-0.02em",
            }}
          >
            Continue to 1:15
          </h1>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.76rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Choose which Kova account signs into git
          </p>
        </div>

        {error && (
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.77rem",
              color: "var(--color-red)",
              marginBottom: 16,
            }}
          >
            {error}
          </p>
        )}

        {isPending || (session?.user && loadingSessions && accounts.length === 0) ? (
          <p
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-tertiary)",
              fontSize: "0.8rem",
              textAlign: "center",
            }}
          >
            Loading accounts…
          </p>
        ) : !session?.user ? (
          <a
            className="btn btn-primary"
            href={signInToContinue()}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Sign in with Kova
          </a>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {accounts.map((item) => {
              const isCurrent = item.user.id === session.user.id;
              const busy = switching !== null;
              return (
                <button
                  key={`${item.user.id}-${item.session.token || "current"}`}
                  type="button"
                  disabled={busy}
                  onClick={() => finishWithAccount(item.session.token || undefined)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    background: isCurrent ? "var(--color-accent-dim)" : "var(--color-surface-raised)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    cursor: busy ? "wait" : "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <UserAvatar src={item.user.image} name={item.user.name ?? item.user.email} size={36} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        color: "var(--color-text-primary)",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.user.name || item.user.email}
                    </span>
                    <span
                      style={{
                        display: "block",
                        color: "var(--color-text-secondary)",
                        fontSize: "0.72rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.user.email}
                    </span>
                  </span>
                  <span style={{ color: "var(--color-text-tertiary)", fontSize: "0.7rem" }}>
                    {switching === (item.session.token || "current")
                      ? "Signing in…"
                      : isCurrent
                        ? "Use"
                        : "Switch"}
                  </span>
                </button>
              );
            })}
            <a
              href={signInForAnotherAccount()}
              onClick={(event) => {
                event.preventDefault();
                window.location.assign(signInForAnotherAccount());
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 8,
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.76rem",
              }}
            >
              <PlusCircle size={14} /> Add another account
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

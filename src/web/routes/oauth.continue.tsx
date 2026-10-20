import { KovaLogo } from "@/components/KovaLogo";
import { UserAvatar } from "@/components/UserAvatar";
import { multiSession, useSession } from "@/lib/auth-client";
import {
  buildSignInReturnPath,
  persistOauthContinueSearch,
  restoreOauthContinueSearch,
} from "@/lib/sign-in-redirect";
import {
  buildAuthorizeUrlAfterAccountSelected,
  OIDC_LAST_USER_STORAGE_KEY,
  sortAccountsLastUsedFirst,
} from "../../worker/lib/oidc-account-picker";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, PlusCircle } from "lucide-react";
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

function lastUsedForgejoUserId(): string | null {
  try {
    return localStorage.getItem(OIDC_LAST_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberForgejoUser(userId: string): void {
  try {
    localStorage.setItem(OIDC_LAST_USER_STORAGE_KEY, userId);
  } catch {
    // ignore quota / private mode
  }
}

function OauthContinuePage() {
  const { data: session, isPending } = useSession();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lastUsedUserId] = useState(() => lastUsedForgejoUserId());

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
      .then(async (res: Awaited<ReturnType<typeof multiSession.listDeviceSessions>>) => {
        const listed = (res.data as DeviceSession[] | null) ?? [];
        setSessions(listed);
        const lastId = lastUsedForgejoUserId();
        const last = listed.find((item) => item.user.id === lastId && item.session.token);
        if (last && last.user.id !== session?.user.id) {
          await multiSession.setActive({ sessionToken: last.session.token });
        }
      })
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }, [session?.user]);

  const accounts = sortAccountsLastUsedFirst(
    sessions.length > 0
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
        : [],
    lastUsedUserId,
  );

  const finishWithAccount = async (item: DeviceSession) => {
    if (switching) return;
    setError("");
    setSwitching(item.session.token || "current");
    try {
      if (item.session.token) {
        await multiSession.setActive({ sessionToken: item.session.token });
      }
      rememberForgejoUser(item.user.id);
      window.location.assign(
        buildAuthorizeUrlAfterAccountSelected(window.location.origin, continueSearch()),
      );
    } catch (e: unknown) {
      setSwitching(null);
      setError(e instanceof Error ? e.message : "Could not switch accounts. Try again.");
    }
  };

  return (
    <main className="center-screen">
      <div className="card public-card stack">
        <div className="stack-sm" style={{ alignItems: "center", textAlign: "center" }}>
          <KovaLogo size={48} />
          <h1 className="text-h2" style={{ marginTop: "var(--space-2)" }}>Continue to 1:15</h1>
          <p className="text-secondary">Choose which Kova account signs into git</p>
        </div>

        {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}

        {isPending || (session?.user && loadingSessions && accounts.length === 0) ? (
          <div className="skeleton-rows" role="status" aria-label="Loading accounts">
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        ) : !session?.user ? (
          <a
            className="btn btn-primary btn-block"
            href={signInToContinue()}
          >
            Sign in with Kova
          </a>
        ) : (
          <div className="stack-sm">
            {accounts.map((item) => {
              const isCurrent = item.user.id === session.user.id;
              const isLastUsed = item.user.id === lastUsedUserId;
              const busy = switching !== null;
              return (
                <button
                  key={`${item.user.id}-${item.session.token || "current"}`}
                  type="button"
                  className="btn btn-secondary btn-block"
                  aria-current={isCurrent || undefined}
                  disabled={busy}
                  onClick={() => finishWithAccount(item)}
                  style={{
                    height: "auto",
                    justifyContent: "flex-start",
                    gap: 12,
                    padding: "10px 12px",
                    textAlign: "start",
                    borderColor: isCurrent ? "var(--color-accent)" : undefined,
                    cursor: busy ? "wait" : undefined,
                  }}
                >
                  <UserAvatar src={item.user.image} name={item.user.name ?? item.user.email} size={36} />
                  <span className="min-w-0" style={{ flex: 1 }}>
                    <span className="text-strong truncate" style={{ display: "block" }}>
                      {item.user.name || item.user.email}
                    </span>
                    <span className="text-sm text-secondary text-mono truncate" style={{ display: "block" }}>
                      {item.user.email}
                    </span>
                  </span>
                  <span className="text-sm text-tertiary">
                    {switching === (item.session.token || "current")
                      ? "Signing in…"
                      : isLastUsed
                        ? "Last used"
                        : isCurrent
                          ? "Use"
                          : "Switch"}
                  </span>
                </button>
              );
            })}
            <a
              className="btn btn-subtle btn-block"
              href={signInForAnotherAccount()}
              onClick={(event) => {
                event.preventDefault();
                window.location.assign(signInForAnotherAccount());
              }}
            >
              <PlusCircle /> Add another account
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

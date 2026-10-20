import { KovaLogo } from "@/components/KovaLogo";
import { AUTH_URL, useSession } from "@/lib/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, Laptop, Shield, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ChallengeStatus = "pending" | "approved" | "denied" | "claimed";

type Challenge = {
  id: string;
  status: ChallengeStatus;
  hostname: string | null;
  platform: string | null;
  label: string | null;
  expiresAt: number;
};

export const Route = createFileRoute("/approve/$challengeId")({
  component: ApproveDevicePage,
});

function apiUrl(path: string) {
  return `${AUTH_URL}${path}`;
}

function signInHref(challengeId: string) {
  const params = new URLSearchParams({
    redirect_url: `/approve/${challengeId}`,
  });
  return `/sign-in?${params.toString()}`;
}

function ApproveDevicePage() {
  const { challengeId } = Route.useParams();
  const { data: session, isPending: sessionPending } = useSession();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(apiUrl(`/api/device-challenges/${challengeId}`), {
      credentials: "include",
    });
    if (res.status === 404) {
      setChallenge(null);
      setLoadError("This approval expired or was never created.");
      return;
    }
    if (!res.ok) {
      setLoadError("Could not load this machine request.");
      return;
    }
    setLoadError("");
    setChallenge(await res.json() as Challenge);
  }, [challengeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "approve" | "deny") => {
    setActionError("");
    setBusy(action);
    try {
      const res = await fetch(apiUrl(`/api/device-challenges/${challengeId}/${action}`), {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        status?: ChallengeStatus;
      };
      if (res.status === 401) {
        window.location.assign(signInHref(challengeId));
        return;
      }
      if (!res.ok) {
        setActionError(body.message ?? body.error ?? "Request failed.");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const machine = challenge?.hostname
    ?? challenge?.label
    ?? "an unknown machine";

  const statusTile = challenge?.status === "approved" || challenge?.status === "claimed"
    ? <span className="icon-tile icon-tile-lg tone-success" aria-hidden="true"><CheckCircle /></span>
    : challenge?.status === "denied"
      ? <span className="icon-tile icon-tile-lg tone-danger" aria-hidden="true"><XCircle /></span>
      : <span className="icon-tile icon-tile-lg" aria-hidden="true"><Laptop /></span>;

  return (
    <main className="center-screen">
      <div className="card public-card stack" style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <KovaLogo size={48} />
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>{statusTile}</div>

        {loadError && (
          <div className="stack-sm">
            <h1 className="text-h2">Can't approve this</h1>
            <p className="text-secondary">{loadError}</p>
          </div>
        )}

        {!loadError && challenge?.status === "pending" && (
          <div className="stack">
            <div className="stack-sm">
              <h1 className="text-h2">Approve this machine?</h1>
              <p className="text-secondary">
                <strong className="text-strong">{machine}</strong>
                {challenge.platform ? ` · ${challenge.platform}` : ""}
                {" "}wants house git access. This does not hand over secrets until mint runs.
              </p>
            </div>
            {sessionPending && <p className="text-secondary">Checking your session…</p>}
            {!sessionPending && !session && (
              <a className="btn btn-primary btn-block" href={signInHref(challengeId)}>
                <Shield /> Sign in to approve
              </a>
            )}
            {!sessionPending && session && (
              <div className="row" style={{ justifyContent: "center" }}>
                <button
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void act("deny")}
                  type="button"
                >
                  {busy === "deny" ? "Denying…" : "Deny"}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => void act("approve")}
                  type="button"
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
              </div>
            )}
            {actionError && <p className="alert alert-danger" role="alert" style={{ textAlign: "start" }}><XCircle /> {actionError}</p>}
          </div>
        )}

        {!loadError && challenge?.status === "approved" && (
          <div className="stack-sm">
            <h1 className="text-h2">Approved</h1>
            <p className="text-secondary">{machine} can finish bootstrap. You can close this.</p>
          </div>
        )}

        {!loadError && challenge?.status === "claimed" && (
          <div className="stack-sm">
            <h1 className="text-h2">Already used</h1>
            <p className="text-secondary">That approval was claimed. Start a new bootstrap if you need another machine.</p>
          </div>
        )}

        {!loadError && challenge?.status === "denied" && (
          <div className="stack-sm">
            <h1 className="text-h2">Denied</h1>
            <p className="text-secondary">{machine} did not get access.</p>
          </div>
        )}
      </div>
    </main>
  );
}

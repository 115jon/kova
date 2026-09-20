import { AUTH_URL, useSession } from "@/lib/auth-client";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, Laptop, Shield, XCircle } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

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

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--color-bg)",
      padding: 24,
    }}
    >
      <div style={{
        position: "fixed",
        top: 22,
        left: 28,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
      >
        <div style={{
          width: 22,
          height: 22,
          borderRadius: 4,
          background: "var(--color-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        >
          <span style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 800,
            color: "#fff",
            fontSize: "0.65rem",
          }}
          >
            K
          </span>
        </div>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          color: "var(--color-text-primary)",
          fontSize: "0.88rem",
        }}
        >
          kova
        </span>
      </div>

      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: 6,
        padding: 36,
        textAlign: "center",
        boxShadow: "0 32px 64px rgba(0,0,0,0.6)",
      }}
      >
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 5,
          margin: "0 auto 16px",
          background: "var(--color-accent-dim)",
          border: "1px solid rgba(59,130,246,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        >
          {challenge?.status === "approved" || challenge?.status === "claimed"
            ? <CheckCircle size={20} color="var(--color-accent)" />
            : challenge?.status === "denied"
              ? <XCircle size={20} color="var(--color-red)" />
              : <Laptop size={20} color="var(--color-accent)" />}
        </div>

        {loadError && (
          <>
            <h1 style={titleStyle}>Can't approve this</h1>
            <p style={bodyStyle}>{loadError}</p>
          </>
        )}

        {!loadError && challenge?.status === "pending" && (
          <>
            <h1 style={titleStyle}>Approve this machine?</h1>
            <p style={bodyStyle}>
              <strong style={{ color: "var(--color-text-primary)" }}>{machine}</strong>
              {challenge.platform ? ` · ${challenge.platform}` : ""}
              {" "}wants house git access. This does not hand over secrets until mint runs.
            </p>
            {sessionPending && <p style={bodyStyle}>Checking your session…</p>}
            {!sessionPending && !session && (
              <a className="btn btn-primary" href={signInHref(challengeId)} style={{ display: "inline-flex", marginTop: 8 }}>
                <Shield size={14} /> Sign in to approve
              </a>
            )}
            {!sessionPending && session && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => void act("approve")}
                  type="button"
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy !== null}
                  onClick={() => void act("deny")}
                  type="button"
                >
                  {busy === "deny" ? "Denying…" : "Deny"}
                </button>
              </div>
            )}
            {actionError && <p style={{ ...bodyStyle, color: "var(--color-red)", marginTop: 12 }}>{actionError}</p>}
          </>
        )}

        {!loadError && challenge?.status === "approved" && (
          <>
            <h1 style={titleStyle}>Approved</h1>
            <p style={bodyStyle}>{machine} can finish bootstrap. You can close this.</p>
          </>
        )}

        {!loadError && challenge?.status === "claimed" && (
          <>
            <h1 style={titleStyle}>Already used</h1>
            <p style={bodyStyle}>That approval was claimed. Start a new bootstrap if you need another machine.</p>
          </>
        )}

        {!loadError && challenge?.status === "denied" && (
          <>
            <h1 style={titleStyle}>Denied</h1>
            <p style={bodyStyle}>{machine} did not get access.</p>
          </>
        )}
      </div>
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "1rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  marginBottom: 8,
};

const bodyStyle: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "0.84rem",
  color: "var(--color-text-secondary)",
  lineHeight: 1.5,
  margin: 0,
};

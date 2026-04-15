import { organization } from "@/lib/auth-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, CheckCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/accept-invitation/$invitationId")({
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { invitationId } = Route.useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [orgName, setOrgName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const accept = async () => {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(invitationId)) {
        setErrorMsg("Invalid invitation link.");
        setStatus("error");
        return;
      }
      try {
        const res = await organization.acceptInvitation({ invitationId });
        if (res.error) throw new Error(res.error.message);
        setOrgName("the organization");
        setStatus("success");
        setTimeout(() => navigate({ to: "/organizations" as any }), 2500);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "This invitation is invalid or has expired.");
        setStatus("error");
      }
    };
    accept();
  }, [invitationId]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-bg)", padding: 24,
    }}>
      {/* Logo wordmark */}
      <div style={{ position: "fixed", top: 22, left: 28, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          background: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: "#fff", fontSize: "0.65rem" }}>R</span>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.88rem", letterSpacing: "-0.02em" }}>
          ralphauth
        </span>
      </div>

      <div style={{
        width: "100%", maxWidth: 400,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: 6, padding: 36, textAlign: "center",
        boxShadow: "0 32px 64px rgba(0,0,0,0.6)",
      }}>
        {status === "loading" && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 5, margin: "0 auto 16px",
              background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Building2 size={20} color="var(--color-accent)" />
            </div>
            <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>
              Accepting invitation…
            </h1>
            <div className="loading" style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)", margin: "16px auto", fontSize: "0.78rem" }}>
              Please wait
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 5, margin: "0 auto 16px",
              background: "var(--color-green-dim)", border: "1px solid rgba(52,211,153,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <CheckCircle size={20} color="var(--color-green)" />
            </div>
            <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>
              Welcome to {orgName}!
            </h1>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-tertiary)" }}>
              You've successfully joined. Redirecting to organizations…
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 5, margin: "0 auto 16px",
              background: "var(--color-red-dim)", border: "1px solid rgba(248,113,113,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <XCircle size={20} color="var(--color-red)" />
            </div>
            <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>
              Invitation failed
            </h1>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--color-text-tertiary)", marginBottom: 20 }}>{errorMsg}</p>
            <button className="btn btn-primary" style={{ margin: "0 auto" }}
              onClick={() => navigate({ to: "/sign-in" as any })}>
              Go to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}

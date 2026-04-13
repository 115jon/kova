import { authClient } from "@/lib/auth-client";
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
      try {
        const res = await (authClient as any).organization.acceptInvitation({ invitationId });
        if (res.error) throw new Error(res.error.message);
        setOrgName(res.data?.organization?.name ?? "the organization");
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
      background: "var(--color-surface-900)", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "var(--color-surface-800)",
        border: "1px solid var(--color-border)",
        borderRadius: 16, padding: 36, textAlign: "center",
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#e2e8f0" }}>
            ralph<span style={{ color: "#818cf8" }}>auth</span>
          </span>
        </div>

        {status === "loading" && (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Building2 size={22} color="#818cf8" />
            </div>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
              Accepting invitation…
            </h1>
            <div className="loading" style={{ color: "#818cf8", margin: "16px auto", fontSize: "0.85rem" }}>
              Please wait
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <CheckCircle size={22} color="#22c55e" />
            </div>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
              Welcome to {orgName}!
            </h1>
            <p style={{ fontSize: "0.85rem", color: "#64748b" }}>
              You've successfully joined. Redirecting to organizations…
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <XCircle size={22} color="#f87171" />
            </div>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
              Invitation failed
            </h1>
            <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 20 }}>{errorMsg}</p>
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

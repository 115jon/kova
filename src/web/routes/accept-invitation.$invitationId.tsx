import { KovaLogo } from "@/components/KovaLogo";
import { organization } from "@/lib/auth-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle, XCircle } from "lucide-react";
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
    <main className="center-screen">
      <div className="card public-card stack" style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <KovaLogo size={48} />
        </div>

        {status === "loading" && (
          <div className="stack-sm" role="status">
            <h1 className="text-h2">Accepting invitation…</h1>
            <p className="text-secondary">Please wait</p>
            <span className="skeleton" aria-hidden="true" style={{ height: 36, margin: "var(--space-2) auto 0", width: "100%" }} />
          </div>
        )}

        {status === "success" && (
          <div className="stack-sm" role="status">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-2)" }}>
              <span className="icon-tile icon-tile-lg tone-success" aria-hidden="true"><CheckCircle /></span>
            </div>
            <h1 className="text-h2">Welcome to {orgName}</h1>
            <p className="text-secondary">
              You've successfully joined. Redirecting to organizations…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="stack">
            <div className="stack-sm">
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-2)" }}>
                <span className="icon-tile icon-tile-lg tone-danger" aria-hidden="true"><XCircle /></span>
              </div>
              <h1 className="text-h2">Invitation failed</h1>
              <p className="text-secondary">{errorMsg}</p>
            </div>
            <button
              className="btn btn-primary btn-block"
              onClick={() => navigate({ to: "/sign-in" as any })}
              type="button"
            >
              Go to sign in
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

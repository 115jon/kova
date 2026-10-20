import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { KovaLogo } from "@/components/KovaLogo";
import { authClient } from "@/lib/auth-client";
import { validatePassword } from "@/lib/password";
import { buildAuthPagePath, validateResetPasswordSearch } from "@/lib/sign-in-redirect";

export const Route = createFileRoute("/reset-password")({
  validateSearch: validateResetPasswordSearch,
  head: () => ({ meta: [{ title: "Reset your password | Kova" }] }),
  component: ResetPasswordPage,
});

const EXPIRED = "That reset link is invalid or has expired. Request a new one.";

type Context = { pk?: string; redirect_url?: string; state?: string };

function ResetPasswordPage() {
  const { pk, redirect_url, state, token, error } = Route.useSearch();
  const context: Context = { pk, redirect_url, state };
  const signInHref = buildAuthPagePath("sign-in", context);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <main className="center-screen">
      <div className="card public-card stack">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <KovaLogo size={48} />
        </div>

        <div className="stack-sm" style={{ textAlign: "center" }}>
          <h1 className="text-h2">Reset your password</h1>
        </div>

        {token && !expired ? (
          <NewPasswordForm
            token={token}
            signInHref={pk && !redirect_url ? undefined : signInHref}
            done={done}
            onDone={() => setDone(true)}
            onExpired={() => setExpired(true)}
          />
        ) : (
          <RequestForm context={context} notice={expired || error ? EXPIRED : ""} />
        )}

        {!done && (
          <Link className="btn btn-secondary btn-block" to="/sign-in" search={context}>
            <ArrowLeft /> Back to sign in
          </Link>
        )}
      </div>
    </main>
  );
}

function RequestForm({ context, notice }: { context: Context; notice: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const address = email.trim();
    try {
      const redirectTo = new URL(buildAuthPagePath("reset-password", context), window.location.origin).toString();
      const res = await authClient.requestPasswordReset({ email: address, redirectTo });
      if (res.error?.status === 429) setError("Too many requests. Try again in a minute.");
      else setSentTo(address);
    } catch {
      setSentTo(address);
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <p className="alert alert-success" role="status">
        <CheckCircle /> If an account exists for {sentTo}, we sent a reset link. It expires in 1 hour.
      </p>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {(error || notice) && <p className="alert alert-danger" role="alert"><AlertCircle /> {error || notice}</p>}
      <div className="form-group">
        <label className="form-label" htmlFor="reset-email">Email</label>
        <input
          id="reset-email"
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}

function NewPasswordForm({ token, signInHref, done, onDone, onExpired }: { token: string; signInHref?: string; done: boolean; onDone: () => void; onExpired: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const { valid, errors } = validatePassword(password);
    if (!valid) return setError(errors[0] ?? "Choose a stronger password.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (!res.error) onDone();
      else if (res.error.code === "INVALID_TOKEN") onExpired();
      else setError(res.error.message || "Couldn't reset your password. Try again.");
    } catch {
      setError("Couldn't reset your password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <p className="alert alert-success" role="status"><CheckCircle /> Your password is updated.</p>
        {signInHref ? (
          <a className="btn btn-primary btn-block" href={signInHref}>Sign in</a>
        ) : (
          <p>Go back to where you were signing in and try again.</p>
        )}
      </>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}
      <div className="form-group">
        <label className="form-label" htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="reset-confirm">Confirm password</label>
        <input
          id="reset-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Saving..." : "Update password"}
      </button>
    </form>
  );
}

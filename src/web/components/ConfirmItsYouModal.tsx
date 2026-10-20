/**
 * "Confirm it's you": the way out of Better Auth's SESSION_NOT_FRESH (see
 * lib/fresh-session.ts). A fresh session only comes from signing in again, so
 * this signs in again on top of the current one, with whatever the account has:
 * a password, a linked provider, a passkey, or, when it has none of those, an
 * emailed link. It never signs out first, so cancelling or failing costs nothing.
 *
 * Accounts with two-factor never take the password path. Better Auth's
 * two-factor plugin answers a password sign-in on such an account by deleting
 * the new session and expiring the browser's session cookies until a code is
 * verified, and the dashboard sends a signed-out browser to /sign-in, so a code
 * step could not even stay on screen. See confirmMethods. If the server asks for
 * a code anyway (the 2FA flag was stale), the previous session is switched back
 * on with multiSession.setActive, which needs no session: it only reads the
 * signed `_multi-<token>` cookie the old session still has.
 *
 * Password and passkey finish in place. Better Auth's multi-session hook
 * deletes the browser's other sessions of the same user whenever a new one is
 * created, so the old session is already gone; there is nothing to revoke.
 * Provider and email-link sign-ins leave the page and come back to /settings, a
 * fixed path, so there is no redirect to steer.
 *
 * It does not retry the blocked action. A passkey prompt needs a user gesture,
 * and the one that opened this is long gone by the time sign-in answers.
 */

import { ProviderIcon } from "@/components/BrandIcons";
import { Modal, ModalHeader, useModalClose } from "@/components/Modal";
import { getSession, multiSession, signIn } from "@/lib/auth-client";
import { confirmMethods } from "@/lib/fresh-session";
import { SOCIAL_PROVIDERS } from "@/lib/providers";
import { AlertCircle, CheckCircle, Fingerprint, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";

const RETURN_TO = "/settings";

interface ConfirmItsYouModalProps {
  email: string;
  /** The account has a password to check. */
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  /** Linked social providers, by id. */
  providers: string[];
  hasPasskey: boolean;
  /** Called once the session is fresh again, when this finishes without leaving the page. */
  onConfirmed: () => void;
  onClose: () => void;
}

export function ConfirmItsYouModal(props: ConfirmItsYouModalProps) {
  return (
    <Modal onClose={props.onClose} maxWidth={420}>
      <ModalHeader
        title="Confirm it's you"
        subtitle="For your security, this needs a recent sign-in."
        icon={<span className="icon-tile" aria-hidden="true"><ShieldCheck /></span>}
      />
      <ConfirmForm {...props} />
    </Modal>
  );
}

function ConfirmForm({ email, hasPassword, twoFactorEnabled, providers, hasPasskey, onConfirmed }: ConfirmItsYouModalProps) {
  const close = useModalClose();
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const methods = confirmMethods({ hasPassword, twoFactorEnabled, hasPasskey, providers });
  const social = SOCIAL_PROVIDERS.filter((p) => p.configured && methods.providers.includes(p.id));

  const attempt = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't confirm. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onConfirmed();
    close();
  };

  const withPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      // Read the 2FA flag from the database, not the cached cookie: a password sign-in on a
      // 2FA account signs this browser out, so it must not start on a stale answer.
      const current = (await getSession({ query: { disableCookieCache: true } })).data;
      if (current?.user.twoFactorEnabled) {
        throw new Error("This account uses two-factor authentication. Confirm another way.");
      }
      const previousToken = current?.session.token;
      const res = await signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message || "That password isn't right.");
      if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        // The plugin has just signed this browser out. Put the previous session back.
        if (previousToken) await multiSession.setActive({ sessionToken: previousToken }).catch(() => { });
        throw new Error("This account uses two-factor authentication. Confirm another way.");
      }
      finish();
    });
  };

  const withPasskey = () =>
    attempt(async () => {
      const res = await signIn.passkey();
      if (res?.error) throw new Error("Passkey sign-in didn't complete. Try again or use another way.");
      finish();
    });

  const withProvider = (provider: string) =>
    attempt(async () => {
      await signIn.social({
        provider: provider as Parameters<typeof signIn.social>[0]["provider"],
        callbackURL: RETURN_TO,
        // Nudges Google to the account that is already signed in here.
        loginHint: provider === "google" ? email : undefined,
      });
    });

  const withEmailLink = () =>
    attempt(async () => {
      const res = await signIn.magicLink({ email, callbackURL: RETURN_TO });
      if (res.error) throw new Error(res.error.message || "Couldn't send the link. Try again.");
      setSent(true);
    });

  if (sent) {
    return (
      <>
        <div className="modal-body">
          <p className="alert alert-success" role="status">
            <CheckCircle /> We sent a sign-in link to {email}. Open it and you'll land back in Settings.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={close}>Close</button>
        </div>
      </>
    );
  }

  const hasOthers = social.length > 0 || methods.passkey || methods.emailLink;

  return (
    <form onSubmit={withPassword}>
      <div className="modal-body">
        {error && <p className="alert alert-danger" role="alert"><AlertCircle /> {error}</p>}

        {methods.password && (
          <div className="form-group">
            <label className="form-label" htmlFor="reauth-password">Password</label>
            <input
              id="reauth-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        )}

        {hasOthers && (
          <div className="stack-sm">
            {methods.password && <p className="text-sm text-tertiary">Or confirm another way</p>}
            {social.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="btn btn-secondary btn-block"
                disabled={busy}
                onClick={() => void withProvider(provider.id)}
              >
                <ProviderIcon id={provider.id} size={16} /> {provider.label}
              </button>
            ))}
            {methods.passkey && (
              <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => void withPasskey()}>
                <Fingerprint /> Use a passkey
              </button>
            )}
            {methods.emailLink && (
              <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => void withEmailLink()}>
                <Mail /> Email me a sign-in link
              </button>
            )}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
        {methods.password && (
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Confirming…" : "Confirm"}
          </button>
        )}
      </div>
    </form>
  );
}

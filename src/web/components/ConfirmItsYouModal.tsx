/**
 * "Confirm it's you": the way out of Better Auth's SESSION_NOT_FRESH (see
 * lib/fresh-session.ts). A fresh session only comes from signing in again, so
 * this signs in again on top of the current one, with whatever the account has:
 * a password (plus a code when 2FA is on), a linked provider, a passkey, or,
 * when it has none of those, an emailed link. It never signs out first, so
 * cancelling or failing costs nothing.
 *
 * On a 2FA account a password sign-in deletes the new session and expires the
 * browser's session cookies until a code is verified, so there is a short window
 * with no session. The password and the code are collected on one form and the
 * two requests go back to back, through a separate client (lib/reauth-client.ts)
 * so the dashboard's useSession never sees the gap and redirects to /sign-in.
 * If anything fails inside the window, multiSession.setActive switches the
 * previous session back on from its signed `_multi-<token>` cookie. If that
 * restore itself fails the browser is signed out, the pre-existing worst case.
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
import { getSession, signIn } from "@/lib/auth-client";
import { classifySecondFactor, confirmMethods, normalizeBackupCode } from "@/lib/fresh-session";
import { createReauthClient } from "@/lib/reauth-client";
import { SOCIAL_PROVIDERS } from "@/lib/providers";
import { AlertCircle, CheckCircle, Fingerprint, Mail, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

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

  const [code, setCode] = useState("");
  const methods = confirmMethods({ hasPassword, twoFactorEnabled, hasPasskey, providers });
  const reauth = useMemo(createReauthClient, []);
  const [needsCode, setNeedsCode] = useState(methods.code);
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
      // Read the 2FA flag from the database, not the cached cookie.
      const current = (await getSession({ query: { disableCookieCache: true } })).data;
      const previousToken = current?.session.token;
      const kind = classifySecondFactor(code);
      if (current?.user.twoFactorEnabled && !kind) {
        setNeedsCode(true);
        throw new Error("Enter the code from your authenticator app, or a backup code.");
      }
      const res = await reauth.signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message || "That password isn't right.");
      if (!(res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        finish();
        return;
      }
      const restore = () =>
        previousToken
          ? reauth.multiSession.setActive({ sessionToken: previousToken }).then(() => {}, () => {})
          : Promise.resolve();
      if (!kind) {
        await restore();
        setNeedsCode(true);
        throw new Error("This account uses two-factor authentication. Enter your code too.");
      }
      const verified =
        kind === "totp"
          ? await reauth.twoFactor.verifyTotp({ code: code.replace(/\s+/g, ""), trustDevice: false })
          : await reauth.twoFactor.verifyBackupCode({ code: normalizeBackupCode(code), trustDevice: false });
      if (verified.error) {
        await restore();
        throw new Error(verified.error.message || "That code isn't right.");
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

        {methods.password && needsCode && (
          <div className="form-group">
            <label className="form-label" htmlFor="reauth-code">Authenticator or backup code</label>
            <input
              id="reauth-code"
              className="input"
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <p className="text-sm text-tertiary">6 digits from your authenticator app, or one of your backup codes</p>
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

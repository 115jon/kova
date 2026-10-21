import type { AppAppearance } from "@/lib/app-sign-in";
import { chooserAccounts, type ChooserAccount, type DeviceSession } from "@/lib/account-chooser";
import { multiSession } from "@/lib/auth-client";
import { ChevronRight, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ActiveAccount = {
  sessionId: string;
  sessionToken: string;
  user: { id: string; name?: string | null; email: string; image?: string | null };
};

function AccountAvatar({ account }: { account: ChooserAccount }) {
  const [failed, setFailed] = useState(false);
  if (account.image && !failed) {
    return (
      <img
        className="app-auth-account-avatar"
        src={account.image}
        alt=""
        width={36}
        height={36}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="app-auth-account-avatar app-auth-account-avatar--letter" aria-hidden="true">
      {account.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * "Continue as" card for an app's sign-in page when someone is already signed
 * in. Nothing happens until an account is picked. Picking one makes it the
 * browser's active session, then `onContinue` hands it to the app through the
 * same bounce a fresh sign-in uses.
 */
export function AccountChooser({ appearance, active, onContinue, onUseAnother }: {
  appearance: AppAppearance;
  active: ActiveAccount;
  onContinue: () => void;
  onUseAnother: () => void;
}) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    multiSession.listDeviceSessions()
      .then((res) => (res.data as DeviceSession[] | null) ?? [])
      .catch((): DeviceSession[] => [])
      .then((listed) => { if (!cancelled) setSessions(listed); });
    return () => { cancelled = true; };
  }, []);

  // The active session always shows, even while the list loads or if it failed.
  const accounts = chooserAccounts(
    [{ session: { id: active.sessionId, token: active.sessionToken }, user: active.user }, ...(sessions ?? [])],
    active.sessionId,
  );

  const choose = async (account: ChooserAccount) => {
    if (busy) return;
    setBusy(account.sessionId);
    setError(null);
    try {
      if (account.sessionId !== active.sessionId) {
        const res = await multiSession.setActive({ sessionToken: account.sessionToken });
        if (res.error) throw new Error(res.error.message || "switch failed");
      }
      onContinue();
    } catch {
      setBusy(null);
      setError(`Couldn't continue as ${account.email}. Try again, or use another account.`);
    }
  };

  const logoAlt = `${appearance.displayName} logo`;

  return (
    <div data-ra-root data-ra-element="card">
      <div data-ra-element="cardHeader">
        {appearance.logoUrl && <img src={appearance.logoUrl} alt={logoAlt} data-ra-element="appLogo" />}
        <h1 data-ra-element="cardTitle" ref={headingRef} tabIndex={-1} className="app-auth-heading">
          Sign in to {appearance.displayName}
        </h1>
        <p data-ra-element="cardSubtitle">Choose an account to continue.</p>
      </div>
      <div data-ra-element="cardBody">
        {error && (
          <div data-ra-element="alertBanner" data-variant="error" role="alert">
            <span>{error}</span>
          </div>
        )}
        <ul className="app-auth-accounts" aria-busy={sessions === null || undefined}>
          {accounts.map((account) => {
            const isBusy = busy === account.sessionId;
            return (
              <li key={account.sessionId}>
                <button
                  type="button"
                  className="app-auth-account"
                  disabled={busy !== null}
                  aria-busy={isBusy || undefined}
                  aria-label={`Continue as ${account.name}${account.name === account.email ? "" : ` (${account.email})`}`}
                  onClick={() => void choose(account)}
                >
                  <AccountAvatar account={account} />
                  <span className="app-auth-account-text">
                    <span className="app-auth-account-name">{account.name}</span>
                    {account.name !== account.email && (
                      <span className="app-auth-account-email">{account.email}</span>
                    )}
                  </span>
                  {isBusy
                    ? <span className="app-auth-account-hint">Continuing…</span>
                    : <ChevronRight className="app-auth-account-chevron" size={18} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="app-auth-account"
              disabled={busy !== null}
              onClick={onUseAnother}
            >
              <span className="app-auth-account-avatar app-auth-account-avatar--icon" aria-hidden="true">
                <UserPlus size={18} />
              </span>
              <span className="app-auth-account-text">
                <span className="app-auth-account-name">Use another account</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
      {!appearance.hideBranding && (
        <div data-ra-element="cardFooter">
          <div data-ra-footer-badges="">
            {/* Same badge as the SDK card footer, which this card stands in for. */}
            <a href="https://auth.115jon.site" target="_blank" rel="noopener noreferrer" data-ra-element="brandingBadge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="12" fill="#0283a7" />
                <path d="M8.5 7v10M15.5 7.5 11 12l4.5 4.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Secured by Kova
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * <UserSecurity /> — the signed-in user's active sessions and recent activity.
 *
 * Opens from <UserButton>'s "Security" item, or embed it in a settings page.
 *  - Active sessions: device, app, location, last active; sign out any other
 *    session, or all of them at once after an inline confirm.
 *  - Recent activity: sign-ins, sign-outs and security changes, newest first,
 *    with "Load more".
 *
 * @example
 * ```tsx
 * <UserSecurity />
 * ```
 */

import { type Ref, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type AccountActivityEvent,
  type AccountClientInfo,
  type AccountRequestOptions,
  type AccountSession,
  activityLabel,
  deviceLabel,
  getAccountActivity,
  getAccountSessions,
  isFailedActivity,
  locationLabel,
  relativeTime,
  revokeAccountSession,
  revokeOtherAccountSessions,
} from "../account";
import { mergeAppearance, useKovaAuth } from "../context";
import type { AppearanceElements, UserSecurityProps } from "../types";
import { Alert, Skeleton, Spinner, visuallyHiddenStyle } from "./ui";

type Announce = (message: string) => void;

const headingStyle = {
  fontFamily: "var(--ra-font)",
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "var(--ra-color-text)",
  margin: "0 0 6px",
  outline: "none",
} as const;

const mutedTextStyle = {
  fontFamily: "var(--ra-font)",
  fontSize: "0.75rem",
  color: "var(--ra-color-text-tertiary)",
  margin: 0,
} as const;

function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Time({ ms }: { ms: number }) {
  return (
    <time dateTime={new Date(ms).toISOString()} title={absoluteTime(ms)}>
      {relativeTime(ms)}
    </time>
  );
}

function Badge({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "primary" }) {
  return (
    <span data-ra-element="userSecurityBadge" data-tone={tone}>
      {children}
    </span>
  );
}

function inAppLabel(client: AccountClientInfo | null): string | null {
  return client?.inApp ? `${client.inApp} in-app` : null;
}

function ActionButton({
  children,
  busy = false,
  destructive = false,
  disabled,
  onClick,
  label,
  elements,
  buttonRef,
}: {
  children: string;
  busy?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
  elements: AppearanceElements;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-ra-element="userSecurityButton"
      data-destructive={destructive ? "true" : undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      disabled={disabled || busy}
      onClick={onClick}
      style={elements.userSecurityButton}
    >
      {busy && <Spinner size={11} />}
      {children}
    </button>
  );
}

function SkeletonRows({ count, height }: { count: number; height: number }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} style={{ opacity: 1 - i * 0.2 }} />
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div>
      <Alert variant="error" style={{ fontSize: "0.75rem", marginBottom: 8 }}>
        {message}
      </Alert>
      <button type="button" data-ra-element="userSecurityButton" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// ── Active sessions ────────────────────────────────────────────────────────────

function SessionsSection({
  options,
  elements,
  announce,
}: {
  options: AccountRequestOptions;
  elements: AppearanceElements;
  announce: Announce;
}) {
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const requestId = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const othersButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoadFailed(false);
    try {
      const next = await getAccountSessions(options);
      if (id === requestId.current) setSessions(next);
    } catch {
      if (id === requestId.current) setLoadFailed(true);
    }
  }, [options]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const revoke = async (session: AccountSession) => {
    setPending(session.id);
    setActionError(null);
    try {
      await revokeAccountSession(options, session.id);
      announce(`Signed out of ${deviceLabel(session.client)}.`);
      await load();
      // The row is gone; keep focus inside the section.
      headingRef.current?.focus();
    } catch {
      setActionError("Couldn't sign out that session. Try again.");
    } finally {
      setPending(null);
    }
  };

  const revokeOthers = async () => {
    setPending("others");
    setActionError(null);
    try {
      const count = await revokeOtherAccountSessions(options);
      setConfirming(false);
      announce(count === 1 ? "Signed out of 1 other session." : `Signed out of ${count} other sessions.`);
      await load();
      headingRef.current?.focus();
    } catch {
      setActionError("Couldn't sign out the other sessions. Try again.");
    } finally {
      setPending(null);
    }
  };

  const others = sessions?.filter((s) => !s.current) ?? [];
  // Current device first, then most recently active.
  const ordered = sessions
    ? [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt)
    : [];

  return (
    <section aria-labelledby={headingId} data-ra-security-section="">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} style={headingStyle}>
        Active sessions
      </h3>

      {actionError && (
        <Alert variant="error" style={{ fontSize: "0.75rem", marginBottom: 8 }}>
          {actionError}
        </Alert>
      )}

      {sessions === null && !loadFailed && <SkeletonRows count={2} height={44} />}
      {loadFailed && (
        <LoadError message="Couldn't load your sessions." onRetry={() => void load()} />
      )}

      {sessions !== null && !loadFailed && (
        <>
          <ul data-ra-security-list="" aria-busy={pending !== null || undefined}>
            {ordered.map((session) => {
              const inApp = inAppLabel(session.client);
              const location = locationLabel(session.city, session.country);
              const device = deviceLabel(session.client);
              return (
                <li
                  key={session.id}
                  data-ra-element="userSecuritySessionItem"
                  style={elements.userSecuritySessionItem}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p data-ra-security-title="">
                      <span>{device}</span>
                      {inApp && <Badge>{inApp}</Badge>}
                      {session.current && <Badge tone="primary">This device</Badge>}
                    </p>
                    <p data-ra-security-meta="">
                      {[session.appName ?? "Browser (Kova)", location].filter(Boolean).join(" · ")}
                      {" · "}
                      <Time ms={session.lastActiveAt} />
                    </p>
                  </div>
                  {!session.current && (
                    <ActionButton
                      busy={pending === session.id}
                      disabled={pending !== null}
                      label={`Sign out of ${device}`}
                      onClick={() => void revoke(session)}
                      elements={elements}
                    >
                      Sign out
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>

          {others.length === 0 ? (
            <p style={{ ...mutedTextStyle, padding: "4px 0" }}>No other sessions</p>
          ) : confirming ? (
            <div data-ra-security-footer="" role="group" aria-label="Confirm sign out">
              <p style={{ ...mutedTextStyle, color: "var(--ra-color-text-secondary)", flex: "1 1 160px" }}>
                {others.length === 1
                  ? "Sign out of 1 other session?"
                  : `Sign out of ${others.length} other sessions?`}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <ActionButton
                  buttonRef={cancelRef}
                  disabled={pending !== null}
                  onClick={() => {
                    setConfirming(false);
                    requestAnimationFrame(() => othersButtonRef.current?.focus());
                  }}
                  elements={elements}
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  destructive
                  busy={pending === "others"}
                  disabled={pending !== null}
                  onClick={() => void revokeOthers()}
                  elements={elements}
                >
                  Sign out
                </ActionButton>
              </div>
            </div>
          ) : (
            <div data-ra-security-footer="">
              <ActionButton
                buttonRef={othersButtonRef}
                destructive
                disabled={pending !== null}
                onClick={() => setConfirming(true)}
                elements={elements}
              >
                Sign out of all other sessions
              </ActionButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Recent activity ────────────────────────────────────────────────────────────

function ActivitySection({
  options,
  pageSize,
  elements,
  announce,
}: {
  options: AccountRequestOptions;
  pageSize: number;
  elements: AppearanceElements;
  announce: Announce;
}) {
  const [events, setEvents] = useState<AccountActivityEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<"initial" | "more" | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const focusIndex = useRef<number | null>(null);
  const headingId = useId();

  const loadFirst = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setEvents(null);
    try {
      const page = await getAccountActivity(options, { limit: pageSize });
      if (id !== requestId.current) return;
      setEvents(page.events);
      setCursor(page.nextCursor);
    } catch {
      if (id === requestId.current) setError("initial");
    }
  }, [options, pageSize]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!cursor || !events) return;
    const id = ++requestId.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getAccountActivity(options, { before: cursor, limit: pageSize });
      if (id !== requestId.current) return;
      focusIndex.current = events.length;
      setEvents([...events, ...page.events]);
      setCursor(page.nextCursor);
      announce(
        page.events.length === 1 ? "Loaded 1 more event." : `Loaded ${page.events.length} more events.`,
      );
    } catch {
      if (id === requestId.current) setError("more");
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  };

  // Move focus to the first new row so keyboard users continue where they were.
  useEffect(() => {
    if (focusIndex.current === null) return;
    const row = listRef.current?.children[focusIndex.current];
    focusIndex.current = null;
    if (row instanceof HTMLElement) row.focus();
  }, [events]);

  return (
    <section aria-labelledby={headingId} data-ra-security-section="">
      <h3 id={headingId} style={headingStyle}>
        Recent activity
      </h3>

      {events === null && error === null && <SkeletonRows count={3} height={36} />}
      {error === "initial" && (
        <LoadError message="Couldn't load your recent activity." onRetry={() => void loadFirst()} />
      )}

      {events !== null && events.length === 0 && (
        <p style={{ ...mutedTextStyle, padding: "4px 0" }}>No recent activity</p>
      )}

      {events !== null && events.length > 0 && (
        <ul ref={listRef} data-ra-security-list="">
          {events.map((event) => {
            const failed = isFailedActivity(event.action);
            const inApp = inAppLabel(event.client);
            const meta = [
              event.client ? deviceLabel(event.client) : null,
              inApp,
              event.appName,
              locationLabel(event.city, event.country),
            ].filter(Boolean);
            return (
              <li
                key={event.id}
                tabIndex={-1}
                data-ra-element="userSecurityActivityItem"
                data-failed={failed ? "true" : undefined}
                style={elements.userSecurityActivityItem}
              >
                <span aria-hidden="true" data-ra-security-dot="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p data-ra-security-title="">
                    <span data-ra-security-action="">{activityLabel(event.action)}</span>
                    <span data-ra-security-time="">
                      <Time ms={event.createdAt} />
                    </span>
                  </p>
                  {meta.length > 0 && <p data-ra-security-meta="">{meta.join(" · ")}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error === "more" && (
        <Alert variant="error" style={{ fontSize: "0.75rem", margin: "8px 0" }}>
          Couldn't load more activity.
        </Alert>
      )}

      {events !== null && cursor && (
        <div data-ra-security-footer="">
          <ActionButton busy={loadingMore} onClick={() => void loadMore()} elements={elements}>
            {error === "more" ? "Try again" : "Load more"}
          </ActionButton>
        </div>
      )}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UserSecurity({
  activityPageSize = 20,
  appearance: instanceAppearance,
  className,
}: UserSecurityProps) {
  const { appearance: providerAppearance, authUrl, publishableKey, sessionToken } = useKovaAuth();
  const el = mergeAppearance(providerAppearance, instanceAppearance).elements ?? {};
  const [announcement, setAnnouncement] = useState("");

  const options = useMemo<AccountRequestOptions | null>(
    () => (publishableKey && sessionToken ? { authUrl, publishableKey, sessionToken } : null),
    [authUrl, publishableKey, sessionToken],
  );

  // Clear first so the same message is announced again.
  const announce = useCallback<Announce>((message) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  return (
    <div data-ra-root data-ra-element="userSecurity" className={className} style={el.userSecurity}>
      <div role="status" aria-live="polite" style={visuallyHiddenStyle}>
        {announcement}
      </div>
      {options ? (
        <>
          <SessionsSection options={options} elements={el} announce={announce} />
          <ActivitySection
            options={options}
            pageSize={Math.min(50, Math.max(1, activityPageSize))}
            elements={el}
            announce={announce}
          />
        </>
      ) : (
        <Alert variant="info" style={{ fontSize: "0.75rem", marginBottom: 0 }}>
          Sign in to see your sessions and recent activity.
        </Alert>
      )}
    </div>
  );
}

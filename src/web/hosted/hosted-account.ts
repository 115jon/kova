/**
 * Hosted account page: who is signed in, their active sessions, and recent
 * activity. Rendered into `#root` when the shell's bootstrap has
 * `page: "account"`.
 *
 * The account API is same-origin and cookie-authenticated
 * (`accountApiBase`, default `/api/account`). A 401 from it means the
 * session is gone, so the page goes to `/sign-in`. Signing out goes through
 * Better Auth on `authUrl`, the same way the sign-in form talks to it.
 */

import { authEndpoint, busyButton, el, monogram, postAuth, setBusy, type HostedBootstrap } from "./hosted-common";
import { rgba, type HostedTheme } from "./hosted-theme";

export interface AccountClient {
  browser?: string | null;
  os?: string | null;
  platform?: string | null;
  inApp?: string | null;
}

export interface AccountSession {
  id: string;
  appName: string | null;
  current: boolean;
  createdAt: number;
  lastActiveAt: number;
  country: string | null;
  city: string | null;
  client: AccountClient | null;
}

export interface AccountEvent {
  id: string;
  action: string;
  createdAt: number;
  appName: string | null;
  country: string | null;
  city: string | null;
  client: AccountClient | null;
}

const SIGN_IN_PATH = "/sign-in";
/** Expired session: sign in again and come back here (allowed by isSafeHostedReturnPath). */
const SIGN_IN_RETURN_PATH = "/sign-in?device_return=%2Faccount";
const ACTIVITY_PAGE = 20;

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function deviceLabel(client: AccountClient | null): string {
  const browser = client?.browser || "";
  const os = client?.os || "";
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}

let regionNames: Intl.DisplayNames | null | undefined;

/** ISO-2 → "Germany". Cloudflare's XX (unknown) is dropped, T1 is Tor. */
export function countryName(code: string): string | null {
  const upper = code.toUpperCase();
  if (upper === "XX" || upper === "ZZ") return null;
  if (upper === "T1") return "Tor network";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(upper) || code;
  } catch {
    return code;
  }
}

export function locationLabel(city: string | null, country: string | null): string | null {
  const parts = [city, country ? countryName(country) : null].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

const ACTION_LABELS: Record<string, string> = {
  "user.signInFailed": "Failed sign-in",
  "user.signOut": "Signed out",
  "user.signUp": "Account created",
  "app.signIn": "Signed in to app",
  "app.signOut": "Signed out of app",
  "session.ended": "Session ended",
  "twoFactor.challengeFailed": "Failed 2FA",
  "twoFactor.enabled": "2FA turned on",
  "twoFactor.disabled": "2FA turned off",
  "user.passwordChanged": "Password changed",
  "security.signInAlertSent": "Sign-in alert sent",
  "security.signOutEverywhere": "Signed out everywhere",
};

/** "user.emailVerified" → "Email verified". */
function humanizeAction(action: string): string {
  const parts = action.split(".").filter(Boolean);
  if (parts.length > 1 && parts[0] === "user") parts.shift();
  const words = parts.join(" ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Activity";
}

export function activityLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  if (action.startsWith("user.signIn")) return "Signed in";
  return humanizeAction(action);
}

export function isFailedAction(action: string): boolean {
  return /failed/i.test(action);
}

/** Short relative time for recent moments, a date beyond a week. */
export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en", sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function timeNode(ms: number, prefix = ""): HTMLTimeElement {
  const node = el("time", { datetime: new Date(ms).toISOString(), title: absoluteTime(ms) }, `${prefix}${relativeTime(ms)}`);
  return node;
}

// ── API ───────────────────────────────────────────────────────────────────────

class AccountApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readClient(value: unknown): AccountClient | null {
  if (!isRecord(value)) return null;
  return {
    browser: stringOrNull(value.browser),
    os: stringOrNull(value.os),
    platform: stringOrNull(value.platform),
    inApp: stringOrNull(value.inApp),
  };
}

function readSession(value: unknown): AccountSession | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    appName: stringOrNull(value.appName),
    current: value.current === true,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    lastActiveAt: typeof value.lastActiveAt === "number" ? value.lastActiveAt : 0,
    country: stringOrNull(value.country),
    city: stringOrNull(value.city),
    client: readClient(value.client),
  };
}

function readEvent(value: unknown): AccountEvent | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.action !== "string") return null;
  return {
    id: value.id,
    action: value.action,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    appName: stringOrNull(value.appName),
    country: stringOrNull(value.country),
    city: stringOrNull(value.city),
    client: readClient(value.client),
  };
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

function accountApi(base: string) {
  const root = base.replace(/\/$/, "");
  const request = async (path: string, fallback: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(`${root}${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      window.location.assign(SIGN_IN_RETURN_PATH);
      throw new AccountApiError("Your session has ended.", 401);
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data)) {
      const message = isRecord(data) && typeof data.error === "string" && data.error ? data.error : fallback;
      throw new AccountApiError(message, response.status);
    }
    return data;
  };
  return {
    async sessions(): Promise<AccountSession[]> {
      const data = await request("/sessions", "Couldn't load sessions.");
      if (!Array.isArray(data.sessions)) throw new AccountApiError("Couldn't load sessions.", 200);
      return compact(data.sessions.map(readSession));
    },
    async activity(before: string | null): Promise<{ events: AccountEvent[]; nextCursor: string | null }> {
      const params = new URLSearchParams({ limit: String(ACTIVITY_PAGE) });
      if (before) params.set("before", before);
      const data = await request(`/activity?${params.toString()}`, "Couldn't load activity.");
      if (!Array.isArray(data.events)) throw new AccountApiError("Couldn't load activity.", 200);
      return { events: compact(data.events.map(readEvent)), nextCursor: stringOrNull(data.nextCursor) };
    },
    async revoke(sessionId: string): Promise<void> {
      await request("/sessions/revoke", "Couldn't sign out that session.", { sessionId });
    },
    async revokeOthers(): Promise<number | null> {
      const data = await request("/sessions/revoke-others", "Couldn't sign out the other sessions.", {});
      return typeof data.revoked === "number" ? data.revoked : null;
    },
  };
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof AccountApiError ? error.message : fallback;
}

/** A 401 already sent the page to sign-in; leave the UI as it is. */
function isSignedOut(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 401;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const BACK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M10 3.5 5.5 8l4.5 4.5"/></svg>';

function avatarNode(user: HostedBootstrap["user"]): HTMLElement {
  const initials = monogram(user?.name || user?.email || "?");
  const fallback = el("div", { class: "ac-avatar kv-monogram", "aria-hidden": "true" }, initials);
  if (!user?.image) return fallback;
  const img = el("img", { class: "ac-avatar", src: user.image, alt: "", width: "52", height: "52", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(fallback));
  return img;
}

function skeletonList(rows: number): HTMLElement {
  const list = el("div", { class: "ac-list ac-skeleton", "aria-hidden": "true" });
  for (let i = 0; i < rows; i++) {
    const row = el("div", { class: "ac-row" });
    const main = el("div", { class: "ac-row-main" });
    main.appendChild(el("span", { class: "ac-skel ac-skel-title" }));
    main.appendChild(el("span", { class: "ac-skel ac-skel-meta" }));
    row.appendChild(main);
    list.appendChild(row);
  }
  return list;
}

function stateBox(message: string, retry?: () => void): HTMLElement {
  const box = el("div", { class: `ac-list ac-state${retry ? " is-error" : ""}` });
  box.appendChild(el("p", {}, message));
  if (retry) {
    const button = el("button", { class: "ac-action", type: "button" }, "Try again");
    button.addEventListener("click", retry);
    box.appendChild(button);
  }
  return box;
}

function metaLine(parts: (string | Node | null)[]): HTMLElement {
  const meta = el("p", { class: "ac-row-meta" });
  const present = parts.filter((part): part is string | Node => part !== null && part !== "");
  present.forEach((part, index) => {
    if (index > 0) meta.appendChild(el("span", { class: "dot", "aria-hidden": "true" }, " · "));
    meta.appendChild(typeof part === "string" ? el("span", {}, part) : part);
  });
  return meta;
}

function sessionAppName(name: string | null): string {
  return name ?? "Browser (Kova)";
}

export function renderAccount(config: HostedBootstrap, root: HTMLElement): void {
  const api = accountApi(config.accountApiBase || "/api/account");
  const appName = config.app.name || "this app";
  const user = config.user;

  const shell = el("div", { class: "ac" });
  const live = el("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const announce = (message: string) => {
    live.textContent = message;
  };

  // Header ────────────────────────────────────────────────────────────────────
  if (config.app.homeUrl) {
    const back = el("a", { class: "ac-back kv-enter", href: config.app.homeUrl });
    const icon = el("span", { class: "ac-back-icon", "aria-hidden": "true" });
    icon.innerHTML = BACK_ICON;
    back.appendChild(icon);
    back.appendChild(el("span", {}, `Back to ${appName}`));
    shell.appendChild(back);
  }

  const head = el("header", { class: "ac-head kv-enter" });
  head.appendChild(avatarNode(user));
  const who = el("div", { class: "ac-who" });
  who.appendChild(el("p", { class: "ac-kicker" }, `${appName} account`));
  who.appendChild(el("h1", { class: "ac-name" }, user?.name || user?.email || "Your account"));
  if (user?.email && user.name) who.appendChild(el("p", { class: "ac-email" }, user.email));
  head.appendChild(who);
  const signOut = busyButton("kv-btn ac-btn-sm", "Sign out");
  head.appendChild(signOut);
  shell.appendChild(head);

  const signOutError = el("p", { class: "ra-error", role: "alert" });
  signOutError.hidden = true;
  shell.appendChild(signOutError);
  signOut.addEventListener("click", () => {
    signOutError.hidden = true;
    setBusy(signOut, true);
    announce("Signing out");
    void (async () => {
      try {
        const result = await postAuth(authEndpoint(config.authUrl, "/api/auth/sign-out"), {}, config.publishableKey);
        if (!result.ok && result.status !== 401) throw new Error("sign-out failed");
        window.location.assign(SIGN_IN_PATH);
      } catch {
        setBusy(signOut, false);
        signOutError.textContent = "Couldn't sign out. Try again.";
        signOutError.hidden = false;
      }
    })();
  });

  // Sessions ──────────────────────────────────────────────────────────────────
  const sessionsSection = el("section", { class: "ac-section kv-enter", "aria-labelledby": "ac-sessions-title" });
  const sessionsTitle = el("h2", { class: "ac-h2", id: "ac-sessions-title", tabindex: "-1" }, "Active sessions");
  sessionsSection.appendChild(sessionsTitle);
  const sessionsBody = el("div", { class: "ac-body" });
  sessionsSection.appendChild(sessionsBody);
  shell.appendChild(sessionsSection);

  let sessions: AccountSession[] = [];
  let sessionsError: string | null = null;
  let confirming = false;
  // Cancel returns focus to the button that opened the confirm step.
  let refocusStart = false;

  const loadSessions = () => {
    sessionsError = null;
    sessionsBody.setAttribute("aria-busy", "true");
    sessionsBody.replaceChildren(skeletonList(2));
    void api.sessions().then(
      (list) => {
        sessions = [...list].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
        sessionsBody.setAttribute("aria-busy", "false");
        drawSessions();
      },
      (error: unknown) => {
        if (isSignedOut(error)) return;
        sessionsBody.setAttribute("aria-busy", "false");
        const message = failureMessage(error, "Couldn't load sessions.");
        sessionsBody.replaceChildren(stateBox(message, loadSessions));
        announce(message);
      },
    );
  };

  const drawSessions = () => {
    const nodes: HTMLElement[] = [];
    if (sessionsError) {
      const error = el("p", { class: "ra-error ac-inline-error", role: "alert" }, sessionsError);
      nodes.push(error);
    }
    if (sessions.length === 0) {
      nodes.push(stateBox("No active sessions."));
      sessionsBody.replaceChildren(...nodes);
      return;
    }
    const list = el("ul", { class: "ac-list" });
    for (const session of sessions) list.appendChild(sessionRow(session));
    nodes.push(list);
    const others = sessions.filter((session) => !session.current);
    if (others.length > 0) nodes.push(revokeOthersFooter(others.length));
    sessionsBody.replaceChildren(...nodes);
  };

  const sessionRow = (session: AccountSession): HTMLElement => {
    const device = deviceLabel(session.client);
    const row = el("li", { class: "ac-row" });
    const main = el("div", { class: "ac-row-main" });
    const title = el("p", { class: "ac-row-title" });
    title.appendChild(el("span", {}, device));
    if (session.current) title.appendChild(el("span", { class: "ac-badge is-current" }, "This device"));
    if (session.client?.inApp) title.appendChild(el("span", { class: "ac-badge" }, `${session.client.inApp} in-app`));
    main.appendChild(title);
    const active = session.current && Date.now() - session.lastActiveAt < 60_000
      ? el("span", {}, "Active now")
      : timeNode(session.lastActiveAt, "Active ");
    main.appendChild(metaLine([sessionAppName(session.appName), locationLabel(session.city, session.country), active]));
    row.appendChild(main);

    if (!session.current) {
      const revoke = busyButton("ac-action", "Sign out", { "aria-label": `Sign out ${device}` });
      revoke.addEventListener("click", () => {
        sessionsError = null;
        setBusy(revoke, true);
        void api.revoke(session.id).then(
          () => {
            sessions = sessions.filter((item) => item.id !== session.id);
            drawSessions();
            sessionsTitle.focus();
            announce(`Signed out ${device}`);
          },
          (error: unknown) => {
            if (isSignedOut(error)) return;
            sessionsError = failureMessage(error, "Couldn't sign out that session.");
            drawSessions();
          },
        );
      });
      row.appendChild(revoke);
    }
    return row;
  };

  const revokeOthersFooter = (count: number): HTMLElement => {
    const foot = el("div", { class: "ac-foot" });
    if (!confirming) {
      const start = el("button", { class: "ac-link", type: "button" }, "Sign out of all other sessions");
      start.addEventListener("click", () => {
        confirming = true;
        drawSessions();
      });
      foot.appendChild(start);
      if (refocusStart) {
        refocusStart = false;
        setTimeout(() => start.focus(), 0);
      }
      return foot;
    }

    const box = el("div", { class: "ac-confirm", role: "group", "aria-labelledby": "ac-confirm-text" });
    const noun = count === 1 ? "1 other session" : `${count} other sessions`;
    box.appendChild(el("p", { id: "ac-confirm-text" }, `Sign out of ${noun}? This device stays signed in.`));
    const actions = el("div", { class: "ac-confirm-actions" });
    const cancel = el("button", { class: "ac-action", type: "button" }, "Cancel");
    const confirm = busyButton("ac-action is-strong", "Sign out");
    const close = () => {
      confirming = false;
      refocusStart = true;
      drawSessions();
    };
    cancel.addEventListener("click", close);
    box.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirm.disabled) close();
    });
    confirm.addEventListener("click", () => {
      sessionsError = null;
      setBusy(confirm, true);
      cancel.disabled = true;
      void api.revokeOthers().then(
        (revoked) => {
          confirming = false;
          sessions = sessions.filter((session) => session.current);
          drawSessions();
          sessionsTitle.focus();
          const n = revoked ?? count;
          announce(n === 1 ? "Signed out of 1 other session" : `Signed out of ${n} other sessions`);
        },
        (error: unknown) => {
          if (isSignedOut(error)) return;
          confirming = false;
          sessionsError = failureMessage(error, "Couldn't sign out the other sessions.");
          drawSessions();
        },
      );
    });
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    box.appendChild(actions);
    foot.appendChild(box);
    setTimeout(() => confirm.focus(), 0);
    return foot;
  };

  // Activity ──────────────────────────────────────────────────────────────────
  const activitySection = el("section", { class: "ac-section kv-enter", "aria-labelledby": "ac-activity-title" });
  activitySection.appendChild(el("h2", { class: "ac-h2", id: "ac-activity-title" }, "Recent activity"));
  const activityBody = el("div", { class: "ac-body" });
  activitySection.appendChild(activityBody);
  shell.appendChild(activitySection);

  const activityList = el("ul", { class: "ac-list" });
  const moreSlot = el("div", { class: "ac-more-slot" });
  let cursor: string | null = null;
  let moreButton: HTMLButtonElement | null = null;

  const eventRow = (event: AccountEvent): HTMLElement => {
    const failed = isFailedAction(event.action);
    const row = el("li", { class: `ac-row ac-event${failed ? " is-failed" : ""}` });
    row.appendChild(el("span", { class: "ac-dot", "aria-hidden": "true" }));
    const main = el("div", { class: "ac-row-main" });
    main.appendChild(el("p", { class: "ac-row-title" }, activityLabel(event.action)));
    main.appendChild(metaLine([
      event.appName,
      event.client ? deviceLabel(event.client) : null,
      locationLabel(event.city, event.country),
    ]));
    row.appendChild(main);
    const time = timeNode(event.createdAt);
    time.className = "ac-time";
    row.appendChild(time);
    return row;
  };

  const drawMore = (error?: string) => {
    moreButton = null;
    if (error) {
      const box = el("div", { class: "ac-more-error" });
      box.appendChild(el("p", { role: "alert" }, error));
      const retry = el("button", { class: "ac-action", type: "button" }, "Try again");
      retry.addEventListener("click", loadMore);
      box.appendChild(retry);
      moreSlot.replaceChildren(box);
      return;
    }
    if (!cursor) {
      moreSlot.replaceChildren();
      return;
    }
    moreButton = busyButton("kv-btn ac-more", "Load more");
    moreButton.addEventListener("click", loadMore);
    moreSlot.replaceChildren(moreButton);
  };

  const loadActivity = () => {
    activityBody.setAttribute("aria-busy", "true");
    activityBody.replaceChildren(skeletonList(3));
    void api.activity(null).then(
      ({ events, nextCursor }) => {
        activityBody.setAttribute("aria-busy", "false");
        cursor = nextCursor;
        if (events.length === 0) {
          activityBody.replaceChildren(stateBox("No activity yet."));
          return;
        }
        activityList.replaceChildren(...events.map(eventRow));
        drawMore();
        activityBody.replaceChildren(activityList, moreSlot);
      },
      (error: unknown) => {
        if (isSignedOut(error)) return;
        activityBody.setAttribute("aria-busy", "false");
        const message = failureMessage(error, "Couldn't load activity.");
        activityBody.replaceChildren(stateBox(message, loadActivity));
        announce(message);
      },
    );
  };

  function loadMore(): void {
    if (!moreButton) {
      moreButton = busyButton("kv-btn ac-more", "Load more");
      moreSlot.replaceChildren(moreButton);
    }
    setBusy(moreButton, true);
    activityBody.setAttribute("aria-busy", "true");
    void api.activity(cursor).then(
      ({ events, nextCursor }) => {
        activityBody.setAttribute("aria-busy", "false");
        cursor = nextCursor;
        for (const event of events) activityList.appendChild(eventRow(event));
        drawMore();
        announce(events.length === 1 ? "Loaded 1 more event" : `Loaded ${events.length} more events`);
      },
      (error: unknown) => {
        if (isSignedOut(error)) return;
        activityBody.setAttribute("aria-busy", "false");
        drawMore(failureMessage(error, "Couldn't load more activity."));
      },
    );
  }

  shell.appendChild(live);
  if (!config.hideBranding) shell.appendChild(el("p", { class: "kv-brand" }, "Secured by Kova"));
  root.appendChild(shell);

  loadSessions();
  loadActivity();
}

/** Account-only rules. Shell tokens and controls come from hostedShellCss. */
export function accountCss(theme: HostedTheme): string {
  const { primary } = theme;
  return `
    .kv-page.is-account .kv-form { align-items: flex-start; }
    .kv-page.is-account .kv-form-inner { max-width: 520px; padding-block: 12px; }
    @media (min-width: 768px) {
      .kv-page.is-account .kv-art { position: sticky; top: 0; align-self: start; height: 100vh; height: 100svh; }
    }
    .ac { display: flex; flex-direction: column; gap: 28px; color: var(--text); }
    .ac-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; min-height: 32px; margin: -6px 0 -14px;
      font-size: 13px; color: var(--muted); text-decoration-color: transparent; }
    .ac-back-icon, .ac-back-icon svg { display: inline-flex; width: 16px; height: 16px; }
    .ac-head { display: flex; align-items: center; gap: 14px; }
    .ac-avatar { display: block; width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex: none; background: var(--raised); }
    .ac-avatar.kv-monogram { font-size: 18px; }
    .ac-who { flex: 1; min-width: 0; }
    .ac-kicker { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ac-name { font-size: 22px; font-weight: 600; line-height: 1.25; letter-spacing: -0.02em; overflow-wrap: anywhere; }
    .ac-email { font-size: 14px; color: var(--secondary); overflow-wrap: anywhere; }
    .kv-btn.ac-btn-sm { width: auto; flex: none; height: 36px; padding: 0 14px; font-size: 14px; }
    .ac > .ra-error { margin: -12px 0 0; }
    .ac-h2 { margin-bottom: 10px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    .ac-h2:focus { outline: none; }
    .ac-list { list-style: none; border: 1px solid var(--line); border-radius: var(--radius); background: rgba(255,255,255,0.025); }
    .ac-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 11px 14px; }
    .ac-row + .ac-row { border-top: 1px solid var(--line); }
    .ac-row-main { flex: 1; min-width: 0; }
    .ac-row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 14px; font-weight: 500; line-height: 1.4; }
    .ac-row-meta { margin-top: 2px; font-size: 13px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
    .ac-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 12px; font-weight: 500;
      color: var(--secondary); background: var(--raised); border: 1px solid var(--line); white-space: nowrap; }
    .ac-badge.is-current { color: #fff; background: ${rgba(primary, 0.2)}; border-color: ${rgba(primary, 0.45)}; }
    .ac-action { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 12px;
      border-radius: 8px; font: inherit; font-size: 13px; font-weight: 500; color: var(--secondary); background: transparent;
      border: 1px solid var(--line); cursor: pointer; transition: border-color 160ms ease, color 160ms ease; -webkit-tap-highlight-color: transparent; }
    .ac-action.is-strong { color: #fff; background: var(--raised); border-color: var(--line-strong); }
    .ac-action:disabled { cursor: default; }
    .ac-action:disabled:not(.is-busy) { opacity: 0.5; }
    .ac-action .spinner { position: absolute; top: 50%; left: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; opacity: 0; }
    .ac-action.is-busy .label { opacity: 0; }
    .ac-action.is-busy .spinner { opacity: 1; animation: kv-spin 700ms linear infinite; }
    .ac-link { align-self: flex-end; min-height: 36px; padding: 0 2px; font: inherit; font-size: 13px; font-weight: 500; color: var(--secondary);
      background: none; border: 0; cursor: pointer; text-decoration: underline; text-decoration-color: ${rgba(primary, 0.6)}; text-underline-offset: 3px; }
    .ac-foot { display: flex; justify-content: flex-end; margin-top: 8px; }
    .ac-confirm { flex: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 14px; padding: 12px 14px;
      border-radius: var(--radius); border: 1px solid var(--line-strong); background: var(--field); font-size: 14px; color: var(--secondary); }
    .ac-confirm p { flex: 1 1 220px; }
    .ac-confirm-actions { display: flex; gap: 8px; }
    .ac-inline-error { margin: 0 0 10px; }
    .ac-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 16px; text-align: center; font-size: 14px; color: var(--muted); }
    .ac-state.is-error { color: var(--secondary); }
    .ac-skel { display: block; height: 10px; border-radius: 5px; background: var(--raised); animation: ac-pulse 1100ms ease-in-out infinite alternate; }
    .ac-skel-title { width: 46%; height: 12px; }
    .ac-skel-meta { width: 68%; margin-top: 9px; }
    .ac-skeleton .ac-row:nth-child(2) .ac-skel-title { width: 38%; }
    .ac-skeleton .ac-row:nth-child(3) .ac-skel-title { width: 52%; }
    @keyframes ac-pulse { from { opacity: 1; } to { opacity: 0.45; } }
    .ac-event { align-items: flex-start; }
    .ac-dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: ${rgba(primary, 0.75)}; }
    .ac-event.is-failed .ac-dot { background: transparent; border: 1.5px solid #ffb020; }
    .ac-event.is-failed .ac-row-title { color: #ffc46b; }
    .ac-time { flex: none; padding-top: 1px; font-size: 12.5px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .kv-btn.ac-more { margin-top: 10px; height: 40px; font-size: 14px; }
    .ac-more-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-top: 10px;
      font-size: 13px; color: var(--secondary); }
    .ac .kv-brand { margin-top: -8px; }
    @media (hover: hover) and (pointer: fine) {
      .ac-back:hover { color: var(--text); }
      .ac-action:hover:not(:disabled) { color: var(--text); border-color: var(--line-strong); }
      .ac-link:hover { color: var(--text); text-decoration-color: var(--primary); }
    }
    @media (max-width: 767px) {
      .ac { gap: 24px; }
      .ac-name { font-size: 20px; }
      .ac-avatar { width: 44px; height: 44px; }
      .ac-row { padding: 11px 12px; }
    }
    @media (max-width: 380px) {
      .ac-head { flex-wrap: wrap; }
      .kv-btn.ac-btn-sm { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ac-skel { animation: none; opacity: 0.7; }
      .ac-action.is-busy .spinner { animation: kv-pulse 1000ms ease-in-out infinite alternate; }
    }
  `;
}

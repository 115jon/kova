/**
 * Markup for the hosted /device page. Rendering only: every decision about
 * which state to show is made in hosted-device.ts and arrives as a
 * DevicePageModel. A redesign replaces this file and keeps the model.
 *
 * Client behavior (approve, deny, switch account) lives in the inline script
 * and talks to:
 *   POST /api/auth/device/approve   {userCode}   (Better Auth)
 *   POST /api/auth/device/deny      {userCode}   (Better Auth)
 *   POST /api/hosted/device/release {userCode}   (drop this account's claim)
 *   POST /api/auth/sign-out                      (Better Auth)
 * then sends the browser to model.switchAccountPath.
 *
 * Security notes:
 *   - Every model string is escaped (device and requester fields come from the
 *     device, account fields from the identity provider). Client-built
 *     outcomes use textContent only.
 *   - The page carries its own nonce CSP (<meta>), since the hosted pages have
 *     no CSP header to join. Inline style/script get the nonce; no inline
 *     event handlers or style attributes are used.
 *   - App colors are interpolated into CSS, so they are restricted to hex.
 *   - Framing is refused by response headers (X-Frame-Options, CSP
 *     frame-ancestors; see NO_FRAMING_HEADERS). As a second line, Approve/Deny
 *     refuse to run inside a frame.
 *   - Device label/hostname/platform are whatever the device sent: shown as
 *     reported by the device, never in the title, and weaker than the
 *     server-observed "Requested from" location.
 */
import { escapeHtml as esc, jsonForHtmlScript } from "../lib/html";
import { RALPH_RADIO_SVG } from "../../shared/hosted-brand";
import type { DevicePageApp, DevicePageModel } from "./hosted-device";

type ReviewModel = Extract<DevicePageModel, { state: "review" }>;
type EnterModel = Extract<DevicePageModel, { state: "enter" }>;
type TerminalState = Exclude<DevicePageModel["state"], "enter" | "review">;

type Copy = { title: string; body: string; action?: { label: string; href: string } };

const ENTER_ANOTHER = { label: "Enter a different code", href: "/device" };
// href="" reloads the current URL, code included.
const TRY_AGAIN = { label: "Try again", href: "" };

export const TERMINAL_COPY: Record<TerminalState, Copy> = {
  approved: { title: "You're signed in", body: "You can close this tab and go back to the app." },
  denied: { title: "Sign-in denied", body: "Nothing was signed in. You can close this tab." },
  expired: {
    title: "Code expired",
    body: "Codes only last a few minutes. Get a new one from your device, then enter it here.",
    action: ENTER_ANOTHER,
  },
  invalid: {
    title: "Code not recognized",
    body: "Check the code on your device and enter it again.",
    action: ENTER_ANOTHER,
  },
  used: {
    title: "Code already used",
    body: "This code was already approved or denied. Start sign-in again on your device for a new one.",
    action: ENTER_ANOTHER,
  },
  claimed: {
    title: "Code in use",
    body: "Another account is already reviewing this code. If that wasn't you, start sign-in again on your device.",
    action: ENTER_ANOTHER,
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Wait a few minutes before trying this code again.",
    action: TRY_AGAIN,
  },
  unavailable: {
    title: "Something went wrong",
    body: "We couldn't load this sign-in. It's not you. Try again in a moment.",
    action: TRY_AGAIN,
  },
};

const DEFAULT_PRIMARY = "#3b82f6";
const DEFAULT_BACKGROUND = "#0a0a0a";
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// Above this, the 5% white card no longer gives the muted text 4.5:1.
const MAX_BACKGROUND_LUMINANCE = 0.012;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Colors go into CSS: hex only, and the page is dark-only, so light backgrounds fall back. */
export function pageColors(app: DevicePageApp): { primary: string; background: string } {
  const primary = HEX_COLOR.test(app.primaryColor) ? app.primaryColor : DEFAULT_PRIMARY;
  const background = HEX_COLOR.test(app.backgroundColor) && relativeLuminance(app.backgroundColor) <= MAX_BACKGROUND_LUMINANCE
    ? app.backgroundColor
    : DEFAULT_BACKGROUND;
  return { primary, background };
}

const PLATFORM_NAMES: Record<string, string> = {
  windows: "Windows", win32: "Windows", win64: "Windows", win: "Windows",
  darwin: "macOS", macos: "macOS", mac: "macOS", osx: "macOS", "mac os": "macOS", "mac os x": "macOS",
  linux: "Linux", ios: "iOS", ipados: "iPadOS", android: "Android",
  chromeos: "ChromeOS", cros: "ChromeOS", freebsd: "FreeBSD", openbsd: "OpenBSD",
};

export function prettyPlatform(platform: string | undefined): string | undefined {
  const value = platform?.trim();
  if (!value) return undefined;
  return PLATFORM_NAMES[value.toLowerCase()] ?? value;
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

function deviceSummary(model: ReviewModel): { primary: string; hostname: string | undefined; full: string } {
  const { hostname, platform, label } = model.device;
  const main = uniqueParts([label, prettyPlatform(platform)]);
  const host = hostname?.trim() && !main.some((p) => p.toLowerCase() === hostname.trim().toLowerCase()) ? hostname.trim() : undefined;
  const all = [...main, ...(host ? [host] : [])];
  return { primary: main.join(" · ") || (host ?? ""), hostname: main.length ? host : undefined, full: all.join(" · ") };
}

/** What to call the device in "You're signed in on …". */
function deviceName(model: ReviewModel): string | undefined {
  return model.device.label?.trim() || prettyPlatform(model.device.platform) || model.device.hostname?.trim() || undefined;
}

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1
    ? [words[0]!, words[words.length - 1]!].map((w) => Array.from(w)[0] ?? "")
    : [Array.from(words[0] ?? email.trim())[0] ?? "?"];
  return letters.join("").toUpperCase();
}

/** "ABCD-EFGH" → "A B C D, E F G H" for screen readers. */
export function spelledCode(code: string): string {
  return code.split("-").map((half) => Array.from(half).join(" ")).join(", ");
}

function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function logo(app: DevicePageApp): string {
  // Same order as the hosted sign-in page: logo, then the built-in brand mark.
  if (!app.logoUrl && app.brandMark === "ralph-radio") return `<span class="logo mark" aria-hidden="true">${RALPH_RADIO_SVG}</span>`;
  const src = app.logoUrl ?? app.faviconUrl;
  if (src) return `<img class="logo" src="${esc(src)}" alt="" width="48" height="48" decoding="async" referrerpolicy="no-referrer" />`;
  return `<span class="logo monogram" aria-hidden="true">${esc(initials(app.name, app.name))}</span>`;
}

const CHECK_ICON = `<svg class="check" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" pathLength="1" />
      <path d="M15 24.5l6 6 12-13" pathLength="1" />
    </svg>`;

function actionLink(action: Copy["action"]): string {
  if (!action) return "";
  return `<a class="btn secondary" href="${esc(action.href)}">${esc(action.label)}</a>`;
}

// ── States ─────────────────────────────────────────────────────────────────────

function enterBody(model: EnterModel): string {
  const hasError = model.error === "invalid_format";
  return `<div class="stage">
    ${logo(model.app)}
    <h1 id="title">Connect a device</h1>
    <p class="sub">Enter the code shown on your device to sign in to ${esc(model.app.name)}.</p>
    <form class="enter" method="get" action="/device" novalidate>
      <label for="device-code" class="sr-only">Device code</label>
      <input id="device-code" class="code-input" name="code" type="text" value="${esc(model.code ?? "")}" placeholder="XXXX-XXXX"
        autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text"
        maxlength="24" required autofocus aria-describedby="code-error"${hasError ? ` aria-invalid="true"` : ""} />
      <p class="error" id="code-error" role="alert">${hasError ? "Codes are 8 letters and numbers, like ABCD-EFGH. Check the code and try again." : ""}</p>
      <button type="submit" class="btn primary" id="continue"><span class="label">Continue</span><span class="spinner" aria-hidden="true"></span></button>
    </form>
  </div>`;
}

/** Shared by the enter form; exported so tests can run the exact source. */
export const FORMAT_CODE_SOURCE = `function formatCode(raw) {
  var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var out = "";
  var upper = String(raw).toUpperCase();
  for (var i = 0; i < upper.length && out.length < 8; i++) {
    if (alphabet.indexOf(upper[i]) !== -1) out += upper[i];
  }
  return out.length > 4 ? out.slice(0, 4) + "-" + out.slice(4) : out;
}`;

function enterScript(): string {
  return `(function () {
  ${FORMAT_CODE_SOURCE}
  var form = document.querySelector("form.enter");
  var input = document.getElementById("device-code");
  var error = document.getElementById("code-error");
  var submit = document.getElementById("continue");
  if (!form || !input || !error || !submit) return;
  var valid = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;
  function apply() {
    var before = input.value;
    var caret = input.selectionStart == null ? before.length : input.selectionStart;
    var kept = 0;
    for (var i = 0; i < caret; i++) if (valid.test(before[i].toUpperCase())) kept++;
    var next = formatCode(before);
    if (next !== before) {
      input.value = next;
      var pos = kept > 4 ? kept + 1 : kept;
      if (pos > next.length) pos = next.length;
      try { input.setSelectionRange(pos, pos); } catch (e) {}
    }
  }
  input.addEventListener("input", function () {
    apply();
    if (input.getAttribute("aria-invalid")) { input.removeAttribute("aria-invalid"); error.textContent = ""; }
  });
  form.addEventListener("submit", function (event) {
    input.value = formatCode(input.value);
    if (input.value.length !== 9) {
      event.preventDefault();
      input.setAttribute("aria-invalid", "true");
      error.textContent = input.value ? "That code is too short. Codes are 8 letters and numbers, like ABCD-EFGH." : "Enter the code shown on your device.";
      input.focus();
      return;
    }
    submit.setAttribute("aria-busy", "true");
    submit.classList.add("is-busy");
  });
  // Coming back via the back/forward cache: clear the busy state.
  window.addEventListener("pageshow", function () { submit.removeAttribute("aria-busy"); submit.classList.remove("is-busy"); });
})();`;
}

function reviewBody(model: ReviewModel): string {
  const app = esc(model.app.name);
  const device = deviceSummary(model);
  const { city, country, ip } = model.requester;
  const place = uniqueParts([city, country]).join(", ");
  const requesterIp = ip?.trim();
  const { name, email, image } = model.account;
  const displayName = name.trim() || email;

  const deviceRow = device.primary
    ? `<div class="row"><dt>Device</dt><dd class="reported">${esc(device.primary)}${device.hostname ? `<span class="muted">${esc(device.hostname)}</span>` : ""}<span class="caption">Reported by the device</span></dd></div>`
    : "";
  const requesterRow = place || requesterIp
    ? `<div class="row"><dt>Requested from</dt><dd>${esc(place || requesterIp)}${place && requesterIp ? `<span class="muted">${esc(requesterIp)}</span>` : ""}</dd></div>`
    : "";

  return `<div class="stage" id="stage">
    ${logo(model.app)}
    <h1 id="title" tabindex="-1">Sign in to ${app}?</h1>
    <p class="sub">Make sure this matches the code on your device.</p>
    <p class="code"><span aria-hidden="true">${esc(model.userCode)}</span><span class="sr-only">Code: ${esc(spelledCode(model.userCode))}</span></p>
    ${deviceRow || requesterRow ? `<dl class="details">${deviceRow}${requesterRow}</dl>` : ""}
    <div class="account">
      <span class="avatar" aria-hidden="true">${esc(initials(name, email))}${image ? `<img src="${esc(image)}" alt="" width="36" height="36" decoding="async" referrerpolicy="no-referrer" />` : ""}</span>
      <span class="who"><span class="name">${esc(displayName)}</span>${name.trim() ? `<span class="email">${esc(email)}</span>` : ""}</span>
      <button type="button" class="link" id="switch-account">Not you?<span class="sr-only"> Use another account</span></button>
    </div>
    <div class="actions">
      <button type="button" class="btn primary" id="approve-device"><span class="label">Approve</span><span class="spinner" aria-hidden="true"></span></button>
      <button type="button" class="btn secondary" id="deny-device"><span class="label">Deny</span><span class="spinner" aria-hidden="true"></span></button>
    </div>
    <noscript><p class="error">Turn on JavaScript to approve or deny this sign-in.</p></noscript>
    <p class="error" id="device-error" role="alert"></p>
    <p class="safety">Only approve if you started this sign-in yourself.</p>
  </div>`;
}

function reviewScript(model: ReviewModel): string {
  const name = deviceName(model);
  const cfg = jsonForHtmlScript({
    userCode: model.userCode,
    switchAccountPath: model.switchAccountPath,
    copy: {
      approved: {
        title: name ? `You're signed in on ${name}` : TERMINAL_COPY.approved.title,
        body: `You can close this tab and go back to ${model.app.name}.`,
      },
      denied: TERMINAL_COPY.denied,
      expired: TERMINAL_COPY.expired,
      used: TERMINAL_COPY.used,
      claimed: TERMINAL_COPY.claimed,
    },
  });
  return `(function () {
  var cfg = ${cfg};
  var stage = document.getElementById("stage");
  var status = document.getElementById("device-status");
  var errorEl = document.getElementById("device-error");
  var approve = document.getElementById("approve-device");
  var deny = document.getElementById("deny-device");
  var other = document.getElementById("switch-account");
  if (!stage || !status || !errorEl || !approve || !deny || !other) return;
  if (window.top !== window.self) {
    errorEl.textContent = "For your safety, open this page in its own tab to approve or deny.";
    approve.setAttribute("aria-disabled", "true");
    deny.setAttribute("aria-disabled", "true");
    return;
  }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var inflight = false;
  var controls = [approve, deny, other];

  function lock(on, active) {
    inflight = on;
    controls.forEach(function (b) {
      if (on) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    });
    if (active) {
      if (on) { active.setAttribute("aria-busy", "true"); active.classList.add("is-busy"); }
      else { active.removeAttribute("aria-busy"); active.classList.remove("is-busy"); }
    }
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function outcome(kind, copy) {
    var next = el("div", "stage is-entering");
    if (kind === "approved") {
      var icon = document.createElement("template");
      icon.innerHTML = ${jsonForHtmlScript(CHECK_ICON)};
      next.appendChild(icon.content);
    }
    var title = el("h1", null, copy.title);
    title.id = "title";
    title.tabIndex = -1;
    next.appendChild(title);
    next.appendChild(el("p", "sub", copy.body));
    if (copy.action) {
      var link = el("a", "btn secondary", copy.action.label);
      link.href = copy.action.href;
      next.appendChild(link);
    }
    return next;
  }

  function finish(kind, copy) {
    var current = document.getElementById("stage");
    var swap = function () {
      var next = outcome(kind, copy);
      next.id = "stage";
      current.replaceWith(next);
      status.textContent = copy.title + ". " + copy.body;
      next.querySelector("h1").focus({ preventScroll: true });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { next.classList.remove("is-entering"); });
      });
    };
    current.classList.add("is-leaving");
    setTimeout(swap, reduce ? 120 : 140);
  }

  async function decide(action, button) {
    if (inflight) return;
    lock(true, button);
    errorEl.textContent = "";
    try {
      var response = await post("/api/auth/device/" + action, { userCode: cfg.userCode });
      var data = await response.json().catch(function () { return {}; });
      if (response.ok) return finish(action === "approve" ? "approved" : "denied", action === "approve" ? cfg.copy.approved : cfg.copy.denied);
      if (data.error === "expired_token") return finish("expired", cfg.copy.expired);
      if (data.error === "access_denied") return finish("claimed", cfg.copy.claimed);
      if (response.status === 400) return finish("used", cfg.copy.used);
      if (response.status === 401) errorEl.textContent = "Your session ended. Reload the page to sign in again.";
      else errorEl.textContent = "That didn't go through. Try again.";
    } catch (e) {
      errorEl.textContent = "Couldn't reach the server. Check your connection and try again.";
    }
    lock(false, button);
  }

  approve.addEventListener("click", function () { decide("approve", approve); });
  deny.addEventListener("click", function () { decide("deny", deny); });
  other.addEventListener("click", async function () {
    if (inflight) return;
    lock(true, null);
    await post("/api/hosted/device/release", { userCode: cfg.userCode }).catch(function () {});
    await post("/api/auth/sign-out").catch(function () {});
    window.location.assign(cfg.switchAccountPath);
  });
  var avatar = document.querySelector(".avatar img");
  if (avatar) {
    var drop = function () { avatar.remove(); };
    if (avatar.complete && avatar.naturalWidth === 0) drop(); else avatar.addEventListener("error", drop);
  }
})();`;
}

/** "a minute" / "3 minutes", rounded up; undefined when unknown. */
export function waitPhrase(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}

function terminalCopy(model: DevicePageModel & { state: TerminalState }): Copy {
  const copy = TERMINAL_COPY[model.state] ?? TERMINAL_COPY.unavailable;
  if (model.state === "rate_limited") {
    const wait = waitPhrase(model.retryAfterSeconds);
    if (wait) return { ...copy, body: `Wait ${wait} before trying this code again.` };
  }
  return copy;
}

function terminalBody(model: DevicePageModel & { state: TerminalState }): string {
  const copy = terminalCopy(model);
  const icon = model.state === "approved" ? CHECK_ICON : logo(model.app);
  return `<div class="stage">
    ${icon}
    <h1 id="title">${esc(copy.title)}</h1>
    <p class="sub">${esc(copy.body)}</p>
    ${actionLink(copy.action)}
  </div>`;
}

// ── Shell ──────────────────────────────────────────────────────────────────────

function styles(primary: string, background: string): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --primary: ${primary}; --bg: ${background}; --text: #ffffff; --secondary: #b8b8b8; --muted: #959b9b;
      --ease-out: cubic-bezier(0.23, 1, 0.32, 1); color-scheme: dark; }
    html { -webkit-text-size-adjust: 100%; }
    body { min-height: 100vh; min-height: 100svh; display: flex; align-items: center; justify-content: center;
      background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased;
      font-family: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5;
      padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    main { width: 100%; max-width: 400px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); border-radius: 20px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.35); padding: 32px 28px 24px; text-align: center;
      animation: card-in 260ms var(--ease-out) both; }
    @keyframes card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .stage { transition: opacity 200ms ease-out, filter 200ms ease-out; }
    .stage.is-entering { opacity: 0; }
    .stage.is-leaving { opacity: 0; filter: blur(2px); transition-duration: 140ms; }

    .logo { display: block; width: auto; height: 48px; max-width: 160px; max-height: 48px; object-fit: contain;
      margin: 0 auto 16px; border-radius: 12px; }
    .monogram { width: 48px; display: grid; place-items: center; background: var(--primary); color: #fff;
      font-weight: 600; font-size: 18px; letter-spacing: 0.02em; }
    h1 { font-size: 20px; font-weight: 600; line-height: 1.25; letter-spacing: -0.015em; text-wrap: balance; overflow-wrap: anywhere; }
    h1:focus { outline: none; }
    .sub { margin-top: 6px; color: var(--secondary); text-wrap: pretty; overflow-wrap: anywhere; }

    .code { margin: 20px 0 4px; padding: 14px 12px; border-radius: 12px; background: rgba(0,0,0,0.25);
      border: 1px solid rgba(255,255,255,0.10); font-family: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
      font-weight: 500; font-size: 30px; line-height: 1.2; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }

    .details { margin-top: 16px; text-align: left; font-size: 14px; }
    .row { display: grid; grid-template-columns: 112px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .row:last-child { border-bottom: 1px solid rgba(255,255,255,0.08); }
    dt { color: var(--muted); }
    dd { color: var(--text); min-width: 0; overflow-wrap: anywhere; }
    dd .muted { display: block; color: var(--muted); font-size: 13px; }
    dd.reported { color: var(--secondary); }
    dd .caption { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-style: italic; }
    .mark { width: 48px; display: grid; place-items: center; color: var(--primary); }
    .mark svg { width: 32px; height: 32px; }
    .brand { margin-top: 20px; text-align: center; font-size: 12px; color: #8a9090; }

    .account { margin-top: 16px; display: flex; align-items: center; gap: 12px; text-align: left; padding: 10px 12px;
      border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .avatar { position: relative; flex: none; width: 36px; height: 36px; border-radius: 50%; overflow: hidden;
      display: grid; place-items: center; background: rgba(255,255,255,0.10); color: var(--text); font-size: 13px; font-weight: 600; }
    .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.35; }
    .name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .email { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .link { flex: none; min-height: 44px; padding: 0 4px; margin-right: -4px; border: 0; background: none; font: inherit;
      font-size: 14px; color: var(--secondary); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; border-radius: 8px; }

    .actions { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; }
    .btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 44px;
      padding: 0 16px; border-radius: 12px; font: inherit; font-size: 15px; font-weight: 500; text-decoration: none;
      color: #fff; cursor: pointer; overflow: hidden; -webkit-tap-highlight-color: transparent;
      transition: transform 160ms ease-out; }
    .btn::after { content: ""; position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none;
      transition: opacity 160ms ease-out; }
    .btn:active:not([aria-disabled="true"]) { transform: scale(0.97); }
    .btn.primary { background: var(--primary); border: 0; font-weight: 600; }
    .btn.secondary { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.10); }
    a.btn { margin-top: 20px; }
    .btn[aria-disabled="true"] { cursor: default; }
    .btn[aria-disabled="true"]:not(.is-busy) { opacity: 0.5; }
    .btn .spinner { position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
      border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; opacity: 0; }
    .btn.is-busy .label { opacity: 0; }
    .btn.is-busy .spinner { opacity: 1; animation: spin 700ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .btn:focus-visible, .link:focus-visible, .code-input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    form.enter { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; }
    .code-input { width: 100%; height: 44px; padding: 0 12px; border-radius: 12px; background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10); color: var(--text); text-align: center; text-transform: uppercase;
      font-family: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace; font-weight: 500; font-size: 20px;
      letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
    .code-input::placeholder { color: var(--muted); letter-spacing: 0.12em; }
    .code-input:focus { outline: none; border-color: var(--primary); }
    .code-input[aria-invalid="true"] { border-color: rgba(255,107,107,0.6); }
    .error { color: #ff9b9b; font-size: 14px; text-align: left; }
    .error:empty { display: none; }
    .actions + noscript .error, .actions ~ .error { margin-top: 12px; }
    .safety { margin-top: 16px; color: var(--muted); font-size: 13px; text-wrap: pretty; }

    .check { display: block; margin: 0 auto 16px; fill: none; stroke: var(--primary); stroke-width: 2.5;
      stroke-linecap: round; stroke-linejoin: round; }
    .check circle { stroke: rgba(255,255,255,0.14); stroke-width: 2; }
    .check path { stroke-dasharray: 1; stroke-dashoffset: 0; animation: draw 300ms var(--ease-out) 120ms both; }
    @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

    @media (hover: hover) and (pointer: fine) {
      .btn:hover:not([aria-disabled="true"])::after { opacity: 0.08; }
      .link:hover { color: var(--text); }
    }
    @media (max-width: 479px) {
      .card { padding: 28px 20px 20px; }
      .row { grid-template-columns: 1fr; gap: 2px; }
    }
    @media (max-width: 359px) {
      .code { font-size: 26px; letter-spacing: 0.06em; }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes card-in { from { opacity: 0; } to { opacity: 1; } }
      .stage.is-leaving { filter: none; }
      .btn, .btn:active:not([aria-disabled="true"]) { transform: none; transition: none; }
      .check path { animation: none; }
      .btn.is-busy .spinner { animation: pulse 1000ms ease-in-out infinite alternate; }
      @keyframes pulse { from { opacity: 1; } to { opacity: 0.4; } }
    }
  `;
}

function documentTitle(model: DevicePageModel): string {
  // The device's own text stays out of the title (tab strip, history).
  if (model.state === "review") return `Sign in to ${model.app.name}?`;
  if (model.state === "enter") return `Connect a device · ${model.app.name}`;
  return `${(TERMINAL_COPY[model.state] ?? TERMINAL_COPY.unavailable).title} · ${model.app.name}`;
}

function shell(model: DevicePageModel, body: string, script: string | null): string {
  const { app } = model;
  const { primary, background } = pageColors(app);
  const nonce = makeNonce();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data:",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
  <meta name="theme-color" content="${background}" />
  <title>${esc(documentTitle(model))}</title>
  ${app.faviconUrl ? `<link rel="icon" href="${esc(app.faviconUrl)}" />` : ""}
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" nonce="${nonce}" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@500&amp;display=swap" />
  <style nonce="${nonce}">${styles(primary, background)}</style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="title">
    ${body}
    ${app.hideBranding ? "" : `<p class="brand">Secured by Kova</p>`}
    </section>
    <p class="sr-only" id="device-status" role="status" aria-live="polite"></p>
  </main>
  ${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

export function renderDevicePage(model: DevicePageModel): string {
  if (model.state === "enter") return shell(model, enterBody(model), enterScript());
  if (model.state === "review") return shell(model, reviewBody(model), reviewScript(model));
  return shell(model, terminalBody(model), null);
}

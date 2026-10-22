/**
 * Standalone hosted sign-in client.
 *
 * Loaded by the HTML shell in `src/worker/routes/hosted-auth.ts` as
 * `/assets/hosted-auth.js`. The shell already wrote
 * `window.__KOVA_AUTH_HOSTED__`; this module only renders into `#root`
 * and talks to the same Better Auth endpoints the dashboard uses.
 *
 * Email/password hits the subdomain (`authUrl`) so the session cookie is
 * host-scoped. Google starts on `mainAuthUrl` with the pre-signed `oauthCtx`,
 * because provider callbacks are registered only on the platform host.
 * A successful password sign-in asks the subdomain for a one-time ticket and
 * redirects to `redirectUri?code=&state=`. Google's ticket is minted later by
 * `/oauth-complete` — this file never signs or rewrites `oauthCtx`.
 *
 * Device-code sign-in sets `returnPath` to a same-origin `/device?code=` URL.
 * That path is assigned after the password session exists. It never mints a
 * ticket and never follows an external redirect.
 */

import type { HostedAppearance, HostedProvider } from "../../shared/hosted-brand";
import { HOSTED_PROVIDERS, PROVIDER_LABELS } from "../../shared/hosted-brand";
import { artPanelHtml, hostedShellCss, hostedTheme, type HostedTheme } from "./hosted-theme";

interface HostedAppInfo {
  id: string;
  name: string;
  homeUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

interface HostedBootstrap {
  publishableKey: string;
  authUrl: string;
  mainAuthUrl: string;
  redirectUri: string;
  state: string;
  mode: "live" | "test";
  page: "sign-in" | "sign-up";
  appearance: HostedAppearance;
  app: HostedAppInfo;
  hideBranding: boolean;
  oauthCtx: string;
  returnPath?: string;
  enabledProviders?: string[];
}

interface AuthErrorBody {
  message?: string;
  code?: string;
}

const BOOTSTRAP_KEY = "__KOVA_AUTH_HOSTED__";
const DEVICE_RETURN_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/** Same-origin /device return only. Keep this aligned with worker lib/device-code.ts. */
export function isSafeDeviceReturnPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!/^\/device\?code=[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(path)) return false;
  if (path.length > 80) return false;
  if (path.includes("\\") || path.includes("//") || path.includes("@")) return false;
  let url: URL;
  try {
    url = new URL(path, "https://device.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "https://device.invalid") return false;
  if (url.pathname !== "/device") return false;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "code") return false;
  const code = url.searchParams.get("code");
  return code !== null && DEVICE_RETURN_CODE.test(code);
}

function readBootstrap(): HostedBootstrap | null {
  const raw = (window as unknown as Record<string, unknown>)[BOOTSTRAP_KEY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<HostedBootstrap>;
  if (
    typeof value.publishableKey !== "string"
    || typeof value.authUrl !== "string"
    || typeof value.mainAuthUrl !== "string"
    || typeof value.page !== "string"
    || typeof value.oauthCtx !== "string"
    || !value.appearance
    || !value.app
  ) {
    return null;
  }
  const config = value as HostedBootstrap;
  if (!Array.isArray(value.enabledProviders) || value.enabledProviders.some(provider => typeof provider !== "string")) {
    config.enabledProviders = [];
  }
  if (!isSafeDeviceReturnPath(value.returnPath)) config.returnPath = undefined;
  return config;
}

function authEndpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

async function postAuth(
  url: string,
  body: Record<string, unknown>,
  publishableKey: string,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-publishable-key": publishableKey,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  const nested = data.error;
  if (nested && typeof nested === "object") {
    const message = (nested as AuthErrorBody).message;
    if (typeof message === "string" && message) return message;
  }
  if (typeof data.message === "string" && data.message) return data.message;
  return fallback;
}

function needsTwoFactor(status: number, data: Record<string, unknown>): boolean {
  if (data.twoFactorRedirect === true) return true;
  const nested = data.error;
  if (nested && typeof nested === "object") {
    const body = nested as AuthErrorBody;
    if (body.code === "TWO_FACTOR_REQUIRED") return true;
  }
  if (data.code === "TWO_FACTOR_REQUIRED") return true;
  return status === 403 && data.twoFactorRedirect !== false && typeof data.message !== "string";
}

/** Google must start on the platform host. oauthCtx is appended, never rewritten. */
export function googleCallbackUrl(config: HostedBootstrap): string {
  const url = new URL("/api/hosted/oauth-complete", config.mainAuthUrl);
  url.searchParams.set("ctx", config.oauthCtx);
  return url.toString();
}

export function finishRedirectUrl(
  config: Pick<HostedBootstrap, "redirectUri" | "state">,
  code: string,
  kovaAuthCode?: unknown,
): string {
  const dest = new URL(config.redirectUri);
  dest.searchParams.set("code", code);
  // Match the Google SDK bounce: native clients also get kova_auth_code.
  // HTTP(S) ticket hops do not, because create-ticket only echoes `code`.
  if (typeof kovaAuthCode === "string" && kovaAuthCode) {
    dest.searchParams.set("kova_auth_code", kovaAuthCode);
  }
  if (config.state) dest.searchParams.set("state", config.state);
  return dest.toString();
}

function finishRedirect(config: HostedBootstrap, code: string, kovaAuthCode?: unknown): void {
  window.location.assign(finishRedirectUrl(config, code, kovaAuthCode));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

/** Brand marks, 24-unit viewBox. Mono marks use currentColor; the rest keep their brand colours. */
export const PROVIDER_ICONS: Record<HostedProvider, string> = {
  google: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#5865F2" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  microsoft: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>',
};

/** First letter of the first and last word, upper-cased. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const picks = words.length > 1 ? [words[0]!, words[words.length - 1]!] : [words[0]!];
  return picks.map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();
}

/** Keep every provider the server enabled, in HOSTED_PROVIDERS order. */
export function orderedProviders(enabled: readonly string[] | undefined): HostedProvider[] {
  const set = new Set(enabled ?? []);
  return HOSTED_PROVIDERS.filter((provider) => set.has(provider));
}

function logoNode(config: HostedBootstrap): HTMLElement {
  if (config.appearance.logoUrl) {
    return el("img", { class: "kv-logo", src: config.appearance.logoUrl, alt: "", width: "44", height: "44", decoding: "async", referrerpolicy: "no-referrer" });
  }
  return el("div", { class: "kv-logo kv-monogram", "aria-hidden": "true" }, monogram(config.app.name || "?"));
}

function render(config: HostedBootstrap): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();

  const theme = hostedTheme(config.appearance.primaryColor, config.appearance.backgroundColor);
  const isSignUp = config.page === "sign-up";
  const appName = config.app.name || "this app";
  const deviceReturn = isSafeDeviceReturnPath(config.returnPath);

  // The shell may already carry the split page; only build it when loaded bare.
  const column = root.closest(".kv-form-inner") ?? root;
  const page = column.closest(".kv-page");
  if (!page) {
    const built = el("div", { class: "kv-page" });
    built.innerHTML = artPanelHtml(theme, appName);
    const form = el("main", { class: "kv-form" });
    const inner = el("div", { class: "kv-form-inner" });
    root.replaceWith(built);
    inner.appendChild(root);
    form.appendChild(inner);
    built.appendChild(form);
  }

  const card = el("div", { class: "ra-card" });

  // Header: logo, test-mode chip, title, context line.
  const head = el("header", { class: "ra-head kv-enter" });
  const row = el("div", { class: "ra-head-row" });
  row.appendChild(logoNode(config));
  if (config.mode === "test") {
    row.appendChild(el("span", { class: "ra-test" }, "Test mode"));
  }
  head.appendChild(row);
  head.appendChild(el("h1", { class: "ra-title" }, isSignUp ? "Create your account" : "Sign in"));
  head.appendChild(el("p", { class: "ra-sub" }, deviceReturn ? `to connect a device to ${appName}` : `to continue to ${appName}`));
  card.appendChild(head);

  const error = el("p", { class: "ra-error", role: "alert" });
  error.hidden = true;
  card.appendChild(error);
  const showError = (message: string) => {
    error.hidden = false;
    error.textContent = message;
  };
  const clearError = () => {
    error.hidden = true;
    error.textContent = "";
  };

  const providers = orderedProviders(config.enabledProviders);
  if (providers.length > 0) {
    const grid = el("div", { class: `ra-providers kv-enter${providers.length >= 3 ? " is-grid" : ""}` });
    for (const provider of providers) {
      const label = PROVIDER_LABELS[provider];
      const button = el("button", { class: "kv-btn ra-provider", type: "button", "aria-label": `Continue with ${label}` });
      const icon = el("span", { class: "ra-provider-icon", "aria-hidden": "true" });
      icon.innerHTML = PROVIDER_ICONS[provider];
      button.appendChild(icon);
      button.appendChild(el("span", { class: "ra-provider-label" }, providers.length >= 3 ? label : `Continue with ${label}`));
      button.addEventListener("click", () => startOAuth(config, provider));
      grid.appendChild(button);
    }
    card.appendChild(grid);
    card.appendChild(el("div", { class: "ra-or kv-enter", "aria-hidden": "true" }, "or"));
  }

  const form = el("form", { class: "ra-form kv-enter" });
  const email = el("input", {
    class: "kv-input",
    type: "email",
    name: "email",
    autocomplete: "email",
    required: "true",
    placeholder: "you@example.com",
    spellcheck: "false",
  });
  email.id = "ra-email";
  const password = el("input", {
    class: "kv-input",
    type: "password",
    name: "password",
    autocomplete: isSignUp ? "new-password" : "current-password",
    required: "true",
    minlength: "8",
    placeholder: isSignUp ? "At least 8 characters" : "",
  });
  const name = el("input", {
    class: "kv-input",
    type: "text",
    name: "name",
    autocomplete: "name",
    required: "true",
  });

  // Each label sits directly above its own input. Name exists only on sign-up.
  const field = (input: HTMLInputElement, label: string, aside?: HTMLElement) => {
    if (!input.id) input.id = `ra-${input.name}`;
    const wrapper = el("div", { class: "ra-field" });
    const labelRow = el("div", { class: "ra-label-row" });
    labelRow.appendChild(el("label", { class: "ra-label", for: input.id }, label));
    if (aside) labelRow.appendChild(aside);
    wrapper.appendChild(labelRow);
    wrapper.appendChild(input);
    return wrapper;
  };

  const submit = el("button", { class: "kv-btn kv-btn-primary ra-submit", type: "submit" }, isSignUp ? "Create account" : "Continue");

  if (isSignUp) form.appendChild(field(name, "Name"));
  form.appendChild(field(email, "Email"));
  const forgot = isSignUp
    ? undefined
    : el("a", { class: "ra-forgot", href: `${config.mainAuthUrl}/reset-password?pk=${encodeURIComponent(config.publishableKey)}` }, "Forgot password?");
  form.appendChild(field(password, "Password", forgot));
  form.appendChild(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPassword(config, {
      email: email.value.trim(),
      password: password.value,
      name: name.value.trim(),
      submit,
      showError,
      clearError,
    });
  });
  card.appendChild(form);

  const footer = el("footer", { class: "ra-foot kv-enter" });
  const toggle = el("p", { class: "ra-toggle" });
  toggle.appendChild(el("span", {}, isSignUp ? "Already have an account? " : "New here? "));
  const link = document.createElement("a");
  const other = isSignUp ? "/sign-in" : "/sign-up";
  const params = new URLSearchParams();
  if (deviceReturn) {
    params.set("device_return", config.returnPath ?? "");
  } else {
    if (config.redirectUri) params.set("redirect_uri", config.redirectUri);
    if (config.state) params.set("state", config.state);
  }
  const query = params.toString();
  link.href = query ? `${other}?${query}` : other;
  link.textContent = isSignUp ? "Sign in" : "Create an account";
  toggle.appendChild(link);
  footer.appendChild(toggle);

  const legal: HTMLElement[] = [];
  if (!config.hideBranding) legal.push(el("span", {}, "Secured by Kova"));
  if (config.app.termsUrl) legal.push(el("a", { href: config.app.termsUrl }, "Terms"));
  if (config.app.privacyUrl) legal.push(el("a", { href: config.app.privacyUrl }, "Privacy"));
  if (legal.length > 0) {
    const brand = el("p", { class: "kv-brand" });
    legal.forEach((node, index) => {
      if (index > 0) brand.appendChild(el("span", { class: "dot", "aria-hidden": "true" }, "·"));
      brand.appendChild(node);
    });
    footer.appendChild(brand);
  }
  card.appendChild(footer);

  root.appendChild(card);
  injectStyles(theme, !page);
}

function injectStyles(theme: HostedTheme, includeShell: boolean): void {
  if (document.getElementById("ra-hosted-styles")) return;
  const style = document.createElement("style");
  style.id = "ra-hosted-styles";
  style.textContent = `${includeShell ? hostedShellCss(theme) : ""}
    .ra-card { color: var(--text); }
    .ra-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
    .ra-test { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 500;
      color: #ffc46b; background: rgba(255,176,32,0.12); border: 1px solid rgba(255,176,32,0.28); letter-spacing: 0.01em; }
    .ra-test::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #ffb020; }
    .ra-title { font-size: 24px; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; color: var(--text); text-wrap: balance; }
    .ra-sub { margin-top: 4px; color: var(--secondary); font-size: 15px; text-wrap: pretty; overflow-wrap: anywhere; }
    .ra-error { margin: 16px 0 0; padding: 11px 13px; border-radius: var(--radius); color: #ffd0d0; font-size: 14px; line-height: 1.45;
      background: rgba(255,107,107,0.1); border: 1px solid rgba(255,107,107,0.28); }
    .ra-error[hidden] { display: none; }
    .ra-providers { margin-top: 22px; display: grid; gap: 8px; }
    .ra-providers.is-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ra-provider-icon { display: inline-flex; width: 18px; height: 18px; flex: none; }
    .ra-provider-icon svg { width: 18px; height: 18px; }
    .ra-provider-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ra-or { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--muted); font-size: 13px; }
    .ra-or::before, .ra-or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
    .ra-form { display: flex; flex-direction: column; gap: 14px; margin-top: 22px; }
    .ra-providers + .ra-or + .ra-form, .ra-or + .ra-form { margin-top: 0; }
    .ra-field { display: flex; flex-direction: column; gap: 6px; }
    .ra-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .ra-label { color: var(--secondary); font-size: 13px; font-weight: 500; }
    .ra-forgot { font-size: 13px; color: var(--muted); text-decoration-color: transparent; }
    .ra-submit { margin-top: 4px; }
    .ra-foot { margin-top: 22px; }
    .ra-toggle { text-align: center; font-size: 14px; color: var(--muted); }
    .ra-toggle a { color: var(--secondary); font-weight: 500; }
    @media (hover: hover) and (pointer: fine) {
      .ra-forgot:hover { color: var(--text); text-decoration-color: var(--primary); }
    }
    @media (max-width: 767px) {
      .ra-head-row { margin-bottom: 14px; }
      .ra-title { font-size: 22px; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Hand off to a same-origin page on the platform host, which starts Google.
 *
 * The OAuth state cookie has to be set on `mainAuthUrl`: that is where
 * Google's callback lands (`/api/auth/callback/google`). Posting to it
 * cross-origin from the app subdomain stores the cookie on the subdomain
 * instead, and the callback fails with `state_mismatch`. A top-level
 * navigation makes the start request same-origin, matching the SDK's
 * `/oauth/start` bootstrap.
 */
function startOAuth(config: HostedBootstrap, provider: string): void {
  const url = new URL("/api/hosted/oauth-start", config.mainAuthUrl);
  url.searchParams.set("pk", config.publishableKey);
  url.searchParams.set("provider", provider);
  url.searchParams.set("ctx", config.oauthCtx);
  window.location.assign(url.toString());
}

async function submitPassword(
  config: HostedBootstrap,
  input: {
    email: string;
    password: string;
    name: string;
    submit: HTMLButtonElement;
    showError: (message: string) => void;
    clearError: () => void;
  },
): Promise<void> {
  input.clearError();
  input.submit.disabled = true;
  const path = config.page === "sign-up"
    ? "/api/auth/sign-up/email"
    : "/api/auth/sign-in/email";
  const body: Record<string, unknown> = {
    email: input.email,
    password: input.password,
  };
  if (config.page === "sign-up") body.name = input.name;

  try {
    const result = await postAuth(
      authEndpoint(config.authUrl, path),
      body,
      config.publishableKey,
    );
    if (!result.ok) {
      if (needsTwoFactor(result.status, result.data)) {
        input.showError("This account uses two-factor authentication, which this page can't complete. Continue with a provider above.");
      } else {
        input.showError(errorMessage(
          result.data,
          config.page === "sign-up" ? "Could not create the account." : "Invalid credentials",
        ));
      }
      input.submit.disabled = false;
      return;
    }
    if (isSafeDeviceReturnPath(config.returnPath)) {
      window.location.assign(config.returnPath);
      return;
    }
    if (!config.redirectUri) {
      const home = config.app.homeUrl || "/";
      window.location.assign(home);
      return;
    }
    const ticket = await postAuth(
      authEndpoint(config.authUrl, "/api/hosted/create-ticket"),
      { redirect_uri: config.redirectUri, state: config.state },
      config.publishableKey,
    );
    const code = ticket.data.code;
    if (!ticket.ok || typeof code !== "string" || !code) {
      input.showError(errorMessage(ticket.data, "Signed in, but the redirect code could not be issued."));
      input.submit.disabled = false;
      return;
    }
    // Custom schemes come back as xfr_ (plus kova_auth_code). HTTPS stays ticket_.
    finishRedirect(config, code, ticket.data.kova_auth_code);
  } catch {
    input.showError("Something went wrong. Please try again.");
    input.submit.disabled = false;
  }
}

export function bootHostedAuth(): void {
  const config = readBootstrap();
  const root = document.getElementById("root");
  if (!config) {
    if (root) {
      root.textContent = "";
      const fail = document.createElement("div");
      fail.className = "ra-skeleton";
      fail.style.color = "#ff6b6b";
      fail.textContent = "Failed to load. Please try again.";
      root.appendChild(fail);
    }
    return;
  }
  render(config);
}


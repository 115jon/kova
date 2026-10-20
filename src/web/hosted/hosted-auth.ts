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

import type { HostedAppearance } from "../../shared/hosted-brand";
import { HOSTED_PROVIDERS, PROVIDER_LABELS, RALPH_RADIO_SVG } from "../../shared/hosted-brand";

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

/** Same-origin /device return only. Keep this aligned with worker device-login.ts. */
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

function render(config: HostedBootstrap): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();

  const primary = config.appearance.primaryColor || "#026f8e";
  const isSignUp = config.page === "sign-up";
  const appName = config.app.name || "this app";

  const card = el("div", { class: "ra-card" });
  if (config.appearance.logoUrl) {
    card.appendChild(el("img", {
      class: "ra-logo",
      src: config.appearance.logoUrl,
      alt: "",
    }));
  } else if (config.appearance.brandMark === "ralph-radio") {
    const mark = el("div", { class: "ra-logo ra-ralph-radio" });
    mark.innerHTML = RALPH_RADIO_SVG;
    card.appendChild(mark);
  }
  card.appendChild(el("h1", { class: "ra-title" }, isSignUp ? "Create account" : "Sign in"));
  card.appendChild(el("p", { class: "ra-sub" }, appName));
  if (config.mode === "test") {
    card.appendChild(el("p", { class: "ra-test" }, "Test mode"));
  }

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

  const deviceReturn = isSafeDeviceReturnPath(config.returnPath);
  const providers = (config.enabledProviders ?? []).filter(provider => HOSTED_PROVIDERS.includes(provider as any));
  if (providers.length > 0) {
    for (const provider of providers) {
      const label = PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
      const button = el("button", { class: "ra-google", type: "button" }, `Continue with ${label}`);
      button.addEventListener("click", () => startOAuth(config, provider));
      card.appendChild(button);
    }
    card.appendChild(el("div", { class: "ra-or" }, "or"));
  }

  const form = el("form", { class: "ra-form" });
  const email = el("input", {
    class: "ra-input",
    type: "email",
    name: "email",
    autocomplete: "email",
    required: "true",
    placeholder: "Email",
  });
  email.id = "ra-email";
  const password = el("input", {
    class: "ra-input",
    type: "password",
    name: "password",
    autocomplete: isSignUp ? "new-password" : "current-password",
    required: "true",
    minlength: "8",
    placeholder: "Password",
  });
  const name = el("input", {
    class: "ra-input",
    type: "text",
    name: "name",
    autocomplete: "name",
    required: "true",
    placeholder: "Name",
  });

  for (const [input, label] of [[email, "Email"], [password, "Password"], [name, "Name"]] as const) {
    const labelNode = el("label", { for: input.id || `ra-${input.name}` }, label);
    if (!input.id) input.id = `ra-${input.name}`;
    form.appendChild(labelNode);
    input.setAttribute("aria-label", label);
  }

  const submit = el("button", { class: "ra-submit", type: "submit" }, isSignUp ? "Create account" : "Continue");
  submit.style.background = primary;

  if (isSignUp) form.appendChild(name);
  form.appendChild(email);
  form.appendChild(password);
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

  const footer = el("p", { class: "ra-foot" });
  const toggle = document.createElement("a");
  const other = isSignUp ? "/sign-in" : "/sign-up";
  const params = new URLSearchParams();
  if (deviceReturn) {
    params.set("device_return", config.returnPath ?? "");
  } else {
    if (config.redirectUri) params.set("redirect_uri", config.redirectUri);
    if (config.state) params.set("state", config.state);
  }
  const query = params.toString();
  toggle.href = query ? `${other}?${query}` : other;
  toggle.textContent = isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up";
  footer.appendChild(toggle);
  if (config.app.termsUrl || config.app.privacyUrl) {
    const legal = el("p", { class: "ra-foot" });
    if (config.app.termsUrl) legal.appendChild(el("a", { href: config.app.termsUrl }, "Terms"));
    if (config.app.privacyUrl) {
      if (config.app.termsUrl) legal.appendChild(el("span", {}, " · "));
      legal.appendChild(el("a", { href: config.app.privacyUrl }, "Privacy"));
    }
    card.appendChild(legal);
  }
  card.appendChild(footer);
  if (!isSignUp) {
    const forgot = el("p", { class: "ra-foot" });
    forgot.appendChild(el("a", { href: `${config.mainAuthUrl}/reset-password?pk=${encodeURIComponent(config.publishableKey)}` }, "Forgot password?"));
    card.appendChild(forgot);
  }

  if (!config.hideBranding) {
    card.appendChild(el("p", { class: "ra-brand" }, "Secured by Kova"));
  }

  root.appendChild(card);
  injectStyles(primary);
}

function injectStyles(primary: string): void {
  if (document.getElementById("ra-hosted-styles")) return;
  const style = document.createElement("style");
  style.id = "ra-hosted-styles";
  style.textContent = `
    .ra-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 20px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.35);
      padding: 32px 28px 24px;
      color: #ffffff;
      font-size: 15px;
      line-height: 1.5;
    }
    .ra-logo { display: block; height: 48px; width: auto; margin: 0 auto 16px; border-radius: 12px; }
    .ra-title { font-size: 20px; font-weight: 600; line-height: 1.25; letter-spacing: -0.015em; text-align: center; color: #ffffff; }
    .ra-sub, .ra-test, .ra-or, .ra-foot, .ra-brand { text-align: center; }
    .ra-sub { margin: 6px 0 24px; color: #b8b8b8; font-size: 15px; }
    .ra-test { margin: -14px 0 16px; color: #ffb020; font-size: 12px; font-weight: 500; }
    .ra-error {
      margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; text-align: left;
      color: #ffffff; font-size: 14px;
      background: rgba(255,107,107,0.10); border: 1px solid rgba(255,107,107,0.24);
    }
    .ra-google, .ra-submit, .ra-input {
      width: 100%; height: 44px; font: inherit; font-size: 15px; border-radius: 12px;
    }
    .ra-google, .ra-submit {
      border: 0; cursor: pointer; padding: 0 16px; font-weight: 500;
      transition: background-color 150ms ease, border-color 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .ra-google {
      background: rgba(255,255,255,0.08); color: #ffffff;
      border: 1px solid rgba(255,255,255,0.10);
    }
    .ra-google + .ra-google { margin-top: 8px; }
    .ra-google:active:not(:disabled), .ra-submit:active:not(:disabled) { transform: scale(0.98); }
    .ra-google:disabled, .ra-submit:disabled { opacity: 0.5; cursor: progress; }
    .ra-or { margin: 20px 0; color: #8a9090; font-size: 13px; }
    .ra-form { display: flex; flex-direction: column; gap: 12px; }
    .ra-input {
      background: rgba(255,255,255,0.08); color: #ffffff;
      border: 1px solid rgba(255,255,255,0.10); padding: 0 16px;
      transition: border-color 150ms ease;
    }
    .ra-input::placeholder { color: #8a9090; }
    .ra-input:focus { outline: none; border-color: ${primary}; }
    .ra-google:focus-visible, .ra-submit:focus-visible, .ra-input:focus-visible, .ra-foot a:focus-visible {
      outline: 2px solid ${primary}; outline-offset: 2px;
    }
    .ra-submit { color: #ffffff; font-weight: 600; margin-top: 4px; }
    .ra-foot { margin-top: 20px; color: #8a9090; font-size: 13px; }
    .ra-foot a { color: #b8b8b8; }
    .ra-brand { margin-top: 20px; font-size: 12px; color: #8a9090; }
    @media (hover: hover) and (pointer: fine) {
      .ra-google:hover:not(:disabled) { border-color: rgba(255,255,255,0.18); }
      .ra-foot a:hover { color: #ffffff; }
    }
    @media (max-width: 479px) {
      .ra-card { padding: 28px 20px 20px; }
      .ra-input { font-size: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ra-google:active:not(:disabled), .ra-submit:active:not(:disabled) { transform: none; }
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

if (typeof document !== "undefined") {
  bootHostedAuth();
}

/**
 * Shared pieces of the hosted bundle: the bootstrap shape the Worker writes
 * into `window.__KOVA_AUTH_HOSTED__`, a tiny element builder, and the Better
 * Auth POST helper. No module-level DOM access, so tests can stub globals.
 */

import type { HostedAppearance } from "../../shared/hosted-brand";
import { artPanelHtml, type HostedTheme } from "./hosted-theme";

export interface HostedAppInfo {
  id: string;
  name: string;
  homeUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

export interface HostedUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface HostedBootstrap {
  publishableKey: string;
  authUrl: string;
  mainAuthUrl: string;
  redirectUri: string;
  state: string;
  mode: "live" | "test";
  page: "sign-in" | "sign-up" | "account";
  appearance: HostedAppearance;
  app: HostedAppInfo;
  hideBranding: boolean;
  oauthCtx: string;
  returnPath?: string;
  enabledProviders?: string[];
  /** Account page only. Same-origin, cookie-authenticated. */
  accountApiBase?: string;
  /** Account page only. The signed-in user. */
  user?: HostedUser;
}

export function el<K extends keyof HTMLElementTagNameMap>(
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

export function authEndpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function postAuth(
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

/** First letter of the first and last word, upper-cased. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const picks = words.length > 1 ? [words[0]!, words[words.length - 1]!] : [words[0]!];
  return picks.map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();
}

/**
 * The shell may already carry the split page; only build it when loaded bare.
 * Returns the page element, and whether it was built here (then the shell CSS
 * is missing too).
 */
export function ensurePage(root: HTMLElement, theme: HostedTheme, caption: string): { page: Element; built: boolean } {
  const column = root.closest(".kv-form-inner") ?? root;
  const existing = column.closest(".kv-page");
  if (existing) return { page: existing, built: false };
  const page = el("div", { class: "kv-page" });
  page.innerHTML = artPanelHtml(theme, caption);
  const form = el("main", { class: "kv-form" });
  const inner = el("div", { class: "kv-form-inner" });
  root.replaceWith(page);
  inner.appendChild(root);
  form.appendChild(inner);
  page.appendChild(form);
  return { page, built: true };
}

/** A button with the shell's busy spinner. */
export function busyButton(className: string, label: string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const button = el("button", { class: className, type: "button", ...attrs });
  button.appendChild(el("span", { class: "label" }, label));
  button.appendChild(el("span", { class: "spinner", "aria-hidden": "true" }));
  return button;
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  const base = button.className.replace(/\s*\bis-busy\b/g, "");
  button.className = busy ? `${base} is-busy` : base;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.setAttribute("aria-busy", "false");
}

export function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

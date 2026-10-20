/**
 * CSS custom-property injection.
 *
 * Writes a `<style id="ra-vars">` tag into `<head>` that maps
 * AppearanceVariables to CSS custom properties on `:root`.
 * Components reference these via `var(--ra-*)`. This keeps all
 * styling zero-dependency while still being fully overridable.
 */

import type { AppearanceVariables } from "../types";

// Stable map between appearance keys and CSS property names
const VAR_MAP: Record<keyof AppearanceVariables, string> = {
  colorPrimary: "--ra-color-primary",
  colorPrimaryHover: "--ra-color-primary-hover",
  colorBackground: "--ra-color-bg",
  colorSurface: "--ra-color-surface",
  colorSurfaceRaised: "--ra-color-surface-raised",
  colorText: "--ra-color-text",
  colorTextSecondary: "--ra-color-text-secondary",
  colorTextTertiary: "--ra-color-text-tertiary",
  colorBorder: "--ra-color-border",
  colorBorderStrong: "--ra-color-border-strong",
  colorError: "--ra-color-error",
  colorSuccess: "--ra-color-success",
  colorWarning: "--ra-color-warning",
  shadow: "--ra-shadow",
  borderRadius: "--ra-radius",
  borderRadiusSm: "--ra-radius-sm",
  fontFamily: "--ra-font",
  fontFamilyMono: "--ra-font-mono",
  fontSize: "--ra-font-size",
};

/**
 * Injects (or replaces) a `<style>` tag with CSS custom properties
 * derived from the appearance variables map.
 *
 * @param vars   Merged appearance variables.
 * @param prevId ID attribute of the previous style tag (to remove it).
 * @returns      The ID of the newly injected style tag.
 */
export function injectAppearanceVars(
  vars: Required<AppearanceVariables>,
  prevId: string | null,
): string {
  if (typeof document === "undefined") return "ra-vars"; // SSR guard

  // Remove previous injection to avoid stacking duplicate rules
  if (prevId) {
    document.getElementById(prevId)?.remove();
  }

  const id = "ra-vars";

  const declarations = (
    Object.entries(vars) as Array<[keyof AppearanceVariables, string]>
  )
    .map(([key, value]) => `  ${VAR_MAP[key]}: ${value};`)
    .join("\n");

  // We also inject the SDK's base structural styles here the first time.
  // They use only var(--ra-*) tokens — never hardcoded colours.
  const css = `
:root {
${declarations}
}

/* ── @kova/react base styles ─────────────────────────────────── */
[data-ra-root] {
  font-family: var(--ra-font);
  font-size: var(--ra-font-size);
  line-height: 1.5;
  color: var(--ra-color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  box-sizing: border-box;
}
[data-ra-root] *, [data-ra-root] *::before, [data-ra-root] *::after {
  box-sizing: inherit;
}

/* Card: enters once, 300ms ease-out. */
[data-ra-element="card"] {
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius);
  box-shadow: var(--ra-shadow);
  overflow: hidden;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  transition: opacity 300ms cubic-bezier(0.23, 1, 0.32, 1), transform 300ms cubic-bezier(0.23, 1, 0.32, 1);
}
@starting-style {
  [data-ra-element="card"] { opacity: 0; transform: translateY(8px); }
}

/* Card sections */
[data-ra-element="cardHeader"] {
  padding: 32px 28px 0;
  text-align: center;
}
[data-ra-element="appLogo"] {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 12px;
  display: block;
  margin: 0 auto 16px;
}
[data-ra-element="cardBody"] {
  padding: 24px 28px;
}
[data-ra-element="cardFooter"] {
  padding: 0 28px 24px;
  text-align: center;
  font-size: 14px;
}

[data-ra-element="cardTitle"] {
  font-family: var(--ra-font);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
  color: var(--ra-color-text);
  margin: 0;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
[data-ra-element="cardSubtitle"] {
  font-size: 15px;
  line-height: 1.5;
  color: var(--ra-color-text-secondary);
  margin: 6px 0 0;
  text-wrap: pretty;
}

/* Tabs: underline, no animated indicator (switching is instant). */
[data-ra-element="tabsRoot"] {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--ra-color-border);
  margin-bottom: 20px;
}
[data-ra-element="tab"] {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: 10px 12px;
  cursor: pointer;
  font-family: var(--ra-font);
  font-size: 14px;
  font-weight: 500;
  color: var(--ra-color-text-tertiary);
  transition: color 150ms ease;
  white-space: nowrap;
}
[data-ra-element="tab"][aria-selected="true"] {
  color: var(--ra-color-text);
  border-bottom-color: var(--ra-color-primary);
}

/* Form fields */
[data-ra-element="formField"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
[data-ra-element="formFieldLabel"] {
  font-family: var(--ra-font);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ra-color-text-secondary);
}
[data-ra-element="formFieldInput"] {
  width: 100%;
  height: 44px;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  font-family: var(--ra-font);
  font-size: var(--ra-font-size);
  color: var(--ra-color-text);
  padding: 0 16px;
  outline: none;
  transition: border-color 150ms ease;
}
[data-ra-element="formFieldInput"]::placeholder {
  color: var(--ra-color-text-tertiary);
  opacity: 1;
}
[data-ra-element="formFieldInput"]:focus {
  border-color: var(--ra-color-primary);
}
[data-ra-element="formFieldInput"][aria-invalid="true"] {
  border-color: var(--ra-color-error);
}
[data-ra-element="formFieldInput"]:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
[data-ra-element="formFieldError"] {
  font-size: 13px;
  line-height: 1.4;
  color: var(--ra-color-error);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Submit button */
[data-ra-element="formSubmitButton"] {
  width: 100%;
  height: 44px;
  background: var(--ra-color-primary);
  color: #fff;
  border: none;
  border-radius: var(--ra-radius-sm);
  padding: 0 16px;
  font-family: var(--ra-font);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms ease, opacity 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
[data-ra-element="formSubmitButton"]:active:not(:disabled) {
  transform: scale(0.98);
}
[data-ra-element="formSubmitButton"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[data-ra-element="formSubmitButton"][aria-busy="true"] {
  cursor: progress;
}
/* The spinner sits beside the label without pushing it off-centre. */
[data-ra-element="formSubmitButton"] {
  position: relative;
}
[data-ra-element="formSubmitButton"] > [data-ra-element="spinner"] {
  position: absolute;
  inset-inline-start: 16px;
  top: 50%;
  margin-top: -7px;
}

/* Social buttons */
[data-ra-element="socialButtonsRoot"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
[data-ra-element="socialButton"] {
  width: 100%;
  height: 44px;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  padding: 0 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-family: var(--ra-font);
  font-size: 15px;
  font-weight: 500;
  color: var(--ra-color-text);
  transition: border-color 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
[data-ra-element="socialButton"] svg { width: 18px; height: 18px; flex-shrink: 0; }
[data-ra-element="socialButton"]:active:not(:disabled) {
  transform: scale(0.98);
}
[data-ra-element="socialButton"]:disabled {
  cursor: progress;
  opacity: 0.6;
}

/* One focus ring for every control, in the app's own primary. */
[data-ra-root] :is(button, a, input, [role="tab"]):focus-visible {
  outline: 2px solid var(--ra-color-primary);
  outline-offset: 2px;
}

/* Divider */
[data-ra-element="dividerRow"] {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
}
[data-ra-element="dividerLine"] {
  flex: 1;
  height: 1px;
  background: var(--ra-color-border);
}
[data-ra-element="dividerText"] {
  font-family: var(--ra-font);
  font-size: 13px;
  color: var(--ra-color-text-tertiary);
  white-space: nowrap;
  user-select: none;
}

/* Footer link */
[data-ra-element="cardFooter"] a,
[data-ra-element="cardFooter"] button {
  font-family: var(--ra-font);
  font-size: 14px;
  font-weight: 500;
  color: var(--ra-color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: color 150ms ease;
}
[data-ra-footer-badges] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
[data-ra-footer-badges]:not(:empty) {
  margin-top: 16px;
}
[data-ra-element="cardFooter"] > [data-ra-footer-badges]:first-child {
  margin-top: 0;
}

/* Branding + development badges */
[data-ra-element="cardFooter"] [data-ra-element="brandingBadge"] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--ra-color-text-tertiary);
  opacity: 0.8;
  transition: opacity 150ms ease;
}
[data-ra-element="devModeBadge"] {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding-top: 10px;
  border-top: 1px dashed var(--ra-color-border-strong);
  font-size: 12px;
  font-weight: 500;
  color: var(--ra-color-warning);
}
[data-ra-dev-dot] {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

/* Alert banner: the icon carries the status colour, the text stays legible. */
[data-ra-element="alertBanner"] {
  border-radius: min(var(--ra-radius-sm), 12px);
  border: 1px solid transparent;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--ra-color-text);
  overflow-wrap: anywhere;
  text-align: left;
}
[data-ra-element="alertBanner"] [data-ra-alert-icon] {
  flex-shrink: 0;
  margin-top: 2px;
}
[data-ra-element="alertBanner"][data-variant="error"] {
  background: color-mix(in srgb, var(--ra-color-error) 10%, transparent);
  border-color: color-mix(in srgb, var(--ra-color-error) 24%, transparent);
}
[data-ra-element="alertBanner"][data-variant="error"] [data-ra-alert-icon] { color: var(--ra-color-error); }
[data-ra-element="alertBanner"][data-variant="success"] {
  background: color-mix(in srgb, var(--ra-color-success) 10%, transparent);
  border-color: color-mix(in srgb, var(--ra-color-success) 24%, transparent);
}
[data-ra-element="alertBanner"][data-variant="success"] [data-ra-alert-icon] { color: var(--ra-color-success); }
[data-ra-element="alertBanner"][data-variant="info"] {
  background: color-mix(in srgb, var(--ra-color-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--ra-color-primary) 24%, transparent);
}
[data-ra-element="alertBanner"][data-variant="info"] [data-ra-alert-icon] { color: var(--ra-color-primary); }

/* Rate-limit banner */
[data-ra-element="rateLimitBanner"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: min(var(--ra-radius-sm), 12px);
  border: 1px solid color-mix(in srgb, var(--ra-color-error) 32%, transparent);
  background: color-mix(in srgb, var(--ra-color-error) 10%, var(--ra-color-surface));
  font-family: var(--ra-font);
}
[data-ra-rate-limit-row] {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ra-color-error);
}
[data-ra-rate-limit-row] svg { flex-shrink: 0; }
[data-ra-rate-limit-track] {
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ra-color-error) 20%, var(--ra-color-border));
}
[data-ra-rate-limit-fill] {
  height: 100%;
  width: 100%;
  border-radius: 999px;
  background: var(--ra-color-error);
  transform-origin: left center;
  transition: transform 200ms linear;
}

/* UserButton */
[data-ra-element="userButtonTrigger"] {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ra-radius-sm);
  padding: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background-color 150ms ease, border-color 150ms ease;
}
[data-ra-element="userButtonMenu"] {
  position: absolute;
  z-index: 9999;
  min-width: 220px;
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border-strong);
  border-radius: min(calc(var(--ra-radius-sm) + 4px), 16px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.25), 0 16px 40px rgba(0,0,0,0.35);
  padding: 4px;
  overflow: hidden;
  transform-origin: top right;
  transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}
@starting-style {
  [data-ra-element="userButtonMenu"] { opacity: 0; transform: scale(0.96); }
}
[data-ra-element="userButtonMenuItem"] {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: var(--ra-font);
  font-size: 14px;
  color: var(--ra-color-text-secondary);
  transition: background-color 100ms ease, color 100ms ease;
  text-align: left;
}

@media (hover: hover) and (pointer: fine) {
  [data-ra-element="tab"]:hover { color: var(--ra-color-text); }
  [data-ra-element="formSubmitButton"]:hover:not(:disabled) { background: var(--ra-color-primary-hover); }
  [data-ra-element="socialButton"]:hover:not(:disabled) { border-color: var(--ra-color-border-strong); }
  [data-ra-element="cardFooter"] a:hover,
  [data-ra-element="cardFooter"] button:hover { color: var(--ra-color-text); }
  [data-ra-element="cardFooter"] [data-ra-element="brandingBadge"]:hover { opacity: 1; }
  [data-ra-element="userButtonTrigger"]:hover {
    background: color-mix(in srgb, var(--ra-color-text) 6%, transparent);
    border-color: var(--ra-color-border);
  }
  [data-ra-element="userButtonMenuItem"]:hover {
    background: color-mix(in srgb, var(--ra-color-text) 6%, transparent);
    color: var(--ra-color-text);
  }
  [data-ra-element="userButtonMenuItem"][data-destructive="true"]:hover {
    background: color-mix(in srgb, var(--ra-color-error) 12%, transparent);
    color: var(--ra-color-error);
  }
}

/* Spinner: rendered only while a request is in flight. */
@keyframes ra-spin { to { transform: rotate(360deg); } }
[data-ra-element="spinner"] {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ra-spin 700ms linear infinite;
  flex-shrink: 0;
}

/* Skeleton: static block, no shimmer. */
[data-ra-element="skeleton"] {
  border-radius: var(--ra-radius-sm);
  background: var(--ra-color-surface-raised);
}

@media (max-width: 479px) {
  [data-ra-element="cardHeader"] { padding: 28px 20px 0; }
  [data-ra-element="cardBody"] { padding: 22px 20px; }
  [data-ra-element="cardFooter"] { padding: 0 20px 20px; }
  /* 16px stops iOS from zooming into the field. */
  [data-ra-element="formFieldInput"] { font-size: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  [data-ra-element="card"],
  [data-ra-element="userButtonMenu"] { transition: opacity 120ms ease; }
  @starting-style {
    [data-ra-element="card"],
    [data-ra-element="userButtonMenu"] { transform: none; }
  }
  [data-ra-element="formSubmitButton"]:active:not(:disabled),
  [data-ra-element="socialButton"]:active:not(:disabled) { transform: none; }
}
`.trim();

  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);

  return id;
}

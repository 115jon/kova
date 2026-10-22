/**
 * Shared look for every hosted page (sign-in, sign-up, device approval).
 *
 * Pure: no DOM, no imports. Both the Worker (which inlines the CSS into the
 * HTML shell) and the browser bundle import from here, so the split layout,
 * the art panel, the colour math and the control styling are defined once.
 *
 * Colours are interpolated into CSS, so everything that reaches
 * `hostedShellCss` is validated hex. Light app backgrounds fall back to a
 * dark one: the pages are dark-only, and the dither art is tuned for it.
 */

export interface HostedColors {
  /** App accent, #rrggbb. */
  primary: string;
  /** Page ground, #rrggbb, always dark. */
  background: string;
}

export interface HostedTheme extends HostedColors {
  /** Body copy on the ground, white. */
  text: string;
  /** Labels and supporting copy, tinted from the accent. ≥7:1 on the ground. */
  secondary: string;
  /** Captions and hints, tinted from the accent. ≥4.5:1 on the ground. */
  muted: string;
  /** Six ink levels, dark to light, for the dither art. */
  inks: ArtInks;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const DEFAULT_PRIMARY = "#3b82f6";
export const DEFAULT_BACKGROUND = "#0a0a0a";
// Above this the white text and the art palette stop working; same gate as the device page.
const MAX_BACKGROUND_LUMINANCE = 0.012;

/** "#abc" / "#AABBCC" → "#aabbcc"; anything else → null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
  const h = value.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

function channels(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a normalized hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix in sRGB: t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Lighten `fg` toward white until it reaches `min` contrast against `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  let color = fg;
  for (let i = 0; i < 24 && contrastRatio(color, bg) < min; i++) {
    color = mixHex(color, "#ffffff", 0.12);
  }
  return color;
}

/** Validate app colours and keep the ground dark. */
export function hostedColors(primary: unknown, background: unknown): HostedColors {
  const p = normalizeHex(primary) ?? DEFAULT_PRIMARY;
  const b = normalizeHex(background);
  return {
    primary: p,
    background: b && relativeLuminance(b) <= MAX_BACKGROUND_LUMINANCE ? b : DEFAULT_BACKGROUND,
  };
}

export type ArtInks = [string, string, string, string, string, string];

/** Dark → light ink ramp from the ground through the accent. Luma-ordered, as the dither expects. */
export function artInks({ primary, background }: HostedColors): ArtInks {
  return [
    background,
    mixHex(background, primary, 0.26),
    mixHex(background, primary, 0.58),
    primary,
    mixHex(primary, "#ffffff", 0.3),
    mixHex(primary, "#ffffff", 0.6),
  ];
}

export function hostedTheme(primary: unknown, background: unknown): HostedTheme {
  const colors = hostedColors(primary, background);
  const tintedSecondary = mixHex("#ffffff", colors.primary, 0.2);
  const tintedMuted = mixHex(mixHex("#ffffff", colors.primary, 0.5), colors.background, 0.3);
  return {
    ...colors,
    text: "#ffffff",
    secondary: ensureContrast(tintedSecondary, colors.background, 7),
    muted: ensureContrast(tintedMuted, colors.background, 4.6),
    inks: artInks(colors),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The art panel. Server-rendered on the device page, built on the client for
 * sign-in; the bundle later mounts the shader into `[data-kova-art]`.
 * `caption` is the app name (escaped here). Nothing else: no host, no invented tagline.
 */
export function artPanelHtml(theme: HostedTheme, caption: string): string {
  return `<aside class="kv-art" data-kova-art data-primary="${theme.primary}" data-background="${theme.background}" aria-hidden="true">`
    + `<div class="kv-art-fallback"></div>`
    + `<div class="kv-art-caption"><span class="kv-art-app">${escapeHtml(caption)}</span></div>`
    + `</aside>`;
}

const GRAIN_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='96' height='96' filter='url(%23g)'/%3E%3C/svg%3E\")";

/**
 * Layout, tokens, browser surfaces and the shared controls. Component-only
 * rules (the sign-in form, the device review) live next to their markup.
 */
export function hostedShellCss(theme: HostedTheme): string {
  const { primary, background, text, secondary, muted, inks } = theme;
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: ${primary}; --bg: ${background}; --text: ${text}; --secondary: ${secondary}; --muted: ${muted};
      --ring: ${rgba(primary, 0.4)}; --line: rgba(255,255,255,0.11); --line-strong: rgba(255,255,255,0.2);
      --field: rgba(255,255,255,0.055); --raised: rgba(255,255,255,0.085);
      --ease-out: cubic-bezier(0.23, 1, 0.32, 1); --radius: 10px;
      --mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
      color-scheme: dark; accent-color: var(--primary);
    }
    html { -webkit-text-size-adjust: 100%; background: var(--bg); scrollbar-color: var(--line-strong) transparent; }
    body { min-height: 100vh; min-height: 100svh; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased;
      font-family: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; caret-color: var(--primary); }
    ::selection { background: ${rgba(primary, 0.45)}; color: #fff; }
    a { color: var(--secondary); text-decoration: underline; text-decoration-color: ${rgba(primary, 0.6)}; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 6px; }

    .kv-page { min-height: 100vh; min-height: 100svh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    @media (min-width: 1440px) { .kv-page { grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); } }

    .kv-art { position: relative; overflow: hidden; background: ${inks[1]}; border-right: 1px solid rgba(255,255,255,0.06); isolation: isolate; }
    .kv-art-fallback { position: absolute; inset: 0; z-index: 0;
      background:
        radial-gradient(60% 55% at 28% 24%, ${inks[4]} 0%, ${rgba(inks[3], 0)} 70%),
        radial-gradient(70% 70% at 78% 72%, ${inks[3]} 0%, ${rgba(inks[2], 0)} 72%),
        radial-gradient(90% 60% at 60% 18%, ${inks[2]} 0%, ${rgba(inks[1], 0)} 70%),
        linear-gradient(170deg, ${inks[1]} 0%, ${inks[0]} 100%); }
    .kv-art-fallback::after { content: ""; position: absolute; inset: 0; background-image: ${GRAIN_SVG}; background-size: 96px 96px;
      opacity: 0.1; mix-blend-mode: overlay; }
    .kv-art canvas { position: absolute; left: 50%; top: 50%; z-index: 1; transform: translate(-50%, -50%);
      image-rendering: pixelated; image-rendering: crisp-edges; opacity: 0; transition: opacity 700ms ease; }
    .kv-art.is-live canvas { opacity: 1; }
    /* A quiet shadow on the seam so the art reads as a surface, and a foot scrim so the caption stays legible. */
    .kv-art::after { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none;
      background: linear-gradient(90deg, rgba(0,0,0,0) 82%, ${rgba(background, 0.55)} 100%),
        linear-gradient(0deg, ${rgba(background, 0.72)} 0%, ${rgba(background, 0)} 24%); }
    .kv-art-caption { position: absolute; z-index: 3; left: max(28px, env(safe-area-inset-left)); bottom: max(24px, env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 2px; max-width: calc(100% - 56px); text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
    .kv-art-app { font-weight: 600; font-size: 14px; letter-spacing: -0.005em; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .kv-form { display: flex; align-items: center; justify-content: center; min-width: 0; overflow-y: auto; overscroll-behavior: contain;
      padding: max(28px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); }
    .kv-form-inner { width: 100%; max-width: 380px; }

    /* Shared controls */
    .kv-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 44px;
      padding: 0 16px; border-radius: var(--radius); font: inherit; font-size: 15px; font-weight: 500; line-height: 1; text-decoration: none;
      color: #fff; cursor: pointer; overflow: hidden; -webkit-tap-highlight-color: transparent; border: 1px solid var(--line); background: var(--raised);
      transition: transform 160ms var(--ease-out), border-color 160ms ease; }
    .kv-btn::after { content: ""; position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; transition: opacity 160ms ease; }
    .kv-btn:active:not(:disabled):not([aria-disabled="true"]) { transform: scale(0.97); }
    .kv-btn-primary { background: var(--primary); border-color: transparent; font-weight: 600;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 1px 2px rgba(0,0,0,0.3); }
    .kv-btn:disabled, .kv-btn[aria-disabled="true"] { cursor: default; }
    .kv-btn:disabled:not(.is-busy), .kv-btn[aria-disabled="true"]:not(.is-busy) { opacity: 0.5; }
    .kv-btn svg { width: 18px; height: 18px; flex: none; }
    .kv-btn .spinner { position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; opacity: 0; }
    .kv-btn.is-busy .label { opacity: 0; }
    .kv-btn.is-busy .spinner { opacity: 1; animation: kv-spin 700ms linear infinite; }
    @keyframes kv-spin { to { transform: rotate(360deg); } }

    .kv-input { width: 100%; height: 44px; padding: 0 14px; border-radius: var(--radius); font: inherit; font-size: 15px; color: var(--text);
      background: var(--field); border: 1px solid var(--line); transition: border-color 160ms ease, box-shadow 160ms ease; }
    .kv-input::placeholder { color: var(--muted); }
    .kv-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
    .kv-input[aria-invalid="true"] { border-color: rgba(255,120,120,0.7); }
    .kv-input:-webkit-autofill { -webkit-text-fill-color: var(--text); -webkit-box-shadow: 0 0 0 1000px ${mixHex(background, primary, 0.14)} inset; }

    .kv-logo { display: block; width: 44px; height: 44px; border-radius: 11px; object-fit: contain; flex: none; }
    .kv-monogram { display: grid; place-items: center; background: var(--primary); color: #fff; font-weight: 600; font-size: 17px; letter-spacing: 0.02em;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18); }

    .kv-brand { margin-top: 18px; text-align: center; font-size: 12px; color: var(--muted); }
    .kv-brand a { color: var(--muted); text-decoration-color: transparent; }
    .kv-brand .dot { margin: 0 6px; }

    .kv-enter { animation: kv-in 260ms var(--ease-out) both; }
    .kv-enter:nth-child(2) { animation-delay: 40ms; }
    .kv-enter:nth-child(3) { animation-delay: 80ms; }
    .kv-enter:nth-child(4) { animation-delay: 120ms; }
    .kv-enter:nth-child(n+5) { animation-delay: 160ms; }
    @keyframes kv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

    @media (hover: hover) and (pointer: fine) {
      .kv-btn:hover:not(:disabled):not([aria-disabled="true"])::after { opacity: 0.07; }
      .kv-btn:hover:not(:disabled):not([aria-disabled="true"]):not(.kv-btn-primary) { border-color: var(--line-strong); }
      a:hover { color: var(--text); text-decoration-color: var(--primary); }
      .kv-brand a:hover { color: var(--secondary); }
    }
    @media (max-width: 767px) {
      .kv-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .kv-art { height: calc(152px + env(safe-area-inset-top)); border-right: 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
      .kv-art::after { background: linear-gradient(180deg, rgba(0,0,0,0) 40%, ${rgba(background, 0.8)} 100%); }
      .kv-art-caption { left: max(20px, env(safe-area-inset-left)); bottom: 18px; }
      .kv-form { align-items: flex-start; overflow-y: visible;
        padding: 24px max(20px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
      .kv-input { font-size: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes kv-in { from { opacity: 0; } to { opacity: 1; } }
      .kv-btn, .kv-btn:active:not(:disabled):not([aria-disabled="true"]) { transform: none; transition: none; }
      .kv-btn.is-busy .spinner { animation: kv-pulse 1000ms ease-in-out infinite alternate; }
      @keyframes kv-pulse { from { opacity: 1; } to { opacity: 0.4; } }
      .kv-art canvas { transition: none; }
    }
  `;
}

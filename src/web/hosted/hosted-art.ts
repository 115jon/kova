/**
 * The dithered field behind every hosted page.
 *
 * A tiny 2D canvas paints a slow greyscale field (a few drifting soft lights
 * over a graded ground). ditherwave reads that canvas every frame, snaps it to
 * a coarse Bayer grid and maps luminance onto the app's ink ramp, so the
 * result is posterised contour bands with ordered-dither grain between them:
 * a risograph print of a signal, tinted by the app.
 *
 * Cost: the WebGL canvas is square (so the dither cells stay square on any
 * panel), rendered at half CSS resolution and upscaled with
 * `image-rendering: pixelated`. The source is ~100×100 pixels. Both are
 * trivial on integrated GPUs.
 *
 * Behaviour:
 *   - mounts after first paint, so the form is interactive before any GL work;
 *   - `prefers-reduced-motion`: one frame is rendered, copied to a plain
 *     canvas, and the GL context is released;
 *   - hidden tabs stop painting (the browser also parks rAF);
 *   - no WebGL2: the CSS fallback that was already showing stays.
 */

import { createDither, type DitherHandle } from "ditherwave/vanilla";
import { artInks, hostedColors, type HostedColors } from "./hosted-theme";

const SOURCE_SIZE = 104;
/** CSS pixels per dither cell: chunkier on desktop panels, finer on the phone band. */
const CELL_PX_DESKTOP = 5;
const CELL_PX_MOBILE = 4;
/** Half-resolution GL buffer, upscaled by CSS. */
const PIXEL_RATIO = 0.5;
const STILL_TIME = 11;

interface Light {
  /** Orbit centre, 0..1. */
  cx: number;
  cy: number;
  /** Orbit radii, 0..1. */
  ax: number;
  ay: number;
  /** Angular speeds, rad/s (periods of 30–60s). */
  wx: number;
  wy: number;
  phase: number;
  /** Radius as a fraction of the source size. */
  r: number;
  /** Peak brightness, 0..1. */
  a: number;
}

/**
 * Composition: one dominant form sitting off-centre toward the form column,
 * a dimmer echo low on the left, and a flowing ridge across the field.
 * Everything else is deep ground.
 */
const LIGHTS: Light[] = [
  { cx: 0.6, cy: 0.36, ax: 0.07, ay: 0.06, wx: 0.12, wy: 0.09, phase: 0.6, r: 0.54, a: 0.82 },
  { cx: 0.26, cy: 0.8, ax: 0.1, ay: 0.06, wx: 0.08, wy: 0.11, phase: 2.4, r: 0.36, a: 0.5 },
];

/** Where a light sits at time t (seconds), in source pixels. Exported for tests. */
export function lightPosition(light: Light, t: number, size: number): { x: number; y: number } {
  return {
    x: (light.cx + light.ax * Math.sin(t * light.wx + light.phase)) * size,
    y: (light.cy + light.ay * Math.cos(t * light.wy + light.phase * 0.7)) * size,
  };
}

/** Dither cells across the square canvas for a given CSS size. Exported for tests. */
export function cellResolution(cssSize: number): number {
  const cell = cssSize >= 600 ? CELL_PX_DESKTOP : CELL_PX_MOBILE;
  return Math.max(64, Math.min(256, Math.round(cssSize / cell)));
}

/** Ridge: a soft diagonal band that slowly breathes and drifts. */
function paintRidge(ctx: CanvasRenderingContext2D, size: number, t: number): void {
  const angle = -0.62 + 0.06 * Math.sin(t * 0.05);
  const offset = (0.08 * Math.sin(t * 0.07 + 1.1)) * size;
  const cx = size * 0.38 + offset;
  const cy = size * 0.66;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const half = size * 0.95;
  const band = ctx.createLinearGradient(cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.42, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.3)");
  band.addColorStop(0.56, "rgba(255,255,255,0.44)");
  band.addColorStop(0.64, "rgba(255,255,255,0.12)");
  band.addColorStop(0.74, "rgba(255,255,255,0)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

/** A soft shadow swept across the lower-left of the focal form, so it reads as a crescent, not a disc. */
function paintShadow(ctx: CanvasRenderingContext2D, size: number, t: number): void {
  const angle = 0.95 + 0.05 * Math.sin(t * 0.06 + 0.8);
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const cx = size * (0.44 + 0.03 * Math.sin(t * 0.08));
  const cy = size * 0.58;
  const half = size * 0.6;
  const band = ctx.createLinearGradient(cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half);
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(0.36, "rgba(0,0,0,0)");
  band.addColorStop(0.5, "rgba(0,0,0,0.82)");
  band.addColorStop(0.62, "rgba(0,0,0,0.5)");
  band.addColorStop(0.8, "rgba(0,0,0,0)");
  band.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

export function paintField(ctx: CanvasRenderingContext2D, size: number, t: number): void {
  ctx.globalCompositeOperation = "source-over";
  // Deep ground: near-black at the left edge, a faint lift toward the focal side.
  const ground = ctx.createLinearGradient(0, size * 0.2, size, size * 0.8);
  ground.addColorStop(0, "#000000");
  ground.addColorStop(0.55, "#060606");
  ground.addColorStop(1, "#141414");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";
  paintRidge(ctx, size, t);
  for (const light of LIGHTS) {
    const { x, y } = lightPosition(light, t, size);
    const radius = light.r * size;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(255,255,255,${light.a})`);
    glow.addColorStop(0.12, `rgba(255,255,255,${light.a * 0.7})`);
    glow.addColorStop(0.4, `rgba(255,255,255,${light.a * 0.3})`);
    glow.addColorStop(0.75, `rgba(255,255,255,${light.a * 0.06})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  paintShadow(ctx, size, t);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function squareSize(host: HTMLElement): number {
  return Math.max(host.clientWidth, host.clientHeight, 1);
}

export function mountHostedArt(host: HTMLElement, colors: HostedColors): () => void {
  if (host.querySelector("canvas")) return () => {};
  const source = document.createElement("canvas");
  source.width = SOURCE_SIZE;
  source.height = SOURCE_SIZE;
  const ctx = source.getContext("2d");
  if (!ctx) return () => {};

  const target = document.createElement("canvas");
  const fit = () => {
    const size = squareSize(host);
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;
    return size;
  };
  let size = fit();
  host.appendChild(target);

  const still = prefersReducedMotion();
  const started = performance.now();
  let handle: DitherHandle | null = null;
  let frame = 0;
  let disposed = false;

  const paint = (t: number) => paintField(ctx, SOURCE_SIZE, t);

  try {
    paint(still ? STILL_TIME : 0);
    handle = createDither(target, source, {
      mode: "bayer",
      matrixSize: 8,
      resolution: cellResolution(size),
      palette: artInks(colors),
      // Low intensity keeps the dither at band edges; the bands themselves stay clean ink.
      intensity: 0.55,
      contrast: 1.25,
      animate: false,
      pauseOffscreen: true,
      pixelRatio: PIXEL_RATIO,
    });
  } catch {
    // No WebGL2: the CSS fallback underneath is already on screen.
    target.remove();
    return () => {};
  }

  if (still) {
    // One frame, kept as plain pixels; the GL context goes away.
    handle.render();
    const keep = document.createElement("canvas");
    keep.width = target.width;
    keep.height = target.height;
    keep.style.width = target.style.width;
    keep.style.height = target.style.height;
    keep.getContext("2d")?.drawImage(target, 0, 0);
    handle.destroy();
    target.replaceWith(keep);
    host.classList.add("is-live");
    return () => keep.remove();
  }

  // Paint the source at ~30fps; ditherwave re-uploads it on its own rAF.
  let last = 0;
  const tick = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden || now - last < 30) return;
    last = now;
    paint((now - started) / 1000);
  };
  frame = requestAnimationFrame(tick);
  requestAnimationFrame(() => host.classList.add("is-live"));

  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      const next = fit();
      if (next !== size) {
        size = next;
        handle?.setOptions({ resolution: cellResolution(size) });
      }
    })
    : null;
  observer?.observe(host);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    handle?.destroy();
    target.remove();
    host.classList.remove("is-live");
  };
}

/**
 * Mount into every `[data-kova-art]` after first paint. Colours come from the
 * element's data attributes (validated again here) so the server-rendered
 * device page and the client-rendered sign-in share one entry point.
 */
export function bootHostedArt(): void {
  if (typeof document === "undefined") return;
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[data-kova-art]"));
  if (panels.length === 0) return;
  const start = () => {
    for (const panel of panels) {
      mountHostedArt(panel, hostedColors(panel.dataset.primary, panel.dataset.background));
    }
  };
  // Two frames in: the form has painted and is focusable before any GL setup.
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(start, 0)));
}

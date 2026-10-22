import { describe, expect, it } from "vitest";
import { cellResolution, lightPosition } from "./hosted-art";
import {
  artInks,
  artPanelHtml,
  contrastRatio,
  ensureContrast,
  hostedColors,
  hostedShellCss,
  hostedTheme,
  mixHex,
  normalizeHex,
  relativeLuminance,
} from "./hosted-theme";

describe("hosted theme colours", () => {
  it("normalizes hex and rejects anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#5865F2")).toBe("#5865f2");
    expect(normalizeHex("red;}body{display:none")).toBeNull();
    expect(normalizeHex("5865f2")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it("mixes in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#5865f2", "#ffffff", 0)).toBe("#5865f2");
    expect(mixHex("#5865f2", "#ffffff", 1)).toBe("#ffffff");
  });

  it("keeps the ground dark and the accent valid", () => {
    expect(hostedColors("#5865f2", "#070709")).toEqual({ primary: "#5865f2", background: "#070709" });
    expect(hostedColors("#5865f2", "#f8f8f8")).toEqual({ primary: "#5865f2", background: "#0a0a0a" });
    expect(hostedColors("</style>", "#070709")).toEqual({ primary: "#3b82f6", background: "#070709" });
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("lifts text until it clears the contrast floor", () => {
    expect(contrastRatio(ensureContrast("#222222", "#070709", 4.5), "#070709")).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast("#ffffff", "#070709", 4.5)).toBe("#ffffff");
  });

  it.each([
    ["#5865f2", "#070709"],
    ["#1a1a6e", "#000000"],
    ["#ffb020", "#0a0a0a"],
    ["#026f8e", "#050505"],
  ])("gives readable supporting text for %s on %s", (primary, background) => {
    const theme = hostedTheme(primary, background);
    expect(contrastRatio(theme.secondary, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("orders the art inks dark to light, ground first and accent in the middle", () => {
    const inks = artInks({ primary: "#5865f2", background: "#070709" });
    expect(inks).toHaveLength(6);
    expect(inks[0]).toBe("#070709");
    expect(inks[3]).toBe("#5865f2");
    for (let i = 1; i < inks.length; i++) {
      expect(relativeLuminance(inks[i]!)).toBeGreaterThan(relativeLuminance(inks[i - 1]!));
    }
  });
});

describe("hosted shell", () => {
  const theme = hostedTheme("#5865f2", "#070709");

  it("escapes the caption and carries validated colours on the art panel", () => {
    const html = artPanelHtml(theme, `<b>"Ralph" & co</b>`);
    expect(html).toContain('data-kova-art data-primary="#5865f2" data-background="#070709"');
    expect(html).toContain('<span class="kv-art-app">&lt;b&gt;&quot;Ralph&quot; &amp; co&lt;/b&gt;</span>');
    expect(html).not.toContain("kv-art-host");
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("follows the motion and interaction rules", () => {
    const css = hostedShellCss(theme);
    expect(css).toContain("--primary: #5865f2;");
    expect(css).toContain("--bg: #070709;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("image-rendering: pixelated");
    expect(css).toContain("scale(0.97)");
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/scale\(0\)/);
  });
});

describe("hosted art", () => {
  it("sizes the dither grid to 5 CSS pixels per cell on desktop and 4 on the phone band", () => {
    expect(cellResolution(720)).toBe(144);
    expect(cellResolution(390)).toBe(98);
    expect(cellResolution(100)).toBe(64);
    expect(cellResolution(4000)).toBe(256);
  });

  it("keeps every light inside its orbit", () => {
    const light = { cx: 0.5, cy: 0.5, ax: 0.3, ay: 0.26, wx: 0.11, wy: 0.13, phase: 4, r: 0.34, a: 0.5 };
    expect(lightPosition(light, 0, 100).x).toBeCloseTo((0.5 + 0.3 * Math.sin(4)) * 100, 6);
    for (let t = 0; t < 600; t += 7) {
      const { x, y } = lightPosition(light, t, 100);
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(80);
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(76);
    }
  });
});

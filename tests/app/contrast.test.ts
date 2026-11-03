import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORS } from "../../src/app/render.ts";

const css = readFileSync(new URL("../../src/app/styles.css", import.meta.url), "utf8");
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("colour contrast", () => {
  it("SBX-044 text and control colours meet WCAG 2.2 AA (4.5:1) on every background they sit on", () => {
    const pairs: [string, string][] = [
      ["text", "bg"],
      ["text", "panel"],
      ["text", "panel-2"],
      ["text", "view"],
      ["muted", "panel"],
      ["muted", "panel-2"],
      ["muted", "view"],
      ["accent", "panel"],
      ["accent", "panel-2"],
      ["accent-ink", "accent"],
      ["text", "accent-soft"],
      ["warn", "warn-bg"],
      ["error", "error-bg"],
    ];
    for (const [fg, bg] of pairs) expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("SBX-038 overlay colours are distinguishable without hue: each differs in lightness from the view background and from each other", () => {
    const overlay = [COLORS.velocity, COLORS.contact, COLORS.force, COLORS.preview];
    for (const c of overlay) expect(contrast(c, COLORS.background), c).toBeGreaterThanOrEqual(3);
    // Velocity (blue) and contacts (orange) — the pair most often confused — also differ in line style (solid vs dashed).
    expect(Math.abs(luminance(COLORS.velocity) - luminance(COLORS.contact))).toBeGreaterThan(0.05);
  });
});

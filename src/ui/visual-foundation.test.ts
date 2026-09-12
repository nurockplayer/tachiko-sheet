import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("visual foundation CSS contract", () => {
  const css = readFileSync(new URL("./sheet-shell.css", import.meta.url), "utf8");

  it("keeps dense-grid focus and responsive hooks explicit", () => {
    expect(css).toContain("--ts-focus: #0b63ce");
    const lineStrong = css.match(/--ts-line-strong:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(lineStrong).toBeDefined();
    expect(contrastRatio(lineStrong as string, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(css).toContain(".ts-cell--focused");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  function contrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
      const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  it("reduces motion without hiding state changes", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto");
    expect(css).toContain("transition-duration: 0.01ms");
  });
});

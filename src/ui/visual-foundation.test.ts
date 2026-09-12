import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("visual foundation CSS contract", () => {
  const css = readFileSync(new URL("./sheet-shell.css", import.meta.url), "utf8");

  it("keeps dense-grid focus and responsive hooks explicit", () => {
    expect(css).toContain("--ts-focus: #0b63ce");
    expect(css).toContain(".ts-cell--focused");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("reduces motion without hiding state changes", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto");
    expect(css).toContain("transition-duration: 0.01ms");
  });
});

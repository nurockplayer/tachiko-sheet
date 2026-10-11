import { describe, expect, it } from "vitest";
import { gridWindowAround, gridWindowRange, gridWindowSegments, scrollTopToReveal } from "./grid-window.js";

describe("grid window", () => {
  it("covers the visible rows plus overscan, clamped to the table", () => {
    expect(gridWindowRange(0, 320, 32, 8406, 30)).toEqual({ start: 0, end: 41 });
    expect(gridWindowRange(32 * 4000, 320, 32, 8406, 30)).toEqual({ start: 3970, end: 4041 });
    expect(gridWindowRange(32 * 8400, 320, 32, 8406, 30)).toEqual({ start: 8370, end: 8406 });
  });

  it("keeps a window that already contains the row and recentres otherwise", () => {
    const current = { start: 100, end: 180 };
    expect(gridWindowAround(150, current, 8406)).toBe(current);
    expect(gridWindowAround(8405, current, 8406)).toEqual({ start: 8326, end: 8406 });
    expect(gridWindowAround(0, current, 8406)).toEqual({ start: 0, end: 80 });
  });

  it("emits ordered rows with spacers that preserve every unrendered row", () => {
    const segments = gridWindowSegments({ start: 10, end: 13 }, [0, 500, 11, -1, 9999], 1000);
    expect(segments).toEqual([
      { kind: "row", index: 0 },
      { kind: "spacer", key: "spacer-1", rows: 9 },
      { kind: "row", index: 10 },
      { kind: "row", index: 11 },
      { kind: "row", index: 12 },
      { kind: "spacer", key: "spacer-13", rows: 487 },
      { kind: "row", index: 500 },
      { kind: "spacer", key: "spacer-501", rows: 499 },
    ]);
    const accounted = segments.reduce((total, segment) => total + (segment.kind === "row" ? 1 : segment.rows), 0);
    expect(accounted).toBe(1000);
  });

  it("scrolls only when a row is outside the area below the sticky header", () => {
    expect(scrollTopToReveal(5, 32, 32, 0, 352)).toBeNull();
    expect(scrollTopToReveal(4000, 32, 32, 0, 352)).toBe(32 * 4001 - 320);
    expect(scrollTopToReveal(2, 32, 32, 320, 352)).toBe(64);
  });
});

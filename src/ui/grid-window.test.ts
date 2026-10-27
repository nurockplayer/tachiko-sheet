import { describe, expect, it } from "vitest";
import { gridPinnedRows, gridWindowAround, gridWindowRange, gridWindowScrollHeight, gridWindowSegments, measuredRowPitch, scrollTopToReveal } from "./grid-window.js";

describe("grid window", () => {
  it("reserves the footer in the scroll extent", () => {
    expect(gridWindowScrollHeight(320, 32, 33)).toBe(320 * 32 + 33);
    expect(gridWindowScrollHeight(320, 32, 33, 34)).toBe(320 * 32 + 33 + 34);
  });

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

  it("clamps a stale window after the table shrinks", () => {
    expect(gridWindowSegments({ start: 8370, end: 8406 }, [8405], 500)).toEqual([{ kind: "spacer", key: "spacer-0", rows: 500 }]);
    expect(gridWindowSegments({ start: 8370, end: 8406 }, [], 8405).filter((segment) => segment.kind === "row").every((segment) => segment.kind === "row" && segment.index < 8405)).toBe(true);
  });

  it("reserves the full scroll extent across distant windows and changing pinned rows", () => {
    const rowCount = 8406;
    for (const pitch of [28, 32]) {
      const header = 36;
      const height = gridWindowScrollHeight(rowCount, pitch, header);
      for (const top of [0, 4203 * pitch, height - 288]) {
        for (const pinned of [[0], [4203], [0, 4203, 8405]]) {
          const segments = gridWindowSegments(gridWindowRange(top, 288, pitch, rowCount), pinned, rowCount);
          const rows = segments.reduce((sum, part) => sum + (part.kind === "row" ? 1 : part.rows), 0);
          expect(rows * pitch + header).toBe(height);
        }
      }
      // The reserve ends exactly where the last row's reveal expects it;
      // overscan and pinned rows add no permanent blank tail.
      expect(scrollTopToReveal(rowCount - 1, pitch, header, 0, 288)).toBe(height - 288);
    }
    expect(gridWindowScrollHeight(0, 28, 36)).toBe(36);
    expect(gridWindowScrollHeight(500, 28, 36)).toBe(14036);
  });

  it("keeps the hosted stalled-to-bottom transition within the same independent extent", () => {
    const height = gridWindowScrollHeight(8406, 28, 28);
    expect(height).toBe(235396);
    const stalled = gridWindowRange(234128, 288, 28, 8406);
    const bottom = gridWindowRange(height - 288, 288, 28, 8406);
    expect(stalled).toEqual({ start: 8331, end: 8403 });
    expect(bottom).toEqual({ start: 8366, end: 8406 });
    const before = gridWindowSegments(stalled, [4203], 8406);
    expect(before.filter((part) => part.kind === "spacer").map((part) => part.rows * 28))
      .toEqual([117684, 115556, 84]);
    // Removing the old window's 35 leading rows can momentarily lose exactly
    // the reported 980px before the middle spacer grows to replace them.
    expect((bottom.start - stalled.start) * 28).toBe(980);
    expect(height - 288 - 980).toBe(234128);
    const after = gridWindowSegments(bottom, [4203], 8406);
    for (const parts of [before, after]) {
      expect(parts.reduce((sum, part) => sum + (part.kind === "row" ? 1 : part.rows), 0) * 28 + 28).toBe(height);
    }
  });

  it("scrolls only when a row is outside the area below the sticky header", () => {
    expect(scrollTopToReveal(5, 32, 32, 0, 352)).toBeNull();
    expect(scrollTopToReveal(4000, 32, 32, 0, 352)).toBe(32 * 4001 - 320);
    expect(scrollTopToReveal(2, 32, 32, 320, 352)).toBe(64);
  });
});

describe("pinned grid rows", () => {
  // Displayed order after a filter hides "a": only b and c remain.
  const displayed = new Map([["b", 0], ["c", 1]]);

  it("pins the displayed editor, selection and focus rows", () => {
    expect(gridPinnedRows(["c", "b", null, "c"], displayed, "b")).toEqual([1, 0, 1]);
  });

  it("pins the first row when the focused row is no longer displayed", () => {
    // The user scrolled away, then a filter hid the focused row "a". The
    // tabIndex=0 fallback is the first displayed row, so it must stay mounted.
    expect(gridPinnedRows(["a"], displayed, "a")).toEqual([0]);
    expect(gridPinnedRows([null], displayed, "gone")).toEqual([0]);
  });

  it("pins the first row when nothing is focused, but not otherwise", () => {
    expect(gridPinnedRows([null], displayed, null)).toEqual([0]);
    expect(gridPinnedRows([], displayed, undefined)).toEqual([0]);
    expect(gridPinnedRows([null], displayed, "c")).toEqual([]);
  });

  it("pins the first row for a focused draft row, which is not a displayed entity", () => {
    expect(gridPinnedRows(["draft"], displayed, "draft")).toEqual([0]);
  });
});

describe("measured row pitch", () => {
  it("uses the median rendered row so a few differing rows cannot skew it", () => {
    expect(measuredRowPitch([44, 28, 28, 28, 28])).toBe(28);
    expect(measuredRowPitch([28, 28, 30])).toBe(28);
    expect(measuredRowPitch([0, Number.NaN, 32])).toBe(32);
    expect(measuredRowPitch([])).toBeNull();
  });
});

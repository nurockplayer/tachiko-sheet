import { describe, expect, it } from "vitest";
import { adjacentFillBottom, fillDragTarget } from "./fill-handle.js";
import { rectangle } from "./clipboard.js";

const cell = (row: number, column: number) => rectangle({ row, column }, { row, column });
const filled = (...cells: string[]) => {
  const set = new Set(cells);
  return (row: number, column: number) => set.has(`${row}:${column}`);
};

describe("fill handle drag", () => {
  it("returns the rectangle from the source's top to the pointer row", () => {
    expect(fillDragTarget(cell(2, 1), 5)).toEqual({ top: 2, left: 1, bottom: 5, right: 1 });
  });

  it("keeps a multi-column source's width", () => {
    expect(fillDragTarget(rectangle({ row: 2, column: 1 }, { row: 2, column: 3 }), 4)).toEqual({ top: 2, left: 1, bottom: 4, right: 3 });
  });

  it("returns null when the pointer is not below the range", () => {
    expect(fillDragTarget(cell(2, 1), 1)).toBeNull();
  });

  it("returns null when the pointer is still on the source row", () => {
    expect(fillDragTarget(cell(2, 1), 2)).toBeNull();
  });

  it("returns null for a source spanning several rows", () => {
    expect(fillDragTarget(rectangle({ row: 0, column: 0 }, { row: 2, column: 0 }), 4)).toBeNull();
  });
});

describe("double-click fill limit", () => {
  it("uses the column left of the range", () => {
    expect(adjacentFillBottom(cell(0, 1), 3, filled("1:0", "2:0", "3:0"), 6)).toBe(3);
  });

  it("uses the column right of the range when there is none on the left", () => {
    expect(adjacentFillBottom(cell(0, 0), 3, filled("1:1", "2:1", "3:1"), 6)).toBe(3);
  });

  it("falls back to the right column when the left one has nothing below the range", () => {
    expect(adjacentFillBottom(cell(0, 1), 3, filled("1:2", "2:2"), 6)).toBe(2);
  });

  it("prefers the left column when both have data", () => {
    expect(adjacentFillBottom(cell(0, 1), 3, filled("1:0", "1:2", "2:2"), 6)).toBe(1);
  });

  it("stops at the row before the first empty cell in the adjacent column", () => {
    expect(adjacentFillBottom(cell(0, 1), 3, filled("1:0", "2:0"), 6)).toBe(2);
  });

  it("returns null when the adjacent column has nothing directly below the range", () => {
    expect(adjacentFillBottom(cell(0, 1), 3, filled("2:0"), 6)).toBeNull();
  });

  it("returns null when there is no adjacent column", () => {
    expect(adjacentFillBottom(cell(0, 0), 1, filled("1:0"), 6)).toBeNull();
  });
});

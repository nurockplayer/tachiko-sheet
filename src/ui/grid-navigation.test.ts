import { describe, expect, it } from "vitest";
import { edgeAddress, homeEndAddress, todayIsoDate } from "./grid-navigation.js";

const emptyExcept = (filled: readonly string[]) => (row: number, column: number): boolean => !filled.includes(`${row},${column}`);

describe("edgeAddress", () => {
  it("stops at the last filled cell of a run", () => {
    const isEmpty = emptyExcept(["0,0", "1,0", "2,0"]);
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowDown", 3, 3, isEmpty)).toEqual({ row: 2, column: 0 });
    expect(edgeAddress({ row: 2, column: 0 }, "ArrowUp", 3, 3, isEmpty)).toEqual({ row: 0, column: 0 });
    const horizontal = emptyExcept(["1,0", "1,1", "1,2"]);
    expect(edgeAddress({ row: 1, column: 0 }, "ArrowRight", 3, 3, horizontal)).toEqual({ row: 1, column: 2 });
    expect(edgeAddress({ row: 1, column: 2 }, "ArrowLeft", 3, 3, horizontal)).toEqual({ row: 1, column: 0 });
  });

  it("jumps over gaps to the next filled cell, then to the run edge", () => {
    const isEmpty = emptyExcept(["0,0", "3,0"]);
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowDown", 5, 2, isEmpty)).toEqual({ row: 3, column: 0 });
    expect(edgeAddress({ row: 3, column: 0 }, "ArrowUp", 5, 2, isEmpty)).toEqual({ row: 0, column: 0 });
    const twoRuns = emptyExcept(["0,0", "1,0", "2,0", "4,0"]);
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowDown", 5, 2, twoRuns)).toEqual({ row: 2, column: 0 });
    expect(edgeAddress({ row: 2, column: 0 }, "ArrowDown", 5, 2, twoRuns)).toEqual({ row: 4, column: 0 });
  });

  it("goes to the table edge when nothing is filled in that direction", () => {
    const isEmpty = emptyExcept([]);
    expect(edgeAddress({ row: 1, column: 1 }, "ArrowDown", 4, 4, isEmpty)).toEqual({ row: 3, column: 1 });
    expect(edgeAddress({ row: 1, column: 1 }, "ArrowUp", 4, 4, isEmpty)).toEqual({ row: 0, column: 1 });
    expect(edgeAddress({ row: 1, column: 1 }, "ArrowRight", 4, 4, isEmpty)).toEqual({ row: 1, column: 3 });
    expect(edgeAddress({ row: 1, column: 1 }, "ArrowLeft", 4, 4, isEmpty)).toEqual({ row: 1, column: 0 });
  });

  it("leaves a cell on the edge, an out-of-range cell or a one-cell table unchanged", () => {
    const isEmpty = emptyExcept([]);
    expect(edgeAddress({ row: 3, column: 1 }, "ArrowDown", 4, 4, isEmpty)).toEqual({ row: 3, column: 1 });
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowUp", 4, 4, isEmpty)).toEqual({ row: 0, column: 0 });
    expect(edgeAddress({ row: 0, column: 3 }, "ArrowRight", 4, 4, isEmpty)).toEqual({ row: 0, column: 3 });
    expect(edgeAddress({ row: 5, column: 0 }, "ArrowDown", 4, 4, isEmpty)).toEqual({ row: 5, column: 0 });
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowDown", 1, 1, isEmpty)).toEqual({ row: 0, column: 0 });
    expect(edgeAddress({ row: 0, column: 0 }, "ArrowRight", 1, 1, isEmpty)).toEqual({ row: 0, column: 0 });
    expect(edgeAddress({ row: 0, column: 0 }, "Enter", 4, 4, isEmpty)).toEqual({ row: 0, column: 0 });
  });
});

describe("homeEndAddress", () => {
  it("moves to the row start or end without a corner key", () => {
    expect(homeEndAddress({ row: 2, column: 1 }, "Home", false, 5, 4)).toEqual({ row: 2, column: 0 });
    expect(homeEndAddress({ row: 2, column: 1 }, "End", false, 5, 4)).toEqual({ row: 2, column: 3 });
  });

  it("moves to the first cell or the last row and column with a corner key", () => {
    expect(homeEndAddress({ row: 2, column: 1 }, "Home", true, 5, 4)).toEqual({ row: 0, column: 0 });
    expect(homeEndAddress({ row: 2, column: 1 }, "End", true, 5, 4)).toEqual({ row: 4, column: 3 });
  });

  it("leaves an empty or out-of-range table unchanged", () => {
    expect(homeEndAddress({ row: 0, column: 0 }, "End", true, 0, 0)).toEqual({ row: 0, column: 0 });
    expect(homeEndAddress({ row: 9, column: 0 }, "End", false, 5, 4)).toEqual({ row: 9, column: 0 });
  });
});

describe("todayIsoDate", () => {
  it("reads the local calendar date, never UTC", () => {
    expect(todayIsoDate(new Date(2026, 10, 1, 0, 30))).toBe("2026-11-01");
    expect(todayIsoDate(new Date(2026, 10, 1, 23, 30))).toBe("2026-11-01");
    expect(todayIsoDate(new Date(2026, 0, 9, 12, 0))).toBe("2026-01-09");
  });
});

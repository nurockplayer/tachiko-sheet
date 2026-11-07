import { describe, expect, it } from "vitest";
import type { GroupTotalsProjection } from "../../public/core-kit/runtime/protocol.js";
import { chartColorSlots, chartTicks, groupChartPoints, groupChartRefusal, pieSlices, shortChartLabel } from "./group-chart";

const points = (...values: number[]) => values.map((value, index) => ({ id: `g${index}`, label: `g${index}`, marked: false, value }));

describe("groupChartPoints", () => {
  const projection = (groups: GroupTotalsProjection["groups"]): GroupTotalsProjection => ({ revision: "r", dimensions: [], measures: ["m"], rows: 0, totals: [null], groups });

  it("keeps a blank apart from the text spelled the same", () => {
    const [blank, text] = groupChartPoints(projection([
      { keys: [{ kind: "blank" }], rows: 1, totals: [1] },
      { keys: [{ kind: "text", value: "(blank)" }], rows: 1, totals: [2] },
    ]), 0)!;
    expect(blank!.label).toBe(text!.label);
    expect(blank!.id).not.toBe(text!.id);
    expect([blank!.marked, text!.marked]).toEqual([true, false]);
  });

  it("keeps two-column keys apart when the joined labels match", () => {
    const [first, second] = groupChartPoints(projection([
      { keys: [{ kind: "text", value: "a · b" }, { kind: "text", value: "c" }], rows: 1, totals: [1] },
      { keys: [{ kind: "text", value: "a" }, { kind: "text", value: "b · c" }], rows: 1, totals: [2] },
    ]), 0)!;
    expect(first!.id).not.toBe(second!.id);
  });

  it("answers null when a total is unavailable", () => {
    expect(groupChartPoints(projection([{ keys: [{ kind: "blank" }], rows: 1, totals: [null] }]), 0)).toBeNull();
  });
});

describe("groupChartRefusal", () => {
  it("refuses unavailable totals and no groups", () => {
    expect(groupChartRefusal("bar", null)).toMatch(/unavailable/);
    expect(groupChartRefusal("line", [])).toMatch(/no groups/);
  });

  it("allows negative totals on a bar, not on a pie", () => {
    expect(groupChartRefusal("bar", points(3, -1))).toBeNull();
    expect(groupChartRefusal("pie", points(3, -1))).toMatch(/negative/);
  });

  it("limits a pie to eight groups and a bar to fifty", () => {
    expect(groupChartRefusal("pie", points(1, 1, 1, 1, 1, 1, 1, 1))).toBeNull();
    expect(groupChartRefusal("pie", points(1, 1, 1, 1, 1, 1, 1, 1, 1))).toMatch(/up to 8/);
    expect(groupChartRefusal("bar", points(...Array<number>(50).fill(1)))).toBeNull();
    expect(groupChartRefusal("bar", points(...Array<number>(51).fill(1)))).toMatch(/More than 50/);
  });

  it("refuses totals an axis can't scale, and every tick it does draw is finite", () => {
    for (const extreme of [[-5e-324, 5e-324], [-1e308, 1e308], [1.7e308]]) {
      expect(groupChartRefusal("bar", points(...extreme))).toMatch(/too large or too small/);
    }
    for (const edge of [[1e300, -1e300], [1e-300], [0, 1e-300]]) {
      expect(groupChartRefusal("line", points(...edge))).toBeNull();
      const ticks = chartTicks(edge);
      expect(ticks.length).toBeGreaterThan(1);
      expect(ticks.every(Number.isFinite)).toBe(true);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
  });

  it("refuses a pie of zeros", () => {
    expect(groupChartRefusal("pie", points(0, 0))).toMatch(/zero/);
  });
});

describe("chartTicks", () => {
  it("includes zero and covers every value", () => {
    expect(chartTicks([3, 17])).toEqual([0, 5, 10, 15, 20]);
    expect(chartTicks([-12, 7])).toEqual([-15, -10, -5, 0, 5, 10]);
  });

  it("answers for all zeros", () => {
    expect(chartTicks([0, 0])).toEqual([0, 1]);
  });
});

describe("pieSlices", () => {
  it("gives each value its share, skipping zeros", () => {
    const slices = pieSlices([1, 0, 3], 50, 40);
    expect(slices.map((slice) => [slice.index, slice.fraction])).toEqual([[0, 0.25], [2, 0.75]]);
    expect(slices[1]!.path).toContain(" 0 1 1 ");
  });

  it("draws one whole slice as a circle", () => {
    expect(pieSlices([5, 0], 50, 40)).toEqual([{ index: 0, fraction: 1, path: null }]);
  });

  it("draws a slice as a circle when rounding makes its ends meet", () => {
    const [big, small] = pieSlices([1_000_000, 1], 50, 40);
    expect(big!.fraction).toBeLessThan(1);
    expect(big!.path).toBeNull();
    expect(small!.path).not.toBeNull();
  });
});

describe("shortChartLabel", () => {
  it("cuts by character, not by code unit", () => {
    expect(shortChartLabel("預算表😀😀", 4)).toBe("預算表…");
    expect(shortChartLabel("short", 5)).toBe("short");
  });
});

describe("chartColorSlots", () => {
  it("keeps a group's slot when others go away", () => {
    const first = chartColorSlots(new Map(), ["a", "b", "c"]);
    const filtered = chartColorSlots(first, ["c"]);
    expect(filtered.get("c")).toBe(2);
    expect(chartColorSlots(filtered, ["d"]).get("d")).toBe(3);
  });

  it("starts over when every slot is taken", () => {
    const full = chartColorSlots(new Map(), ["a", "b"], 2);
    const next = chartColorSlots(full, ["c", "a"], 2);
    expect(next.get("c")).toBe(0);
    expect(next.get("a")).toBe(1);
  });
});

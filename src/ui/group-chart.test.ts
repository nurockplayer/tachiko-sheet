import { describe, expect, it } from "vitest";
import { chartColorSlots, chartTicks, groupChartRefusal, pieSlices, shortChartLabel } from "./group-chart";

const points = (...values: number[]) => values.map((value, index) => ({ label: `g${index}`, value }));

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

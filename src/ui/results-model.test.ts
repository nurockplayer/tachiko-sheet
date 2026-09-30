import { describe, expect, it } from "vitest";
import type { KeyedGroupedSumResult, ReportConfiguration } from "../contracts.js";
import { resultAnnouncementMessages, resultCardModels, resultChartGeometry, resultChartLabelFit, resultStatusLabel } from "./results-model.js";

const report: ReportConfiguration = {
  definitionId: "d1", type: "bar", title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false,
};
const result = (definitionId: string, revision = "r1", groups = [{ category: "PEN", value: 800 }], diagnostics: KeyedGroupedSumResult["diagnostics"] = []): KeyedGroupedSumResult => ({
  definitionId, revision, groups, diagnostics,
});

describe("per-definition Results projection", () => {
  it("keeps mixed definitions independent and binds report titles by definition identity", () => {
    const cards = resultCardModels({
      occurrence: "o1", revision: "r1", definitionIds: ["d1", "d2", "d3"],
      results: [result("d2", "r1", [{ category: "NOTE", value: 1000 }]), result("d1"), result("d3", "r1", [], [{ code: "bad", entity: null, field: null, lookup_key: null, candidates: [] }])],
      currentness: "current", report,
    });
    expect(cards.map(({ definitionId, state, title, showGroups }) => ({ definitionId, state, title, showGroups }))).toEqual([
      { definitionId: "d1", state: "A", title: "Sales by product", showGroups: true },
      { definitionId: "d2", state: "B", title: "Summary 2", showGroups: true },
      { definitionId: "d3", state: "D", title: "Summary 3", showGroups: false },
    ]);
  });

  it("distinguishes stale pending values, missing reads, unknown recovery and current revision mismatch", () => {
    const base = { occurrence: "o1", revision: "r2", definitionIds: ["d1"], report, results: [result("d1", "r1")] };
    expect(resultCardModels({ ...base, currentness: "pending", priorChartModes: new Map([["o1\u0000d1", "drawn"]]) })[0]?.state).toBe("C");
    expect(resultCardModels({ ...base, currentness: "pending", results: [] })[0]?.state).toBe("J");
    expect(resultCardModels({ ...base, currentness: "unknown" })[0]).toMatchObject({ state: "G", showGroups: false });
    expect(resultCardModels({ ...base, currentness: "current" })[0]?.state).toBe("E");
  });

  it("defers unsupported chart types, too many groups and zero/nonpositive values", () => {
    expect(resultCardModels({ occurrence: "o", revision: "r1", definitionIds: ["d1"], results: [result("d1")], currentness: "current", report: { ...report, type: "line" } })[0]?.state).toBe("K");
    expect(resultCardModels({ occurrence: "o", revision: "r1", definitionIds: ["d1"], results: [result("d1", "r1", Array.from({ length: 7 }, (_, i) => ({ category: `P${i}`, value: i + 1 })))], currentness: "current", report })[0]?.state).toBe("H");
    expect(resultCardModels({ occurrence: "o", revision: "r1", definitionIds: ["d1"], results: [result("d1", "r1", [])], currentness: "current", report })[0]?.state).toBe("I");
  });

  it("requires measured value labels to fit without deriving or truncating values", () => {
    const groups = [{ category: "A", value: 1000 }, { category: "B", value: 800 }];
    expect(resultChartLabelFit(groups, 224, () => 100)).toBe(true);
    expect(resultChartLabelFit(groups, 210, () => 100)).toBe(false);
    expect(resultChartLabelFit([{ category: "zero", value: 0 }], 240, () => 1)).toBe(false);
  });

  it("uses identical 12px-inset, equal-slot geometry for fit and drawing", () => {
    expect(resultChartGeometry(224, 2)).toEqual({ left: 12, right: 212, slot: 100, barWidth: 56, baseline: 151, height: 196 });
    expect(resultChartGeometry(100, 2)).toMatchObject({ slot: 38, barWidth: 22, baseline: 151, height: 196 });
    expect(resultChartGeometry(55, 1)).toBeNull();
    expect(resultChartGeometry(20, 1)).toBeNull();
  });

  it("keeps the bar minimum inside each equal category slot", () => {
    const geometry = resultChartGeometry(88, 2);
    expect(geometry).toMatchObject({ slot: 32, barWidth: 16 });
    expect(geometry!.barWidth).toBeLessThanOrEqual(geometry!.slot - 16);
  });

  it("uses title-based state announcements and leaves initial, C/C′, and generic pending silent", () => {
    const prior = new Map([
      ["d1", "B" as const], ["d2", "C" as const], ["d3", "J" as const], ["d4", "D" as const],
    ]);
    expect(resultAnnouncementMessages(prior, [
      { definitionId: "d1", title: "Sales by product", state: "J" },
      { definitionId: "d2", title: "Orders", state: "C′" },
      { definitionId: "d3", title: "Cost by product", state: "A" },
      { definitionId: "d4", title: "Refunds", state: "D" },
    ])).toEqual([
      "Sales by product is updating.",
      "Cost by product is up to date.",
    ]);
    expect(resultAnnouncementMessages(new Map(), [{ definitionId: "d1", title: "Sales by product", state: "A" }])).toEqual([]);
    expect(resultAnnouncementMessages(new Map([["d1", "B"]]), [{ definitionId: "d1", title: "Summary", state: "D" }])).toEqual(["Summary needs attention."]);
    expect(resultAnnouncementMessages(new Map([["d1", "D"]]), [{ definitionId: "d1", title: "Summary", state: "A" }])).toEqual(["Summary is up to date."]);
    expect(resultStatusLabel("E")).toBe("Needs attention");
    expect(resultStatusLabel("J")).toBe("Updating…");
  });
});

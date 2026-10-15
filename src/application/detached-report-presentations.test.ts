import { describe, expect, it } from "vitest";
import type { ReportConfiguration } from "../contracts.js";
import { DetachedReportPresentations } from "./detached-report-presentations.js";

const report: ReportConfiguration = {
  definitionId: "summary-1", type: "line", title: "売上", categoryLabel: "",
  valueLabel: "Revenue €", legendVisible: false,
};

describe("occurrence-local detached report presentations", () => {
  it("hides a removed source, retains every setting through repeated absence and restores exactly once", () => {
    const detached = new DetachedReportPresentations();
    expect(detached.reconcile("work-1", report, [])).toBeNull();
    expect(detached.reconcile("work-1", null, [])).toBeNull();
    expect(detached.reconcile("work-1", null, ["unrelated"])).toBeNull();
    expect(detached.reconcile("work-1", null, [report.definitionId])).toEqual(report);
    // Explicit Remove after restoration must not resurrect the presentation.
    expect(detached.reconcile("work-1", null, [report.definitionId])).toBeNull();
  });

  it("retains detached settings across same-occurrence observation and a Save of the truthful null report", () => {
    const detached = new DetachedReportPresentations();
    const currentForSave = detached.reconcile("work-1", report, []);
    expect(currentForSave).toBeNull();
    // Save receives only currentForSave; it neither serializes nor clears the cache.
    detached.observeOccurrence("work-1");
    expect(detached.reconcile("work-1", currentForSave, [report.definitionId])).toEqual(report);
  });

  it.each(["work-2", null])("clears detached settings at occurrence boundary %s, even if the same definition returns", (next) => {
    const detached = new DetachedReportPresentations();
    detached.reconcile("work-1", report, []);
    detached.observeOccurrence(next);
    expect(detached.reconcile(next ?? "work-1", null, [report.definitionId])).toBeNull();
  });

  it("keeps definitions distinct and never replaces an authored current report", () => {
    const detached = new DetachedReportPresentations();
    const sibling = { ...report, definitionId: "summary-2", title: "Second" };
    detached.reconcile("work-1", report, []);
    detached.reconcile("work-1", sibling, []);
    expect(detached.reconcile("work-1", null, [sibling.definitionId])).toEqual(sibling);
    expect(detached.reconcile("work-1", sibling, [report.definitionId, sibling.definitionId])).toEqual(sibling);
    expect(detached.reconcile("work-1", null, [report.definitionId])).toEqual(report);
    const edited = { ...report, title: "Edited after restore", type: "bar" as const, legendVisible: true };
    detached.reconcile("work-1", edited, []);
    expect(detached.reconcile("work-1", null, [report.definitionId])).toEqual(edited);
  });

  it("restores the latest detached configuration when multiple sources return together", () => {
    const detached = new DetachedReportPresentations();
    const sibling = { ...report, definitionId: "summary-2" };
    detached.reconcile("work-1", report, []);
    detached.reconcile("work-1", sibling, []);
    const latest = { ...report, title: "Newer authored configuration" };
    detached.reconcile("work-1", latest, []);
    expect(detached.reconcile("work-1", null, [report.definitionId, sibling.definitionId])).toEqual(latest);
  });
});

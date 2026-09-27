import { describe, expect, it, vi } from "vitest";

import {
  clearRecoveryOccurrenceContext,
  noResidentRecoveryState,
  openRecoveryRestoreDecision,
  presentationAfterConfirmedImport,
  recoverPresentationAfterAcknowledgedOpen,
  recoveryDraftAfterBoundary,
  runIfRecoveryCleared,
  settledSaveStatus,
  startInitialExampleOnce,
} from "./App.js";
import {
  bindingCatalogContainsDate,
  DATE_SUMMARY_UNSUPPORTED_MESSAGE,
  reportPresentationLimitViolation,
  reportPresentationTextLimitViolation,
} from "./contracts.js";
import { OpenedProjectionRecoveryError } from "./runtime/session.js";

describe("completed copy save status", () => {
  it("does not leave a completed write pending or claim a retained draft is saved", () => {
    expect(settledSaveStatus("saving", "revision-1", "revision-1", true)).toBe("not-saved");
    expect(settledSaveStatus("saving", "revision-1", "revision-1", false)).toBe("saved");
    expect(settledSaveStatus("saving", "revision-1", "revision-2", false)).toBe("not-saved");
    expect(settledSaveStatus("failed", "revision-1", "revision-1", false)).toBe("failed");
  });
});

describe("Date schema admission", () => {
  it("finds Date in selected or unrelated collections, including a schema with no rows", () => {
    expect(bindingCatalogContainsDate({ collections: [
      { key: "orders", fields: [{ key: "when", fieldType: "date" }] },
    ] })).toBe(true);
    expect(bindingCatalogContainsDate({ collections: [
      { key: "orders", fields: [{ key: "quantity", fieldType: "number" }] },
      { key: "unrelated-empty-table", fields: [{ key: "when", fieldType: "date" }] },
    ] })).toBe(true);
  });

  it("keeps non-Date types, including reference, admissible", () => {
    expect(bindingCatalogContainsDate({ collections: [
      { key: "orders", fields: [
        { key: "quantity", fieldType: "number" },
        { key: "product", fieldType: "reference" },
      ] },
    ] })).toBe(false);
    expect(DATE_SUMMARY_UNSUPPORTED_MESSAGE).toMatch(/Date column/);
  });
});

describe("report presentation Unicode bounds", () => {
  it("counts code points rather than UTF-16 code units and preserves blank values", () => {
    const atTitleLimit = "A".repeat(119) + "😀";
    const atLabelLimit = "界".repeat(79) + "😀";
    expect(atTitleLimit.length).toBe(121);
    expect(Array.from(atTitleLimit)).toHaveLength(120);
    expect(reportPresentationTextLimitViolation("title", atTitleLimit)).toBe(null);
    expect(reportPresentationTextLimitViolation("categoryLabel", atLabelLimit)).toBe(null);
    expect(reportPresentationTextLimitViolation("valueLabel", "")).toBe(null);
    expect(reportPresentationLimitViolation({
      title: atTitleLimit,
      categoryLabel: atLabelLimit,
      valueLabel: "",
    })).toEqual(null);
  });

  it("identifies the first over-limit presentation field without rewriting it", () => {
    const title = "名".repeat(120) + "😀";
    expect(reportPresentationTextLimitViolation("title", title)).toEqual({limit: 120, length: 121});
    expect(reportPresentationLimitViolation({
      title,
      categoryLabel: "",
      valueLabel: "",
    })).toEqual({field: "title", limit: 120, length: 121});
    expect(title).toBe("名".repeat(120) + "😀");
  });
});

describe("recovery draft lifecycle", () => {
  it("retains the draft only across its own authoritative reobserve", () => {
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "reobserve")).toBe(
      '{"kind":"number","input":"3"}',
    );
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "replacement")).toBe(null);
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "close")).toBe(null);
  });

  it("clears recovery state when authoritative reobserve finds no resident", () => {
    expect(noResidentRecoveryState()).toEqual({
      dirty: false,
      currentness: "current",
      outcome: "idle",
      message: "No resident work is available. Open a project to continue.",
      recoveryDraft: null,
    });
  });

  it("clears A recovery context in the replacement-open recovery catch", () => {
    const recoveryContext = { current: '{"kind":"number","input":"3"}' as string | null };
    try {
      throw new OpenedProjectionRecoveryError(new Error("B projection unavailable"), "unknown");
    } catch (error) {
      expect(clearRecoveryOccurrenceContext(recoveryContext, error)).toBe(true);
    }
    expect(recoveryContext.current).toBe(null);
  });
});

describe("unknown-open provenance recovery", () => {
  const checkpoint = {
    occurrence: "old-occurrence",
    revision: "old-revision",
    savedRevision: "old-revision",
    pendingDirty: false,
    draftDirty: false,
  };

  it("restores a receipt only for the same occurrence and matching revision", () => {
    expect(openRecoveryRestoreDecision(checkpoint, {
      occurrence: "old-occurrence",
      revision: "old-revision",
    })).toEqual({ sameOccurrence: true, saved: true });
    expect(openRecoveryRestoreDecision(checkpoint, {
      occurrence: "old-occurrence",
      revision: "new-revision",
    })).toEqual({ sameOccurrence: true, saved: false });
  });

  it("does not infer source identity from a different occurrence", () => {
    expect(openRecoveryRestoreDecision(checkpoint, {
      occurrence: "candidate-occurrence",
      revision: "old-revision",
    })).toEqual({ sameOccurrence: false, saved: false });
  });

  it("does not restore a receipt while a checkpoint had draft or dirty state", () => {
    expect(openRecoveryRestoreDecision({ ...checkpoint, pendingDirty: true }, checkpoint)).toEqual({
      sameOccurrence: true,
      saved: false,
    });
    expect(openRecoveryRestoreDecision({ ...checkpoint, draftDirty: true }, checkpoint)).toEqual({
      sameOccurrence: true,
      saved: false,
    });
    expect(openRecoveryRestoreDecision({ ...checkpoint, presentationDirty: true }, checkpoint)).toEqual({
      sameOccurrence: true,
      saved: false,
    });
  });

  it("blocks copy/export dispatches when an unknown open has no old checkpoint", () => {
    let createCalls = 0;
    let opaqueCalls = 0;
    let exportCalls = 0;
    const blocked = runIfRecoveryCleared(
      true,
      () => {
        createCalls += 1;
        opaqueCalls += 1;
        exportCalls += 1;
        return "dispatched";
      },
      () => "blocked",
    );
    expect(blocked).toBe("blocked");
    expect(createCalls).toBe(0);
    expect(opaqueCalls).toBe(0);
    expect(exportCalls).toBe(0);
    expect(runIfRecoveryCleared(false, () => "reopened", () => "blocked")).toBe("reopened");
  });
});

describe("confirmed import presentation isolation", () => {
  it("clears an old occurrence report and its dirty marker only after confirmed import", () => {
    expect(presentationAfterConfirmedImport({
      definitionId: "old-summary",
      type: "line",
      title: "Old report",
      categoryLabel: "Category",
      valueLabel: "Value",
      legendVisible: true,
    })).toEqual({ report: null, presentationDirty: false });
  });
});

describe("acknowledged saved-open presentation recovery", () => {
  const presentation = {
    version: 1 as const,
    report: {
      definitionId: "definition-1",
      type: "bar" as const,
      title: "Saved report",
      categoryLabel: "Category",
      valueLabel: "Value",
      legendVisible: true,
    },
    snapshotRevision: "rev-1",
    snapshotDigest: "a".repeat(64),
  };
  const result = {
    definitionId: "definition-1",
    revision: "rev-1",
    groups: [{ category: "Alpha", value: 3 }],
    diagnostics: [],
  };

  it("binds after the same replacement and a fresh clean result even when a new resident session resets revision", () => {
    expect(recoverPresentationAfterAcknowledgedOpen(
      { occurrence: "replacement", presentation },
      { occurrence: "replacement", revision: "resident/0" },
      [{ ...result, revision: "resident/0" }],
    )).toEqual(presentation.report);
  });

  it("isolates a different occurrence, stale result, or failed result", () => {
    expect(recoverPresentationAfterAcknowledgedOpen(
      { occurrence: "replacement", presentation },
      { occurrence: "other", revision: "rev-1" },
      [result],
    )).toBe(null);
    expect(recoverPresentationAfterAcknowledgedOpen(
      { occurrence: null, presentation },
      { occurrence: "replacement", revision: "rev-2" },
      [result],
    )).toBe(null);
    expect(recoverPresentationAfterAcknowledgedOpen(
      { occurrence: "replacement", presentation },
      { occurrence: "replacement", revision: "rev-1" },
      [{ ...result, diagnostics: [{ code: "failed", entity: null, field: null, lookup_key: null, candidates: [] }] }],
    )).toBe(null);
  });
});

describe("first-entry example launch", () => {
  it("dispatches once and does not retry after a known failure", async () => {
    const attempted = { current: false };
    const failure = new Error("fixture unavailable");
    const openExample = vi.fn(async () => { throw failure; });
    const onKnownFailure = vi.fn();
    const onSettled = vi.fn();

    startInitialExampleOnce(attempted, openExample, onKnownFailure, onSettled);
    startInitialExampleOnce(attempted, openExample, onKnownFailure, onSettled);
    await Promise.resolve();
    await Promise.resolve();

    expect(openExample).toHaveBeenCalledTimes(1);
    expect(onKnownFailure).toHaveBeenCalledWith(failure);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(attempted.current).toBe(true);
  });

  it("keeps the completed launch latch after Close", async () => {
    const attempted = { current: false };
    const openExample = vi.fn(async () => undefined);

    const onSettled = vi.fn();
    startInitialExampleOnce(attempted, openExample, vi.fn(), onSettled);
    await Promise.resolve();
    // Close deliberately does not reset the mount-scoped latch.
    startInitialExampleOnce(attempted, openExample, vi.fn(), onSettled);
    await Promise.resolve();

    expect(openExample).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(attempted.current).toBe(true);
  });
});

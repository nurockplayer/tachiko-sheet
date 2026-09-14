import { describe, expect, it } from "vitest";

import {
  clearRecoveryOccurrenceContext,
  noResidentRecoveryState,
  openRecoveryRestoreDecision,
  presentationAfterConfirmedImport,
  recoveryDraftAfterBoundary,
  runIfRecoveryCleared,
} from "./App.js";
import { OpenedProjectionRecoveryError } from "./runtime/session.js";

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

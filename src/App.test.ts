import { describe, expect, it } from "vitest";

import {
  clearRecoveryOccurrenceContext,
  confirmedReportSource,
  noResidentRecoveryState,
  openRecoveryRestoreDecision,
  presentationAfterConfirmedImport,
  recoverPresentationAfterAcknowledgedOpen,
  recoveryDraftAfterBoundary,
  runIfRecoveryCleared,
  settledSaveStatus,
  resolveSalesSummaryBinding,
  salesReportConfiguration,
  salesEntryOutcomeAfterReplacement,
  salesEntryOutcomeAfterCleanupFailure,
  salesEntryTipAfterSuccessfulSave,
  salesInitialOccurrenceAfterConfirmedChange,
  salesChangeOccurrenceAfterConfirmedEdit,
  salesMarkersAfterBoundary,
  targetedResultRefreshIsAdmitted,
  savedCopiesRequestIsCurrent,
} from "./App.js";
import {
  bindingCatalogContainsDate,
  DATE_SUMMARY_UNSUPPORTED_MESSAGE,
  reportPresentationLimitViolation,
  reportPresentationTextLimitViolation,
  savedCopiesAreVisible,
  LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE,
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

describe("Sales tip and initial footer lifecycle", () => {
  const markers = {
    salesEntryTip: { occurrence: "sales-1", collection: "catalog", field: "price" },
    salesCatalogLayout: { occurrence: "sales-1", collectionId: "catalog-id" },
    salesInitialOccurrence: "sales-1",
    salesChangedOccurrence: null,
  };

  it("clears every UI-only marker only when an occurrence is abandoned", () => {
    expect(salesMarkersAfterBoundary(markers, "abandon")).toEqual({
      salesEntryTip: null, salesCatalogLayout: null, salesInitialOccurrence: null, salesChangedOccurrence: null,
    });
    for (const boundary of ["unknown-open-recovery", "prepublication-refusal", "unknown-publication"] as const) {
      expect(salesMarkersAfterBoundary(markers, boundary)).toEqual(markers);
    }
  });

  it("ends initial D10 only for a known publication in the matching occurrence and does not claim Updated", () => {
    expect(salesMarkersAfterBoundary(markers, "known-publication-recovery", "sales-1")).toEqual({
      ...markers, salesInitialOccurrence: null,
    });
    expect(salesMarkersAfterBoundary(markers, "known-publication-recovery", "sales-1", true)).toEqual({
      ...markers, salesInitialOccurrence: null, salesChangedOccurrence: "sales-1",
    });
    expect(salesMarkersAfterBoundary(markers, "known-publication-recovery", "other-occurrence")).toEqual(markers);
  });

  it("clears the initial footer only for a confirmed change in its occurrence", () => {
    expect(salesInitialOccurrenceAfterConfirmedChange("sales-1", "sales-2")).toBe("sales-1");
    expect(salesInitialOccurrenceAfterConfirmedChange("sales-1", "sales-1")).toBe(null);
  });

  it("marks the tip Updated only for a confirmed edit in the matching Sales occurrence", () => {
    const marker = { occurrence: "sales-1", collection: "catalog", field: "price" };
    expect(salesChangeOccurrenceAfterConfirmedEdit(marker, "sales-1")).toBe("sales-1");
    expect(salesChangeOccurrenceAfterConfirmedEdit(marker, "sales-2")).toBe(null);
    expect(salesChangeOccurrenceAfterConfirmedEdit(null, "sales-1")).toBe(null);
  });
});

describe("targeted Results refresh admission", () => {
  const witness = { occurrence: "o1", revision: "r1" };
  const live = { occurrence: "o1", revision: "r1" };
  it("requires currentness, exact occurrence/revision, and a known definition", () => {
    expect(targetedResultRefreshIsAdmitted({ currentness: "current", live, witness, definitionIds: ["d1"], definitionId: "d1" })).toBe(true);
    expect(targetedResultRefreshIsAdmitted({ currentness: "pending", live, witness, definitionIds: ["d1"], definitionId: "d1" })).toBe(false);
    expect(targetedResultRefreshIsAdmitted({ currentness: "current", live: { ...live, revision: "r2" }, witness, definitionIds: ["d1"], definitionId: "d1" })).toBe(false);
    expect(targetedResultRefreshIsAdmitted({ currentness: "current", live, witness, definitionIds: ["d1"], definitionId: "foreign" })).toBe(false);
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

describe("coordinated Sales entry bindings", () => {
  const catalog = { collections: [
    { key: "sales", fields: [
      { key: "product_code", fieldType: "text" },
      { key: "quantity", fieldType: "number" },
    ] },
    { key: "catalog", fields: [
      { key: "code", fieldType: "text" },
      { key: "category", fieldType: "text" },
      { key: "price", fieldType: "number" },
    ] },
  ] };

  it("resolves the exact field identities and types from the authoritative catalog", () => {
    expect(resolveSalesSummaryBinding(catalog)).toEqual({
      ordersCollection: "sales",
      orderLookupKeyField: "product_code",
      orderQuantityField: "quantity",
      productsCollection: "catalog",
      productKeyField: "code",
      productCategoryField: "category",
      productPriceField: "price",
    });
  });

  it("refuses missing, duplicate, or wrong-type identities instead of choosing a nearby field", () => {
    expect(() => resolveSalesSummaryBinding({ collections: [...catalog.collections,
      { key: "sales", fields: [] },
    ] })).toThrow(/resolved uniquely/);
    expect(() => resolveSalesSummaryBinding({ collections: [
      { ...catalog.collections[0]!, fields: catalog.collections[0]!.fields.filter((field) => field.key !== "quantity") },
      catalog.collections[1]!,
    ] })).toThrow(/sales.quantity/);
    expect(() => resolveSalesSummaryBinding({ collections: [
      { ...catalog.collections[0]!, fields: [
        { key: "product_code", fieldType: "text" }, { key: "quantity", fieldType: "text" },
      ] },
      catalog.collections[1]!,
    ] })).toThrow(/sales.quantity/);
  });

  it("admits only one current clean generated definition as a report source", () => {
    const live = { revision: "revision-2" };
    const source = { definitionId: "generated-1", revision: "revision-2", groups: [], diagnostics: [] };
    expect(confirmedReportSource(live, [source], "generated-1")).toEqual(source);
    expect(confirmedReportSource(live, [{ ...source, revision: "revision-1" }], "generated-1")).toBe(null);
    expect(confirmedReportSource(live, [{ ...source, diagnostics: [{ code: "invalid", entity: null, field: null, lookup_key: null, candidates: [] }] }], "generated-1")).toBe(null);
    expect(confirmedReportSource(live, [source, source], "generated-1")).toBe(null);
  });

  it("uses the fixed approved Sales report copy", () => {
    expect(salesReportConfiguration("generated-1")).toEqual({
      definitionId: "generated-1", type: "bar", title: "Sales by product",
      categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false,
    });
  });
});

describe("Sales entry recovery outcomes", () => {
  it("does not collapse acknowledged or unknown Open recovery into a refusal", () => {
    expect(salesEntryOutcomeAfterReplacement("acknowledged-recovery")).toEqual({ kind: "acknowledged-open-recovery" });
    expect(salesEntryOutcomeAfterReplacement("unknown-recovery")).toEqual({ kind: "unknown-open-recovery" });
    expect(salesEntryOutcomeAfterReplacement("confirmed")).toBe(null);
    expect(salesEntryOutcomeAfterReplacement("refused")?.kind).toBe("refused");
  });

  it("routes a pre-Open startup failure to the typed unavailable state", () => {
    expect(salesEntryOutcomeAfterReplacement("startup-unavailable")).toEqual({ kind: "startup-unavailable" });
  });

  it("requires page reload after a failed owned cleanup, without claiming an unknown create", () => {
    expect(salesEntryOutcomeAfterCleanupFailure()).toEqual({
      kind: "reload-required",
      message: LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE,
    });
    expect(LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE).not.toMatch(/schema|close failed/i);
  });

  it("clears the one-shot marker for the saved occurrence only", () => {
    const marker = { occurrence: "sales-1", collection: "catalog", field: "price" };
    expect(salesEntryTipAfterSuccessfulSave(marker, "sales-1")).toBe(null);
    expect(salesEntryTipAfterSuccessfulSave(marker, "sales-2")).toBe(marker);
  });
});

describe("saved-copy inventory freshness", () => {
  it("hides stale entries while checking or unavailable and accepts only the latest request", () => {
    expect(savedCopiesAreVisible("checking", 3)).toBe(false);
    expect(savedCopiesAreVisible("unavailable", 3)).toBe(false);
    expect(savedCopiesAreVisible("ready", 0)).toBe(false);
    expect(savedCopiesAreVisible("ready", 3)).toBe(true);
    expect(savedCopiesRequestIsCurrent(2, 3)).toBe(false);
    expect(savedCopiesRequestIsCurrent(3, 3)).toBe(true);
  });
});

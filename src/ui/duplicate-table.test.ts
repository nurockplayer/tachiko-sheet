import { describe, expect, it } from "vitest";
import { duplicateLanding, duplicateNameEnterAction, duplicateOutcomeSettlement, suggestedDuplicateName, supportsDuplicateTable } from "./duplicate-table.js";

describe("table duplication command", () => {
  it("is offered only by a kit that publishes the capability", () => {
    expect(supportsDuplicateTable).toBe(true);
  });

  it("starts from the current table name plus copy, leaving admission to Work", () => {
    expect(suggestedDuplicateName("Expenses")).toBe("Expenses copy");
    expect(suggestedDuplicateName("  Quarter 1  ")).toBe("  Quarter 1   copy");
  });
});

describe("duplicateNameEnterAction", () => {
  it("submits a typed Enter", () => {
    expect(duplicateNameEnterAction({ key: "Enter" })).toBe("submit");
  });

  it("never submits an IME confirmation key", () => {
    expect(duplicateNameEnterAction({ key: "Enter", composing: true })).toBe(null);
    expect(duplicateNameEnterAction({ key: "Enter", keyCode: 229 })).toBe(null);
    expect(duplicateNameEnterAction({ key: "Enter", composing: true, keyCode: 229 })).toBe(null);
  });

  it("does nothing for any other key", () => {
    expect(duplicateNameEnterAction({ key: "Escape" })).toBe(null);
    expect(duplicateNameEnterAction({ key: "a" })).toBe(null);
  });
});

describe("duplicateLanding", () => {
  it("lands in the Table panel only for the copy a publication confirmed", () => {
    expect(duplicateLanding({ kind: "confirmed" })).toEqual({ switchToTable: true });
    expect(duplicateLanding({ kind: "refused", message: "This name is already used. Choose a distinct name." }))
      .toEqual({ switchToTable: false });
    expect(duplicateLanding({ kind: "recovery" })).toEqual({ switchToTable: false });
  });
});

describe("duplicate outcome settlement", () => {
  it("closes the dialog only after a confirmed publication", () => {
    expect(duplicateOutcomeSettlement({ kind: "confirmed" })).toEqual({ close: true, error: null });
    expect(duplicateOutcomeSettlement({ kind: "recovery" })).toEqual({ close: true, error: null });
  });

  it("keeps the dialog open with Work's typed duplicate-name refusal", () => {
    const settled = duplicateOutcomeSettlement({
      kind: "refused",
      message: "The row change was not applied. (Details: a name could not be admitted)",
      nameFailures: [{ reason: "duplicate_display_name", inputs: [{ kind: "table" }], subjects: [], effective_name: "Expenses" }],
    });
    expect(settled).toEqual({ close: false, error: "This name is already used. Choose a distinct name." });
  });

  it("keeps the dialog open with Work's typed invalid-name refusal", () => {
    const settled = duplicateOutcomeSettlement({
      kind: "refused",
      message: "a name could not be admitted",
      nameFailures: [{ reason: "empty_display_name", inputs: [{ kind: "table" }], subjects: [], effective_name: null }],
    });
    expect(settled).toEqual({ close: false, error: "Enter a name that isn't only spaces." });
  });

  it("keeps any other refusal message exactly as it arrived", () => {
    expect(duplicateOutcomeSettlement({ kind: "refused", message: "This change belongs to an older view. Refresh before trying again." }))
      .toEqual({ close: false, error: "This change belongs to an older view. Refresh before trying again." });
  });
});

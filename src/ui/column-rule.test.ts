import { describe, expect, it } from "vitest";
import { columnRuleDraft, columnRuleInput, columnRuleKind, columnRuleSettlement } from "./column-rule.js";

describe("column rules", () => {
  it("maps supported field types", () => {
    expect(columnRuleKind("text")).toBe("list");
    expect(columnRuleKind("number")).toBe("range");
    expect(columnRuleKind("date")).toBeNull();
    expect(columnRuleKind("boolean")).toBeNull();
  });

  it("prefills list and range drafts from Work constraints", () => {
    expect(columnRuleDraft({ field_type: "text", constraint: { kind: "text_literal_set", values: ["Todo", "Doing", "Done"] } }))
      .toEqual({ kind: "list", values: "Todo\nDoing\nDone", min: "", max: "" });
    expect(columnRuleDraft({ field_type: "number", constraint: { kind: "number_inclusive_range", min: 1, max: 5 } }))
      .toEqual({ kind: "range", values: "", min: "1", max: "5" });
    expect(columnRuleDraft({ field_type: "text" })).toEqual({ kind: "list", values: "", min: "", max: "" });
    expect(columnRuleDraft({ field_type: "date" })).toBeNull();
  });

  it("sends allowed values exactly as typed and drops only empty lines", () => {
    expect(columnRuleInput({ kind: "list", values: " Todo \n\nDone\r\n", min: "", max: "" }))
      .toEqual({ input: { kind: "text_literal_set", values: [" Todo ", "Done"] } });
    // An unchanged prefill round-trips Work's values literally.
    const draft = columnRuleDraft({ field_type: "text", constraint: { kind: "text_literal_set", values: ["  padded", "Done"] } })!;
    expect(columnRuleInput(draft)).toEqual({ input: { kind: "text_literal_set", values: ["  padded", "Done"] } });
    expect(columnRuleInput({ kind: "list", values: "Active\n \nInactive", min: "", max: "" }))
      .toEqual({ input: { kind: "text_literal_set", values: ["Active", " ", "Inactive"] } });
    expect(columnRuleInput({ kind: "list", values: "\n\r\n", min: "", max: "" }))
      .toEqual({ error: "Enter at least one allowed value." });
  });

  it("parses numeric bounds without deciding rule admissibility", () => {
    expect(columnRuleInput({ kind: "range", values: "", min: "1", max: " 5 " }))
      .toEqual({ input: { kind: "number_inclusive_range", min: 1, max: 5 } });
    expect(columnRuleInput({ kind: "range", values: "", min: "-2.5", max: "5" }))
      .toEqual({ input: { kind: "number_inclusive_range", min: -2.5, max: 5 } });
    expect(columnRuleInput({ kind: "range", values: "", min: "1e3", max: ".5" }))
      .toEqual({ input: { kind: "number_inclusive_range", min: 1000, max: 0.5 } });
    for (const [min, max] of [["abc", "5"], ["1", ""], ["1e999", "5"]]) {
      expect(columnRuleInput({ kind: "range", values: "", min, max }))
        .toEqual({ error: "Enter a number for both the lowest and highest value." });
    }
  });

  it("settles confirmed, refused, and recovery outcomes", () => {
    expect(columnRuleSettlement({ kind: "confirmed" })).toEqual({ close: true, error: null, confirmed: true });
    expect(columnRuleSettlement({ kind: "refused", message: "Work refused this rule." })).toEqual({ close: false, error: "Work refused this rule.", confirmed: false });
    // A recovery's outcome is unknown, so it is never announced as applied.
    expect(columnRuleSettlement({ kind: "recovery" })).toEqual({ close: true, error: null, confirmed: false });
  });
});

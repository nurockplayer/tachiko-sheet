import { describe, expect, it } from "vitest";
import { draftKeyAction, draftRefusal, firstMissingDraftColumn } from "./row-entry-model.js";
const columns = [
  { id: "text", key: "text", display_name: "Item", field_type: "text" },
  { id: "number", key: "number", display_name: "Price", field_type: "number" },
  { id: "date", key: "date", display_name: "When", field_type: "date" },
  { id: "boolean", key: "boolean", display_name: "Paid", field_type: "boolean" },
];
describe("in-grid draft row intent", () => {
  it("requires scalar presence without validating Number or Date; empty Text, zero and false are input", () => {
    expect(firstMissingDraftColumn(columns, {})?.id).toBe("number");
    expect(firstMissingDraftColumn(columns, { number: "0", date: "2026-10-19", boolean: "false" })).toBeUndefined();
    expect(firstMissingDraftColumn(columns, { number: "abc", date: "not-a-date", boolean: "true" })).toBeUndefined();
    expect(firstMissingDraftColumn(columns, { number: "  " })?.id).toBe("number");
    expect(firstMissingDraftColumn(columns, { number: "1", date: "2026-10-19" })?.id).toBe("boolean");
  });
  it("publishes only explicit forward Enter or last-cell Tab", () => {
    expect(draftKeyAction("Enter", false, false)).toBe("publish");
    expect(draftKeyAction("Tab", false, true)).toBe("publish");
    expect(draftKeyAction("Tab", false, false)).toBe("next");
    expect(draftKeyAction("Tab", true, true)).toBe("previous");
    expect(draftKeyAction("Enter", true, true)).toBe("previous");
    for (const key of ["Escape", "blur", "ArrowDown"]) expect(draftKeyAction(key, false, true)).toBeNull();
  });
  it("maps only an unambiguous refusal and never displays raw engine details", () => {
    const name = (column: typeof columns[number]) => column.display_name;
    expect(draftRefusal(columns, {}, "number", "Details: invalid_number", name)).toEqual({ message: "Price needs a number.", fields: ["number"] });
    const duplicate = [...columns, { ...columns[1]!, id: "other", display_name: "Quantity" }];
    expect(draftRefusal(duplicate, { number: "abc", other: "abc" }, "number", "'abc' is not a finite Number", name).fields).toBeUndefined();
    expect(draftRefusal(duplicate, { number: "abc", other: "5" }, "number", "'abc' is not a finite Number", name).fields).toEqual(["number"]);
    expect(draftRefusal(duplicate, {}, undefined, "Details: secret engine prose", name).message).not.toContain("Details");
  });
});

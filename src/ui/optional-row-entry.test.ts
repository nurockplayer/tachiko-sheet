import { describe, expect, it } from "vitest";
import { draftInitializers, draftKeyAction, draftReadiness, firstMissingDraftColumn, hasDraftInput } from "./row-entry-model.js";
const columns = [
  { id: "t", key: "t", display_name: "Text", field_type: "text", required: false },
  { id: "n", key: "n", display_name: "Number", field_type: "number", required: false },
  { id: "other", key: "other", display_name: "Other text", field_type: "text", required: false },
];
describe("optional draft initialization", () => {
  it.each<Record<string, string>>([{}, { t: "", n: "", other: "" }])("does not publish or demand a missing value for an untouched all-optional draft", values => {
    expect(hasDraftInput(values)).toBe(false);
    expect(firstMissingDraftColumn(columns, values)).toBeUndefined();
    expect(draftReadiness(columns, values)).toBe("untouched");
    expect(draftKeyAction("Enter", false, true, "untouched")).toBe("edit");
    expect(draftKeyAction("Tab", false, true, "untouched")).toBe("leave");
    expect(draftInitializers(columns, values)).toEqual([]);
  });
  it("omits untouched optional Text/Number rather than filling them", () => {
    expect(draftReadiness(columns, { t: "Partial" })).toBe("complete");
    expect(draftInitializers(columns, { t: "Partial", n: "", other: "" })).toEqual([{ field: "t", input: { kind: "text", value: "Partial" } }]);
  });
  it("keeps optional-only zero and whitespace as explicit raw values", () => {
    expect(draftInitializers(columns, { t: " ", n: "0" })).toEqual([{ field: "t", input: { kind: "text", value: " " } }, { field: "n", input: { kind: "number", input: "0" } }]);
    expect(draftReadiness(columns, { n: "0" })).toBe("complete");
  });
  it("passes invalid optional Number input to Work without mutating the retained draft", () => {
    const values = { t: "Retained", n: "abc" };
    expect(draftReadiness(columns, values)).toBe("complete");
    expect(draftInitializers(columns, values)).toEqual([{ field: "t", input: { kind: "text", value: "Retained" } }, { field: "n", input: { kind: "number", input: "abc" } }]);
    expect(values).toEqual({ t: "Retained", n: "abc" });
  });
  it("requires only required non-Text presence and initializes required empty Text", () => {
    const mixed = [...columns, { ...columns[0]!, id: "required-text", required: true }, { ...columns[1]!, id: "required-number", required: true }];
    expect(firstMissingDraftColumn(mixed, { t: "x" })?.id).toBe("required-number");
    expect(draftReadiness(mixed, { "required-number": "0" })).toBe("complete");
    expect(draftInitializers(mixed, { "required-number": "0" })).toEqual([{ field: "required-text", input: { kind: "text", value: "" } }, { field: "required-number", input: { kind: "number", input: "0" } }]);
  });
  it("keeps required zero/false/empty-Text initialization exactly typed", () => {
    const required = [{ ...columns[0]!, required: true }, { ...columns[1]!, required: true }, { ...columns[0]!, id: "b", field_type: "boolean", required: true }];
    expect(draftInitializers(required, { n: "0", b: "false" })).toEqual([{ field: "t", input: { kind: "text", value: "" } }, { field: "n", input: { kind: "number", input: "0" } }, { field: "b", input: { kind: "boolean", value: false } }]);
  });
});

import { describe, expect, it } from "vitest";
import { columnFill, columnRefusal, fillChoiceRequired, initialColumnDraft } from "./column-operations.js";

describe("column intent", () => {
  it("requires an explicit typed choice only for populated tables", () => {
    for (const type of ["number", "date", "boolean"] as const) {
      expect(fillChoiceRequired(type, 3, "")).toBe(true);
      expect(fillChoiceRequired(type, 0, "")).toBe(false);
    }
    expect(fillChoiceRequired("text", 3, "")).toBe(false);
    expect(fillChoiceRequired("number", 3, "0")).toBe(false);
    expect(fillChoiceRequired("boolean", 3, "no")).toBe(false);
  });
  it("does not normalize or parse Work's raw inputs", () => {
    for (const fill of ["NaN", "1,300", "", " 4 "]) expect(columnFill({ name: "n", fieldType: "number", fill })).toEqual({ kind: "number", input: fill });
    expect(columnFill({ name: "d", fieldType: "date", fill: "2026-02-30" })).toEqual({ kind: "date", value: "2026-02-30" });
    expect(columnFill({ name: "b", fieldType: "boolean", fill: "" })).toBeNull();
    expect(columnFill({ name: "b", fieldType: "boolean", fill: "no" })).toEqual({ kind: "boolean", value: false });
    expect(columnFill({ name: "t", fieldType: "text", fill: "" })).toEqual({ kind: "text", value: "" });
  });
  it("opens a fresh fill choice and keeps rename text verbatim", () => {
    expect(initialColumnDraft({ kind: "rename", occurrence: "o", revision: "r", collection: "c", rowEntities: ["e"], field: "f", name: "  Price  " })).toEqual({ name: "  Price  ", fieldType: "text", fill: "", required: false, fillExisting: false });
  });
  it("translates authoritative refusal evidence", () => {
    expect(columnRefusal("schema field 'x' is still referenced by a formula or saved definition")).toMatch(/used by a formula or cross-table summary/);
    expect(columnRefusal("a native table needs at least one column")).toMatch(/Keep at least one column/);
    expect(columnRefusal("raw", "number")).toMatch(/Enter a number/);
    expect(columnRefusal("unfamiliar refusal")).toBe("unfamiliar refusal");
  });
});

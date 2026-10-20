import { describe, expect, it } from "vitest";
import { cellEditSlot, cellEditorUnchanged, pastedCellEdit } from "./cell-edit-slot.js";
import { routePaste } from "./clipboard.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const column = (kind = "text"): TableColumn => ({ id: "f", key: "key", display_name: "Name", field_type: kind, required: false });
const blank: TableRow = { id: "entity", key: "row", fields: [], blank_fields: ["f"] };
describe("authoritative sparse edit slots", () => {
  it.each(["text", "number"])("addresses a blank %s by entity and field, without a FieldProjection", kind => {
    const slot = cellEditSlot(blank, column(kind))!;
    expect(slot).toEqual({ target: { entity: "entity", field: "f" }, kind, original: "", blank: true, formula: false });
    expect(pastedCellEdit(slot, kind === "text" ? "typed" : "0")).toEqual({ target: slot.target,
      input: kind === "text" ? { kind, value: "typed" } : { kind, input: "0" } });
  });
  it("never infers a blank from a missing field or a missing membership list", () => {
    for (const blank_fields of [undefined, [], ["different"]]) expect(cellEditSlot({ ...blank, blank_fields }, column())).toBeNull();
    expect(cellEditSlot(blank, { ...column(), required: true })).toBeNull();
    for (const type of ["date", "boolean", "reference", "unknown"]) expect(cellEditSlot(blank, column(type))).toBeNull();
  });
  it("uses the existing entity identity join when other present fields exist", () => {
    const row: TableRow = { ...blank, fields: [{ target: { entity: "semantic-entity", field: "other" }, address: "a", stored: { kind: "text", value: "x" }, formula: null, calculated: null, diagnostics: [], editable_scalar: "text" }] };
    expect(cellEditSlot(row, column())?.target).toEqual({ entity: "semantic-entity", field: "f" });
  });
  it.each(["text", "number"])("leaves unchanged/empty blank %s editors and clipboard cells unpublished", kind => {
    const slot = cellEditSlot(blank, column(kind))!;
    expect(cellEditorUnchanged(slot, "", "")).toBe(true);
    expect(cellEditorUnchanged(slot, "", "typed")).toBe(false);
    expect(pastedCellEdit(slot, "")).toBeNull();
    expect(pastedCellEdit(slot, " ")!.input).toEqual(kind === "text" ? { kind, value: " " } : { kind, input: " " });
  });
  it.each(["text", "number", "date"])("retains present %s target/empty-paste behavior", kind => {
    const col = column(kind);
    const field = { target: { entity: "entity", field: col.id }, address: "a", stored: { kind: "text" as const, value: "present" }, formula: null, calculated: null, diagnostics: [], editable_scalar: kind as "text" | "number" | "date" | "boolean" };
    const slot = cellEditSlot({ ...blank, blank_fields: [], fields: [field] }, col)!;
    expect(slot.blank).toBe(false);
    expect(pastedCellEdit(slot, "")!.input).toEqual(kind === "number" ? { kind, input: "" } : kind === "boolean" ? { kind, value: false } : { kind, value: "" });
    expect(cellEditorUnchanged(slot, "present", "")).toBe(false);
  });
  it("retains non-editable and formula evidence from present projections", () => {
    const field = { target: { entity: "entity", field: "f" }, address: "a", stored: null, formula: { source: "1" }, calculated: null, diagnostics: [], editable_scalar: null };
    expect(cellEditSlot({ ...blank, fields: [field] }, column())).toBeNull();
  });
  it("routes a rectangle of blank slots atomically and keeps the original 1,024-cell cap", () => {
    const context = { native: true, draft: false, blocked: false, pendingDraft: false, rowCount: 128, start: { row: 0, column: 0 }, columnTypes: Array(9).fill("text"), columnRequired: Array(9).fill(false), editable: () => Boolean(cellEditSlot(blank, column())) };
    expect(routePaste(Array.from({ length: 128 }, () => Array(8).fill("")), context).kind).toBe("edit");
    expect(routePaste(Array.from({ length: 128 }, () => Array(9).fill("")), context)).toMatchObject({ kind: "refused", message: expect.stringContaining("1,024-cell") });
  });
});

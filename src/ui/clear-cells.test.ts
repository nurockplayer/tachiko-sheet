import { describe, expect, it } from "vitest";
import { cellEditSlot, cellEditorUnchanged, emptyCellEdit, pastedCellEdit } from "./cell-edit-slot.js";
import { clearCellEdits } from "./clear-cells.js";
import { rectangle, routePaste } from "./clipboard.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const column = (field_type: string, required = false, id = "f"): TableColumn => ({ id, key: id, display_name: id, field_type, required });
const present = (col: TableColumn, value: string | number | boolean = "kept"): TableRow => ({ id: "e", key: "e", fields: [{
  target: { entity: "e", field: col.id }, address: "a", stored: typeof value === "number" ? { kind: "number", value } : typeof value === "boolean" ? { kind: "boolean", value } : { kind: "text", value },
  formula: null, calculated: null, diagnostics: [], editable_scalar: col.field_type as "text" | "number" | "date" | "boolean",
}] });
const blank = (col: TableColumn): TableRow => ({ id: "e", key: "e", fields: [], blank_fields: [col.id] });
const one = rectangle({ row: 0, column: 0 }, { row: 0, column: 0 });

describe("native empty intent and atomic clear request shaping", () => {
  it.each(["text", "number"])("encodes a present optional %s as explicit clear for editor, grid and paste", kind => {
    const col = column(kind), row = present(col), slot = cellEditSlot(row, col)!;
    const edit = { target: slot.target, input: { kind: "clear" } };
    expect(emptyCellEdit(slot)).toEqual(edit);
    expect(pastedCellEdit(slot, "", true)).toEqual(edit);
    expect(clearCellEdits([row], [col], one, true)).toEqual([edit]);
    expect(cellEditorUnchanged(slot, "kept", "")).toBe(false);
  });
  it("sets required Text to explicit empty Text", () => {
    const col = column("text", true), row = present(col), slot = cellEditSlot(row, col)!;
    const edit = { target: slot.target, input: { kind: "text", value: "" } };
    expect(emptyCellEdit(slot)).toEqual(edit);
    expect(pastedCellEdit(slot, "", true)).toEqual(edit);
    expect(clearCellEdits([row], [col], one, true)).toEqual([edit]);
  });
  it.each(["number", "date", "boolean"])("refuses required %s locally for all empty request paths", kind => {
    const col = column(kind, true), row = present(col), slot = cellEditSlot(row, col)!;
    const label = kind === "boolean" ? "Yes/No" : kind === "date" ? "Date" : "Number";
    for (const request of [() => emptyCellEdit(slot), () => pastedCellEdit(slot, "", true), () => clearCellEdits([row], [col], one, true)]) {
      expect(request).toThrow(`This ${label} column needs a value in every row.`);
    }
    expect(routePaste([[""]], { native: true, draft: false, blocked: false, pendingDraft: false, start: { row: 0, column: 0 }, rowCount: 1, columnTypes: [kind], columnRequired: [true], editable: () => true }))
      .toMatchObject({ kind: "edit", rows: [[""]] });
  });
  it.each(["text", "number"])("omits authoritative blank %s targets without fabricating empty values", kind => {
    const col = column(kind), row = blank(col), slot = cellEditSlot(row, col)!;
    expect(emptyCellEdit(slot)).toBeNull(); expect(pastedCellEdit(slot, "", true)).toBeNull();
    expect(clearCellEdits([row], [col], one, true)).toEqual([]);
    expect(cellEditorUnchanged(slot, "", "")).toBe(true);
  });
  it.each([false, true])("keeps unchanged present empty Text editors as no-op (required=%s)", required => {
    const col = column("text", required), slot = cellEditSlot(present(col, ""), col)!;
    expect(cellEditorUnchanged(slot, "", "")).toBe(true);
    expect(emptyCellEdit(slot)).toEqual(required ? null : { target: slot.target, input: { kind: "clear" } });
  });
  it.each([["text", " "], ["number", "0"], ["boolean", "false"]])("preserves nonempty %s paste %j", (kind, raw) => {
    const col = column(kind!, kind === "boolean"), slot = cellEditSlot(present(col), col)!;
    expect(pastedCellEdit(slot, raw!, true)?.input).toEqual(kind === "number" ? { kind, input: raw } : { kind, value: kind === "boolean" ? false : raw });
    expect(cellEditorUnchanged(slot, raw!, raw!)).toBe(true);
  });
  it("mixes explicit clears and required empty Text in one payload, omitting only no-ops", () => {
    const cols = [column("text"), column("number", false, "n"), column("text", true, "t")];
    const row = { ...present(cols[0]!), blank_fields: ["n"], fields: [...present(cols[0]!).fields, ...present(cols[2]!).fields] };
    expect(clearCellEdits([row], cols, { ...one, right: 2 }, true)).toEqual([
      { target: { entity: "e", field: "f" }, input: { kind: "clear" } }, { target: { entity: "e", field: "t" }, input: { kind: "text", value: "" } },
    ]);
  });
  it("refuses the whole mixed rectangle, never returning its clearable prefix", () => {
    const cols = [column("text"), column("number", true, "n")];
    expect(() => clearCellEdits([{ ...present(cols[0]!), fields: cols.flatMap(c => present(c).fields) }], cols, { ...one, right: 1 }, true)).toThrow(/Number column/);
  });
  it("refuses every non-native table, including imported optional Date/Boolean", () => {
    for (const kind of ["text", "number", "date", "boolean"]) {
      const col = column(kind);
      expect(() => clearCellEdits([present(col)], [col], one, false)).toThrow(/table cannot be cleared/);
    }
  });
  it("refuses calculated, read-only and unknown slots even among blanks", () => {
    const col = column("text");
    for (const row of [{ id: "e", key: "e", fields: [] }, { ...present(col), fields: present(col).fields.map(f => ({ ...f, editable_scalar: null })) }]) {
      expect(() => clearCellEdits([row], [col], one, true)).toThrow(/non-editable/);
    }
  });
  it("sends a Work formula to the formula bar instead of clearing it", () => {
    const col = column("number");
    const formulaRow = { ...present(col, 4), fields: present(col, 4).fields.map(f => ({ ...f, formula: { source: "1 + 2" } })) };
    expect(() => clearCellEdits([formulaRow], [col], one, true)).toThrow("Edit the formula in the formula bar.");
    expect(() => emptyCellEdit(cellEditSlot(formulaRow, col)!)).toThrow("Edit the formula in the formula bar.");
  });
  it("counts the whole rectangle before omitting blanks and never chunks past 1,024", () => {
    const cols = Array.from({ length: 9 }, (_, i) => column("text", false, String(i)));
    const rows = Array.from({ length: 128 }, () => ({ id: "e", key: "e", fields: [], blank_fields: cols.map(c => c.id) }));
    expect(clearCellEdits(rows, cols, { top: 0, left: 0, bottom: 127, right: 7 }, true)).toEqual([]);
    expect(() => clearCellEdits(rows, cols, { top: 0, left: 0, bottom: 127, right: 8 }, true)).toThrow(/1,024-cell/);
  });
});

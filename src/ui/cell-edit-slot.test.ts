import { describe, expect, it } from "vitest";
import { cellEditSlot, cellEditorOptions, cellEditorUnchanged, cellOptionMatches, cellOptionsKeyAction, pastedCellEdit } from "./cell-edit-slot.js";
import { routePaste } from "./clipboard.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const column = (kind = "text"): TableColumn => ({ id: "f", key: "key", display_name: "Name", field_type: kind, required: false });
const blank: TableRow = { id: "entity", key: "row", fields: [], blank_fields: ["f"] };
describe("authoritative sparse edit slots", () => {
  it.each(["text", "number"])("addresses a blank %s by entity and field, without a FieldProjection", kind => {
    const slot = cellEditSlot(blank, column(kind))!;
    expect(slot).toEqual({ target: { entity: "entity", field: "f" }, kind, original: "", blank: true, formula: false, required: false });
    expect(pastedCellEdit(slot, kind === "text" ? "typed" : "0")).toEqual({ target: slot.target,
      input: kind === "text" ? { kind, value: "typed" } : { kind, input: "0" } });
  });
  it("never infers a blank from a missing field or a missing membership list", () => {
    for (const blank_fields of [undefined, [], ["different"]]) expect(cellEditSlot({ ...blank, blank_fields }, column())).toBeNull();
    expect(cellEditSlot(blank, { ...column(), required: true })).toBeNull();
    for (const type of ["reference", "unknown"]) expect(cellEditSlot(blank, column(type))).toBeNull();
    // Optional Date and Yes/No blanks are editable since Work #598.
    for (const type of ["date", "boolean"]) expect(cellEditSlot(blank, column(type))).toMatchObject({ kind: type, blank: true, original: "" });
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

describe("cell editor options", () => {
  const listed: TableColumn = { ...column(), constraint: { kind: "text_literal_set", values: ["Doing", "Done", "Todo"] }, dropdown_options: ["Doing", "Done", "Todo"] };
  it("offers the declared values only for an allowed-values column", () => {
    expect(cellEditorOptions(listed)).toEqual(["Doing", "Done", "Todo"]);
    expect(cellEditorOptions(column())).toEqual([]);
    expect(cellEditorOptions({ ...column("number"), constraint: { kind: "number_inclusive_range", min: 0, max: 9 } })).toEqual([]);
  });
  it("narrows by typed text, keeping every choice for empty or exact text", () => {
    const options = cellEditorOptions(listed);
    expect(cellOptionMatches(options, "")).toEqual(options);
    expect(cellOptionMatches(options, "Done")).toEqual(options);
    expect(cellOptionMatches(options, "do")).toEqual(["Doing", "Done", "Todo"]);
    expect(cellOptionMatches(options, "on")).toEqual(["Done"]);
    expect(cellOptionMatches(options, "Blocked")).toEqual([]);
  });
  it("owns arrows, Enter on a highlighted choice and Escape on an open list only", () => {
    const open = { open: true, index: -1 };
    expect(cellOptionsKeyAction("ArrowDown", open, 3)).toEqual({ kind: "move", ui: { open: true, index: 0 } });
    expect(cellOptionsKeyAction("ArrowDown", { open: true, index: 2 }, 3)).toEqual({ kind: "move", ui: { open: true, index: 2 } });
    expect(cellOptionsKeyAction("ArrowUp", { open: false, index: -1 }, 3)).toEqual({ kind: "move", ui: { open: true, index: 2 } });
    expect(cellOptionsKeyAction("Enter", { open: true, index: 1 }, 3)).toEqual({ kind: "pick", index: 1 });
    expect(cellOptionsKeyAction("Enter", open, 3)).toBeNull();
    expect(cellOptionsKeyAction("Escape", open, 3)).toEqual({ kind: "close" });
    expect(cellOptionsKeyAction("Escape", { open: false, index: -1 }, 3)).toBeNull();
    expect(cellOptionsKeyAction("Tab", { open: true, index: 1 }, 3)).toBeNull();
    expect(cellOptionsKeyAction("ArrowDown", open, 0)).toBeNull();
  });
});

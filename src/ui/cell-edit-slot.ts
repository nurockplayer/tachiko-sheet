import type { CellEdit, FieldTarget } from "../contracts.js";
import { FORMULA_BAR_GUIDANCE } from "./clipboard.js";
import { scalarEditOf, seedTextOf } from "./field-display.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

export interface CellEditSlot {
  target: FieldTarget;
  kind: "text" | "number" | "date" | "boolean";
  original: string;
  blank: boolean;
  formula: boolean;
  required: boolean;
}

/** UI edit address, never a fabricated FieldProjection. Missing is not blank. */
export function cellEditSlot(row: TableRow, column: TableColumn): CellEditSlot | null {
  const field = fieldForColumn(row, column.id);
  if (field) return field.editable_scalar ? {
    target: field.target, kind: field.editable_scalar, original: seedTextOf(field), blank: false, formula: Boolean(field.formula), required: column.required,
  } : null;
  if (!column.required && row.blank_fields?.includes(column.id) && (column.field_type === "text" || column.field_type === "number")) {
    return { target: { entity: rowEntity(row), field: column.id }, kind: column.field_type, original: "", blank: true, formula: false, required: false };
  }
  return null;
}

/** Choices for the cell editor: an allowed-values column's declared values. Work still validates the commit. */
export function cellEditorOptions(column: TableColumn): readonly string[] {
  return column.constraint?.kind === "text_literal_set" ? column.constraint.values : [];
}

/** All choices until the typed text narrows them; an exact choice keeps the full list visible. */
export function cellOptionMatches(options: readonly string[], value: string): readonly string[] {
  const needle = value.trim().toLocaleLowerCase();
  if (!needle || options.includes(value)) return options;
  return options.filter(option => option.toLocaleLowerCase().includes(needle));
}

export interface CellOptionsUi { open: boolean; index: number }
export type CellOptionsKeyAction = { kind: "move"; ui: CellOptionsUi } | { kind: "pick"; index: number } | { kind: "close" } | null;

/** Keys the choice list owns; any other key (and Enter/Escape with no list) keeps the editor's own handling. */
export function cellOptionsKeyAction(key: string, ui: CellOptionsUi, count: number): CellOptionsKeyAction {
  if (count === 0) return null;
  if (key === "ArrowDown") return { kind: "move", ui: { open: true, index: ui.open ? Math.min(ui.index + 1, count - 1) : 0 } };
  if (key === "ArrowUp") return { kind: "move", ui: { open: true, index: ui.open ? Math.max(ui.index - 1, 0) : count - 1 } };
  if (key === "Enter" && ui.open && ui.index >= 0 && ui.index < count) return { kind: "pick", index: ui.index };
  if (key === "Escape" && ui.open) return { kind: "close" };
  return null;
}

export function cellEditorUnchanged(slot: CellEditSlot, original: string, raw: string): boolean {
  return raw === original || (slot.blank && raw === "");
}

/** Empty clipboard input on an authoritative blank is unchanged, not empty Text.
 * The caller validates the whole rectangle and cap before omitting no-op slots.
 * Boolean tokens have already been validated and folded by routePaste. */
export function pastedCellEdit(slot: CellEditSlot, raw: string, native = false): CellEdit | null {
  if (native && raw === "") return emptyCellEdit(slot);
  if (slot.blank && raw === "") return null;
  return { target: slot.target, input: slot.kind === "boolean" ? { kind: "boolean", value: raw === "true" } : scalarEditOf(slot.kind, raw) };
}

export class CellClearRefusal extends Error {}

export function requiredCellValueMessage(kind: string): string {
  const label = kind === "boolean" ? "Yes/No" : kind === "date" ? "Date" : "Number";
  return `This ${label} column needs a value in every row.`;
}

/** Request shaping only. Requiredness/presence come from Work's projection. */
export function emptyCellEdit(slot: CellEditSlot): CellEdit | null {
  if (slot.formula) throw new CellClearRefusal(FORMULA_BAR_GUIDANCE);
  if (slot.blank) return null;
  if (slot.required) {
    if (slot.kind !== "text") throw new CellClearRefusal(requiredCellValueMessage(slot.kind));
    return slot.original === "" ? null : { target: slot.target, input: { kind: "text", value: "" } };
  }
  if (slot.kind !== "text" && slot.kind !== "number") throw new CellClearRefusal("This column cannot be cleared here.");
  return { target: slot.target, input: { kind: "clear" } };
}

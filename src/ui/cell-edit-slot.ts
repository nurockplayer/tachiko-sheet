import type { CellEdit, FieldTarget } from "../contracts.js";
import { scalarEditOf, seedTextOf } from "./field-display.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

export interface CellEditSlot {
  target: FieldTarget;
  kind: "text" | "number" | "date" | "boolean";
  original: string;
  blank: boolean;
  formula: boolean;
}

/** UI edit address, never a fabricated FieldProjection. Missing is not blank. */
export function cellEditSlot(row: TableRow, column: TableColumn): CellEditSlot | null {
  const field = fieldForColumn(row, column.id);
  if (field) return field.editable_scalar ? {
    target: field.target, kind: field.editable_scalar, original: seedTextOf(field), blank: false, formula: Boolean(field.formula),
  } : null;
  if (!column.required && row.blank_fields?.includes(column.id) && (column.field_type === "text" || column.field_type === "number")) {
    return { target: { entity: rowEntity(row), field: column.id }, kind: column.field_type, original: "", blank: true, formula: false };
  }
  return null;
}

export function cellEditorUnchanged(slot: CellEditSlot, original: string, raw: string): boolean {
  return raw === original || (slot.blank && raw === "");
}

/** Empty clipboard input on an authoritative blank is unchanged, not empty Text.
 * The caller validates the whole rectangle and cap before omitting no-op slots.
 * Boolean tokens have already been validated and folded by routePaste. */
export function pastedCellEdit(slot: CellEditSlot, raw: string): CellEdit | null {
  if (slot.blank && raw === "") return null;
  return { target: slot.target, input: slot.kind === "boolean" ? { kind: "boolean", value: raw === "true" } : scalarEditOf(slot.kind, raw) };
}

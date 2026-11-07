import type { FieldTarget } from "../contracts.js";
import type { FormulaCopy } from "../../public/core-kit/runtime/protocol.js";
import { cellEditSlot } from "./cell-edit-slot.js";
import { EDIT_CELLS_MAX, type CellRectangle } from "./clipboard.js";
import { FORMULA_COPY_AXES, NON_EDITABLE } from "./fill-down.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

/** A deliberately copied formula cell: its source formula and the text the clipboard holds. */
export interface CopiedFormula {
  entity: string;
  field: string;
  formula: string;
  text: string;
}

export class FormulaPasteRefusal extends Error {}

export type FormulaPastePlan =
  | null
  | { kind: "unchanged" }
  | { kind: "formula"; request: FormulaCopy; count: number };

/**
 * Plans a paste of the last copied formula into its own column. `null` means an
 * ordinary value paste; `stored` is false while a sort or filter is active
 * because Work shifts references by stored position.
 */
export function formulaPastePlan(
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  area: CellRectangle | null,
  copied: CopiedFormula,
  stored = true,
): FormulaPastePlan {
  if (!area || area.right !== area.left) return null;
  const column = columns[area.left];
  if (!column || column.id !== copied.field) return null;
  const sourceIndex = rows.findIndex(row => rowEntity(row) === copied.entity);
  const sourceRow = rows[sourceIndex];
  const sourceField = sourceRow ? fieldForColumn(sourceRow, copied.field) : null;
  // A deleted row or an edited formula leaves only the value to paste.
  if (!sourceRow || !sourceField || sourceField.formula?.source !== copied.formula) return null;
  if (!stored) throw new FormulaPasteRefusal("Clear the sort and filter to paste a formula. Nothing was pasted.");

  const destinations: FieldTarget[] = [];
  for (let rowIndex = area.top; rowIndex <= area.bottom; rowIndex += 1) {
    if (rowIndex === sourceIndex) continue;
    const row = rows[rowIndex];
    // An editable value or an existing formula (Work projects formula cells
    // with no editable_scalar) may be replaced; Undo restores it.
    const slot = row ? cellEditSlot(row, column) : null;
    const formulaField = row ? fieldForColumn(row, column.id) : undefined;
    const target = slot?.target ?? (formulaField?.formula != null ? formulaField.target : undefined);
    if (!target) throw new FormulaPasteRefusal(NON_EDITABLE);
    destinations.push(target);
  }
  if (!destinations.length) return { kind: "unchanged" };
  if (destinations.length > EDIT_CELLS_MAX) throw new FormulaPasteRefusal("The paste range exceeds the 1,024-cell limit. Nothing was pasted.");
  return { kind: "formula", request: { source: sourceField.target, destinations, ...FORMULA_COPY_AXES }, count: destinations.length };
}

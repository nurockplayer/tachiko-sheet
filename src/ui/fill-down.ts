import type { CellEdit } from "../contracts.js";
import { cellEditSlot, pastedCellEdit } from "./cell-edit-slot.js";
import { EDIT_CELLS_MAX, type CellRectangle } from "./clipboard.js";
import { fieldForColumn, type TableColumn, type TableRow } from "./projection-access.js";
import type { FormulaCopy } from "../../public/core-kit/runtime/protocol.js";

export class FillDownRefusal extends Error {}

export type FillDownPlan =
  | { kind: "formula"; request: FormulaCopy; count: number }
  | { kind: "values"; edits: CellEdit[]; count: number };

const NON_EDITABLE = "The fill range includes a calculated or non-editable cell. Nothing was filled.";

export function fillDownPlan(rows: readonly TableRow[], columns: readonly TableColumn[], area: CellRectangle | null, native: boolean): FillDownPlan {
  if (!area || area.bottom <= area.top) throw new FillDownRefusal("Select at least two rows to fill down.");
  const width = area.right - area.left + 1;
  const height = area.bottom - area.top + 1;
  const count = width * (height - 1);
  if (count > EDIT_CELLS_MAX) throw new FillDownRefusal("The fill range exceeds the 1,024-cell limit. Nothing was filled.");
  if (!native) throw new FillDownRefusal("This table cannot be filled here. Nothing was filled.");

  const topRow = rows[area.top];
  const selectedColumns = Array.from({ length: width }, (_, offset) => columns[area.left + offset]);
  const formulaColumnIndex = selectedColumns.findIndex(column => {
    const field = topRow && column ? fieldForColumn(topRow, column.id) : undefined;
    return field?.formula != null;
  });
  if (formulaColumnIndex >= 0) {
    if (width !== 1) throw new FillDownRefusal("Fill a formula down one column at a time. Nothing was filled.");
    const column = selectedColumns[0];
    const source = topRow && column ? fieldForColumn(topRow, column.id)?.target : undefined;
    if (!source) throw new FillDownRefusal(NON_EDITABLE);
    const destinations = [];
    for (let rowIndex = area.top + 1; rowIndex <= area.bottom; rowIndex += 1) {
      const row = rows[rowIndex];
      const target = row && column ? fieldForColumn(row, column.id)?.target : undefined;
      if (!target) throw new FillDownRefusal(NON_EDITABLE);
      destinations.push(target);
    }
    return { kind: "formula", request: { source, destinations, fixed_references: [], relative_rows: true, relative_columns: false }, count };
  }

  const edits: CellEdit[] = [];
  for (const column of selectedColumns) {
    if (!topRow || !column) throw new FillDownRefusal(NON_EDITABLE);
    const topSlot = cellEditSlot(topRow, column);
    if (!topSlot || topSlot.formula) throw new FillDownRefusal(NON_EDITABLE);
    for (let rowIndex = area.top + 1; rowIndex <= area.bottom; rowIndex += 1) {
      const row = rows[rowIndex];
      const slot = row ? cellEditSlot(row, column) : null;
      if (!slot || slot.formula) throw new FillDownRefusal(NON_EDITABLE);
      const edit = pastedCellEdit(slot, topSlot.original, native);
      if (edit) edits.push(edit);
    }
  }
  return { kind: "values", edits, count };
}

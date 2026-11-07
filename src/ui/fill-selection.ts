import type { CellEdit } from "../contracts.js";
import { cellEditSlot, cellEditorUnchanged, pastedCellEdit } from "./cell-edit-slot.js";
import { EDIT_CELLS_MAX, type CellRectangle } from "./clipboard.js";
import type { TableColumn, TableRow } from "./projection-access.js";

export class FillSelectionRefusal extends Error {}

const NOT_EDITABLE = "The selection includes a cell that can't be edited here. Nothing was filled.";

/** Ctrl+Enter request shaping: one entry for every cell of the selected rectangle. */
export function fillSelectionPlan(
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  area: CellRectangle,
  raw: string,
  native: boolean,
): CellEdit[] {
  if (raw.startsWith("=")) throw new FillSelectionRefusal("Enter the formula in one cell, then fill it with Ctrl+D. Nothing was filled.");
  const width = area.right - area.left + 1;
  const height = area.bottom - area.top + 1;
  if (width * height > EDIT_CELLS_MAX) throw new FillSelectionRefusal("The fill range exceeds the 1,024-cell limit. Nothing was filled.");
  if (!native) throw new FillSelectionRefusal("This table cannot be filled here. Nothing was filled.");

  const edits: CellEdit[] = [];
  for (let rowIndex = area.top; rowIndex <= area.bottom; rowIndex += 1) {
    for (let columnIndex = area.left; columnIndex <= area.right; columnIndex += 1) {
      const row = rows[rowIndex], column = columns[columnIndex];
      const slot = row && column ? cellEditSlot(row, column) : null;
      if (!slot || slot.formula) throw new FillSelectionRefusal(NOT_EDITABLE);
      if (cellEditorUnchanged(slot, slot.original, raw)) continue;
      const edit = pastedCellEdit(slot, raw, native);
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

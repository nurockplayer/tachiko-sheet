import type { CellEdit } from "../contracts.js";
import { cellEditSlot, CellClearRefusal, emptyCellEdit } from "./cell-edit-slot.js";
import { EDIT_CELLS_MAX, FORMULA_BAR_GUIDANCE, type CellRectangle } from "./clipboard.js";
import { fieldForColumn, type TableColumn, type TableRow } from "./projection-access.js";

/** Validate every target before returning one atomic edit_cells payload. */
export function clearCellEdits(rows: readonly TableRow[], columns: readonly TableColumn[], area: CellRectangle, native: boolean, verb: "cleared" | "cut" = "cleared"): CellEdit[] {
  if (!native) throw new CellClearRefusal(`This table cannot be cleared here. Nothing was ${verb}.`);
  if ((area.bottom - area.top + 1) * (area.right - area.left + 1) > EDIT_CELLS_MAX) {
    throw new CellClearRefusal(`The selected range exceeds the 1,024-cell limit. Nothing was ${verb}.`);
  }
  const edits: CellEdit[] = [];
  for (let r = area.top; r <= area.bottom; r++) {
    for (let c = area.left; c <= area.right; c++) {
      const row = rows[r], column = columns[c];
      const slot = row && column ? cellEditSlot(row, column) : null;
      if (!slot || slot.formula) {
        throw new CellClearRefusal(row && column && fieldForColumn(row, column.id)?.formula != null
          ? FORMULA_BAR_GUIDANCE
          : `The selected range includes a calculated or non-editable cell. Nothing was ${verb}.`);
      }
      let edit: CellEdit | null;
      try { edit = emptyCellEdit(slot); } catch (error) {
        if (verb === "cut" && error instanceof CellClearRefusal && error.message !== FORMULA_BAR_GUIDANCE) throw new CellClearRefusal(`${error.message} Nothing was cut.`);
        throw error;
      }
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

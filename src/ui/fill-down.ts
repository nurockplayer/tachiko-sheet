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

/**
 * A reference to the formula's own row follows the row; a reference to
 * another row stays on that row. Shared by fill down and formula paste.
 */
export const FORMULA_COPY_AXES: Pick<FormulaCopy, "fixed_references" | "relative_rows" | "relative_columns"> = {
  fixed_references: [], relative_rows: false, relative_columns: false,
};

/**
 * `stored` is true when the displayed rows are in stored order (no sort or
 * filter). A reference to the formula's own row follows the row; a reference
 * to another row stays on that row. Formula fill is only offered when display
 * order and stored order agree.
 */
export function fillDownPlan(rows: readonly TableRow[], columns: readonly TableColumn[], area: CellRectangle | null, native: boolean, stored = true, source?: CellRectangle): FillDownPlan {
  if (!area || (!source && area.bottom <= area.top)) throw new FillDownRefusal("Select at least two rows to fill down.");
  source ??= { ...area, bottom: area.top };
  const horizontal = area.left !== source.left || area.right !== source.right;
  if (horizontal ? source.left !== source.right : source.top !== source.bottom) {
    throw new FillDownRefusal(horizontal
      ? "Fill from one column. Filling a series isn't available yet. Nothing was filled."
      : "Fill from one row. Filling a series isn't available yet. Nothing was filled.");
  }
  const width = area.right - area.left + 1;
  const height = area.bottom - area.top + 1;
  const count = width * height - (source.right - source.left + 1) * (source.bottom - source.top + 1);
  if (count > EDIT_CELLS_MAX) throw new FillDownRefusal(`The fill range exceeds the ${EDIT_CELLS_MAX.toLocaleString("en-US")}-cell limit. Nothing was filled.`);
  if (!native) throw new FillDownRefusal("This table cannot be filled here. Nothing was filled.");

  if (source.left !== source.right && columns.slice(source.left, source.right + 1).some(column => fieldForColumn(rows[source.top]!, column.id)?.formula != null)) {
    throw new FillDownRefusal("Fill a formula down one column at a time. Nothing was filled.");
  }
  const edits: CellEdit[] = [];
  const destinations: FormulaCopy["destinations"] = [];
  let formulaSource: FormulaCopy["source"] | undefined;
  for (let columnIndex = area.left; columnIndex <= area.right; columnIndex += 1) {
    for (let rowIndex = area.top; rowIndex <= area.bottom; rowIndex += 1) {
      if (rowIndex >= source.top && rowIndex <= source.bottom && columnIndex >= source.left && columnIndex <= source.right) continue;
      const sourceRow = rows[horizontal ? rowIndex : source.top];
      const sourceColumn = columns[horizontal ? source.left : columnIndex];
      const row = rows[rowIndex], column = columns[columnIndex];
      if (!sourceRow || !sourceColumn || !row || !column) throw new FillDownRefusal(NON_EDITABLE);
      const field = fieldForColumn(sourceRow, sourceColumn.id);
      const slot = cellEditSlot(row, column);
      if (field?.formula != null) {
        if (source.left !== source.right || source.top !== source.bottom) throw new FillDownRefusal("Fill a formula down one column at a time. Nothing was filled.");
        if (!stored) throw new FillDownRefusal("Clear the sort and filter to fill a formula down. Nothing was filled.");
        const targetField = fieldForColumn(row, column.id);
        const target = slot?.target ?? (targetField?.formula != null ? targetField.target : undefined);
        if (!target) throw new FillDownRefusal(NON_EDITABLE);
        formulaSource = field.target;
        destinations.push(target);
      } else {
        const sourceSlot = cellEditSlot(sourceRow, sourceColumn);
        if (!sourceSlot || !slot || slot.formula) throw new FillDownRefusal(NON_EDITABLE);
        const edit = pastedCellEdit(slot, sourceSlot.original, native);
        if (edit) edits.push(edit);
      }
    }
  }
  return formulaSource
    ? { kind: "formula", request: { source: formulaSource, destinations, ...FORMULA_COPY_AXES, relative_columns: horizontal }, count }
    : { kind: "values", edits, count };
}

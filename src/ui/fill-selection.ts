import { isMacPlatform, menuShortcut } from "./cell-context-menu.js";
import type { CellEdit } from "../contracts.js";
import { cellEditSlot, cellEditorUnchanged, pastedCellEdit } from "./cell-edit-slot.js";
import { EDIT_CELLS_MAX, type CellRectangle } from "./clipboard.js";
import { parseBooleanDraft } from "./field-display.js";
import type { TableColumn, TableRow } from "./projection-access.js";

export class FillSelectionRefusal extends Error {}

const BOOLEAN_ENTRY = "Enter true or false for a boolean cell. Nothing was filled.";
const NOT_EDITABLE = "The selection includes a cell that can't be edited here. Nothing was filled.";

/** Ctrl+Enter request shaping: one entry for every cell of the selected rectangle. */
export function fillSelectionPlan(
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  area: CellRectangle,
  raw: string,
  native: boolean,
): CellEdit[] {
  if (raw.startsWith("=")) throw new FillSelectionRefusal(`Enter the formula in one cell, then fill it with ${menuShortcut("D", isMacPlatform())}. Nothing was filled.`);
  const width = area.right - area.left + 1;
  const height = area.bottom - area.top + 1;
  if (width * height > EDIT_CELLS_MAX) throw new FillSelectionRefusal(`The fill range exceeds the ${EDIT_CELLS_MAX.toLocaleString("en-US")}-cell limit. Nothing was filled.`);
  if (!native) throw new FillSelectionRefusal("This table cannot be filled here. Nothing was filled.");

  const edits: CellEdit[] = [];
  for (let rowIndex = area.top; rowIndex <= area.bottom; rowIndex += 1) {
    for (let columnIndex = area.left; columnIndex <= area.right; columnIndex += 1) {
      const row = rows[rowIndex], column = columns[columnIndex];
      const slot = row && column ? cellEditSlot(row, column) : null;
      if (!slot || slot.formula) throw new FillSelectionRefusal(NOT_EDITABLE);
      if (cellEditorUnchanged(slot, slot.original, raw)) continue;
      // pastedCellEdit takes folded tokens, so "TRUE" or a typo would otherwise be stored as false.
      const parsed = slot.kind === "boolean" && raw !== "" ? parseBooleanDraft(raw) : null;
      if (slot.kind === "boolean" && raw !== "" && parsed === null) throw new FillSelectionRefusal(BOOLEAN_ENTRY);
      const edit = pastedCellEdit(slot, parsed === null ? raw : String(parsed), native);
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

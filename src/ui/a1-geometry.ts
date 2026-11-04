import { rowEntity } from "../contracts.js";
import type { TableRow } from "./projection-access.js";

/**
 * The spreadsheet geometry Work reads A1 references against: the grid's
 * header row is row 1, the first data row is row 2, and columns are named
 * A, B, … in column order. This is what the grid displays, not an entity id.
 */
export const A1_HEADER_ROW = 1;

/** The A1 letter of a 0-based column position: 0 → "A", 26 → "AA", 702 → "AAA". */
export function a1ColumnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The A1 row number of a 0-based displayed data row: the first displayed row is row 2. */
export function a1RowNumber(displayIndex: number): number {
  return displayIndex + A1_HEADER_ROW + 1;
}

/** The displayed grid's A1 addresses: its header row, row entities and column ids in order. */
export function a1Geometry(
  displayRows: readonly TableRow[],
  columns: readonly { id: string }[],
): { headerRow: number; rows: string[]; columns: string[] } {
  return {
    headerRow: A1_HEADER_ROW,
    rows: displayRows.map((row) => rowEntity(row)),
    columns: columns.map((column) => column.id),
  };
}

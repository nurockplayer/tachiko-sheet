/** Excel-style grid navigation geometry only; Work owns every value. */
import type { CellAddress } from "./clipboard.js";

const stepOf = (key: string): { row: number; column: number } | null =>
  key === "ArrowUp" ? { row: -1, column: 0 }
    : key === "ArrowDown" ? { row: 1, column: 0 }
      : key === "ArrowLeft" ? { row: 0, column: -1 }
        : key === "ArrowRight" ? { row: 0, column: 1 }
          : null;

const inside = (at: CellAddress, rows: number, columns: number): boolean =>
  at.row >= 0 && at.row < rows && at.column >= 0 && at.column < columns;

/** Excel Ctrl+Arrow: from a filled cell whose neighbour is filled, go to the last filled cell of that run;
 *  otherwise go to the next filled cell in that direction; if none, to the table edge. Out of range → unchanged. */
export function edgeAddress(
  at: CellAddress,
  key: string,
  rows: number,
  columns: number,
  isEmpty: (row: number, column: number) => boolean,
): CellAddress {
  const step = stepOf(key);
  if (!step || !inside(at, rows, columns)) return at;
  const vertical = step.row !== 0;
  const offset = vertical ? step.row : step.column;
  const extent = vertical ? rows : columns;
  const index = vertical ? at.row : at.column;
  const last = extent - 1;
  const next = index + offset;
  if (next < 0 || next > last) return at;
  const addressAt = (line: number): CellAddress => vertical ? { row: line, column: at.column } : { row: at.row, column: line };
  const filled = (line: number): boolean => {
    const cell = addressAt(line);
    return !isEmpty(cell.row, cell.column);
  };
  if (filled(index) && filled(next)) {
    let line = next;
    while (line + offset >= 0 && line + offset <= last && filled(line + offset)) line += offset;
    return addressAt(line);
  }
  for (let line = next; line >= 0 && line <= last; line += offset) {
    if (filled(line)) return addressAt(line);
  }
  return addressAt(offset > 0 ? last : 0);
}

/** Home/End and Ctrl/Cmd+Home/End targets. */
export function homeEndAddress(
  at: CellAddress,
  key: "Home" | "End",
  toCorner: boolean,
  rows: number,
  columns: number,
): CellAddress {
  if (!inside(at, rows, columns)) return at;
  if (toCorner) return key === "Home" ? { row: 0, column: 0 } : { row: rows - 1, column: columns - 1 };
  return { row: at.row, column: key === "Home" ? 0 : columns - 1 };
}

/** Local calendar date as YYYY-MM-DD (never UTC). */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

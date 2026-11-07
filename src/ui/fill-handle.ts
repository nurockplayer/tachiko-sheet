import type { CellRectangle } from "./clipboard.js";

/**
 * The rectangle a fill-handle drag would fill: the source's columns from its
 * top row down to the row under the pointer. Null when the pointer is not
 * below the source, or when the source spans several rows (a series is out of
 * scope; the caller announces that case).
 */
export function fillDragTarget(source: CellRectangle, pointerRow: number): CellRectangle | null {
  if (source.bottom > source.top) return null;
  if (pointerRow <= source.bottom) return null;
  return { top: source.top, left: source.left, bottom: pointerRow, right: source.right };
}

/**
 * Excel's double-click fill limit: the last contiguous filled row below the
 * range in the adjacent column, the one to the left of the range or, when the
 * range starts at the first column, the one to its right. Null when there is
 * no such column or no filled row directly below the range.
 */
export function adjacentFillBottom(
  area: CellRectangle,
  columnCount: number,
  filled: (row: number, column: number) => boolean,
  rowCount: number,
): number | null {
  const column = area.left > 0 ? area.left - 1 : area.right + 1 < columnCount ? area.right + 1 : null;
  if (column === null) return null;
  let bottom: number | null = null;
  for (let row = area.bottom + 1; row < rowCount; row += 1) {
    if (!filled(row, column)) break;
    bottom = row;
  }
  return bottom;
}

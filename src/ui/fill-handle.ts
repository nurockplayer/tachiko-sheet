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
 * range in the adjacent column, the one to the left of the range or, when that
 * column has nothing directly below the range, the one to its right. Null when
 * neither does.
 */
export function adjacentFillBottom(
  area: CellRectangle,
  columnCount: number,
  filled: (row: number, column: number) => boolean,
  rowCount: number,
): number | null {
  const bottomIn = (column: number): number | null => {
    let bottom: number | null = null;
    for (let row = area.bottom + 1; row < rowCount; row += 1) {
      if (!filled(row, column)) break;
      bottom = row;
    }
    return bottom;
  };
  const left = area.left > 0 ? bottomIn(area.left - 1) : null;
  if (left !== null) return left;
  return area.right + 1 < columnCount ? bottomIn(area.right + 1) : null;
}

import type { CellRectangle } from "./clipboard.js";

/**
 * The source plus the extension along the pointer's dominant axis.
 */
export function fillDragTarget(source: CellRectangle, pointerRow: number, pointerColumn = source.right, horizontal = false): CellRectangle | null {
  if (horizontal) {
    if (pointerColumn >= source.left && pointerColumn <= source.right) return null;
    return { ...source, left: Math.min(source.left, pointerColumn), right: Math.max(source.right, pointerColumn) };
  }
  if (pointerRow >= source.top && pointerRow <= source.bottom) return null;
  return { ...source, top: Math.min(source.top, pointerRow), bottom: Math.max(source.bottom, pointerRow) };
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

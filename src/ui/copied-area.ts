import type { CellRectangle } from "./clipboard.js";

export function copiedEdges(area: CellRectangle, row: number, column: number): string[] | null {
  if (row < area.top || row > area.bottom || column < area.left || column > area.right) return null;
  return [
    ...(row === area.top ? ["top"] : []),
    ...(row === area.bottom ? ["bottom"] : []),
    ...(column === area.left ? ["left"] : []),
    ...(column === area.right ? ["right"] : []),
  ];
}

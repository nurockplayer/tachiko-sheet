import type { FieldTarget } from "../contracts.js";
import type { CellRectangle } from "./clipboard.js";
import { rowEntity, type TableRow, type TableColumn } from "./projection-access.js";

export function selectionStatisticsTargets(rows: readonly TableRow[], columns: readonly TableColumn[], area: CellRectangle): FieldTarget[] {
  if (area.top < 0 || area.left < 0 || area.bottom < area.top || area.right < area.left ||
    area.bottom >= rows.length || area.right >= columns.length ||
    (area.bottom - area.top + 1) * (area.right - area.left + 1) < 2) return [];
  const targets: FieldTarget[] = [];
  for (let row = area.top; row <= area.bottom; row++) {
    const entity = rowEntity(rows[row]!);
    for (let column = area.left; column <= area.right; column++) targets.push({ entity, field: columns[column]!.id });
  }
  return targets;
}

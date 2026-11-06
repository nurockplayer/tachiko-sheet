import { cellDisplay } from "./field-display.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

export interface GridMatch { entity: string; field: string; rowIndex: number }

/** Cells whose displayed text contains the query literally (spaces count), in display order. Blank query: none. */
export function findGridMatches(rows: readonly TableRow[], columns: readonly TableColumn[], query: string): GridMatch[] {
  if (!query.trim()) return [];
  const needle = query.toLocaleLowerCase();
  const matches: GridMatch[] = [];
  rows.forEach((row, rowIndex) => {
    for (const column of columns) {
      if (cellDisplay(row, column).text.toLocaleLowerCase().includes(needle)) matches.push({ entity: rowEntity(row), field: column.id, rowIndex });
    }
  });
  return matches;
}

/** Next index, wrapping; -1 when there are no matches. current -1 means "before the first". */
export function stepGridMatch(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export function findStatusText(count: number, current: number): string {
  return count === 0 ? "No matches" : `${current < 0 ? 0 : current + 1} of ${count}`;
}

/** Stored Text cells eligible for Work's exact, case-sensitive replace. */
export function replaceTargets(rows: readonly TableRow[], columns: readonly TableColumn[], query: string): { entity: string; field: string }[] {
  if (!query) return [];
  return rows.flatMap(row => columns.flatMap(column => {
    const field = fieldForColumn(row, column.id);
    return column.field_type === "text" && field?.formula == null && field?.stored?.kind === "text" && field.stored.value.includes(query)
      ? [{ entity: rowEntity(row), field: column.id }] : [];
  }));
}

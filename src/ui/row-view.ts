/** Client-only ordering for the grid. Never changes the Work projection. */
import { cellDisplay } from "./field-display.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

export interface RowViewSort {
  field: string;
  direction: "asc" | "desc";
}

export interface RowViewFilter {
  field: string;
  text: string;
}

export interface RowViewSettings {
  sort?: RowViewSort;
  filter?: RowViewFilter;
  /** Rows just added or edited while a filter is active; visible until it changes. */
  kept?: ReadonlySet<string>;
}

/** View settings scoped to one work occurrence; the record survives a missing projection. */
export interface RowViewRecord {
  occurrence: string | null;
  byCollection: Record<string, RowViewSettings>;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NO_KEPT: ReadonlySet<string> = new Set();

interface SortableRow {
  row: TableRow;
  index: number;
  blank: boolean;
  number: number | null;
  text: string;
}

/** True when the pasted block would run past the last row the filter shows. */
export function pastePastVisibleRows(startRow: number, pastedRows: number, visibleRows: number): boolean {
  return startRow + pastedRows > visibleRows;
}

/**
 * The publish/add-rows paste route addresses the stored order, so a paste that
 * would extend past the displayed rows cannot carry display-order mapping.
 * Refuse the whole paste whenever a sort or filter is active; null leaves the
 * unsorted, unfiltered paste exactly as it was.
 */
export function rowViewPasteRefusal(
  settings: Pick<RowViewSettings, "sort" | "filter">,
  startRow: number,
  pastedRows: number,
  visibleRows: number,
): string | null {
  if (!pastePastVisibleRows(startRow, pastedRows, visibleRows)) return null;
  const sorted = settings.sort !== undefined;
  const filtered = (settings.filter?.text.trim() ?? "") !== "";
  if (sorted && filtered) return "Clear the sort and filter to paste past the visible rows.";
  if (sorted) return "Clear the sort to paste past the last row.";
  if (filtered) return "Clear the filter to paste past the visible rows.";
  return null;
}

/**
 * Keep the installed view settings while a projection is temporarily missing.
 * Only a different, confirmed occurrence (a replaced work) clears them.
 */
export function rowViewRecordForOccurrence(current: RowViewRecord, occurrence: string | null | undefined): RowViewRecord {
  if (!occurrence || current.occurrence === occurrence) return current;
  return { occurrence, byCollection: {} };
}

/**
 * Drop settings that point at a column which no longer exists, so restoring
 * the column (Undo) cannot silently revive a sort or filter. A renamed column
 * keeps its id and therefore its settings.
 */
export function rowViewSettingsForColumns(settings: RowViewSettings, columnIds: ReadonlySet<string>): RowViewSettings {
  const dropSort = settings.sort !== undefined && !columnIds.has(settings.sort.field);
  const dropFilter = settings.filter !== undefined && !columnIds.has(settings.filter.field);
  if (!dropSort && !dropFilter) return settings;
  return {
    ...settings,
    sort: dropSort ? undefined : settings.sort,
    filter: dropFilter ? undefined : settings.filter,
    kept: dropFilter ? undefined : settings.kept,
  };
}

/** Apply a filter; changing or clearing it discards kept rows. */
export function rowViewSettingsForFilter(settings: RowViewSettings, field: string, text: string): RowViewSettings {
  const trimmed = text.trim();
  const unchanged = settings.filter?.field === field && settings.filter?.text === trimmed;
  return {
    ...settings,
    filter: trimmed ? { field, text: trimmed } : undefined,
    kept: unchanged ? settings.kept : undefined,
  };
}

/**
 * Keep a confirmed insertion visible under the active filter, like an edited
 * row. Without a filter the row is visible anyway, so nothing is kept.
 */
export function rowViewKeepingRows(settings: RowViewSettings, entities: readonly string[]): RowViewSettings {
  if (!settings.filter || entities.length === 0) return settings;
  const kept = new Set(settings.kept);
  for (const entity of entities) kept.add(entity);
  return { ...settings, kept };
}

/**
 * The displayed rows a block addresses. Paste and clear targets follow the
 * displayed order, so a sorted grid must not fall back to the stored order.
 */
export function rowViewBlockRows(rows: readonly TableRow[], startRow: number, height: number): TableRow[] {
  return rows.slice(startRow, startRow + height);
}

export type RowViewFilterKeyAction = "apply" | "cancel" | null;

/**
 * Keys for the Filter… input. Enter applies and Escape cancels, but an IME
 * composition key (isComposing, or the 229 legacy keyCode) does neither.
 * Enter is handled on the input itself: the menu's implicit form submission
 * does not fire, although its Apply button still submits the form.
 */
export function rowViewFilterKeyAction(event: { key: string; composing?: boolean; keyCode?: number }): RowViewFilterKeyAction {
  if (event.composing === true || event.keyCode === 229) return null;
  if (event.key === "Enter") return "apply";
  if (event.key === "Escape") return "cancel";
  return null;
}

/**
 * Display order for one table: filter, then stable sort, then the original
 * order. Blank and empty-text cells sort last in both directions. The draft
 * row is owned by the grid footer and never enters this function.
 */
export function rowViewOrder(
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  settings: RowViewSettings = {},
): TableRow[] {
  const filterText = settings.filter?.text.trim().toLowerCase() ?? "";
  const filterColumn = filterText ? columns.find((column) => column.id === settings.filter!.field) : undefined;
  const sort = settings.sort;
  const sortColumn = sort ? columns.find((column) => column.id === sort.field) : undefined;
  const kept = settings.kept ?? NO_KEPT;

  const entries: SortableRow[] = [];
  rows.forEach((row, index) => {
    if (filterColumn && !kept.has(rowEntity(row)) && !matchesFilter(row, filterColumn, filterText)) return;
    entries.push(sortColumn ? sortableRow(row, index, sortColumn) : { row, index, blank: false, number: null, text: "" });
  });

  if (!sortColumn || !sort) return entries.map((entry) => entry.row);

  const direction = sort.direction;
  entries.sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    if (!a.blank) {
      const compared = sortColumn.field_type === "number"
        ? compareNumbers(a.number, b.number)
        : COLLATOR.compare(a.text, b.text);
      if (compared !== 0) return direction === "asc" ? compared : -compared;
    }
    return a.index - b.index;
  });
  return entries.map((entry) => entry.row);
}

function matchesFilter(row: TableRow, column: TableColumn, text: string): boolean {
  return cellDisplay(row, column).text.trim().toLowerCase().includes(text);
}

function sortableRow(row: TableRow, index: number, column: TableColumn): SortableRow {
  const display = cellDisplay(row, column);
  const field = fieldForColumn(row, column.id);
  const blank = isBlank(row, column, field === null);
  if (column.field_type === "number") {
    const number = field?.calculated?.status === "value"
      ? field.calculated.value
      : field?.stored?.kind === "number" ? field.stored.value : null;
    return { row, index, blank: blank || number === null || !Number.isFinite(number), number, text: display.text };
  }
  return { row, index, blank: blank || display.text === "", number: null, text: display.text };
}

function isBlank(row: TableRow, column: TableColumn, missing: boolean): boolean {
  if (row.blank_fields?.includes(column.id)) return true;
  if (missing) return true;
  const field = fieldForColumn(row, column.id);
  if (field?.blank === true) return true;
  return !field?.formula && field?.stored?.kind === "text" && field.stored.value === "";
}

function compareNumbers(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

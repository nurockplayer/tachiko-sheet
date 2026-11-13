/** Client-only ordering for the grid. Never changes the Work projection. */
import { cellDisplay } from "./field-display.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";

export interface RowViewSort {
  field: string;
  direction: "asc" | "desc";
}

export type RowViewComparison = "=" | "<>" | "<" | "<=" | ">" | ">=";
export type RowViewFilter =
  | { field: string; kind: "contains"; text: string }
  | { field: string; kind: "values"; values: readonly string[] }
  | { field: string; kind: "number"; op: RowViewComparison; value: number }
  | { field: string; kind: "date"; op: RowViewComparison; value: string };

export interface RowViewSettings {
  sort?: RowViewSort;
  filters?: readonly RowViewFilter[];
  /** Rows just added or edited while a filter is active; visible until it changes. */
  kept?: ReadonlySet<string>;
  /** Column id → CSS px. A view width, never part of the work file. */
  widths?: Readonly<Record<string, number>>;
}

/** The narrowest and widest a column may be dragged, in CSS px. */
export const COLUMN_WIDTH_MIN = 48;
export const COLUMN_WIDTH_MAX = 800;

/** A dragged width is a whole number of CSS pixels inside the allowed range. */
export function clampColumnWidth(px: number): number {
  const rounded = Math.round(px);
  if (!Number.isFinite(rounded)) return COLUMN_WIDTH_MIN;
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, rounded));
}

/** Convert Work's 1/256-character widths using Excel's seven-pixel digit. */
export function columnWidthToPx(units: number): number {
  return Math.trunc((units / 256) * 7 + 5);
}

export function columnWidthToUnits(px: number): number {
  return Math.min(65280, Math.max(1, Math.ceil(Math.max(0, (px - 5) / 7) * 256)));
}

/** Set one column's width; an unchanged width returns the same settings object. */
export function rowViewWithWidth(settings: RowViewSettings, field: string, px: number): RowViewSettings {
  const width = clampColumnWidth(px);
  if (settings.widths?.[field] === width) return settings;
  return { ...settings, widths: { ...settings.widths, [field]: width } };
}

/**
 * The width a double-click fits: the header plus its sort/filter markers and
 * menu, or the widest cell text, plus the cell padding and its border.
 */
export function autoFitWidth(texts: readonly string[], header: string, measure: (text: string) => number): number {
  let widest = measure(header) + 28;
  for (const text of texts) widest = Math.max(widest, measure(text));
  return clampColumnWidth(widest + 22);
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
  settings: Pick<RowViewSettings, "sort" | "filters">,
  startRow: number,
  pastedRows: number,
  visibleRows: number,
): string | null {
  if (!pastePastVisibleRows(startRow, pastedRows, visibleRows)) return null;
  const sorted = settings.sort !== undefined;
  const filtered = Boolean(settings.filters?.length);
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
  const filters = settings.filters?.filter(filter => columnIds.has(filter.field));
  const dropFilter = filters?.length !== settings.filters?.length;
  const keptWidths = settings.widths
    ? Object.fromEntries(Object.entries(settings.widths).filter(([field]) => columnIds.has(field)))
    : undefined;
  const dropWidths = keptWidths !== undefined && Object.keys(keptWidths).length !== Object.keys(settings.widths!).length;
  if (!dropSort && !dropFilter && !dropWidths) return settings;
  return {
    ...settings,
    sort: dropSort ? undefined : settings.sort,
    filters: dropFilter ? (filters?.length ? filters : undefined) : settings.filters,
    kept: dropFilter ? undefined : settings.kept,
    widths: dropWidths ? (Object.keys(keptWidths!).length > 0 ? keptWidths : undefined) : settings.widths,
  };
}

/** Apply a filter; changing or clearing it discards kept rows. */
export function rowViewSettingsForFilter(settings: RowViewSettings, field: string, next: RowViewFilter | null): RowViewSettings {
  if (next?.kind === "contains") next = next.text.trim() ? { ...next, text: next.text.trim() } : null;
  const previous = settings.filters?.find(filter => filter.field === field);
  const canonical = (filter: RowViewFilter | null | undefined) => JSON.stringify(filter?.kind === "values" ? { ...filter, values: [...filter.values].sort() } : filter ?? null);
  if (canonical(previous) === canonical(next)) return settings;
  const filters = [...(settings.filters ?? []).filter(filter => filter.field !== field), ...(next ? [next] : [])];
  return { ...settings, filters: filters.length ? filters : undefined, kept: undefined };
}

/**
 * Identity of the displayed order and membership. A different sort field or
 * direction, or a different filter, remaps display addresses, so anything
 * anchored to them (a rectangular selection) is invalid once this changes.
 */
export function rowViewDisplaySignature(settings: Pick<RowViewSettings, "sort" | "filters">): string {
  const sort = settings.sort ? `${settings.sort.field}\u0000${settings.sort.direction}` : "";
  const filter = JSON.stringify([...(settings.filters ?? [])].sort((a, b) => a.field < b.field ? -1 : a.field > b.field ? 1 : 0).map(item => item.kind === "values" ? { ...item, values: [...item.values].sort() } : item));
  return `${sort}\u0001${filter}`;
}

/**
 * Keep a confirmed insertion visible under the active filter, like an edited
 * row. Without a filter the row is visible anyway, so nothing is kept.
 */
export function rowViewKeepingRows(settings: RowViewSettings, entities: readonly string[]): RowViewSettings {
  if (!settings.filters?.length || entities.length === 0) return settings;
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
  const filters = (settings.filters ?? []).flatMap(filter => {
    const column = columns.find(item => item.id === filter.field);
    return column ? [{ filter, column }] : [];
  });
  const sort = settings.sort;
  const sortColumn = sort ? columns.find((column) => column.id === sort.field) : undefined;
  const kept = settings.kept ?? NO_KEPT;

  const entries: SortableRow[] = [];
  rows.forEach((row, index) => {
    if (!kept.has(rowEntity(row)) && !filters.every(({ filter, column }) => matchesFilter(row, column, filter))) return;
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

export function rowViewValueChoices(rows: readonly TableRow[], column: TableColumn, limit = 200): { values: string[]; truncated: boolean } {
  const values = [...new Set(rows.map(row => cellDisplay(row, column).text))].sort((a, b) => a === "" ? (b === "" ? 0 : -1) : b === "" ? 1 : COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  return { values: values.slice(0, limit), truncated: values.length > limit };
}

/** What a condition's draft still needs. Text kept from Contains can be a partial date, which the date box shows as empty. */
export function rowViewConditionError(fieldType: string, text: string): string | null {
  if (fieldType === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? null : "Enter a date.";
  return text.trim() && Number.isFinite(Number(text)) ? null : "Enter a number.";
}

/** Whether every value on offer is checked, so the filter would hide nothing. A checked value an edit has since removed doesn't count. */
export function rowViewChoicesAllChecked(choices: { values: readonly string[]; truncated: boolean }, checked: readonly string[]): boolean {
  return !choices.truncated && choices.values.every(value => checked.includes(value));
}

function matchesFilter(row: TableRow, column: TableColumn, filter: RowViewFilter): boolean {
  const display = cellDisplay(row, column).text;
  if (filter.kind === "contains") return display.trim().toLowerCase().includes(filter.text.trim().toLowerCase());
  if (filter.kind === "values") return filter.values.includes(display);
  const field = fieldForColumn(row, column.id);
  if (isBlank(row, column, field === null)) return false;
  const value = field?.calculated ? (field.calculated.status === "value" ? field.calculated.value : null)
    : field?.stored?.kind === filter.kind ? field.stored.value : null;
  if (filter.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (filter.kind === "date" && typeof value !== "string") return false;
  if (value === null) return false;
  switch (filter.op) {
    case "=": return value === filter.value;
    case "<>": return value !== filter.value;
    case "<": return value < filter.value;
    case "<=": return value <= filter.value;
    case ">": return value > filter.value;
    case ">=": return value >= filter.value;
  }
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
  const text = column.field_type === "date" && field?.stored?.kind === "date" ? field.stored.value : display.text;
  return { row, index, blank: blank || display.text === "", number: null, text };
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

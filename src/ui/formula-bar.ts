import type { Currentness, FieldTarget, WorkbookView } from "../contracts.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";
import { DRAFT_ROW } from "./row-entry-model.js";

/** Presentation state for the one focused field instance; never a column rule. */
export interface FormulaBarState {
  /** Bind identity: one view revision plus one cell. A newer owner never inherits a draft. */
  identity: string;
  label: string;
  target: FieldTarget | null;
  /** Work's projected `formula.source`, or empty for an ordinary cell. */
  source: string;
  editable: boolean;
  reason: string | null;
  /** A note that does not refuse editing, e.g. the bound row is hidden by a filter. */
  note: string | null;
}

export interface FormulaBarDraft { identity: string; value: string }

export const FORMULA_BAR_PLACEHOLDER = "Enter a formula";
export const FORMULA_BAR_NO_CELL = "Select a cell to see its formula.";
export const FORMULA_BAR_DRAFT_ROW = "Add the row before editing its formula.";
export const FORMULA_BAR_DRAFT_ROW_HINT = "Add or discard the new row first. Press Esc to cancel this formula.";
export const FORMULA_BAR_HIDDEN_ROW = "This row is hidden by the current filter or sort. Its formula can still be edited.";
export const FORMULA_BAR_NON_NATIVE = "Formula editing is available only in native tables. This table does not support it.";
export const FORMULA_BAR_COLUMN = "This column cannot hold a formula.";
export const FORMULA_BAR_UNKNOWN = "The current work is not confirmed. Use Refresh to recheck it before editing formulas.";
export const FORMULA_BAR_LOCKED = "An operation is in progress; formula editing is disabled until it finishes.";
export { FORMULA_BAR_GUIDANCE } from "./clipboard.js";

export function formulaBarState(input: {
  viewIdentity: string;
  table: WorkbookView["table"] | null;
  columns: readonly TableColumn[];
  displayRows: readonly TableRow[];
  focus: { entity: string; field: string } | null;
  currentness: Currentness;
  /** Another Work operation is in flight; its publication would drop a draft. */
  locked?: boolean;
}): FormulaBarState {
  const empty: FormulaBarState = {
    identity: `${input.viewIdentity}\u0000${input.focus?.entity ?? ""}\u0000${input.focus?.field ?? ""}`,
    label: "",
    target: null,
    source: "",
    editable: false,
    reason: FORMULA_BAR_NO_CELL,
    note: null,
  };
  if (!input.table || !input.focus) return empty;
  const column = input.columns.find((candidate) => candidate.id === input.focus!.field);
  if (!column) return empty;
  if (input.focus.entity === DRAFT_ROW) {
    return { ...empty, label: `${column.display_name} · New row`, reason: FORMULA_BAR_DRAFT_ROW };
  }
  // A filter or sort can hide the focused row. Its instance still exists in
  // the projection, so the bar keeps editing it and says whose formula it is.
  const index = input.displayRows.findIndex((row) => rowEntity(row) === input.focus!.entity);
  const displayed = index >= 0 ? input.displayRows[index] : undefined;
  const row = displayed ?? input.table.rows.find((candidate) => rowEntity(candidate) === input.focus!.entity);
  if (!row) return empty;
  const field = fieldForColumn(row, column.id);
  const target = field?.target ?? { entity: input.focus.entity, field: column.id };
  const rowName = rowLabel(row, input.columns) || (displayed ? `Row ${index + 1}` : "Hidden row");
  const reason = !tableAdmitsFormulas(input.table) ? FORMULA_BAR_NON_NATIVE
    : !columnCanHoldFormula(field, column) ? FORMULA_BAR_COLUMN
    : input.currentness === "unknown" ? FORMULA_BAR_UNKNOWN
    : input.locked === true || input.currentness !== "current" ? FORMULA_BAR_LOCKED
    : null;
  return {
    identity: empty.identity,
    label: `${column.display_name} · ${rowName}`,
    target,
    source: field?.formula?.source ?? "",
    editable: reason === null,
    reason,
    note: displayed ? null : FORMULA_BAR_HIDDEN_ROW,
  };
}

/**
 * Work's reference token for one projected cell, from the projection's own
 * keys — never a DOM id, an entity id or a display name. Work refuses ids with
 * `MissingEntityKey`, and a rename only changes `display_name`.
 *
 * The same-row shorthand (`[.fieldKey]`) is not on this pin (Work #574), so
 * every reference takes the full `[entityKey.fieldKey]` form.
 */
export function formulaReferenceToken(
  row: { key: string } | null,
  column: { key: string } | null,
): string | null {
  const entityKey = row?.key ?? "";
  const fieldKey = column?.key ?? "";
  if (!entityKey.trim() || !fieldKey.trim()) return null;
  return `[${entityKey}.${fieldKey}]`;
}

/**
 * What a click on a grid cell means while the formula bar holds the caret:
 * a reference token to insert, or nothing (an ordinary click, a draft row, a
 * stub cell, or a bar that is not in edit mode).
 */
export function formulaReferenceInsertion(input: {
  /** The bar's input owns the caret and is editable. */
  barHasCaret: boolean;
  /** The clicked cell belongs to the new-row draft. */
  draft: boolean;
  row: { key: string } | null;
  column: { key: string } | null;
}): string | null {
  if (!input.barHasCaret || input.draft) return null;
  return formulaReferenceToken(input.row, input.column);
}

/** Insert a token at the caret, replacing the selection; returns the caret after it. */
export function insertFormulaReference(
  value: string,
  token: string,
  selection: { start: number; end: number } | null,
): { value: string; caret: number } {
  const start = Math.min(Math.max(selection?.start ?? value.length, 0), value.length);
  const end = Math.min(Math.max(selection?.end ?? start, start), value.length);
  return { value: `${value.slice(0, start)}${token}${value.slice(end)}`, caret: start + token.length };
}

export type FormulaBarKeyAction =
  | { kind: "cancel" }
  | { kind: "submit"; then: "stay" | "next" | "previous" };

/**
 * Keys the bar owns while it has the caret. Tab applies a changed formula like
 * Enter and moves on; with nothing to apply it leaves the bar without moving
 * focus into the grid, so the browser's native Tab cannot bounce it back.
 */
export function formulaBarKeyAction(
  event: { key: string; repeat: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  changed: boolean,
): FormulaBarKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Escape") return { kind: "cancel" };
  if (event.repeat) return null;
  if (event.key === "Enter" && !event.shiftKey) return { kind: "submit", then: "stay" };
  if (event.key === "Tab") return changed
    ? { kind: "submit", then: event.shiftKey ? "previous" : "next" }
    : { kind: "cancel" };
  return null;
}

/** Work projected a formula for this field instance; Sheet never infers one. */
export function isFormulaCell(row: TableRow, column: TableColumn): boolean {
  return fieldForColumn(row, column.id)?.formula != null;
}

/**
 * A draft is visible only for the exact projection revision and cell that
 * started it. It stays visible while editing is temporarily locked, because
 * the text belongs to this cell and a new revision changes the identity.
 */
export function boundFormulaDraft(state: FormulaBarState, draft: FormulaBarDraft | null): FormulaBarDraft | null {
  return draft && draft.identity === state.identity ? draft : null;
}

export function formulaBarDraftValue(state: FormulaBarState, draft: FormulaBarDraft | null): string {
  return boundFormulaDraft(state, draft)?.value ?? state.source;
}

/**
 * Work's native-table profile is a *scalar row authoring shape* check, not a
 * stable table identity: one formula value makes it withdraw, even though Work
 * keeps accepting formula updates on numeric and formula cells. A projected
 * formula is Work's own evidence that this table admits formula authoring, so
 * the bar trusts that instead of guessing a profile from column types. A
 * tracker is never one, whatever its rows project.
 */
function tableAdmitsFormulas(table: WorkbookView["table"]): boolean {
  if (table.tracker_profile === true) return false;
  if (table.native_table_profile) return true;
  return table.rows.some((row) => row.fields.some((field) => field.formula !== null));
}

function columnCanHoldFormula(field: TableRow["fields"][number] | null, column: TableColumn): boolean {
  if (field) return field.formula !== null || field.editable_scalar !== null;
  return column.field_type === "text" || column.field_type === "number" ||
    column.field_type === "date" || column.field_type === "boolean";
}

/** The row's first readable value, never an internal ID. */
function rowLabel(row: TableRow, columns: readonly TableColumn[]): string {
  const first = columns[0];
  const stored = first ? fieldForColumn(row, first.id)?.stored : null;
  if (!stored) return "";
  return stored.kind === "text" ? stored.value.trim() : stored.kind === "number" ? String(stored.value) : "";
}

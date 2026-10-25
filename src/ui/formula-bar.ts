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
}

export interface FormulaBarDraft { identity: string; value: string }

export const FORMULA_BAR_PLACEHOLDER = "Enter a formula";
export const FORMULA_BAR_NO_CELL = "Select a cell to see its formula.";
export const FORMULA_BAR_DRAFT_ROW = "Add the row before editing its formula.";
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
  };
  if (!input.table || !input.focus) return empty;
  const column = input.columns.find((candidate) => candidate.id === input.focus!.field);
  if (!column) return empty;
  if (input.focus.entity === DRAFT_ROW) {
    return { ...empty, label: `${column.display_name} · New row`, reason: FORMULA_BAR_DRAFT_ROW };
  }
  const index = input.displayRows.findIndex((row) => rowEntity(row) === input.focus!.entity);
  const row = input.displayRows[index];
  if (!row) return empty;
  const field = fieldForColumn(row, column.id);
  const target = field?.target ?? { entity: input.focus.entity, field: column.id };
  const rowName = rowLabel(row, input.columns) || `Row ${index + 1}`;
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
  };
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

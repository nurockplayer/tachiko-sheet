import type { Currentness, FieldTarget, WorkbookView } from "../contracts.js";
import { fieldForColumn, rowEntity, type TableColumn, type TableRow } from "./projection-access.js";
import { DRAFT_ROW } from "./row-entry-model.js";
import { rowSource } from "./row-source.js";

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
  const row = displayed ?? rowSource(input.table).byEntity(input.focus!.entity);
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
 * Work #574 is on the pin: a reference to the formula's own row uses
 * `[.fieldKey]`; references to other rows use `[entityKey.fieldKey]`.
 */
export function formulaReferenceToken(
  row: { key: string } | null,
  column: { key: string } | null,
  formulaRowKey: string | null,
): string | null {
  const entityKey = row?.key ?? "";
  const fieldKey = column?.key ?? "";
  if (!entityKey.trim() || !fieldKey.trim()) return null;
  return formulaRowKey === entityKey ? `[.${fieldKey}]` : `[${entityKey}.${fieldKey}]`;
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
  /** The projection key of the row whose formula is being edited. */
  formulaRowKey: string | null;
  /**
   * The clicked row projects a field instance for this column. The grid also
   * draws a stub cell for every column, but a cell Work never projected has
   * no reference to give; only the projection can name an address.
   */
  hasProjectedField: boolean;
}): string | null {
  if (!input.barHasCaret || input.draft || !input.hasProjectedField) return null;
  return formulaReferenceToken(input.row, input.column, input.formulaRowKey);
}

/** Whether the rendered refusal line clips any of its text. */
export function formulaRefusalIsTruncated(element: Pick<HTMLElement, "scrollWidth" | "clientWidth">): boolean {
  return element.scrollWidth > element.clientWidth;
}

/**
 * A pointer-down inside the cell's own scalar editor is that editor's: the
 * native caret placement and text selection must survive, and no reference is
 * inserted. `target` is only inspected through `closest`, so this stays a
 * pure predicate.
 */
export function cellEditorOwnsPointer(target: { closest?: (selector: string) => unknown } | null): boolean {
  return Boolean(target?.closest?.("input, [role=\"listbox\"]"));
}

/** A grid cell address; only identity matters for focus movement. */
export interface FormulaGridPosition { entity: string; field: string }

/**
 * Tab/Shift+Tab after a successful formula submit lands on a cell the grid
 * actually displays. A filter can hide the bound row, so a position missing
 * from the displayed order falls back to the first (Tab) or last (Shift+Tab)
 * visible cell; with nothing visible it returns null, which keeps focus in the
 * bar instead of on a cell that is not mounted.
 */
export function positionedAfterFormulaSubmit(input: {
  position: FormulaGridPosition;
  then: "stay" | "next" | "previous";
  /** Displayed cells in grid order; the new-row draft is last when present. */
  order: readonly FormulaGridPosition[];
  /** The new-row draft is never a submit destination. */
  draftEntity: string;
}): FormulaGridPosition | null {
  if (input.then === "stay") return input.position;
  const index = input.order.findIndex((item) => item.entity === input.position.entity && item.field === input.position.field);
  if (index >= 0) {
    const target = input.order[index + (input.then === "next" ? 1 : -1)];
    return target && target.entity !== input.draftEntity ? target : input.position;
  }
  const visible = input.then === "next" ? input.order : [...input.order].reverse();
  return visible.find((item) => item.entity !== input.draftEntity) ?? null;
}

/** A Tab/Shift+Tab/Enter handoff queued by a formula submit. */
export interface FormulaSubmitHandoff {
  /** The focused cell at submit time; the neighbour comes from the grid's order. */
  position: FormulaGridPosition;
  then: "stay" | "next" | "previous";
  /** The projection displayed when the submit started; the handoff waits for a newer one. */
  viewKey: string;
  /** `focusIntent` generation at submit; a newer user focus action cancels the handoff. */
  generation: number;
  /** The occurrence the submit belonged to; a replaced workbook cancels the handoff. */
  occurrence: string;
}

export type FormulaSubmitHandoffOutcome =
  /** The commit's own projection has not rendered yet; keep the handoff queued. */
  | { kind: "wait" }
  /** Focus is no longer the commit's: stop without moving it. */
  | { kind: "stop" }
  | { kind: "move"; destination: FormulaGridPosition | null };

/**
 * Decide a queued formula-submit handoff against what the grid displays *now*.
 * A commit can change a filter or sort, so the order captured before it is
 * never a destination: the neighbour is resolved from the rendered order only
 * once the commit's own projection has replaced the one it started from.
 */
export function formulaSubmitHandoffOutcome(input: {
  handoff: FormulaSubmitHandoff;
  /** Current `focusIntent` generation, bumped by any newer focus action. */
  generation: number;
  /** The open work's occurrence right now, or empty when nothing is open. */
  occurrence: string;
  /** The projection the grid displays right now, or empty when the workbook is gone. */
  viewKey: string;
  order: readonly FormulaGridPosition[];
  draftEntity: string;
  /** A modal owns focus and must keep it. */
  modalOpen: boolean;
  /** Focus is still on the bar, or was dropped to the body by its disabled input. */
  focusOnBar: boolean;
}): FormulaSubmitHandoffOutcome {
  if (input.modalOpen || !input.focusOnBar) return { kind: "stop" };
  if (input.handoff.generation !== input.generation) return { kind: "stop" };
  if (input.handoff.occurrence !== input.occurrence) return { kind: "stop" };
  // A replaced (recovery) or not-yet-rendered projection has no grid to land on.
  if (input.viewKey === "") return { kind: "stop" };
  if (input.viewKey === input.handoff.viewKey) return { kind: "wait" };
  return {
    kind: "move",
    destination: positionedAfterFormulaSubmit({
      position: input.handoff.position,
      then: input.handoff.then,
      order: input.order,
      draftEntity: input.draftEntity,
    }),
  };
}

/**
 * The grid a handoff settles against: one render's displayed order, the row
 * index of every displayed row in that same order, and whether only a window
 * of rows is mounted. All of it must come from one projection: a destination
 * named by the rendered order has to be looked up (and revealed) in the same
 * window, never in the one captured before the commit.
 */
export interface FormulaHandoffGrid {
  viewKey: string;
  order: readonly FormulaGridPosition[];
  /** Displayed row index by entity, built from this same order. */
  rowIndexByEntity: ReadonlyMap<string, number>;
  /** Rows outside the mounted window exist, so a destination there must be revealed. */
  windowed: boolean;
}

export type FormulaHandoffSettlement =
  | { kind: "wait" }
  | { kind: "stop" }
  | {
    kind: "move";
    destination: FormulaGridPosition;
    /** The rendered row to mount before focusing, or null when no reveal is needed. */
    rowIndex: number | null;
  };

/**
 * Settle a handoff and name the row a windowed grid must mount for it. The row
 * index comes from the same rendered projection that named the destination, so
 * a row a filter or sort has just revealed is reachable even though no earlier
 * window displayed it.
 */
export function formulaHandoffSettlement(input: {
  handoff: FormulaSubmitHandoff;
  generation: number;
  occurrence: string;
  draftEntity: string;
  modalOpen: boolean;
  focusOnBar: boolean;
  rendered: FormulaHandoffGrid;
}): FormulaHandoffSettlement {
  const outcome = formulaSubmitHandoffOutcome({
    handoff: input.handoff,
    generation: input.generation,
    occurrence: input.occurrence,
    viewKey: input.rendered.viewKey,
    order: input.rendered.order,
    draftEntity: input.draftEntity,
    modalOpen: input.modalOpen,
    focusOnBar: input.focusOnBar,
  });
  if (outcome.kind !== "move") return outcome;
  if (!outcome.destination) return { kind: "stop" };
  const destination = outcome.destination;
  return {
    kind: "move",
    destination,
    rowIndex: input.rendered.windowed
      ? input.rendered.rowIndexByEntity.get(destination.entity) ?? null
      : null,
  };
}

/**
 * The formula source of an in-cell entry that starts with "=", as in other
 * spreadsheets, or null for an ordinary value. Work parses the source; Sheet
 * only removes the leading "=" that the formula grammar does not use.
 */
export function inCellFormulaSource(value: string): string | null {
  const entry = value.trim();
  return entry.length > 1 && entry.startsWith("=") ? entry.slice(1).trim() : null;
}

/** Work's refusal with its own character position, as one line of text. */
export function formulaRefusalText(error: { message: string; position?: number }): string {
  return `${error.message}${error.position !== undefined ? ` (position ${error.position})` : ""}`;
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
  return rowSource(table).allRowsForNow().some((row) => row.fields.some((field) => field.formula !== null));
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

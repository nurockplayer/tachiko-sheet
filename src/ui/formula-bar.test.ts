/**
 * Focused unit evidence for the formula bar's presentation contract. These are
 * server-rendered strings and pure helpers, not browser or Work behaviour.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FieldProjection, StoredValueProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";
import { FormulaBar } from "./FormulaBar.js";
import {
  FORMULA_BAR_COLUMN,
  FORMULA_BAR_DRAFT_ROW,
  FORMULA_BAR_DRAFT_ROW_HINT,
  FORMULA_BAR_HIDDEN_ROW,
  FORMULA_BAR_LOCKED,
  FORMULA_BAR_NON_NATIVE,
  FORMULA_BAR_NO_CELL,
  FORMULA_BAR_UNKNOWN,
  boundFormulaDraft,
  cellEditorOwnsPointer,
  formulaBarDraftValue,
  formulaBarKeyAction,
  formulaBarState,
  formulaRefusalIsTruncated,
  formulaHandoffSettlement,
  formulaRefusalText,
  inCellFormulaSource,
  formulaSubmitHandoffOutcome,
  formulaReferenceInsertion,
  formulaReferenceToken,
  insertFormulaReference,
  isFormulaCell,
  positionedAfterFormulaSubmit,
  type FormulaGridPosition,
  type FormulaHandoffGrid,
  type FormulaSubmitHandoff, formulaBarSource, formulaColumnNameHint } from "./formula-bar.js";
import { fieldForColumn, type TableColumn, type TableRow } from "./projection-access.js";

const task: TableColumn = { id: "task", key: "task", display_name: "Task", field_type: "text", required: true };
const impact: TableColumn = { id: "impact", key: "impact", display_name: "Impact", field_type: "number", required: false };
const columns: TableColumn[] = [task, impact];

function field(
  entity: string,
  targetField: string,
  stored: StoredValueProjection | null,
  formula: { source: string } | null = null,
  editable: FieldProjection["editable_scalar"] = null,
): FieldProjection {
  return {
    target: { entity, field: targetField },
    address: `${entity}.${targetField}`,
    stored,
    formula,
    calculated: formula ? { status: "value", value: 10 } : null,
    diagnostics: [],
    editable_scalar: editable,
  };
}

const formulaRow: TableRow = {
  id: "row-1",
  key: "row-1",
  fields: [
    field("e1", "task", { kind: "text", value: "Reserve" }, null, "text"),
    // Work projects a formula field with no stored scalar and no scalar kind.
    field("e1", "impact", null, { source: "min([task.qty], 4) + 1" }),
  ],
};
const plainRow: TableRow = {
  id: "row-2",
  key: "row-2",
  fields: [
    field("e2", "task", { kind: "text", value: "Rent" }, null, "text"),
    field("e2", "impact", { kind: "number", value: 3 }, null, "number"),
  ],
};
const scalarRow: TableRow = {
  id: "row-3",
  key: "row-3",
  fields: [
    field("e3", "task", { kind: "text", value: "Rent" }, null, "text"),
    field("e3", "impact", { kind: "number", value: 3 }, null, "number"),
  ],
};
const displayRows = [formulaRow, plainRow];

function table(native = true, options: { rows?: TableRow[]; tracker?: boolean } = {}): WorkbookView["table"] {
  return {
    revision: "rev-1",
    collection: { id: "col-1", key: "plan", display_name: "Plan", entity_count: 2 },
    columns,
    rows: options.rows ?? displayRows,
    ...(native ? { native_table_profile: true } : {}),
    ...(options.tracker === true ? { tracker_profile: true } : {}),
  };
}

function state(
  focus: { entity: string; field: string } | null,
  options: { native?: boolean; currentness?: "current" | "unknown"; locked?: boolean; rows?: TableRow[]; tracker?: boolean; displayRows?: TableRow[] } = {},
) {
  return formulaBarState({
    viewIdentity: "occ-1\u0000rev-1",
    table: table(options.native ?? true, options),
    columns,
    displayRows: options.displayRows ?? options.rows ?? displayRows,
    focus,
    currentness: options.currentness ?? "current",
    ...(options.locked === undefined ? {} : { locked: options.locked }),
  });
}

describe("formulaBarState", () => {
  it("shows only the focused instance's own projected formula source", () => {
    const value = state({ entity: "e1", field: "impact" });
    expect(value.label).toBe("Impact · Reserve");
    expect(value.source).toBe("min([task.qty], 4) + 1");
    expect(value.editable).toBe(true);
    expect(value.reason).toBeNull();
    expect(value.target).toEqual({ entity: "e1", field: "impact" });
  });

  it("leaves an ordinary cell blank instead of showing its value", () => {
    const value = state({ entity: "e1", field: "task" });
    expect(value.label).toBe("Task · Reserve");
    expect(value.source).toBe("");
    expect(value.editable).toBe(true);
  });

  it("follows focus to another revision-bound cell", () => {
    const first = state({ entity: "e1", field: "impact" });
    const second = state({ entity: "e2", field: "impact" });
    expect(second.source).toBe("");
    expect(second.label).toBe("Impact · Rent");
    expect(second.identity).not.toBe(first.identity);
  });

  it("names the reason a cell cannot hold a formula", () => {
    expect(state(null).reason).toBe(FORMULA_BAR_NO_CELL);
    expect(state(null).editable).toBe(false);
    expect(state({ entity: "e1", field: "task" }).editable).toBe(true);
    expect(state({ entity: "sheet:draft-row", field: "impact" }).reason).toBe(FORMULA_BAR_DRAFT_ROW);
    expect(state({ entity: "e3", field: "impact" }, { native: false, rows: [scalarRow] }).reason).toBe(FORMULA_BAR_NON_NATIVE);
    expect(state({ entity: "e1", field: "impact" }, { currentness: "unknown" }).reason).toBe(FORMULA_BAR_UNKNOWN);
    expect(state({ entity: "e1", field: "impact" }, { locked: true }).reason).toBe(FORMULA_BAR_LOCKED);
    expect(state({ entity: "e1", field: "impact" }, { locked: true }).editable).toBe(false);
  });

  it("stays editable when a formula has withdrawn Work's row-authoring profile", () => {
    // native_table_profile is a scalar row shape check, so Work drops it as
    // soon as a row holds a formula. After a successful submit the focused
    // formula cell must remain editable with no read-only reason.
    const value = state({ entity: "e1", field: "impact" }, { native: false });
    expect(value.source).toBe("min([task.qty], 4) + 1");
    expect(value.editable).toBe(true);
    expect(value.reason).toBeNull();
    // A sibling numeric cell keeps Work's scalar kind and stays formula-capable.
    const sibling = state({ entity: "e2", field: "impact" }, { native: false });
    expect(sibling.editable).toBe(true);
    expect(sibling.reason).toBeNull();
  });

  it("never treats a tracker as formula-capable, whatever its rows project", () => {
    expect(state({ entity: "e1", field: "impact" }, { native: false, tracker: true }).reason).toBe(FORMULA_BAR_NON_NATIVE);
  });

  it("does not guess a formula for a column Work never projected", () => {
    const missing: TableColumn = { id: "absent", key: "absent", display_name: "Absent", field_type: "unknown", required: false };
    const value = formulaBarState({
      viewIdentity: "occ-1\u0000rev-1",
      table: table(),
      columns: [task, missing],
      displayRows,
      focus: { entity: "e1", field: "absent" },
      currentness: "current",
    });
    expect(value.source).toBe("");
    expect(value.editable).toBe(false);
    expect(value.reason).toBe(FORMULA_BAR_COLUMN);
  });

  it("keeps a draft only for the exact cell in the exact revision", () => {
    const value = state({ entity: "e1", field: "impact" });
    const draft = { identity: value.identity, value: "1 + 2" };
    expect(formulaBarDraftValue(value, draft)).toBe("1 + 2");
    expect(boundFormulaDraft(value, { identity: "another-cell", value: "9" })).toBeNull();
    expect(formulaBarDraftValue(value, { identity: "another-cell", value: "9" })).toBe("min([task.qty], 4) + 1");
  });

  it("recognises a formula field instance from Work's projection only", () => {
    expect(isFormulaCell(formulaRow, impact)).toBe(true);
    expect(isFormulaCell(plainRow, impact)).toBe(false);
    expect(isFormulaCell(plainRow, task)).toBe(false);
  });
});

function render(props: Parameters<typeof FormulaBar>[0]): string {
  return renderToStaticMarkup(createElement(FormulaBar, props));
}

describe("FormulaBar", () => {
  it("renders the focused formula source beside the fx label", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const html = render({ state: bar, draft: null, pending: false, error: null });
    expect(html).toContain('class="ts-formula-fx"');
    expect(html).toContain("Impact · Reserve");
    expect(html).toContain("min([task.qty], 4) + 1");
    expect(html).toContain('placeholder="Enter a formula"');
    expect(html).not.toContain("readonly");
  });

  it("renders a blank editable input for an ordinary cell", () => {
    const bar = state({ entity: "e1", field: "task" });
    const html = render({ state: bar, draft: null, pending: false, error: null });
    expect(html).toContain('value=""');
    expect(html).not.toContain("10");
    expect(html).not.toContain("readonly");
  });

  it("renders the bound draft, not the projected source", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const html = render({ state: bar, draft: { identity: bar.identity, value: "min([task.qty], 2)" }, pending: false, error: null });
    expect(html).toContain('value="min([task.qty], 2)"');
    expect(html).not.toContain('value="min([task.qty], 4) + 1"');
  });

  it("is read-only with its reason outside a native table", () => {
    const bar = state({ entity: "e3", field: "impact" }, { native: false, rows: [scalarRow] });
    const html = render({ state: bar, draft: null, pending: false, error: null });
    expect(html).toContain("ts-formula-bar--readonly");
    expect(html).toContain("readonly");
    expect(html).toContain(FORMULA_BAR_NON_NATIVE);
  });

  it("stays editable after a formula submit withdrew Work's row-authoring profile", () => {
    const bar = state({ entity: "e1", field: "impact" }, { native: false });
    const html = render({ state: bar, draft: null, pending: false, error: null });
    expect(html).toContain("min([task.qty], 4) + 1");
    expect(html).toContain('placeholder="Enter a formula"');
    expect(html).not.toContain("readonly");
    expect(html).not.toContain(FORMULA_BAR_NON_NATIVE);
  });

  it("always keeps the reason line so focus never resizes the bar over the grid", () => {
    // The bar sits in normal flow directly above the grid. A reason line that
    // appeared or disappeared with focus moved every row under the pointer
    // between the two clicks of a double-click, so the line is always there.
    const editable = render({ state: state({ entity: "e1", field: "impact" }), draft: null, pending: false, error: null });
    const readOnly = render({ state: state({ entity: "e3", field: "impact" }, { native: false, rows: [scalarRow] }), draft: null, pending: false, error: null });
    for (const html of [editable, readOnly]) {
      expect(html.match(/data-testid="formula-bar-reason"/g)).toHaveLength(1);
    }
    expect(editable).toMatch(/<p class="ts-hint ts-formula-bar-reason"[^>]*data-testid="formula-bar-reason">\s*<\/p>/);
    expect(readOnly).toContain(FORMULA_BAR_NON_NATIVE);
  });

  it("reserves the refusal's line so showing it never moves the grid", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const withoutError = render({ state: bar, draft: null, pending: false, error: null });
    const withError = render({ state: bar, draft: null, pending: false, error: { message: "Unexpected end of input.", position: 4 } });
    // The refusal overlays the reason line inside one notes container, and its
    // Details disclosure and popover are overlays too. Taking them (and the
    // input's reference to the refusal) out must leave exactly the error-free
    // bar, so none of them adds a line height for the grid to move.
    expect(withError).toContain('class="ts-formula-bar-notes"');
    const stripped = withError
      .replace(/<p class="ts-dialog-error[^>]*>[\s\S]*?<\/p>/, "")
      .replace(/<button[^>]*>Details<\/button>/, "")
      .replace(/<div class="ts-formula-bar-error-details"[\s\S]*?<\/div>/, "")
      .replace(/ aria-describedby="[^"]*-error"/, "");
    expect(stripped).toBe(withoutError);
  });

  it("keeps a truncated refusal readable without adding a line", () => {
    // The fixed 18px line ellipsizes a long Work refusal. The whole text stays
    // in the alert region and is the hover title. Details appears only once the
    // rendered line is measured as clipped, so a server render has none and
    // its popover stays hidden.
    const message = "Unexpected end of input: the call to sum( is missing its closing parenthesis before the end of the formula.";
    const error = { message, position: 96 };
    const html = render({ state: state({ entity: "e1", field: "impact" }), draft: null, pending: false, error });
    const fullText = formulaRefusalText(error);
    expect(fullText).toBe(`${message} (position 96)`);
    expect(html).toContain('role="alert"');
    expect(html).toContain(fullText);
    expect(html).toContain(`title="${fullText}"`);
    expect(html).not.toContain(">Details</button>");
    expect(html).toMatch(/<div class="ts-formula-bar-error-details"[^>]*hidden=""[^>]*>Unexpected end of input[\s\S]*<\/div>/);
    // A long popover scrolls inside itself, and its text is reachable from the
    // keyboard, so it can never add scroll height under the grid.
    expect(html).toMatch(/<div class="ts-formula-bar-error-details"[^>]*tabindex="0"/);
    // Still inside the one reserved line, never a sibling block above the grid.
    expect(html.indexOf('class="ts-formula-bar-notes"')).toBeLessThan(html.indexOf('class="ts-formula-bar-error-details"'));
  });

  it("shows Work's refusal verbatim below the bar and keeps the draft", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const draft = { identity: bar.identity, value: "1 +" };
    const html = render({ state: bar, draft, pending: false, error: { message: "The formula could not be parsed." } });
    expect(html).toContain('value="1 +"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("The formula could not be parsed.");
  });

  it("adds Work's character position only when the refusal carries one", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const withPosition = render({ state: bar, draft: null, pending: false, error: { message: "Unexpected end of input.", position: 4 } });
    expect(withPosition).toContain("Unexpected end of input.");
    expect(withPosition).toContain("(position 4)");
    const withoutPosition = render({ state: bar, draft: null, pending: false, error: { message: "Unexpected end of input." } });
    expect(withoutPosition).not.toContain("position");
  });

  it("keeps the draft visible but read-only while another operation is in flight", () => {
    const bar = state({ entity: "e1", field: "impact" }, { locked: true });
    const html = render({ state: bar, draft: { identity: bar.identity, value: "1 + 2" }, pending: false, error: null });
    expect(html).toContain('value="1 + 2"');
    expect(html).toContain("readonly");
    expect(html).toContain(FORMULA_BAR_LOCKED);
  });

  it("disables the input while a commit is in flight", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const html = render({ state: bar, draft: { identity: bar.identity, value: "1 + 1" }, pending: true, error: null });
    expect(html).toContain("disabled");
  });

  it("falls back to the projected source after Escape discards the draft", () => {
    const bar = state({ entity: "e1", field: "impact" });
    expect(formulaBarDraftValue(bar, null)).toBe("min([task.qty], 4) + 1");
    expect(boundFormulaDraft(bar, { identity: bar.identity, value: "9" })).not.toBeNull();
  });
});

describe("formula references", () => {
  // The projection's keys are what Work resolves. An id, an entity id or a
  // display name would be refused with MissingEntityKey.
  const keyedRow: TableRow = { ...formulaRow, id: "internal-id", key: "entity-key" };
  const keyedColumn: TableColumn = { ...impact, id: "impact-id", key: "impact-key" };

  it("builds the token from the projection's keys, never an id", () => {
    const token = formulaReferenceToken(keyedRow, keyedColumn, "another-row");
    expect(token).toBe("[entity-key.impact-key]");
    for (const forbidden of ["internal-id", "e1", "impact-id", "Impact"]) expect(token).not.toContain(forbidden);
  });

  it("has no token without a projected key form", () => {
    expect(formulaReferenceToken(null, keyedColumn, null)).toBeNull();
    expect(formulaReferenceToken({ key: "  " }, keyedColumn, null)).toBeNull();
    expect(formulaReferenceToken(keyedRow, { key: "" }, keyedRow.key)).toBeNull();
    // The new-row draft is not a projected instance.
    expect(formulaReferenceInsertion({ barHasCaret: true, draft: true, row: keyedRow, column: keyedColumn, formulaRowKey: null, hasProjectedField: true })).toBeNull();
  });

  it("inserts nothing for a stub cell the projection never gave a field", () => {
    // The grid draws a cell for every column. A row can project no field for
    // one of them: the stub has both keys, yet no address Work can resolve.
    const stubRow: TableRow = { ...formulaRow, fields: formulaRow.fields.filter((item) => item.target.field !== impact.id) };
    expect(fieldForColumn(stubRow, impact.id)).toBeNull();
    expect(formulaReferenceToken(stubRow, impact, "another-row")).toBe("[row-1.impact]");
    expect(formulaReferenceInsertion({
      barHasCaret: true, draft: false, row: stubRow, column: impact, formulaRowKey: "another-row",
      hasProjectedField: fieldForColumn(stubRow, impact.id) !== null,
    })).toBeNull();
  });

  it("inserts at the caret, replacing the selection", () => {
    expect(insertFormulaReference("1 + 2", "[r.c]", { start: 4, end: 5 })).toEqual({ value: "1 + [r.c]", caret: 9 });
    expect(insertFormulaReference("sum()", "[r.c]", { start: 4, end: 4 })).toEqual({ value: "sum([r.c])", caret: 9 });
    expect(insertFormulaReference("sum()", "[r.c]", null)).toEqual({ value: "sum()[r.c]", caret: 10 });
    expect(insertFormulaReference("", "[r.c]", { start: 9, end: 9 })).toEqual({ value: "[r.c]", caret: 5 });
  });

  it("uses the same-row shorthand and retains full references for other rows", () => {
    expect(formulaReferenceToken(keyedRow, keyedColumn, keyedRow.key)).toBe("[.impact-key]");
    expect(formulaReferenceToken(keyedRow, keyedColumn, "other-entity")).toBe("[entity-key.impact-key]");
    expect(formulaReferenceInsertion({
      barHasCaret: true, draft: false, row: keyedRow, column: keyedColumn,
      formulaRowKey: keyedRow.key, hasProjectedField: true,
    })).toBe("[.impact-key]");
  });

  it("only edits the draft on a click, never the projected formula", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const token = formulaReferenceInsertion({ barHasCaret: true, draft: false, row: keyedRow, column: keyedColumn, formulaRowKey: "other-entity", hasProjectedField: true });
    expect(token).toBe("[entity-key.impact-key]");
    const inserted = insertFormulaReference(bar.source, token!, { start: bar.source.length, end: bar.source.length });
    // A click changes what the bar would submit; it commits nothing on its own.
    expect(formulaBarDraftValue(bar, { identity: bar.identity, value: inserted.value }))
      .toBe(`${bar.source}[entity-key.impact-key]`);
    expect(bar.source).toBe("min([task.qty], 4) + 1");
  });

  it("inserts nothing unless the bar owns the caret", () => {
    expect(formulaReferenceInsertion({ barHasCaret: false, draft: false, row: keyedRow, column: keyedColumn, formulaRowKey: null, hasProjectedField: true })).toBeNull();
  });

  it("detects refusal truncation from the rendered element dimensions", () => {
    expect(formulaRefusalIsTruncated({ clientWidth: 100, scrollWidth: 101 })).toBe(true);
    expect(formulaRefusalIsTruncated({ clientWidth: 100, scrollWidth: 100 })).toBe(false);
  });

  it("leaves a press inside the cell's own editor to that editor", () => {
    // The scalar editor's <input> sits inside the cell. Its pointer-down must
    // place the caret natively instead of inserting a reference.
    const editorInput = { closest: (selector: string) => selector.split(", ").includes("input") ? {} : null };
    expect(cellEditorOwnsPointer(editorInput)).toBe(true);
    // So does the allowed-values list under that editor.
    const choice = { closest: (selector: string) => selector.split(", ").includes('[role="listbox"]') ? {} : null };
    expect(cellEditorOwnsPointer(choice)).toBe(true);
    expect(cellEditorOwnsPointer({ closest: () => null })).toBe(false);
    expect(cellEditorOwnsPointer(null)).toBe(false);
  });
});

describe("formulaBarKeyAction", () => {
  const key = (overrides: Partial<{ key: string; repeat: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) =>
    ({ key: "Enter", repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...overrides });

  it("applies on Enter and stays on the cell", () => {
    expect(formulaBarKeyAction(key({}), true)).toEqual({ kind: "submit", then: "stay" });
  });

  it("applies a changed formula on Tab, then moves to the next or previous cell", () => {
    expect(formulaBarKeyAction(key({ key: "Tab" }), true)).toEqual({ kind: "submit", then: "next" });
    expect(formulaBarKeyAction(key({ key: "Tab", shiftKey: true }), true)).toEqual({ kind: "submit", then: "previous" });
  });

  it("leaves the bar cleanly on Tab when there is nothing to apply", () => {
    // Focus returns to the cell, so the browser's own Tab destination can
    // never bounce it back into the bar.
    expect(formulaBarKeyAction(key({ key: "Tab" }), false)).toEqual({ kind: "cancel" });
  });

  it("cancels on Escape and ignores modified or repeated keys", () => {
    expect(formulaBarKeyAction(key({ key: "Escape" }), true)).toEqual({ kind: "cancel" });
    expect(formulaBarKeyAction(key({ ctrlKey: true }), true)).toBeNull();
    expect(formulaBarKeyAction(key({ repeat: true }), true)).toBeNull();
    expect(formulaBarKeyAction(key({ shiftKey: true }), true)).toBeNull();
  });

  it("keeps the row-draft hint and the hidden-row note exact", () => {
    expect(FORMULA_BAR_DRAFT_ROW_HINT).toBe("Add or discard the new row first. Press Esc to cancel this formula.");
    expect(FORMULA_BAR_HIDDEN_ROW).toBe("This row is hidden by the current filter or sort. Its formula can still be edited.");
  });
});

describe("positionedAfterFormulaSubmit", () => {
  // The grid's displayed order: every displayed row's columns, then the
  // new-row draft last.
  const order = [
    { entity: "e1", field: "task" }, { entity: "e1", field: "impact" },
    { entity: "e2", field: "task" }, { entity: "e2", field: "impact" },
    { entity: "draft", field: "task" }, { entity: "draft", field: "impact" },
  ];
  const at = (position: { entity: string; field: string }, then: "stay" | "next" | "previous", rows = order) =>
    positionedAfterFormulaSubmit({ position, then, order: rows, draftEntity: "draft" });

  it("stays on the same cell after Enter", () => {
    expect(at({ entity: "e1", field: "impact" }, "stay")).toEqual({ entity: "e1", field: "impact" });
    // Even a hidden bound row keeps the bar's cell; focus simply stays put.
    expect(at({ entity: "gone", field: "impact" }, "stay")).toEqual({ entity: "gone", field: "impact" });
  });

  it("walks the displayed order without wrap-around and never into the draft row", () => {
    expect(at({ entity: "e1", field: "task" }, "next")).toEqual({ entity: "e1", field: "impact" });
    expect(at({ entity: "e2", field: "impact" }, "previous")).toEqual({ entity: "e2", field: "task" });
    // The entry row is last in the order but is never a submit destination.
    expect(at({ entity: "e2", field: "impact" }, "next")).toEqual({ entity: "e2", field: "impact" });
  });

  it("finds a displayed cell when a filter hides the bound row", () => {
    // The focused row is projected but not displayed, so its position is not
    // in the order: Tab goes to the first displayed cell, Shift+Tab to the
    // last, and either way not to a cell that is not mounted.
    expect(at({ entity: "gone", field: "impact" }, "next")).toEqual({ entity: "e1", field: "task" });
    expect(at({ entity: "gone", field: "impact" }, "previous")).toEqual({ entity: "e2", field: "impact" });
  });

  it("keeps focus in the bar when the grid displays no cell", () => {
    expect(at({ entity: "gone", field: "impact" }, "next", [])).toBeNull();
    // Only the draft row is left; it is still not a destination.
    expect(at({ entity: "gone", field: "impact" }, "next", order.slice(4))).toBeNull();
    expect(at({ entity: "gone", field: "impact" }, "previous", order.slice(4))).toBeNull();
  });
});

describe("formulaSubmitHandoffOutcome", () => {
  // Submit happened on e1.impact while the grid showed revision r1.
  const handoff = (over: { then?: "stay" | "next" | "previous"; position?: { entity: string; field: string } } = {}) => ({
    position: over.position ?? { entity: "e1", field: "impact" },
    then: over.then ?? ("next" as const),
    viewKey: "occ-1\u0000r1",
    generation: 3,
    occurrence: "occ-1",
  });
  const order = [
    { entity: "e1", field: "task" }, { entity: "e1", field: "impact" },
    { entity: "e2", field: "task" }, { entity: "e2", field: "impact" },
  ];
  const decide = (input: {
    handoff?: ReturnType<typeof handoff>;
    generation?: number;
    occurrence?: string;
    viewKey?: string;
    order?: typeof order;
    modalOpen?: boolean;
    focusOnBar?: boolean;
  } = {}) => formulaSubmitHandoffOutcome({
    handoff: handoff(),
    generation: 3,
    occurrence: "occ-1",
    viewKey: "occ-1\u0000r2",
    order,
    draftEntity: "draft",
    modalOpen: false,
    focusOnBar: true,
    ...input,
  });

  it("waits until the commit's own projection has rendered", () => {
    // The pre-commit order is not a destination: a filter or sort change can
    // make its neighbour hidden or wrong.
    expect(decide({ viewKey: "occ-1\u0000r1" })).toEqual({ kind: "wait" });
  });

  it("resolves the neighbour from the rendered order, not the pre-commit one", () => {
    // The commit's new filter hid e1: Tab goes to the first displayed cell and
    // Shift+Tab to the last, never to e1's old neighbour.
    const filtered = [{ entity: "e2", field: "task" }, { entity: "e2", field: "impact" }];
    expect(decide({ order: filtered })).toEqual({ kind: "move", destination: { entity: "e2", field: "task" } });
    expect(decide({ order: filtered, handoff: handoff({ then: "previous" }) }))
      .toEqual({ kind: "move", destination: { entity: "e2", field: "impact" } });
  });

  it("walks the rendered order and never lands on the entry row", () => {
    expect(decide()).toEqual({ kind: "move", destination: { entity: "e2", field: "task" } });
    const withDraft = [...order, { entity: "draft", field: "task" }];
    expect(decide({ order: withDraft, handoff: handoff({ position: { entity: "e2", field: "impact" } }) }))
      .toEqual({ kind: "move", destination: { entity: "e2", field: "impact" } });
  });

  it("keeps the bar's own cell after Enter once the projection rendered", () => {
    expect(decide({ handoff: handoff({ then: "stay" }) }))
      .toEqual({ kind: "move", destination: { entity: "e1", field: "impact" } });
  });

  it("stops when a newer focus action happened during the commit", () => {
    expect(decide({ generation: 4 })).toEqual({ kind: "stop" });
  });

  it("stops while a modal owns focus", () => {
    expect(decide({ modalOpen: true })).toEqual({ kind: "stop" });
  });

  it("stops when focus is no longer the commit's", () => {
    expect(decide({ focusOnBar: false })).toEqual({ kind: "stop" });
  });

  it("stops when the workbook's projection is gone", () => {
    expect(decide({ viewKey: "" })).toEqual({ kind: "stop" });
  });

  it("stops when the open work was replaced during the commit", () => {
    expect(decide({ occurrence: "occ-2", viewKey: "occ-2\u0000r1" })).toEqual({ kind: "stop" });
  });
});

describe("formulaHandoffSettlement", () => {
  const fields = ["task", "impact"];
  const orderOf = (entities: readonly string[]): FormulaGridPosition[] =>
    entities.flatMap((entity) => fields.map((field) => ({ entity, field })));
  const grid = (input: { entities: readonly string[]; viewKey?: string; windowed?: boolean }): FormulaHandoffGrid => ({
    viewKey: input.viewKey ?? "occ-1\u0000r2",
    order: orderOf(input.entities),
    rowIndexByEntity: new Map(input.entities.map((entity, index) => [entity, index])),
    windowed: input.windowed ?? true,
  });
  // The submit happened on e150.task while a filter hid that row, so the
  // pre-submit grid displayed only rows 0-79 and its row map had no e150.
  const handoff: FormulaSubmitHandoff = {
    position: { entity: "e150", field: "task" },
    then: "next",
    viewKey: "occ-1\u0000r1",
    generation: 3,
    occurrence: "occ-1",
  };
  const settle = (rendered: FormulaHandoffGrid) => formulaHandoffSettlement({
    handoff, generation: 3, occurrence: "occ-1", draftEntity: "draft", modalOpen: false, focusOnBar: true, rendered,
  });

  it("waits while the pre-submit window is still the rendered one", () => {
    const preSubmit = grid({ entities: Array.from({ length: 80 }, (_, index) => `e${index + 1}`), viewKey: "occ-1\u0000r1" });
    expect(preSubmit.rowIndexByEntity.has("e150")).toBe(false);
    expect(settle(preSubmit)).toEqual({ kind: "wait" });
  });

  it("reveals a destination row the pre-submit window never displayed", () => {
    // The commit's filter change reveals 300 rows. The neighbour is e150 at
    // rendered row 149 — far outside the window captured before the commit,
    // and a row the pre-submit row map could not name at all. The reveal index
    // must therefore come from the same rendered grid that named it.
    const rendered = grid({ entities: ["e1", ...Array.from({ length: 299 }, (_, index) => `e${index + 2}`)] });
    expect(rendered.rowIndexByEntity.get("e150")).toBe(149);
    expect(settle(rendered)).toEqual({
      kind: "move",
      destination: { entity: "e150", field: "impact" },
      rowIndex: 149,
    });
  });

  it("asks for no reveal when the grid mounts every row", () => {
    expect(settle(grid({ entities: ["e150", "e151"], windowed: false }))).toEqual({
      kind: "move",
      destination: { entity: "e150", field: "impact" },
      rowIndex: null,
    });
  });

  it("stops when the rendered grid displays no cell", () => {
    expect(settle(grid({ entities: [] }))).toEqual({ kind: "stop" });
  });
});

describe("formula bar with a hidden bound row", () => {
  it("stays editable on the same instance and names the row", () => {
    // The focused row is filtered out of the displayed order but is still in
    // the projection: the draft belongs to it and must remain editable.
    const bar = state({ entity: "e1", field: "impact" }, { displayRows: [plainRow] });
    expect(bar.editable).toBe(true);
    expect(bar.reason).toBeNull();
    expect(bar.note).toBe(FORMULA_BAR_HIDDEN_ROW);
    expect(bar.label).toBe("Impact · Reserve");
    expect(bar.source).toBe("min([task.qty], 4) + 1");
    expect(bar.target).toEqual({ entity: "e1", field: "impact" });
  });

  it("still refuses a row that is no longer in the projection at all", () => {
    const bar = state({ entity: "gone", field: "impact" }, { displayRows: [plainRow] });
    expect(bar.editable).toBe(false);
    expect(bar.reason).toBe(FORMULA_BAR_NO_CELL);
    expect(bar.note).toBeNull();
  });

  it("renders the hidden-row note without turning the input read-only", () => {
    const bar = state({ entity: "e1", field: "impact" }, { displayRows: [plainRow] });
    const html = render({ state: bar, draft: { identity: bar.identity, value: "1 + 2" }, pending: false, error: null });
    expect(html).toContain('value="1 + 2"');
    expect(html).not.toContain("readonly");
    expect(html).toContain(FORMULA_BAR_HIDDEN_ROW);
    expect(html).not.toContain(FORMULA_BAR_NO_CELL);
  });
});

describe("inCellFormulaSource", () => {
  it("reads a leading = as a formula and keeps other entries as values", () => {
    expect(inCellFormulaSource("=[.amount]*0.1")).toBe("[.amount]*0.1");
    expect(inCellFormulaSource("  = [.amount] * 2 ")).toBe("[.amount] * 2");
    expect(inCellFormulaSource("=")).toBeNull();
    expect(inCellFormulaSource("12")).toBeNull();
    expect(inCellFormulaSource("1=1")).toBeNull();
  });
});

describe("formulaBarSource", () => {
  it("drops one leading = like the in-cell entry and maps positions back", () => {
    expect(formulaBarSource("[.hours]*[.rate]")).toEqual({ source: "[.hours]*[.rate]", offset: 0 });
    expect(formulaBarSource("=[.hours]*[.rate]")).toEqual({ source: "[.hours]*[.rate]", offset: 1 });
    expect(formulaBarSource("  =  1 + 2 ")).toEqual({ source: "1 + 2", offset: 5 });
    expect(formulaBarSource("1 = 2")).toEqual({ source: "1 = 2", offset: 0 });
  });
});

describe("formulaColumnNameHint", () => {
  const columns = [{ key: "hours", display_name: "Hours" }, { key: "unit_price", display_name: "Unit price" }, { key: "unit", display_name: "Unit" }];

  it("names the column at Work's refusal position, preferring the longest name", () => {
    expect(formulaColumnNameHint("Hours*Rate", 1, columns)).toBe("“Hours” is a column. Click one of its cells to insert a reference, or write [.hours].");
    expect(formulaColumnNameHint("[.hours] * Unit price", 12, columns)).toBe("“Unit price” is a column. Click one of its cells to insert a reference, or write [.unit_price].");
    expect(formulaColumnNameHint("unit_price*2", 1, columns)).toContain("[.unit_price]");
  });

  it("stays silent without a position, outside the source, or on a longer word", () => {
    expect(formulaColumnNameHint("Hours*Rate", undefined, columns)).toBeNull();
    expect(formulaColumnNameHint("Hours*Rate", 20, columns)).toBeNull();
    expect(formulaColumnNameHint("Hoursly", 1, columns)).toBeNull();
    expect(formulaColumnNameHint("Rate*2", 1, columns)).toBeNull();
  });
});

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
  formulaBarDraftValue,
  formulaBarKeyAction,
  formulaBarState,
  formulaReferenceInsertion,
  formulaReferenceToken,
  insertFormulaReference,
  isFormulaCell,
} from "./formula-bar.js";
import type { TableColumn, TableRow } from "./projection-access.js";

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
    const token = formulaReferenceToken(keyedRow, keyedColumn);
    expect(token).toBe("[entity-key.impact-key]");
    for (const forbidden of ["internal-id", "e1", "impact-id", "Impact"]) expect(token).not.toContain(forbidden);
  });

  it("has no token without a projected key form", () => {
    expect(formulaReferenceToken(null, keyedColumn)).toBeNull();
    expect(formulaReferenceToken({ key: "  " }, keyedColumn)).toBeNull();
    expect(formulaReferenceToken(keyedRow, { key: "" })).toBeNull();
    // The new-row draft is not a projected instance.
    expect(formulaReferenceInsertion({ barHasCaret: true, draft: true, row: keyedRow, column: keyedColumn })).toBeNull();
  });

  it("inserts at the caret, replacing the selection", () => {
    expect(insertFormulaReference("1 + 2", "[r.c]", { start: 4, end: 5 })).toEqual({ value: "1 + [r.c]", caret: 9 });
    expect(insertFormulaReference("sum()", "[r.c]", { start: 4, end: 4 })).toEqual({ value: "sum([r.c])", caret: 9 });
    expect(insertFormulaReference("sum()", "[r.c]", null)).toEqual({ value: "sum()[r.c]", caret: 10 });
    expect(insertFormulaReference("", "[r.c]", { start: 9, end: 9 })).toEqual({ value: "[r.c]", caret: 5 });
  });

  it("only edits the draft on a click, never the projected formula", () => {
    const bar = state({ entity: "e1", field: "impact" });
    const token = formulaReferenceInsertion({ barHasCaret: true, draft: false, row: keyedRow, column: keyedColumn });
    expect(token).toBe("[entity-key.impact-key]");
    const inserted = insertFormulaReference(bar.source, token!, { start: bar.source.length, end: bar.source.length });
    // A click changes what the bar would submit; it commits nothing on its own.
    expect(formulaBarDraftValue(bar, { identity: bar.identity, value: inserted.value }))
      .toBe(`${bar.source}[entity-key.impact-key]`);
    expect(bar.source).toBe("min([task.qty], 4) + 1");
  });

  it("inserts nothing unless the bar owns the caret", () => {
    expect(formulaReferenceInsertion({ barHasCaret: false, draft: false, row: keyedRow, column: keyedColumn })).toBeNull();
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

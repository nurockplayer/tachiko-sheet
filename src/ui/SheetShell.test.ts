// @vitest-environment happy-dom
import { act, createElement } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { AppearancePreferenceController, AppearancePreferenceSnapshot } from "../application/appearance-preference.js";
import type { KeyedGroupedSumResult, SheetShellProps, WorkbookView } from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "./interface-profile/profile.js";
import {
  cellEditorListAttributes,
  cellEditorFormulaSource,
  formulaOptionsUi,
  formulaOptionIndex,
  formulaTabKeepsField,
  scrollCellIntoGridNearest,
  focusRevealNextScrollTop,
  focusRevealScrollDelta,
  focusRevealStillCurrent,
  missingKeyedGroupedSumDefinitionIds,
  salesEntryFocusTarget,
  salesCatalogLayoutEligible,
  describeSavedCopyNameWhitespace,
  reportRenderResetKey,
  rowViewStatusText,
  shouldPublishAppearanceCompositionEnd,
  SheetShell,
} from "./SheetShell.js";
import { cellDisplay, fieldClipboardText, fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
import { encodeTsv } from "./clipboard.js";
import { functionSuggestions } from "./formula-hints.js";
import { DRAFT_ROW } from "./row-entry-model.js";
import { FORMULA_BAR_NO_CELL } from "./formula-bar.js";
import { notesFieldFor, rowEntity, tableColumns } from "./projection-access.js";

const pasteRender = vi.hoisted(() => ({ capture: false, nodes: [] as React.ReactElement<Record<string, any>>[], occurrenceEffects: [] as React.EffectCallback[] }));
vi.mock("react/jsx-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (factory: typeof actual.jsx) => (...args: Parameters<typeof actual.jsx>) => {
    const node = factory(...args);
    if (pasteRender.capture) pasteRender.nodes.push(node as React.ReactElement<Record<string, any>>);
    return node;
  };
  return { ...actual, jsx: capture(actual.jsx), jsxs: capture(actual.jsxs) };
});
vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    const node = actual.jsxDEV(...args);
    if (pasteRender.capture) pasteRender.nodes.push(node as React.ReactElement<Record<string, any>>);
    return node;
  } };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: vi.fn(actual.useState), useLayoutEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
    if (pasteRender.capture && deps?.length === 1 && deps[0] === "occ-1") pasteRender.occurrenceEffects.push(effect);
    return actual.useLayoutEffect(effect, deps);
  } };
});

const entityA = "entity-a";
const entityB = "entity-b";

const appearanceSnapshot: AppearancePreferenceSnapshot = {
  selection: { kind: "built-in", profileId: "tachiko", density: "compact" },
  pendingSelection: null,
  notice: null,
  notSaved: false,
  composing: false,
};

const appearancePreference: AppearancePreferenceController = {
  getSnapshot: () => appearanceSnapshot,
  selectBuiltIn: () => appearanceSnapshot,
  selectDensity: () => appearanceSnapshot,
  selectImported: () => appearanceSnapshot,
  beginComposition: () => undefined,
  endComposition: () => appearanceSnapshot,
};

function projected(
  entity: string,
  field: string,
  stored: FieldProjection["stored"],
  overrides: Partial<FieldProjection> = {},
): FieldProjection {
  return {
    target: { entity, field },
    address: `tables/release_items/${entity}/${field}`,
    stored,
    formula: null,
    calculated: null,
    diagnostics: [],
    editable_scalar: stored && stored.kind !== "reference" ? stored.kind : null,
    ...overrides,
  };
}

function makeView(options: { columns?: boolean; titleValue?: string; titleDiagnostic?: boolean } = {}): WorkbookView {
  const columns = [
    { id: "c-title", key: "title", display_name: "title", field_type: "text", required: true },
    { id: "c-impact", key: "impact", display_name: "impact", field_type: "number", required: true },
    { id: "c-priority", key: "priority", display_name: "priority", field_type: "number", required: true },
    { id: "c-notes", key: "notes", display_name: "notes", field_type: "text", required: true },
  ];
  const rows = [
    {
      id: entityA,
      key: "playtest_notes",
      fields: [
        projected(entityA, "c-title", { kind: "text", value: options.titleValue ?? "Alpha work" }, options.titleDiagnostic ? {
          diagnostics: [{ code: "stale", message: "revision too old", path: "c-title" }],
        } : {}),
        projected(entityA, "c-impact", { kind: "number", value: 5 }),
        projected(entityA, "c-priority", { kind: "number", value: 10 }, {
          formula: { source: "impact + friction" },
          calculated: { status: "value", value: 10 },
          editable_scalar: null,
        }),
        projected(entityA, "c-notes", { kind: "text", value: "first note" }),
      ],
    },
    {
      id: entityB,
      key: "beta",
      fields: [
        projected(entityB, "c-title", { kind: "text", value: "Beta work" }),
        projected(entityB, "c-impact", { kind: "number", value: 3 }),
        projected(entityB, "c-priority", null, {
          calculated: { status: "unavailable" },
          editable_scalar: null,
        }),
        projected(entityB, "c-notes", { kind: "text", value: "second note" }),
      ],
    },
  ];
  return {
    title: "Plan",
    occurrence: "occ-1",
    revision: "rev-1",
    collections: [{ id: "col-1", key: "release_items", display_name: "release_items", headerless: false, data_start_row: 2, entity_count: rows.length }],
    table: {
      cell_styling: { status: "supported" },
      revision: "rev-1",
      collection: { id: "col-1", key: "release_items", display_name: "release_items", headerless: false, data_start_row: 2, entity_count: rows.length },
      columns: options.columns === false ? [] : columns,
      rows,
    },
  };
}

function summaryResult(definitionId: string, value: number): KeyedGroupedSumResult {
  return {
    definitionId,
    revision: "rev-1",
    groups: [{ category: "PEN", value }],
    diagnostics: [],
  };
}

function makeProps(overrides: Partial<SheetShellProps> = {}): SheetShellProps {
  return {
    appearancePreference,
    requestByteLimit: 65_536,
    view: null,
    busy: false,
    dirty: false,
    currentness: "current",
    outcome: "idle",
    saveStatus: "not-saved",
    message: null,
    copies: [],
    onOpenFiles: async () => {},
    onOpenExample: async () => {},
    onOpenSaved: async () => {},
    onCommit: async () => ({ accepted: true }),
    localHistory: { occurrence: null, revision: null, undo: [], redo: [] },
    onRecordViewHistory: () => true,
    onHistory: async () => null,
    onCreateCopy: async () => ({ saved: true }),
    onClose: async () => {},
    onRefresh: async () => {},
    onDraftChange: () => {},
    onReportDraftChange: () => {},
    ...overrides,
  };
}

function render(props: Partial<SheetShellProps>): string {
  return renderToStaticMarkup(createElement(SheetShell, makeProps(props)));
}

describe("headerless worksheets use the existing grid", () => {
  let dispose: (() => Promise<void>) | undefined;
  afterEach(async () => { await dispose?.(); dispose = undefined; });

  async function mount(initial?: WorkbookView, overrides: Partial<SheetShellProps> = {}) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let view = initial ?? makeView();
    view = { ...view, table: { ...view.table, collection: { ...view.table.collection, headerless: true, data_start_row: 1 },
      ...(initial ? {} : { rows: [], columns: [] }) } };
    const onCommit = vi.fn<SheetShellProps["onCommit"]>(async () => ({ accepted: true }));
    const onEditCells = vi.fn<NonNullable<SheetShellProps["onEditCells"]>>(async () => ({ kind: "confirmed" }));
    const onSave = vi.fn(async () => true);
    const onCreateCopy = vi.fn(async () => ({ saved: true as const }));
    const draw = () => root.render(createElement(SheetShell, makeProps({ view, onCommit, onEditCells, onWriteCellAt: onWrite,
      onSave, onCreateCopy, boundCopyName: "Saved worksheet", importedSourceName: initial ? "headerless.csv" : null, ...overrides })));
    const onWrite = vi.fn<NonNullable<SheetShellProps["onWriteCellAt"]>>(async (_witness, _collection, row, column, input) => {
      const columns = Array.from({ length: Math.max(view.table.columns.length, column + 1) }, (_, index) =>
        view.table.columns[index] ?? { id: `c-${index}`, key: `column-${index}`, display_name: `Column ${index + 1}`, field_type: "auto", required: false });
      const rows = Array.from({ length: Math.max(view.table.rows.length, row + 1) }, (_, index) =>
        view.table.rows[index] ?? { id: `row-${index}`, key: `row-${index}`, fields: [] });
      const target = rows[row]!;
      const field = projected(target.id, columns[column]!.id, { kind: "text", value: typeof input === "string" ? input : "input" in input ? input.input : String(input.value) }, { editable_scalar: "auto" });
      rows[row] = { ...target, fields: [...target.fields.filter(field => field.target.field !== columns[column]!.id), field] };
      view = { ...view, table: { ...view.table, columns, rows } };
      draw();
      return { kind: "confirmed" };
    });
    dispose = async () => { await act(async () => root.unmount()); container.remove(); };
    await act(async () => draw());
    const cell = (address: string) => container.querySelector<HTMLElement>(`[data-address="${address}"]`)
      ?? container.querySelectorAll<HTMLTableRowElement>("tbody tr.ts-row")[Number(address.slice(1)) - 2]?.querySelectorAll<HTMLElement>("td")[address.charCodeAt(0) - 65]!;
    const key = async (value: string, options: KeyboardEventInit = {}) => act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
    });
    const focus = async (address: string) => act(async () => cell(address).focus());
    const type = async (value: string) => {
      await key(value[0]!);
      const editor = container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="cell-editor"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(editor, value);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    return { container, cell, focus, key, type, onWrite, onCommit, onEditCells, onSave, onCreateCopy, currentView: () => view };
  }

  it.each([["A1", "Hello", 0, 0], ["B4", "Apple", 3, 1]] as const)("writes unused %s through positional allocation", async (address, text, row, column) => {
    const ui = await mount();
    await ui.focus(address);
    await ui.type(text);
    await ui.key("Enter");
    expect(ui.onWrite).toHaveBeenLastCalledWith(expect.anything(), "release_items", row, column, text);
    expect(ui.onCommit).not.toHaveBeenCalled();
    expect(ui.cell(address).textContent).toBe(text);
    expect(ui.container.querySelector(".ts-table-panel .ts-grid-scroll")).not.toBeNull();
  });

  it.each([["Enter", "A2", 1, 0], ["Tab", "B1", 0, 1]] as const)("continues typing at %s's destination %s after allocation", async (key, destination, row, column) => {
    const ui = await mount();
    await ui.focus("A1");
    await ui.type("Hello");
    await ui.key(key);
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ui.onWrite).toHaveBeenNthCalledWith(1, expect.anything(), "release_items", 0, 0, "Hello");
    expect(ui.cell("A1").textContent).toBe("Hello");
    expect(document.activeElement).toBe(ui.cell(destination));
    await ui.type("World");
    await ui.key("Enter");
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ui.onWrite).toHaveBeenNthCalledWith(2, expect.anything(), "release_items", row, column, "World");
    expect(ui.cell(destination).textContent).toBe("World");
    expect(ui.onCommit).not.toHaveBeenCalled();
  });

  it("allocates beyond hidden stored rows when typing into filtered synthetic space", async () => {
    const view = makeView();
    view.table.columns = [view.table.columns[0]!];
    view.table.rows = ["Apple", "Banana", "Cherry"].map((value, index) => ({
      id: `fruit-${index}`, key: `fruit-${index}`, fields: [projected(`fruit-${index}`, "c-title", { kind: "text", value })],
    }));
    const ui = await mount(view, { importedSourceName: null });
    const filter = ui.container.querySelector<HTMLButtonElement>('[data-column-action="Filter…"]')!;
    await act(async () => filter.click());
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Filter title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Apple");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => ui.container.querySelector("form.ts-row-view-filter")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(ui.cell("A1").textContent).toBe("Apple");
    expect(ui.cell("A2").textContent).toBe("");
    await ui.focus("A2");
    await ui.type("Orange");
    await ui.key("Enter");
    expect(ui.onWrite).toHaveBeenLastCalledWith(expect.anything(), "release_items", 3, 0, { kind: "text", value: "Orange" });
    expect(ui.currentView().table.rows.map(row => row.fields[0]?.stored)).toEqual([
      { kind: "text", value: "Apple" }, { kind: "text", value: "Banana" },
      { kind: "text", value: "Cherry" }, { kind: "text", value: "Orange" },
    ]);
  });

  it("pastes over the last stored headerless CSV row and appends the rest", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns = view.table.columns.slice(0, 2);
    view.table.rows = ["Apple", "Banana", "Cherry"].map((value, index) => ({
      id: `fruit-${index}`, key: `fruit-${index}`, fields: [
        projected(`fruit-${index}`, "c-title", { kind: "text", value }),
        projected(`fruit-${index}`, "c-impact", { kind: "number", value: index + 1 }),
      ],
    }));
    const onPasteCells = vi.fn<NonNullable<SheetShellProps["onPasteCells"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount(view, { onPasteCells });
    await ui.focus("A4");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { types: ["text/plain"], getData: () => "Orange\t4\nPear\t5" } });
    await act(async () => { ui.cell("A4").dispatchEvent(event); });
    expect(onPasteCells).toHaveBeenCalledWith(expect.anything(), "release_items", "fruit-2", "c-title", [["Orange", "4"], ["Pear", "5"]]);
    expect(ui.onEditCells).not.toHaveBeenCalled();
    expect(ui.container.textContent).not.toContain("Nothing was pasted.");
  });

  it.each([false, true])("blocks number formats for unused columns (includes a stored column: %s)", async includesStoredColumn => {
    const view = makeView();
    view.table.columns = [{ ...view.table.columns[0]!, field_type: "auto" }];
    const onSetColumnNumberFormat = vi.fn<NonNullable<SheetShellProps["onSetColumnNumberFormat"]>>();
    const ui = await mount(includesStoredColumn ? view : undefined, {
      importedSourceName: null,
      onSetCellStyle: vi.fn(),
      onSetColumnNumberFormat,
    });
    await ui.focus("A1");
    await ui.key(" ", { ctrlKey: true });
    if (includesStoredColumn) {
      const neighbour = ui.container.querySelector('th[data-column-letter="B"]')!;
      await act(async () => neighbour.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
    }
    await ui.key("1", { ctrlKey: true });

    const dialog = ui.container.querySelector('[role="dialog"][aria-label="Format Cells"]')!;
    const apply = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Apply number format")!;
    expect(apply.closest("fieldset")?.disabled).toBe(true);
    expect(dialog.textContent).toContain("Number formats are unavailable while the selection includes an unused column.");
    await act(async () => apply.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSetColumnNumberFormat).not.toHaveBeenCalled();
  });

  it("refuses blank worksheet formulas and reference insertion without publishing", async () => {
    const onTranslateA1Formula = vi.fn<NonNullable<SheetShellProps["onTranslateA1Formula"]>>();
    const ui = await mount(undefined, { onTranslateA1Formula });
    await ui.focus("A1");
    await ui.type("=A2");
    await act(async () => {
      ui.cell("A2").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      ui.cell("A2").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await ui.key("Enter");
    expect(ui.onWrite).not.toHaveBeenCalled();
    expect(ui.onCommit).not.toHaveBeenCalled();
    expect(onTranslateA1Formula).not.toHaveBeenCalled();
    expect(ui.container.querySelector<HTMLInputElement>('[data-testid="cell-editor"]')?.value).toBe("=A2");
    expect(ui.container.textContent).toContain("Enter worksheet formulas directly in a cell that has a value.");
    expect(ui.container.querySelector<HTMLInputElement>('[data-testid="formula-bar-input"]')?.readOnly).toBe(true);
    expect(ui.container.querySelector(".ts-cell--formula-ref")).toBeNull();
  });

  it("pastes into the new-row draft without allocating padded worksheet rows", async () => {
    const onPasteCellsAt = vi.fn<NonNullable<SheetShellProps["onPasteCellsAt"]>>(async () => ({ kind: "confirmed" }));
    const view = makeView();
    view.table.native_table_profile = true;
    const ui = await mount(view, { onPasteCellsAt, importedSourceName: null, onInsertRow: async () => ({ kind: "confirmed", view }) });
    const draft = ui.container.querySelector<HTMLElement>(`[data-work-entity="${DRAFT_ROW}"]`)!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { types: ["text/plain"], getData: () => "New" } });
    await act(async () => { draft.dispatchEvent(event); });
    expect(onPasteCellsAt).not.toHaveBeenCalled();
    expect(ui.container.textContent).toContain("Pasted into the new row.");
  });

  it("routes a block crossing the worksheet extents as one positional publication", async () => {
    const onPasteCells = vi.fn<NonNullable<SheetShellProps["onPasteCells"]>>(async () => ({ kind: "confirmed" }));
    const onPasteCellsAt = vi.fn<NonNullable<SheetShellProps["onPasteCellsAt"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount(undefined, { onPasteCells, onPasteCellsAt });
    await ui.focus("A1");
    await ui.type("Keep");
    await ui.key("Enter");
    ui.onWrite.mockClear();
    await ui.focus("A1");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { types: ["text/plain"], getData: () => "Orange\t4\nPear\t5" } });
    await act(async () => { ui.cell("A1").dispatchEvent(event); });
    expect(onPasteCellsAt).toHaveBeenCalledExactlyOnceWith(expect.anything(), "release_items", 0, 0, [["Orange", "4"], ["Pear", "5"]]);
    expect(onPasteCells).not.toHaveBeenCalled();
    expect(ui.onWrite).not.toHaveBeenCalled();
    expect(ui.onEditCells).not.toHaveBeenCalled();
    expect(ui.cell("A1").textContent).toBe("Keep");
  });

  it.each([["typed", "headerless.csv"], ["clicked", "headerless.xlsx"]] as const)("keeps header-inclusive geometry for %s references in %s", async (mode, importedSourceName) => {
    const view = makeView();
    view.table.native_table_profile = true;
    const onTranslateA1Formula = vi.fn<NonNullable<SheetShellProps["onTranslateA1Formula"]>>(async () => ({
      kind: "translated", revision: view.revision, source: "[beta.impact]", notes: [],
    }));
    const ui = await mount(view, { onTranslateA1Formula, importedSourceName });
    expect(ui.cell("B2").closest("tr")!.querySelector("th")!.textContent).toBe("2");
    expect(ui.cell("B3").closest("tr")!.querySelector("th")!.textContent).toBe("3");
    await ui.focus("B2");
    expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Name Box"]')?.value).toBe("B2");
    await ui.type(mode === "typed" ? "=B3" : "=");
    if (mode === "clicked") {
      await act(async () => {
        const input = ui.container.querySelector<HTMLInputElement>('[data-testid="cell-editor"]')!;
        input.focus();
        input.setSelectionRange(1, 1);
        ui.cell("B3").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 }));
      });
      expect(ui.container.querySelector<HTMLInputElement>('[data-testid="cell-editor"]')?.value).toBe("=B3");
    }
    expect(ui.cell("B3").classList.contains("ts-cell--formula-ref")).toBe(true);
    expect(ui.cell("B2").classList.contains("ts-cell--formula-ref")).toBe(false);
    await ui.key("Enter");
    expect(onTranslateA1Formula).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      rowEntityId: entityA, targetFieldId: "c-impact", text: "B3",
      geometry: { headerRow: 1, rows: [entityA, entityB], columns: ["c-title", "c-impact", "c-priority", "c-notes"] },
    }));
    expect(ui.onCommit).toHaveBeenCalledWith(expect.anything(), { entity: entityA, field: "c-impact" }, { kind: "formula", source: "[beta.impact]" });
    expect(ui.onWrite).not.toHaveBeenCalled();
  });

  it("preserves imported headerless Number editing (5 → 6)", async () => {
    const ui = await mount(makeView());
    await ui.focus("B2");
    await ui.type("6");
    await ui.key("Enter");
    expect(ui.onCommit).toHaveBeenCalledWith(expect.anything(), { entity: entityA, field: "c-impact" }, { kind: "number", input: "6" });
    expect(ui.onWrite).not.toHaveBeenCalled();
  });

  it("commits a formula in an existing optional blank Number cell on import", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns[1] = { ...view.table.columns[1]!, required: false };
    view.table.rows[0] = { ...view.table.rows[0]!,
      fields: view.table.rows[0]!.fields.filter(field => field.target.field !== "c-impact"),
      blank_fields: ["c-impact"],
    };
    const ui = await mount(view);
    await ui.focus("B2");
    await ui.type("=1+2");
    await ui.key("Enter");
    expect(ui.onCommit).toHaveBeenCalledWith(expect.anything(), { entity: entityA, field: "c-impact" }, { kind: "formula", source: "1+2" });
    expect(ui.onWrite).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[data-testid="cell-editor"]')).toBeNull();
  });

  it.each([
    ["row", "Delete", null], ["row", "Cut", null],
    ["column", "Delete", null], ["column", "Cut", null],
    ["row", "Delete", "headerless.csv"], ["row", "Cut", "headerless.csv"],
    ["column", "Delete", "headerless.csv"], ["column", "Cut", "headerless.csv"],
  ] as const)("handles whole-%s %s (source %s)", async (axis, action, importedSourceName) => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns = view.table.columns.slice(0, 2).map(column => ({ ...column, required: false }));
    view.table.rows = view.table.rows.map(row => ({ ...row, fields: row.fields.slice(0, 2) }));
    const onMoveCells = vi.fn<NonNullable<SheetShellProps["onMoveCells"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount(view, { importedSourceName, onMoveCells });
    await act(async () => ui.container.querySelector<HTMLElement>(axis === "row" ? "tbody .ts-row-head" : "thead .ts-column-header")!.click());
    if (action === "Delete") {
      await ui.key("Delete");
      const targets = axis === "row" ? [{ entity: entityA, field: "c-title" }, { entity: entityA, field: "c-impact" }]
        : [{ entity: entityA, field: "c-title" }, { entity: entityB, field: "c-title" }];
      expect(ui.onEditCells).toHaveBeenCalledExactlyOnceWith(expect.anything(), targets.map(target => ({ target, input: { kind: "clear" } })));
    } else {
      const event = new Event("cut", { bubbles: true, cancelable: true });
      const setData = vi.fn();
      Object.defineProperty(event, "clipboardData", { value: { setData } });
      await act(async () => { document.activeElement!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      expect(setData).toHaveBeenCalledWith("text/plain", expect.stringContaining("Alpha work"));
      expect(ui.container.querySelectorAll(".ts-cell--copied")).toHaveLength(2);
      expect(ui.onEditCells).not.toHaveBeenCalled();
      expect(onMoveCells).not.toHaveBeenCalled();
      await ui.key("Escape");
      expect(ui.container.querySelectorAll(".ts-cell--copied")).toHaveLength(0);
    }
    expect(ui.onWrite).not.toHaveBeenCalled();
  });

  it.each([null, "headerless.csv"])("reveals the next windowed row after editing while scrolled away (source %s)", async importedSourceName => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns = view.table.columns.slice(0, 1);
    view.table.rows = Array.from({ length: 1000 }, (_, index) => ({
      id: `r-${index}`, key: `r-${index}`, fields: [projected(`r-${index}`, "c-title", { kind: "text", value: `Row ${index}` })],
    }));
    const ui = await mount(view, { importedSourceName });
    const firstAddress = importedSourceName ? "A2" : "A1";
    const nextCell = () => ui.container.querySelector<HTMLElement>('[data-work-entity="r-1"][data-work-field="c-title"]');
    await ui.focus(firstAddress);
    await ui.type("Changed");
    const grid = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
    await act(async () => {
      grid.scrollTop = 20000;
      grid.dispatchEvent(new Event("scroll"));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    expect(nextCell()).toBeNull();
    expect(ui.container.querySelector('[data-testid="cell-editor"]')).not.toBeNull();
    await ui.key("Enter");
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ui.onCommit).toHaveBeenCalledWith(expect.anything(), { entity: "r-0", field: "c-title" }, { kind: "text", value: "Changed" });
    expect(ui.container.querySelector('[data-testid="cell-editor"]')).toBeNull();
    expect(nextCell()).not.toBeNull();
    expect(document.activeElement).toBe(nextCell());
  });

  it.each(["F2", "double-click"])("keeps imported headerless formulas intact on %s", async gesture => {
    const ui = await mount(makeView());
    await ui.focus("C2");
    if (gesture === "F2") await ui.key("F2");
    else await act(async () => { ui.cell("C2").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await ui.key("Enter");
    expect(ui.container.querySelector('[data-testid="cell-editor"]')).toBeNull();
    expect(ui.onCommit).not.toHaveBeenCalled();
    expect(ui.onWrite).not.toHaveBeenCalled();
    expect(ui.container.textContent).toContain("Edit the formula in the formula bar.");
    await ui.key("F2", { shiftKey: true });
    expect(ui.container.querySelector<HTMLInputElement>('[data-testid="formula-bar-input"]')?.value).toBe("impact + friction");
  });

  it.each(["Enter", "Tab"])("unchanged %s navigates without a write or error", async key => {
    const ui = await mount(makeView());
    await ui.focus("B2");
    await ui.key("F2");
    await ui.key(key);
    expect(ui.onCommit).not.toHaveBeenCalled();
    expect(ui.onWrite).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[data-testid="cell-editor"]')).toBeNull();
    expect(ui.container.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(ui.cell(key === "Enter" ? "B3" : "C2"));
  });

  it("blocks Save and Save a copy and retains the draft across panel tabs", async () => {
    const ui = await mount();
    await ui.focus("B4");
    await ui.type("Apple draft");
    await ui.key("s", { ctrlKey: true });
    const copy = Array.from(ui.container.querySelectorAll("button")).find(button => button.textContent === "Save a copy")!;
    await act(async () => copy.click());
    expect(ui.onSave).not.toHaveBeenCalled();
    expect(ui.onCreateCopy).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    for (const tab of ["brief", "report", "summary", "interop", "table"]) {
      await act(async () => ui.container.querySelector<HTMLButtonElement>(`#ts-tab-${tab}`)!.click());
    }
    expect(ui.container.querySelector<HTMLInputElement>('[data-testid="cell-editor"]')?.value).toBe("Apple draft");
    expect(ui.onWrite).not.toHaveBeenCalled();
  });

  it("restores clipboard, Find, Delete/Backspace and persisted styles on a headerless import", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.rows[0]!.styles = [{ bold: true, italic: true, fill: "ffcc00", border: true, number_format: null, wrap: false, alignment: null }];
    const onMoveCells = vi.fn<NonNullable<SheetShellProps["onMoveCells"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount(view, { importedSourceName: "headerless.xlsx", onMoveCells });
    await ui.focus("A2");
    expect(ui.cell("A2").style.fontWeight).toBe("700");
    expect(ui.cell("A2").style.fontStyle).toBe("italic");
    expect(ui.cell("A2").style.backgroundColor).toBe("#ffcc00");
    let clipboardText = "";
    const clipboardData = { types: ["text/plain"], setData: vi.fn((_type: string, text: string) => { clipboardText = text; }), getData: () => clipboardText };
    async function dispatchClipboard(name: string, address: string) {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      await act(async () => { ui.cell(address).dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    await dispatchClipboard("copy", "A2");
    await dispatchClipboard("cut", "A2");
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "Alpha work");
    expect(ui.onEditCells).not.toHaveBeenCalled();
    await ui.focus("A3");
    await dispatchClipboard("paste", "A3");
    expect(onMoveCells).toHaveBeenCalledExactlyOnceWith(expect.anything(), [{
      from: { entity: entityA, field: "c-title" }, to: { entity: entityB, field: "c-title" },
    }]);
    clipboardText = "Pasted";
    await ui.focus("A2");
    await dispatchClipboard("paste", "A2");
    expect(ui.onEditCells).toHaveBeenCalledWith(expect.anything(), [{ target: { entity: entityA, field: "c-title" }, input: { kind: "text", value: "Pasted" } }]);
    for (const key of ["Delete", "Backspace"]) { await ui.focus("A2"); await ui.key(key); }
    expect(ui.onEditCells).toHaveBeenCalledTimes(3);
    await ui.key("f", { ctrlKey: true });
    expect(ui.container.querySelector('[role="search"]')).not.toBeNull();
  });

  it("windows large imported headerless worksheets", async () => {
    const view = makeView();
    view.table.rows = Array.from({ length: 1000 }, (_, index) => ({ id: `r-${index}`, key: `r-${index}`, fields: [projected(`r-${index}`, "c-title", { kind: "text", value: `Row ${index}` })] }));
    const ui = await mount(view);
    expect(ui.container.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("1001");
    expect(ui.container.querySelectorAll("tbody tr.ts-row").length).toBeLessThan(100);
    expect(ui.container.querySelector(".ts-grid-spacer")).not.toBeNull();
  });
});

describe("keyboard history queue", () => {
  let dispose: (() => Promise<void>) | undefined;
  afterEach(async () => { await dispose?.(); dispose = undefined; });

  async function mount(overrides: Partial<SheetShellProps> = {}) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const view = makeView();
    view.table.native_table_profile = true;
    let props = makeProps({ view, localHistory: { occurrence: view.occurrence, revision: view.revision, undo: ["work", "work", "work"], redo: [] }, ...overrides });
    const update = async (next: Partial<SheetShellProps> = {}) => {
      props = { ...props, ...next };
      await act(async () => root.render(createElement(SheetShell, props)));
    };
    dispose = async () => { await act(async () => root.unmount()); container.remove(); };
    await update();
    const cell = () => container.querySelector<HTMLElement>(`[data-testid="cell:${entityA}:c-title"]`)!;
    await act(async () => cell().focus());
    const key = async (value = "z", target: HTMLElement = document.activeElement as HTMLElement) => {
      const event = new KeyboardEvent("keydown", { key: value, ctrlKey: true, bubbles: true, cancelable: true });
      await act(async () => { target.dispatchEvent(event); });
      return event;
    };
    return { container, update, key, cell, view };
  }

  it.each([100, 200])("reveals a partially clipped drag endpoint at %s%% zoom", async zoom => {
    try {
      const ui = await mount();
      const grid = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      if (zoom === 200) await act(async () => {
        for (let i = 0; i < 10; i++) ui.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in grid"]')!.click();
      });
      expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Grid zoom percentage"]')!.value).toBe(String(zoom));
      const scale = zoom / 100;
      Object.defineProperties(grid, { clientWidth: { value: 200 * scale, configurable: true }, clientHeight: { value: 80 * scale, configurable: true } });
      vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200 * scale, 80 * scale));
      vi.spyOn(grid.querySelector<HTMLElement>("thead")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200 * scale, 20 * scale));
      grid.querySelectorAll<HTMLTableRowElement>("tbody tr.ts-row").forEach((row, r) => {
        vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, (20 + r * 40) * scale - grid.scrollTop, 350 * scale, 40 * scale));
        row.querySelectorAll<HTMLElement>("td[data-work-field]").forEach((cell, c) => {
          vi.spyOn(cell, "getBoundingClientRect").mockImplementation(() => new DOMRect((30 + c * 80) * scale - grid.scrollLeft, (20 + r * 40) * scale - grid.scrollTop, 80 * scale, 40 * scale));
        });
      });
      await act(async () => {
        ui.cell().dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, clientX: 60 * scale, clientY: 40 * scale, bubbles: true }));
        window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 195 * scale, clientY: 75 * scale }));
      });
      expect(grid.scrollTop).toBeGreaterThan(0);
      expect(grid.scrollLeft).toBeGreaterThan(0);
      expect(ui.container.querySelector('[data-testid="cell:entity-b:c-priority"]')!.getAttribute("aria-selected")).toBe("true");
      await act(async () => window.dispatchEvent(new MouseEvent("mouseup")));
    } finally { vi.restoreAllMocks(); }
  });

  it("uses the current zoom when ResizeObserver updates a windowed grid", async () => {
    const observers = new Map<ResizeObserver, { callback: ResizeObserverCallback; elements: Set<Element> }>();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observers.set(this as unknown as ResizeObserver, { callback, elements: new Set() }); }
      observe(element: Element) { observers.get(this as unknown as ResizeObserver)!.elements.add(element); }
      disconnect() { observers.delete(this as unknown as ResizeObserver); }
    });
    const flush = async () => {
      while (frames.length) {
        const batch = frames.splice(0);
        await act(async () => batch.forEach(callback => callback(0)));
      }
    };
    try {
      const view = makeView();
      view.table.rows = Array.from({ length: 300 }, (_, i) => {
        const entity = i === 0 ? entityA : `row-${i}`;
        return { id: entity, key: entity, fields: [projected(entity, "c-title", { kind: "text", value: `Row ${i}` })] };
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.matches("tr.ts-row") ? 28 : this.matches("thead") ? 31 : 0; });
      const ui = await mount({ view });
      await flush();
      const grid = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      Object.defineProperty(grid, "clientHeight", { value: 400, configurable: true });
      grid.scrollTop = 2800;
      await act(async () => {
        for (let i = 0; i < 10; i++) ui.container.querySelector<HTMLButtonElement>('[aria-label="Zoom in grid"]')!.click();
      });
      await flush();
      expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Grid zoom percentage"]')!.value).toBe("200");
      expect(ui.container.querySelector('tr[aria-rowindex="52"]')).not.toBeNull();
      Object.defineProperty(grid, "clientHeight", { value: 600, configurable: true });
      await act(async () => {
        for (const [observer, entry] of observers) if (entry.elements.has(grid)) entry.callback([], observer);
      });
      await flush();
      expect(ui.container.querySelector('tr[aria-rowindex="52"]')).not.toBeNull();
      expect(ui.container.querySelector('tr[aria-rowindex="60"]')).not.toBeNull();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it("shows the focused cell fill and applies the colour already shown", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.rows[0]!.styles = [{ bold: false, italic: false, fill: "FFFF00", border: false, number_format: null, wrap: false, alignment: null }];
    const onSetCellStyle = vi.fn(async () => ({ kind: "confirmed" as const }));
    const ui = await mount({ view, onSetCellStyle });
    const colour = ui.container.querySelector<HTMLInputElement>('[aria-label="Fill colour"]')!;
    const buttons = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[aria-label="Format"] button'));
    const apply = buttons.find(button => button.textContent === "Apply fill")!;
    const noFill = buttons.find(button => button.textContent === "No fill")!;
    expect(colour.value).toBe("#ffff00");

    const secondCell = ui.container.querySelector<HTMLElement>(`[data-testid="cell:${entityB}:c-title"]`)!;
    await act(async () => secondCell.focus());
    expect(colour.value).toBe("#000000");
    await act(async () => apply.click());
    expect(onSetCellStyle).toHaveBeenLastCalledWith(
      { occurrence: view.occurrence, revision: view.revision }, view.table.collection.key,
      { row: 2, rowCount: 1 }, ["c-title"], [{ kind: "fill", color: "#000000" }],
    );

    await act(async () => ui.cell().focus());
    expect(colour.value).toBe("#ffff00");
    await act(async () => noFill.click());
    const cleared = makeView();
    cleared.table.native_table_profile = true;
    await ui.update({ view: cleared });
    expect(colour.value).toBe("#000000");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(colour, "#ffff00");
      colour.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSetCellStyle).toHaveBeenLastCalledWith(
      { occurrence: view.occurrence, revision: view.revision }, view.table.collection.key,
      { row: 1, rowCount: 1 }, ["c-title"], [{ kind: "fill", color: "#FFFF00" }],
    );
  });

  it("shows and applies the focused field's fill after hiding the preceding column", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns[0]!.hidden = true;
    const style = { bold: false, italic: false, border: false, number_format: null, wrap: false, alignment: null };
    view.table.rows[0]!.styles = [{ ...style, fill: "FF0000" }, { ...style, fill: "0000FF" }];
    const onSetCellStyle = vi.fn(async () => ({ kind: "confirmed" as const }));
    const ui = await mount({ onSetCellStyle });
    await ui.update({ view });
    const cell = ui.container.querySelector<HTMLElement>(`[data-testid="cell:${entityA}:c-impact"]`)!;
    await act(async () => cell.focus());
    expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Fill colour"]')!.value).toBe("#0000ff");

    const apply = [...ui.container.querySelectorAll<HTMLButtonElement>('[aria-label="Format"] button')]
      .find(button => button.textContent === "Apply fill")!;
    await act(async () => apply.click());
    expect(onSetCellStyle).toHaveBeenCalledExactlyOnceWith(
      { occurrence: view.occurrence, revision: view.revision }, view.table.collection.key,
      { row: 1, rowCount: 1 }, ["c-impact"], [{ kind: "fill", color: "#0000FF" }],
    );
  });

  it("sends large contiguous formatting selections as one stored row range", async () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.rows = Array.from({ length: 1800 }, (_, index) => {
      const entity = index === 0 ? entityA : `row-${String(index).padStart(36, "0")}`;
      return { id: entity, key: entity, fields: view.table.columns.map(column => projected(entity, column.id, { kind: "text", value: "value" })) };
    });
    const onSetCellStyle = vi.fn(async () => ({ kind: "confirmed" as const }));
    const ui = await mount({ view, onSetCellStyle });
    await act(async () => ui.cell().dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    await ui.key("b");
    expect(onSetCellStyle).toHaveBeenCalledExactlyOnceWith(
      { occurrence: view.occurrence, revision: view.revision }, view.table.collection.key,
      { row: 1, rowCount: 1800 }, view.table.columns.map(column => column.id), [{ kind: "toggle_bold" }],
    );
  });

  it.each(["Shift+click", "Ctrl+Shift+End"])("preserves B2 as the range anchor after scrolling a 450-row table (%s)", async extension => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.rows = Array.from({ length: 450 }, (_, index) => ({
      id: index === 0 ? entityA : `row-${index}`, key: `row-${index}`,
      fields: view.table.columns.map((column, field) => projected(index === 0 ? entityA : `row-${index}`, column.id, {
        kind: "text", value: `R${index + 2}C${field + 1}`,
      })),
    }));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const flushFrames = async () => {
      for (let count = 0; frames.length && count < 20; count++) {
        const batch = frames.splice(0);
        await act(async () => { batch.forEach(callback => callback(0)); });
      }
      expect(frames).toHaveLength(0);
    };
    try {
      const ui = await mount({ view });
      const scroller = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 320 });
      const cell = (row: number, field: string) => ui.container.querySelector<HTMLElement>(`[data-testid="cell:${row === 0 ? entityA : `row-${row}`}:${field}"]`)!;
      const anchor = cell(0, "c-impact");
      await act(async () => anchor.click());
      expect(document.activeElement).toBe(anchor);
      const initiallyMounted = cell(10, "c-title");
      expect(initiallyMounted).not.toBeNull();
      await act(async () => {
        scroller.scrollTop = 398 * 32;
        scroller.dispatchEvent(new Event("scroll"));
      });
      await flushFrames();
      expect(initiallyMounted.isConnected).toBe(false);
      expect(ui.container.querySelectorAll("tbody tr.ts-row").length).toBeLessThan(100);
      // B2 is outside the window, but focus already pins its row.
      expect(anchor.isConnected).toBe(true);
      expect(document.activeElement).toBe(anchor);
      await act(async () => {
        if (extension === "Shift+click") {
          cell(398, "c-notes").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
        } else {
          anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
        }
      });
      await flushFrames();
      const lastRow = extension === "Shift+click" ? 398 : 449;
      expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Name Box"]')!.value).toBe("B2");
      expect(document.activeElement).toBe(anchor);
      expect(cell(lastRow, "c-notes").getAttribute("aria-selected")).toBe("true");
      const data = new DataTransfer();
      await act(async () => anchor.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data })));
      expect(data.getData("text/plain")).toBe(encodeTsv(Array.from({ length: lastRow + 1 }, (_, index) =>
        [2, 3, 4].map(column => `R${index + 2}C${column}`))));
      await act(async () => {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll"));
      });
      await flushFrames();
      for (const rendered of ui.container.querySelectorAll<HTMLElement>("tbody td[data-work-entity]")) {
        if (rendered.dataset.workEntity === DRAFT_ROW) continue;
        const row = rendered.dataset.workEntity === entityA ? 0 : Number(rendered.dataset.workEntity!.slice(4));
        const selected = row >= 0 && row <= lastRow && rendered.dataset.workField !== "c-title";
        expect(rendered.getAttribute("aria-selected") === "true").toBe(selected);
      }
      expect(cell(0, "c-impact")).toBe(anchor);
    } finally {
      await dispose?.(); dispose = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("targets the frozen column above scrolled cells and fills through the first visible column", async () => {
    const { useState } = await vi.importActual<typeof import("react")>("react");
    vi.mocked(React.useState).mockImplementation(((initial: unknown) => useState(
      initial && typeof initial === "object" && "byCollection" in initial
        ? { occurrence: "occ-1", byCollection: { release_items: { freezeFirstColumn: true } } }
        : initial,
    )) as typeof React.useState);
    const view = makeView();
    view.table.native_table_profile = true;
    for (const column of view.table.columns) column.field_type = "number";
    for (const row of view.table.rows) {
      for (const [index, field] of row.fields.entries()) {
        field.stored = { kind: "number", value: index + 1 };
        field.editable_scalar = "number";
        field.formula = null;
      }
    }
    const onEditCells = vi.fn<NonNullable<SheetShellProps["onEditCells"]>>(async () => ({ kind: "confirmed" }));
    try {
      const ui = await mount({ view, onEditCells });
      const grid = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 300));
      Object.defineProperty(grid, "clientHeight", { value: 300, configurable: true });
      const row = ui.container.querySelector<HTMLTableRowElement>("tbody tr.ts-row")!;
      ui.container.querySelectorAll<HTMLTableRowElement>("tbody tr.ts-row").forEach((item, index) =>
        vi.spyOn(item, "getBoundingClientRect").mockReturnValue(new DOMRect(0, index * 30, 500, 30)));
      const cells = row.querySelectorAll<HTMLTableCellElement>("td[data-work-field]");
      [100, 0, 100, 200].forEach((left, index) => vi.spyOn(cells[index]!, "getBoundingClientRect").mockReturnValue(new DOMRect(left, 0, 100, 30)));
      expect(cells[0]!.classList.contains("ts-frozen-first-column")).toBe(true);
      const drag = async (x: number) => {
        await act(async () => {
          ui.container.querySelector<HTMLElement>('[data-testid="fill-handle"]')!.dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, clientX: 190, clientY: 15, bubbles: true }));
          window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: x, clientY: 15 }));
          window.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: 15 }));
        });
      };
      await drag(195);
      expect(onEditCells).not.toHaveBeenCalled();
      await drag(220);
      expect(onEditCells).toHaveBeenCalledOnce();
      expect(onEditCells.mock.calls[0]![1].map(edit => edit.target.field)).toEqual(["c-impact", "c-priority", "c-notes"]);
    } finally {
      vi.mocked(React.useState).mockImplementation(useState);
      vi.restoreAllMocks();
    }
  });

  it("accelerates fill auto-scroll beyond the edge and stops its timer on unmount", async () => {
    const ui = await mount();
    const grid = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 100));
    Object.defineProperty(grid, "clientHeight", { value: 100, configurable: true });
    vi.useFakeTimers();
    try {
      await act(async () => {
        ui.container.querySelector<HTMLElement>('[data-testid="fill-handle"]')!.dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, detail: 1, bubbles: true }));
        window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientY: 100 }));
        vi.advanceTimersByTime(50);
      });
      const near = grid.scrollTop;
      expect(near).toBeGreaterThan(0);
      await act(async () => {
        window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientY: 160 }));
        vi.advanceTimersByTime(50);
      });
      expect(grid.scrollTop - near).toBeGreaterThan(near);
      await dispose!();
      dispose = undefined;
      const stopped = grid.scrollTop;
      vi.advanceTimersByTime(150);
      expect(grid.scrollTop).toBe(stopped);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("preserves Select All when a pending column width publishes a new revision", async () => {
    let finish!: (result: { kind: "confirmed" }) => void;
    const onSetColumnWidth = vi.fn<NonNullable<SheetShellProps["onSetColumnWidth"]>>(() => new Promise(resolve => { finish = resolve; }));
    const ui = await mount({ onSetColumnWidth });
    const separator = ui.container.querySelector<HTMLElement>('[role="separator"]')!;
    await act(async () => {
      separator.focus();
      separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    // Blur commits the keyboard preview, but the Work reply remains pending.
    await act(async () => ui.cell().focus());
    expect(onSetColumnWidth).toHaveBeenCalledOnce();
    await ui.key("a");
    const snapshot = () => {
      const cells = [...ui.container.querySelectorAll<HTMLElement>('td[data-work-field]:not([data-entry-field])')];
      return { revision: cells[0]!.dataset.workRevision, selected: cells.filter(cell => cell.getAttribute("aria-selected") === "true").map(cell => cell.dataset.testid), total: cells.length,
        range: ui.container.querySelector<HTMLInputElement>('[aria-label="Name Box"]')!.value };
    };
    const before = snapshot();
    expect(before.selected).toHaveLength(before.total);
    const next = { ...ui.view, revision: "rev-width", table: { ...ui.view.table, revision: "rev-width" } };
    await ui.update({ view: next });
    await act(async () => finish({ kind: "confirmed" }));
    const after = snapshot();
    console.log(JSON.stringify({ case: "Select All during width publication", before, after }));
    expect(after.selected).toHaveLength(after.total);
    expect(after.range).toBe(before.range);
    expect(document.activeElement).toBe(ui.cell());
    // An unrelated revision still invalidates the selection as before.
    await ui.update({ view: { ...next, revision: "rev-edit" } });
    expect(snapshot().selected).toHaveLength(1);
  });

  it.each(["upward", "leftward"])("reveals the pasted start of a %s selection without moving its anchor", async direction => {
    const view = makeView();
    if (direction === "upward") {
      view.table.columns = view.table.columns.slice(0, 1);
      view.table.rows = Array.from({ length: 8001 }, (_, index) => ({
        id: index === 0 ? entityA : `row-${index}`, key: `row-${index}`,
        fields: [projected(index === 0 ? entityA : `row-${index}`, "c-title", { kind: "text", value: `Row ${index}` })],
      }));
    }
    const onEditCells = vi.fn<NonNullable<SheetShellProps["onEditCells"]>>(async () => ({ kind: "confirmed" }));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const flushFrames = async () => { await act(async () => { while (frames.length) frames.shift()!(0); }); };
    try {
      const ui = await mount({ view, onEditCells });
      const scroller = ui.container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
      Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 200 });
      scroller.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 200 } as DOMRect);
      await act(async () => ui.cell().dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true })));
      await flushFrames();
      const anchor = document.activeElement as HTMLElement;
      expect(anchor.dataset.workEntity).toBe(direction === "upward" ? "row-8000" : entityB);
      expect(anchor.dataset.workField).toBe(direction === "upward" ? "c-title" : "c-notes");
      await act(async () => anchor.dispatchEvent(new KeyboardEvent("keydown", {
        key: direction === "upward" ? "Home" : "ArrowLeft", ctrlKey: true, shiftKey: true, bubbles: true,
      })));
      await flushFrames();
      const nameBox = ui.container.querySelector<HTMLInputElement>('[aria-label="Name Box"]')!;
      const selection = nameBox.value;
      const first = ui.container.querySelector<HTMLElement>(`[data-testid="cell:${direction === "upward" ? entityA : entityB}:c-title"]`)!;
      first.getBoundingClientRect = () => ({
        top: 32 - scroller.scrollTop, bottom: 64 - scroller.scrollTop,
        left: 40 - scroller.scrollLeft, right: 200 - scroller.scrollLeft,
      } as DOMRect);
      scroller.scrollTop = direction === "upward" ? 8000 * 32 : 0;
      scroller.scrollLeft = direction === "leftward" ? 480 : 0;
      const data = new DataTransfer();
      data.setData("text/plain", "pasted");
      await act(async () => anchor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })));
      await flushFrames();
      expect(onEditCells).toHaveBeenCalledOnce();
      expect(onEditCells.mock.calls[0]![1][0]!.target).toMatchObject({ entity: direction === "upward" ? entityA : entityB, field: "c-title" });
      expect(scroller.scrollTop).toBe(0);
      expect(first.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(first.getBoundingClientRect().right).toBeLessThanOrEqual(200);
      expect(first.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
      expect(first.getBoundingClientRect().bottom).toBeLessThanOrEqual(100);
      expect(document.activeElement).toBe(anchor);
      expect(nameBox.value).toBe(selection);
      expect(first.getAttribute("aria-selected")).toBe("true");
      expect(anchor.getAttribute("aria-selected")).toBe("true");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("adds immediately with + and Shift+F11 from the grid and tab bar, using the lowest unused displayed name", async () => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const view = makeView();
    view.collections[0]!.display_name = "sHeEt 4";
    view.collections.push({ id: "other", key: "other", display_name: "Sheet 5", headerless: false, data_start_row: 2, entity_count: 0 }, { id: "third", key: "third", display_name: "Other", headerless: false, data_start_row: 2, entity_count: 0 });
    const ui = await mount({ view, onAddTable });
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!;
    await act(async () => add.click());
    const shortcut = async (target: HTMLElement) => act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", shiftKey: true, bubbles: true, cancelable: true }));
    });
    await shortcut(ui.cell());
    await shortcut(ui.container.querySelector<HTMLElement>('[aria-label="Sheets"] [role="tab"]')!);
    expect(onAddTable).toHaveBeenCalledTimes(3);
    for (const args of onAddTable.mock.calls) expect(args).toEqual([
      { occurrence: view.occurrence, revision: view.revision }, "Sheet 6", [{ name: "A", field_type: "text", required: false }],
    ]);
    expect(ui.container.querySelector('[role="dialog"]:not([hidden])')).toBeNull();
  });

  it("lands in the first cell when the new projection renders before confirmation completes", async () => {
    let confirm!: (result: { kind: "confirmed" }) => void;
    const ui = await mount({ onAddTable: () => new Promise(resolve => { confirm = resolve; }), onInsertRow: async () => ({ kind: "confirmed" }) });
    await act(async () => ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!.click());
    expect(ui.container.querySelector('[aria-label="Sheets"] [aria-selected="true"]')?.textContent).toBe("release_items");
    const collection = { id: "new", key: "new", display_name: "Sheet 2", headerless: false, data_start_row: 2, entity_count: 0 };
    const view = { ...ui.view, revision: "rev-2", collections: [collection, ...ui.view.collections], table: { ...ui.view.table, revision: "rev-2", collection, rows: [], columns: [{ id: "a", key: "a", display_name: "A", field_type: "text" as const, required: false }] } };
    // App can install the projection before its mutation promise resolves.
    // The view-key reset clears commitPending during this render.
    await ui.update({ view });
    expect(document.activeElement).not.toBe(ui.container.querySelector('.ts-entry-row [data-entry-field="a"]'));
    await act(async () => confirm({ kind: "confirmed" }));
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ui.container.querySelector('[aria-label="Sheets"] [aria-selected="true"]')?.textContent).toBe("Sheet 2");
    const firstCell = ui.container.querySelector('.ts-entry-row [data-entry-field="a"]');
    expect(firstCell).not.toBeNull();
    expect(document.activeElement).toBe(firstCell);
  });

  it("keeps CSV addition disabled and refuses Shift+F11 with the exact hint", async () => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount({ onAddTable, importedSourceName: "book.csv", interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [] } } });
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("Adding sheets to imported work is not available yet.");
    await act(async () => { add.click(); ui.cell().dispatchEvent(new KeyboardEvent("keydown", { key: "F11", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(onAddTable).not.toHaveBeenCalled();
    expect(ui.container.textContent).toContain("Adding sheets to imported work is not available yet.");
  });

  it("offers XLSX addition with the existing starter column", async () => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount({ onAddTable, importedSourceName: "book.xlsx", interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [] } } });
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!;
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    expect(onAddTable).toHaveBeenCalledWith({ occurrence: ui.view.occurrence, revision: ui.view.revision }, "Sheet 2", [{ name: "A", field_type: "text", required: false }]);
    await ui.update({ busy: true });
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!.disabled).toBe(true);
  });

  it.each([["xlsx", false], ["native", true], ["imported", false]] as const)("uses %s origin for reopened work", async (importOrigin, disabled) => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount({ onAddTable, importOrigin, importedSourceName: null, interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [] } } });
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!.disabled).toBe(disabled);
  });

  it("offers sheet addition after reopening companion-backed work", async () => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount({ onAddTable, importedSourceName: null, interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [] } } });
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!;
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    expect(onAddTable).toHaveBeenCalledOnce();
  });

  it.each(["double-click", "F2", "menu"])("offers imported XLSX rename through %s and retains last-sheet/pending/draft guards", async method => {
    const onRenameTable = vi.fn<NonNullable<SheetShellProps["onRenameTable"]>>(async () => ({ kind: "confirmed" }));
    const view = makeView();
    const ui = await mount({ view, onRenameTable, onDeleteTable: async () => ({ kind: "confirmed" }), importedSourceName: "book.xlsx", interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [{ schema_id: view.table.collection.id, name: "Imported", has_header: true, columns: [], rows: [] }] } } });
    const tab = ui.container.querySelector<HTMLElement>('[aria-label="Sheets"] [role="tab"]')!;
    const open = async () => {
      await act(async () => {
        tab.dispatchEvent(method === "double-click" ? new MouseEvent("dblclick", { bubbles: true }) : method === "F2" ? new KeyboardEvent("keydown", { key: "F2", bubbles: true }) : new MouseEvent("contextmenu", { bubbles: true }));
      });
      if (method === "menu") await act(async () => ui.container.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    };
    if (method === "menu") {
      await act(async () => tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
      const items = ui.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      expect(items[0]!.disabled).toBe(false);
      expect(items[1]!.disabled).toBe(true);
      await act(async () => items[0]!.click());
    } else await open();
    const renameDialog = ui.container.querySelector<HTMLElement>('[role="dialog"][aria-label="Rename sheet"]')!;
    expect(renameDialog.querySelector<HTMLInputElement>("input")?.value).toBe("Imported");
    const cancel = Array.from(renameDialog.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Cancel")!;
    await act(async () => cancel.click());
    await ui.update({ busy: true });
    await open();
    expect(ui.container.querySelector('[role="dialog"][aria-label="Rename sheet"]')).toBeNull();
    await ui.update({ busy: false });
    await act(async () => ui.cell().dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })));
    const editor = ui.container.querySelector<HTMLTextAreaElement>('[data-testid="cell-editor"]')!;
    expect(editor).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "Kept draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await open();
    expect(ui.container.querySelector('[role="dialog"][aria-label="Rename sheet"]')).toBeNull();
    expect(onRenameTable).not.toHaveBeenCalled();
  });

  it("keeps Work's refusal visible without changing tabs", async () => {
    const ui = await mount({ onAddTable: async () => ({ kind: "refused", message: "At most 32 collections are supported." }) });
    await act(async () => ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!.click());
    expect(ui.container.textContent).toContain("At most 32 collections are supported.");
    expect(ui.container.querySelectorAll('[aria-label="Sheets"] [role="tab"]')).toHaveLength(1);
  });

  it("does not add from a cell editor, Name Box, dialog, or locked work", async () => {
    const onAddTable = vi.fn<NonNullable<SheetShellProps["onAddTable"]>>(async () => ({ kind: "confirmed" }));
    const ui = await mount({ onAddTable, onRenameTable: async () => ({ kind: "confirmed" }) });
    const shortcut = async (target: HTMLElement) => act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", shiftKey: true, bubbles: true, cancelable: true }));
    });
    const nameBox = ui.container.querySelector<HTMLInputElement>('[aria-label="Name Box"]')!;
    expect(nameBox).not.toBeNull();
    await shortcut(nameBox);
    await act(async () => ui.cell().dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })));
    const editor = ui.container.querySelector<HTMLElement>('[data-testid="cell-editor"]')!;
    expect(editor).not.toBeNull();
    await shortcut(editor);
    await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const tab = ui.container.querySelector<HTMLElement>('[aria-label="Sheets"] [role="tab"]')!;
    await act(async () => tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(ui.container.querySelector('[role="dialog"][aria-label="Rename sheet"]')).not.toBeNull();
    await shortcut(tab);
    expect(onAddTable).not.toHaveBeenCalled();
    await ui.update({ busy: true });
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="Add sheet"]')!.disabled).toBe(true);
  });

  it.each([["su", false], ["s", false], ["su", true]] as const)("Tab handles field prefix %s (suggestion explicitly selected: %s)", async (token, navigated) => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns[1]!.key = "su";
    const onCommit = vi.fn<SheetShellProps["onCommit"]>(async () => ({ accepted: true }));
    const ui = await mount({ view, onCommit });
    const cell = ui.container.querySelector<HTMLElement>(`[data-testid="cell:${entityA}:c-impact"]`)!;
    await act(async () => { cell.focus(); cell.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true })); });
    const input = ui.container.querySelector<HTMLInputElement>('[data-testid="cell-editor"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, `=${token}`);
      input.setSelectionRange(token.length + 1, token.length + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(ui.container.querySelector('[role="listbox"]')).not.toBeNull();
    if (navigated) {
      await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
      expect(ui.container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain("SUM");
    }
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    if (token === "su" && !navigated) expect(onCommit.mock.calls[0]?.[2]).toEqual({ kind: "formula", source: "su" });
    else { expect(onCommit).not.toHaveBeenCalled(); expect(input.value).toBe("=SUM("); }
  });

  it.each(["sort", "filter"])("clears the copied outline after local %s", async change => {
    const ui = await mount();
    const data = new DataTransfer();
    await act(async () => { ui.cell().dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data })); });
    expect(ui.container.querySelector('[class*="ts-cell--copied"]')).not.toBeNull();
    const header = ui.container.querySelector("th.ts-column-header")!;
    if (change === "sort") {
      const sort = header.querySelector<HTMLButtonElement>('[aria-label="Sort A → Z"]')!;
      await act(async () => sort.click());
    } else {
      const filter = header.querySelector<HTMLButtonElement>('[aria-label="Filter…"]')!;
      await act(async () => filter.click());
      const input = header.querySelector<HTMLInputElement>('input[aria-label="Filter title"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alpha");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const apply = [...header.querySelectorAll("button")].find(button => button.textContent === "Apply")!;
      await act(async () => apply.click());
    }
    expect(ui.container.querySelector('[class*="ts-cell--copied"]')).toBeNull();
  });

  it("closes menus and disclosures before shortcut help", async () => {
    const ui = await mount({ onDeleteTable: async () => ({ kind: "confirmed" }) });
    const tab = ui.container.querySelector<HTMLElement>('[aria-label="Sheets"] [role="tab"]')!;
    await act(async () => { tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    expect(ui.container.querySelector('[role="menu"]')).not.toBeNull();
    const disclosure = ui.container.querySelector<HTMLDetailsElement>(".ts-column-overflow")!;
    disclosure.open = true;
    const help = [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Keyboard shortcuts")!;
    await act(async () => help.click());
    expect(ui.container.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).not.toBeNull();
    expect(ui.container.querySelector('[role="menu"]')).toBeNull();
    expect(disclosure.open).toBe(false);
  });

  it("returns focus to More document commands after closing shortcut help", async () => {
    const ui = await mount();
    const disclosure = ui.container.querySelector<HTMLDetailsElement>(".ts-command-overflow")!;
    const summary = disclosure.querySelector<HTMLElement>('summary[aria-label="More document commands"]')!;
    const help = [...disclosure.querySelectorAll("button")].find(button => button.textContent === "Keyboard shortcuts")!;
    await act(async () => { summary.click(); help.focus(); help.click(); });
    const dialog = ui.container.querySelector<HTMLElement>('[role="dialog"][aria-label="Keyboard shortcuts"]')!;
    expect(dialog).not.toBeNull();
    expect(disclosure.open).toBe(false);
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ui.container.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(document.activeElement).toBe(summary);
  });

  it("disables unavailable Rename without blocking history via menu, F2 or double-click", async () => {
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => null);
    const ui = await mount({ onHistory, onDeleteTable: async () => ({ kind: "confirmed" }) });
    const tab = ui.container.querySelector<HTMLElement>('[aria-label="Sheets"] [role="tab"]')!;
    await act(async () => { tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    const rename = ui.container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(rename.disabled).toBe(true);
    expect(rename.title).toBe("Renaming sheets is not available.");
    await act(async () => { rename.click(); tab.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })); tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(ui.container.querySelector('[role="dialog"][aria-label="Rename sheet"]')).toBeNull();
    await act(async () => { tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await ui.key("z", ui.cell());
    expect(onHistory).toHaveBeenCalledOnce();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }

  it("undoes a row delete requested while its commit is pending", async () => {
    const deletion = deferred<Awaited<ReturnType<NonNullable<SheetShellProps["onRemoveRows"]>>>>();
    const onRemoveRows = vi.fn(() => deletion.promise);
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => {
      await ui.update({ view: ui.view });
      return null;
    });
    const ui = await mount({ onInsertRow: async () => ({ kind: "confirmed" }), onRemoveRows, onHistory, localHistory: { occurrence: "occ-1", revision: "rev-1", undo: [], redo: [] } });
    const button = [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Delete row")!;
    await act(async () => button.click());
    expect(onRemoveRows).toHaveBeenCalledOnce();
    expect((await ui.key()).defaultPrevented).toBe(true);
    expect(onHistory).not.toHaveBeenCalled();
    const deleted = { ...ui.view, revision: "rev-2", table: { ...ui.view.table, revision: "rev-2", rows: ui.view.table.rows.slice(1) } };
    // App keeps its runtime busy while publication precedes the command's settlement.
    await ui.update({ busy: true, view: deleted, localHistory: { occurrence: "occ-1", revision: "rev-2", undo: ["work"], redo: [] } });
    expect(onHistory).not.toHaveBeenCalled();
    await act(async () => { deletion.resolve({ kind: "confirmed" }); });
    expect(onHistory).not.toHaveBeenCalled();
    await ui.update({ busy: false });
    expect(onHistory).toHaveBeenCalledExactlyOnceWith("undo");
    expect(ui.cell()).not.toBeNull();
  });

  it("runs rapid Undo presses one step at a time", async () => {
    const first = deferred<null>();
    const onHistory = vi.fn<SheetShellProps["onHistory"]>().mockImplementationOnce(() => first.promise).mockResolvedValue(null);
    const ui = await mount({ onHistory });
    await ui.key();
    await ui.key();
    expect(onHistory).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(null); });
    expect(onHistory.mock.calls.map(call => call[0])).toEqual(["undo", "undo"]);
  });

  it("keeps Ctrl+Z local to an open cell editor", async () => {
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => null);
    const ui = await mount({ onHistory });
    await act(async () => { ui.cell().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    const input = ui.cell().querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
    expect(input).not.toBeNull();
    expect((await ui.key("z", input)).defaultPrevented).toBe(false);
    expect(onHistory).not.toHaveBeenCalled();
  });

  it.each(["Ctrl+Z", "Cmd+Z", "menu"])("does not replay %s entered during unknown currentness after Refresh", async shortcut => {
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => null);
    const onRefresh = vi.fn(async () => { await ui.update({ currentness: "current" }); });
    const ui = await mount({ onHistory, onRefresh, currentness: "unknown" });
    await act(async () => {
      if (shortcut === "menu") window.dispatchEvent(new CustomEvent("tachiko-menu", { detail: "undo" }));
      else ui.cell().dispatchEvent(new KeyboardEvent("keydown", {
        key: "z", ctrlKey: shortcut === "Ctrl+Z", metaKey: shortcut === "Cmd+Z", bubbles: true, cancelable: true,
      }));
    });
    expect(onHistory).not.toHaveBeenCalled();
    const refresh = [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Refresh")!;
    await act(async () => refresh.click());
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onHistory).not.toHaveBeenCalled();
    // Recovery retained the same occurrence, revision and available history;
    // a fresh press, rather than Refresh itself, must initiate the next step.
    await act(async () => ui.cell().focus());
    await ui.key();
    expect(onHistory).toHaveBeenCalledExactlyOnceWith("undo");
  });

  it("clears history queued before a commit leaves currentness unknown", async () => {
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => null);
    const ui = await mount({ onHistory, busy: true });
    await ui.key();
    await ui.update({ currentness: "unknown", busy: false });
    await ui.update({ currentness: "pending", busy: true });
    await ui.update({ currentness: "current", busy: false });
    expect(onHistory).not.toHaveBeenCalled();
  });

  it.each(["collection", "occurrence", "close", "draft", "modal"])("clears queued history on %s change", async change => {
    const first = deferred<null>();
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(() => first.promise);
    const ui = await mount({ onHistory });
    await ui.key();
    await ui.key();
    if (change === "collection") {
      await ui.update({ view: { ...ui.view, table: { ...ui.view.table, collection: { ...ui.view.table.collection, key: "other" } } } });
    } else if (change === "occurrence") {
      await ui.update({ view: { ...ui.view, occurrence: "other" } });
    } else if (change === "close") {
      await ui.update({ view: null });
    } else if (change === "draft") {
      await act(async () => { ui.cell().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
      expect(ui.cell().querySelector("input, textarea")).not.toBeNull();
      await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    } else {
      const help = [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Keyboard shortcuts")!;
      await act(async () => help.click());
      expect(ui.container.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    }
    await act(async () => { first.resolve(null); });
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  it("preserves mixed Undo/Redo order and ignores entries beyond 20", async () => {
    const onHistory = vi.fn<SheetShellProps["onHistory"]>(async () => null);
    const ui = await mount({ onHistory, busy: true, localHistory: { occurrence: "occ-1", revision: "rev-1", undo: Array<"work">(20).fill("work"), redo: Array<"work">(20).fill("work") } });
    for (let i = 0; i < 22; i++) await ui.key(i % 2 ? "y" : "z");
    expect(onHistory).not.toHaveBeenCalled();
    await ui.update({ busy: false });
    expect(onHistory.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 ? "redo" : "undo"));
  });
});

describe("paste completion reveal", () => {
  it("keeps an asynchronously published windowed target visible when the grid resizes after reveal settles", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const observers = new Map<ResizeObserver, { callback: ResizeObserverCallback; elements: Set<Element> }>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observers.set(this as unknown as ResizeObserver, { callback, elements: new Set() }); }
      observe(element: Element) { observers.get(this as unknown as ResizeObserver)!.elements.add(element); }
      disconnect() { observers.delete(this as unknown as ResizeObserver); }
    });
    const flushFrames = async () => {
      for (let count = 0; frames.length && count < 20; count++) {
        const batch = frames.splice(0);
        await act(async () => { batch.forEach(callback => callback(0)); });
      }
      expect(frames).toHaveLength(0);
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.columns = view.table.columns.slice(0, 1);
    view.table.rows = Array.from({ length: 300 }, (_, index) => ({
      id: `row-${index}`, key: `row-${index}`,
      fields: [projected(`row-${index}`, "c-title", { kind: "text", value: `Row ${index}` })],
    }));
    let finish!: (result: { kind: "confirmed" }) => void;
    const onEditCells = vi.fn<NonNullable<SheetShellProps["onEditCells"]>>(() => new Promise(resolve => { finish = resolve; }));
    let height = 264;
    const rowHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.matches("tr.ts-row") ? 28 : this.matches("thead") ? 31 : 0;
    });
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const scroller = container.querySelector<HTMLElement>(".ts-grid-scroll");
      const row = this.closest("tr[aria-rowindex]");
      const top = this.matches("td[data-work-entity]") && row
        ? 290 + 31 + (Number(row.getAttribute("aria-rowindex")) - 2) * 28 - scroller!.scrollTop : 290;
      const boxHeight = this.matches("thead") ? 31 : this.matches(".ts-grid-scroll") ? height + 15 : 28;
      const left = this.matches("td[data-work-entity]") ? 64 : 16;
      const width = this.matches(".ts-gutter-head") ? 48 : this.matches("td[data-work-entity]") ? 325 : 953;
      return { top, bottom: top + boxHeight, left, right: left + width, width, height: boxHeight } as DOMRect;
    });
    try {
      await act(async () => root.render(createElement(SheetShell, makeProps({ view, onEditCells }))));
      const scroller = container.querySelector<HTMLElement>(".ts-grid-scroll")!;
      Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => height });
      const first = container.querySelector<HTMLElement>('[data-testid="cell:row-0:c-title"]')!;
      await act(async () => {
        first.focus();
        first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true }));
      });
      await flushFrames();
      const target = container.querySelector<HTMLElement>('[data-testid="cell:row-299:c-title"]')!;
      expect(document.activeElement).toBe(target);
      await act(async () => {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll"));
      });
      await flushFrames();
      expect(target.getBoundingClientRect().top).toBeGreaterThan(290 + height);
      expect(container.querySelectorAll("tbody tr.ts-row").length).toBeLessThan(100);
      const prePublicationRow = container.querySelector('[data-testid="cell:row-1:c-title"]')!;
      const data = new DataTransfer(); data.setData("text/plain", "off-screen-paste");
      await act(async () => target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })));
      expect(onEditCells).toHaveBeenCalledOnce();
      expect(onEditCells.mock.calls[0]![1]).toMatchObject([{ target: { entity: "row-299", field: "c-title" } }]);
      expect(scroller.scrollTop).toBe(0);
      const published = { ...view, revision: "rev-2", table: { ...view.table, revision: "rev-2", rows: view.table.rows.map((row, index) => index !== 299 ? row : {
        ...row, fields: [projected("row-299", "c-title", { kind: "text", value: "off-screen-paste" })],
      }) } };
      await act(async () => {
        root.render(createElement(SheetShell, makeProps({ view: published, onEditCells })));
        finish({ kind: "confirmed" });
      });
      await flushFrames();
      expect(prePublicationRow.isConnected).toBe(false);
      expect(target.textContent).toBe("off-screen-paste");
      expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(290 + height);
      // The published feedback/layout reduces the client body by one 28px row,
      // after the old reveal's stable frame has already released its request.
      height = 236;
      await act(async () => {
        for (const [observer, entry] of observers) if (entry.elements.has(scroller)) entry.callback([], observer);
      });
      await flushFrames();
      expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(321);
      expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(526);
      expect(document.activeElement).toBe(target);
      // Ordinary later scrolling is free once the reveal has settled.
      await act(async () => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event("scroll")); });
      await flushFrames();
      expect(scroller.scrollTop).toBe(0);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      rowHeight.mockRestore(); geometry.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each(["confirmed", "refused", "cancelled", "offset/window changes", "wheel", "touch", "wide", "tall", "fractional", "nonconverging"])("reveals an off-screen target only after confirmed paste (%s)", async outcome => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    let scrollLeft = 0;
    const scrollport = {
      scrollTop: 0, get scrollLeft() { return scrollLeft; }, set scrollLeft(value: number) { scrollLeft = outcome === "fractional" ? Math.round(value) : value; }, clientTop: 0, clientHeight: 83, clientLeft: 0, clientWidth: 400,
      querySelector: () => null,
      getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 400 }),
    };
    let cellTop = 400;
    class Cell {
      dataset = { workEntity: entityB, workField: "c-title" };
      classList = { contains: () => false };
      closest(selector: string) { return selector.startsWith("td[") ? this : null; }
      getBoundingClientRect() {
        const left = (outcome === "fractional" ? 500.328125 : outcome === "wide" ? 500 : 20) - scrollport.scrollLeft;
        const top = outcome === "nonconverging" ? 400 : cellTop - scrollport.scrollTop;
        return { top, bottom: top + (outcome === "tall" ? 160 : 32), left, right: left + (["wide", "fractional"].includes(outcome) ? 800 : 100) };
      }
    }
    const target = new Cell();
    const doc = { activeElement: target };
    vi.stubGlobal("Element", Cell);
    vi.stubGlobal("document", doc);
    let finish!: (result: any) => void;
    const publish = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
    let finishRead!: (text: string) => void;
    vi.stubGlobal("navigator", { clipboard: { readText: () => new Promise<string>(resolve => { finishRead = resolve; }) } });
    try {
      pasteRender.nodes = [];
      pasteRender.capture = true;
      render({ view: makeView(), onEditCells: publish });
      pasteRender.capture = false;
      // Mount the occurrence lifecycle and DOM refs used by the real event handlers.
      pasteRender.occurrenceEffects[0]();
      const grid = pasteRender.nodes.find(node => node.props.role === "grid")!;
      const scroller = pasteRender.nodes.find(node => node.props.className === "ts-grid-scroll")!;
      scroller.props.ref.current = scrollport;
      const cell = pasteRender.nodes.find(node => node.type === "td" && node.props["data-work-entity"] === entityB && node.props["data-work-field"] === "c-title")!;
      cell.props.ref(target);
      expect(target.getBoundingClientRect().top).toBeGreaterThan(100);
      if (outcome === "cancelled") {
        cell.props.onKeyDown({ key: "v", ctrlKey: true, shiftKey: true, nativeEvent: {}, preventDefault() {}, target, currentTarget: target });
        doc.activeElement = new Cell();
        doc.activeElement.dataset.workEntity = entityA;
        finishRead("pasted");
      } else {
        grid.props.onPaste({ target, preventDefault() {}, clipboardData: { types: ["text/plain"], getData: () => "pasted" } });
        expect(publish).toHaveBeenCalledOnce();
        expect(scrollport.scrollTop).toBe(0);
        finish(outcome === "refused" ? { kind: "refused", message: "Refused" } : { kind: "confirmed" });
      }
      await Promise.resolve();
      await Promise.resolve();
      if (outcome === "offset/window changes") {
        // Publication's estimated scroll is clamped while the virtual window
        // replaces its rows. The target mounts only after the first frame.
        scrollport.scrollTop = 200;
        cell.props.ref(null);
        frames.shift()!(0);
        cellTop = 700;
        cell.props.ref(target);
        frames.shift()!(0);
        // A later measurement/commit changes both offsets and cell geometry.
        cellTop = 1000;
        scrollport.scrollTop = 850;
        scroller.props.onScroll();
      } else if (outcome === "wheel" || outcome === "touch") {
        scroller.props[outcome === "wheel" ? "onWheelCapture" : "onTouchMoveCapture"]();
        scrollport.scrollTop = 20;
        scroller.props.onScroll();
      }
      let frame = 0;
      for (; frames.length && frame < 10; frame++) frames.shift()!(0);
      expect(frames).toHaveLength(0);
      if (outcome === "nonconverging") expect(frame).toBe(8);
      else if (["confirmed", "offset/window changes", "wide", "tall", "fractional"].includes(outcome)) {
        if (outcome === "tall") expect(target.getBoundingClientRect().top).toBe(0);
        else expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(83);
        if (outcome === "wide") expect(target.getBoundingClientRect().left).toBe(0);
        if (outcome === "fractional") expect(target.getBoundingClientRect().left).toBeCloseTo(0.328125);
        expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
        scrollport.scrollTop = 0;
        scroller.props.onScroll();
        while (frames.length) frames.shift()!(0);
        expect(scrollport.scrollTop).toBe(0);
      } else {
        expect(scrollport.scrollTop).toBe(outcome === "wheel" || outcome === "touch" ? 20 : 0);
        if (outcome === "cancelled") expect(publish).not.toHaveBeenCalled();
      }
    } finally {
      pasteRender.capture = false;
      pasteRender.nodes = [];
      pasteRender.occurrenceEffects = [];
      vi.unstubAllGlobals();
    }
  });
});

function cellMarkup(markup: string, testId: string, closeTag = "</td>"): string | null {
  const marker = markup.indexOf(`data-testid="${testId}"`);
  if (marker < 0) return null;
  const start = markup.lastIndexOf("<", marker);
  const end = markup.indexOf(closeTag, marker);
  if (start < 0 || end < 0) return null;
  return markup.slice(start, end);
}

function textOf(elementMarkup: string): string {
  return elementMarkup.replace(/<[^>]*>/g, "").trim();
}

function chipText(markup: string, testId: string): string | null {
  const marker = markup.indexOf(`data-testid="${testId}"`);
  if (marker < 0) return null;
  const open = markup.lastIndexOf("<", marker);
  const close = markup.indexOf("</span>", marker);
  if (open < 0 || close < 0) return null;
  return textOf(markup.slice(open, close));
}

describe("fieldDisplay", () => {
  it("uses explicit presence and requiredness, never rendered emptiness", () => {
    const empty = projected(entityA, "c-title", { kind: "text", value: "" });
    expect(fieldDisplay(empty, false)).toMatchObject({ text: '""', description: "Empty text", emptyTextMarker: true });
    expect(fieldDisplay(empty, true)).toMatchObject({ text: "", description: "Empty text" });
    expect(fieldDisplay(empty, true).emptyTextMarker).toBeUndefined();
    expect(fieldDisplay(projected(entityA, "c-title", null, { blank: true }))).toMatchObject({ text: "", description: "Blank" });
    expect(fieldDisplay(projected(entityA, "c-title", null)).description).toBeUndefined();
    expect(fieldDisplay(null).description).toBeUndefined();
    for (const stored of [{ kind: "text", value: " " }, { kind: "number", value: 0 }, { kind: "boolean", value: false }] as const) {
      expect(fieldDisplay(projected(entityA, "c-title", stored), false).emptyTextMarker).toBeUndefined();
      expect(fieldClipboardText(projected(entityA, "c-title", stored))).toBe(String(stored.value));
    }
  });

  it("joins sparse fields and blank IDs by identity, including entirely blank rows", () => {
    const view = makeView();
    const column = { ...view.table.columns[0]!, required: false };
    const row = { ...view.table.rows[0]!, fields: [projected(entityA, "another-field", { kind: "text", value: "present" })], blank_fields: [column.id] };
    expect(cellDisplay(row, column)).toMatchObject({ text: "", description: "Blank" });
    expect(cellDisplay({ ...row, fields: [] }, column).description).toBe("Blank");
    expect(cellDisplay({ ...row, blank_fields: undefined }, column).description).toBeUndefined();
    expect(cellDisplay({ ...row, blank_fields: [], fields: [projected(entityA, column.id, { kind: "text", value: "" })] }, column).text).toBe('""');
  });

  it("serializes values independently from empty-text decoration and diagnostics", () => {
    const empty = projected(entityA, "c-title", { kind: "text", value: "" });
    const blank = projected(entityA, "c-title", null, { blank: true });
    const diagnostic = projected(entityA, "c-title", { kind: "text", value: "" }, { diagnostics: [{ code: "warning", message: "Attention", path: "title" }] });
    expect(fieldDisplay(empty, false).text).toBe('""');
    expect(encodeTsv([[fieldClipboardText(blank), fieldClipboardText(empty), fieldClipboardText(diagnostic)]])).toBe("\t\t");
    expect(fieldClipboardText(null)).toBe("");
    expect(fieldClipboardText(projected(entityA, "c-priority", { kind: "number", value: 1 }, { formula: { source: "1 + 2" }, calculated: { status: "value", value: 3 } }))).toBe("3");
    expect(fieldClipboardText(projected(entityA, "c-priority", null, { calculated: { status: "unavailable" } }))).toBe("");
  });

  it("renders stored scalars and references without deriving meaning", () => {
    expect(fieldDisplay(projected(entityA, "c-impact", { kind: "number", value: 5 }))).toEqual({
      text: "5",
      tone: "plain",
      title: null,
    });
    expect(fieldDisplay(projected(entityA, "c-title", { kind: "boolean", value: false })).text).toBe("false");
    expect(fieldDisplay(projected(entityA, "c-title", { kind: "date", value: "2026-09-12" })).text).toBe("2026-09-12");
    const reference = fieldDisplay(projected(entityA, "c-title", { kind: "reference", entity: entityB }));
    expect(reference.text).toBe("→ reference");
    expect(reference.title).toBe("Reference value");
    expect(reference.title).not.toContain(entityB);
  });

  it("keeps long stored text available as a full-value tooltip", () => {
    const value = "A long task value that remains available when the dense grid truncates its cell";
    expect(fieldDisplay(projected(entityA, "c-title", { kind: "text", value })).title).toBe(value);
  });

  it("keeps diagnostic-bearing Latin and CJK text fully accessible", () => {
    const values = [
      "Review partner brief and confirm ownership, launch timing, and rollback notes for the next release",
      "檢查鍵盤導覽、窄視窗水平捲動，以及長文字欄位的完整值存取體驗",
    ];
    for (const value of values) {
      const display = fieldDisplay(
        projected(entityA, "c-title", { kind: "text", value }, {
          diagnostics: [{ code: "stale", message: "revision too old", path: "c-title" }],
        }),
      );
      expect(display.text).toBe(value);
      expect(display.tone).toBe("warning");
      expect(display.title).toBe(`stale: revision too old — ${value}`);
    }
  });

  it("keeps calculated results, failures and unavailable states distinguishable", () => {
    const calculated = fieldDisplay(
      projected(entityA, "c-priority", { kind: "number", value: 10 }, {
        formula: { source: "impact + friction" },
        calculated: { status: "value", value: 10 },
      }),
    );
    expect(calculated.text).toBe("10");
    expect(calculated.tone).toBe("computed");
    expect(calculated).not.toHaveProperty("calculationFailed");
    expect(calculated.title).toBe("Calculated value");
    expect(calculated.title).not.toContain("impact + friction");
    const pending = fieldDisplay(
      projected(entityA, "c-priority", null, { formula: { source: "[playtest_notes.impact] + 1" } }),
    );
    expect(pending.title).toBe("Calculated value without a current result");
    expect(pending).not.toHaveProperty("calculationFailed");
    expect(pending.title).not.toContain("playtest_notes");

    const failure = fieldDisplay(
      projected(entityA, "c-priority", null, {
        calculated: { status: "failure", code: "div0", message: "division by zero" },
      }),
    );
    expect(failure.text).toBe("Calculation failed");
    expect(failure.tone).toBe("warning");
    expect(failure.title).toBe("div0: division by zero");
    expect(failure.calculationFailed).toBe(true);

    const failureWithDiagnostic = fieldDisplay(projected(entityA, "c-priority", null, {
      calculated: { status: "failure", code: "div0", message: "division by zero" },
      diagnostics: [{ code: "stale", message: "revision too old", path: "priority" }],
    }));
    expect(failureWithDiagnostic).toEqual({
      ...failure, title: "stale: revision too old",
    });

    const unavailable = fieldDisplay(projected(entityA, "c-priority", null, { calculated: { status: "unavailable" } }));
    expect(unavailable.text).toBe("Unavailable");
    expect(unavailable.tone).toBe("muted");
    expect(unavailable).not.toHaveProperty("calculationFailed");
  });

  it("marks missing projections, empty values and diagnostics explicitly", () => {
    expect(fieldDisplay(null)).toMatchObject({ text: "", title: "No value" });
    expect(fieldDisplay(projected(entityA, "c-title", { kind: "text", value: "" }))).toMatchObject({ text: "", title: "Empty text" });
    expect(fieldDisplay(projected(entityA, "c-title", null)).text).toBe("");
    expect(fieldDisplay(projected(entityA, "c-priority", null, { formula: "=1" } as never)).text).toBe("Empty");
    const emptyWithDiagnostic = fieldDisplay(projected(entityA, "c-title", { kind: "text", value: "" }, {
      diagnostics: [{ code: "stale", message: "revision too old", path: "title" }],
    }));
    expect(emptyWithDiagnostic).toMatchObject({ text: "Empty", tone: "warning" });
    const withDiagnostic = fieldDisplay(
      projected(entityA, "c-impact", { kind: "number", value: 5 }, {
        diagnostics: [{ code: "stale", message: "revision too old", path: "impact" }],
      }),
    );
    expect(withDiagnostic.tone).toBe("warning");
    expect(withDiagnostic.title).toBe("stale: revision too old");
    expect(withDiagnostic.text).toBe("5");
    expect(withDiagnostic).not.toHaveProperty("calculationFailed");
  });

  it("marks only failed-calculation cells in the grid", () => {
    const view = makeView({ titleDiagnostic: true });
    view.table!.rows[0]!.fields = view.table!.rows[0]!.fields.map((field) =>
      field.target.field === "c-priority"
        ? { ...field, calculated: { status: "failure", code: "div0", message: "division by zero" } }
        : field,
    );
    const markup = render({ view });
    const failure = cellMarkup(markup, `cell:${entityA}:c-priority`);
    expect(failure).toContain("ts-cell--calc-failed");
    expect(failure).toContain("Calculation failed");
    expect(failure).toContain('title="div0: division by zero"');
    expect(cellMarkup(markup, `cell:${entityB}:c-priority`)).not.toContain("ts-cell--calc-failed");
    expect(cellMarkup(markup, `cell:${entityA}:c-title`)).not.toContain("ts-cell--calc-failed");
    expect(cellMarkup(markup, `cell:${entityA}:c-impact`)).not.toContain("ts-cell--calc-failed");
  });
});

describe("edit drafts", () => {
  it("passes raw number input through without frontend validation", () => {
    expect(scalarEditOf("number", "not a number")).toEqual({ kind: "number", input: "not a number" });
    expect(scalarEditOf("text", "先完成試玩回饋")).toEqual({ kind: "text", value: "先完成試玩回饋" });
    expect(scalarEditOf("date", "2026-09-12")).toEqual({ kind: "date", value: "2026-09-12" });
    expect(parseBooleanDraft(" TRUE ")).toBe(true);
    expect(parseBooleanDraft("false")).toBe(false);
    expect(parseBooleanDraft("maybe")).toBe(null);
  });

  it("seeds editors from the actual projection", () => {
    expect(seedTextOf(projected(entityA, "c-impact", { kind: "number", value: 5 }))).toBe("5");
    expect(seedTextOf(projected(entityA, "c-title", { kind: "boolean", value: true }))).toBe("true");
    expect(seedTextOf(projected(entityA, "c-notes", { kind: "text", value: "first note" }))).toBe("first note");
  });
});

describe("recovery presentation", () => {
  it("keeps the established five-view order and Refresh recovery route in a retained workbook", () => {
    const markup = render({ view: makeView(), currentness: "unknown", outcome: "unknown" });
    const orderedTabs = ["ts-tab-table", "ts-tab-summary", "ts-tab-report", "ts-tab-brief", "ts-tab-interop"];
    const positions = orderedTabs.map((id) => markup.indexOf(`id=\"${id}\"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    const refresh = markup.match(/<button[^>]*>Refresh<\/button>/)?.[0];
    expect(refresh).toBeDefined();
    expect(refresh).not.toContain("disabled");
  });

  it("keeps every workbook command available in the responsive document header", () => {
    const markup = render({ view: makeView() });
    const context = markup.match(/<nav class="ts-work-context"[\s\S]*?<\/nav>/)?.[0];
    expect(markup).toContain('aria-label="Document commands"');
    expect(markup).toContain(">Undo</button>");
    expect(markup).toContain(">Redo</button>");
    expect(markup).toContain("ts-refresh-command");
    expect(markup).toContain(">Refresh</button>");
    expect(markup).toContain(">Save a copy</button>");
    expect(markup).toContain(">Close project</button>");
    expect(markup).toContain('<details class="ts-command-overflow">');
    expect(markup).toContain('aria-label="More document commands"');
    expect(markup.indexOf(">Refresh</button>")).toBeLessThan(markup.indexOf("ts-save-status"));
    expect(markup.indexOf("ts-save-status")).toBeLessThan(markup.indexOf(">Save a copy</button>"));
    expect(context).toContain('aria-label="Workbook actions"');
    expect(context).toContain('id="ts-active-table"');
  });

  it.each([
    [null, "Save your work as a copy you can reopen here. The file you opened from is not changed."],
    ["My workbook", "Save changes to this copy (like Excel's Save). The file you opened from is not changed."],
  ])("explains Save for bound copy %s without renaming workbook actions", (boundCopyName, title) => {
    const markup = render({ view: makeView(), boundCopyName });
    const save = markup.match(/<button[^>]*>Save<\/button>/)?.[0];
    const saveCopy = markup.match(/<button[^>]*>Save a copy<\/button>/)?.[0];
    expect(save).toBeDefined();
    expect(save).toContain(`title="${title.replace(/'/g, "&#x27;")}"`);
    expect(saveCopy).toBeDefined();
    expect(saveCopy).toContain('title="Keep this copy and save another one (like Excel&#x27;s Save As)."');
  });

  it("explains Prepare XLSX alongside the existing download description and labels", async () => {
    // Select the interop tab for this server render; render the actual panel.
    const { useState } = await vi.importActual<typeof import("react")>("react");
    const tabState = vi.mocked(React.useState).mockImplementation(
      ((initial: unknown) => useState(initial === "table" ? "interop" : initial)) as typeof React.useState,
    );
    try {
      const markup = render({ view: makeView() });
      expect(markup).toContain("Prepare a file from your current work. Review what it includes and any changes or warnings before downloading. Prepare XLSX makes a new Excel file; the file you opened from is not changed, and your work here still needs Save.");
      expect(markup).toContain(">Prepare CSV</button>");
      expect(markup).toContain(">Prepare XLSX</button>");
    } finally {
      tabState.mockImplementation(useState);
    }
  });

  it("offers Duplicate sheet in the existing context row only when the host can save its copy", () => {
    const contextOf = (markup: string) => markup.match(/<nav class="ts-work-context"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const handler = async () => ({ kind: "confirmed" as const });

    const offered = render({ view: makeView(), onDuplicateTable: handler });
    expect(contextOf(offered)).toContain("Duplicate sheet…");
    expect(contextOf(offered)).toContain("ts-context-commands");
    expect(offered.match(/<button[^>]*>Duplicate sheet…<\/button>/)?.[0]).not.toContain("disabled=");

    const readerOnly = render({ view: makeView() });
    expect(readerOnly).not.toContain("Duplicate sheet…");
  });

  it("keeps Duplicate sheet disabled while busy or while the work is unconfirmed", () => {
    const handler = async () => ({ kind: "confirmed" as const });
    const buttonOf = (markup: string) => markup.match(/<button[^>]*>Duplicate sheet…<\/button>/)?.[0] ?? "";
    expect(buttonOf(render({ view: makeView(), busy: true, onDuplicateTable: handler }))).toContain("disabled=");
    expect(buttonOf(render({ view: makeView(), currentness: "unknown", outcome: "unknown", onDuplicateTable: handler })))
      .toContain("disabled=");
  });

  it("adds Duplicate sheet without changing the grid's own markup", () => {
    const workspaceOf = (markup: string) => markup.slice(markup.indexOf('id="ts-table-workspace"'), markup.indexOf('<footer class="ts-workspace-footer"'));
    const base = render({ view: makeView() });
    const offered = render({ view: makeView(), onDuplicateTable: async () => ({ kind: "confirmed" }) });
    expect(workspaceOf(offered)).toBe(workspaceOf(base));
  });

  it("keeps Refresh available when a replacement opened without a confirmed projection", () => {
    const markup = render({ currentness: "unknown", outcome: "unknown" });
    expect(markup).toContain('aria-label="Recovery"');
    expect(markup).toContain("Refresh required");
    expect(chipText(markup, "currentness")).toBe("Needs refresh");
    expect(chipText(markup, "operation-outcome")).toBe("Outcome needs review");
    expect(markup).toMatch(/<button[^>]*class="ts-button"[^>]*>Refresh<\/button>/);
    expect(markup).toContain("Close and abandon recovery");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Refresh<\/button>/);
    expect(markup).not.toContain("could not be opened");
  });

  it("does not render an empty idle outcome chip during recovery", () => {
    const markup = render({ currentness: "unknown", outcome: "idle" });
    expect(chipText(markup, "currentness")).toBe("Needs refresh");
    expect(chipText(markup, "operation-outcome")).toBe(null);
    expect(chipText(markup, "persistence-status")).toBe(null);
    expect(markup).not.toContain('data-testid="operation-outcome"');
  });

  it("shows known unsaved work alongside recovery without replacing the other status", () => {
    const markup = render({ currentness: "unknown", outcome: "idle", dirty: true });
    expect(chipText(markup, "currentness")).toBe("Needs refresh");
    expect(chipText(markup, "persistence-status")).toBe("Not saved yet");
    expect(chipText(markup, "operation-outcome")).toBe(null);

    const unknownMutation = render({ currentness: "unknown", outcome: "unknown", dirty: true });
    expect(chipText(unknownMutation, "persistence-status")).toBe("Not saved yet");
    expect(chipText(unknownMutation, "operation-outcome")).toBe("Outcome needs review");
    expect(unknownMutation).not.toContain("change was applied");

    const cleanReplacement = render({ currentness: "unknown", outcome: "unknown", dirty: false });
    expect(chipText(cleanReplacement, "persistence-status")).toBe(null);
    expect(cleanReplacement).not.toContain("Not saved yet");
    expect(cleanReplacement).not.toContain("Edited — not saved");

    const ordinaryHome = render({ currentness: "current", dirty: true });
    expect(chipText(ordinaryHome, "persistence-status")).toBe(null);
    expect(ordinaryHome).not.toContain("Not saved yet");
  });

  it("does not render an editable stale workbook during published recovery", () => {
    const markup = render({
      view: null,
      dirty: false,
      currentness: "unknown",
      outcome: "unknown",
      copies: [{ name: "copy", savedAt: "now" }],
    });
    expect(markup).not.toContain('data-testid="cell-editor"');
    expect(markup).toContain('aria-label="Recovery"');
    expect(markup).toMatch(/<button[^>]*class="ts-button"[^>]*>Refresh<\/button>/);
    expect(markup).toContain("Close and abandon recovery");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Refresh<\/button>/);
    expect(markup).toContain('class="ts-button ts-home-file-action ts-home-file-action--disabled" aria-disabled="true"');
    expect(markup).toContain('data-testid="open-project" type="file" multiple="" disabled=""');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Open release plan example"[^>]*>Open<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Open saved copy"/);
    expect(markup).not.toContain('data-testid="project-ready"');
    expect(markup).not.toContain("Save a copy");
  });
});

describe("focused Results reveal geometry", () => {
  it("moves the nearest edge with focus-ring clearance and leaves visible targets alone", () => {
    const scrollport = { top: 171, bottom: 729 };
    expect(focusRevealScrollDelta({ top: 790, bottom: 834 }, scrollport)).toBe(109);
    expect(focusRevealScrollDelta({ top: 300, bottom: 340 }, scrollport)).toBe(0);
    expect(focusRevealScrollDelta({ top: 100, bottom: 140 }, scrollport)).toBe(-75);
  });

  it("clamps movement and rejects a stale focus, detached target, or replaced composition", () => {
    expect(focusRevealNextScrollTop(0, 109, 145)).toBe(109);
    expect(focusRevealNextScrollTop(140, 109, 145)).toBe(145);
    expect(focusRevealNextScrollTop(10, -75, 145)).toBe(0);
    const current = { targetConnected: true, targetIsActive: true, compositionConnected: true, compositionIsCurrent: true };
    expect(focusRevealStillCurrent(current)).toBe(true);
    expect(focusRevealStillCurrent({ ...current, targetIsActive: false })).toBe(false);
    expect(focusRevealStillCurrent({ ...current, targetConnected: false })).toBe(false);
    expect(focusRevealStillCurrent({ ...current, compositionConnected: false })).toBe(false);
    expect(focusRevealStillCurrent({ ...current, compositionIsCurrent: false })).toBe(false);
  });
});

describe("projection access", () => {
  it("uses the projected entity and falls back to the row id", () => {
    const view = makeView();
    expect(rowEntity(view.table.rows[0]!)).toBe(entityA);
    expect(rowEntity({ id: "row-only", key: "k", fields: [] })).toBe("row-only");
  });

  it("identifies the notes field by the actual column key, not a guessed id", () => {
    const view = makeView();
    const columns = tableColumns(view.table);
    const notes = notesFieldFor(view.table.rows[0]!, columns);
    expect(notes?.target.field).toBe("c-notes");
    expect(notesFieldFor(view.table.rows[0]!, [{ id: "other", key: "title", display_name: "title", field_type: "text", required: true }])).toBe(null);
  });

  it("falls back to the row field order when no column list is projected", () => {
    const view = makeView({ columns: false });
    expect(tableColumns(view.table).map((column) => column.id)).toEqual([
      "c-title",
      "c-impact",
      "c-priority",
      "c-notes",
    ]);
  });
});

describe("SheetShell static rendering", () => {
  it("shows the row capacity warning at 80 percent and hides it at 50 percent", () => {
    const view = makeView();
    const warning = render({ view, capacity: { rows: 80, maximum: 100 } });
    expect(warning).toContain('<span class="ts-capacity-warn">80 of 100 rows</span> · 4 columns');

    const ordinary = render({ view, capacity: { rows: 50, maximum: 100 } });
    expect(ordinary).not.toContain("ts-capacity-warn");
    expect(ordinary).toContain("2 rows · 4 columns");
  });

  it("starts Other ways with New table and preserves the existing file/example entries", () => {
    const markup = render({ onNewTable: async () => true });
    const otherWays = markup.slice(markup.indexOf('aria-label="Other ways to start"'));
    expect(otherWays).toContain("Start an empty table with your own columns.");
    expect(otherWays).toContain(">New table…</button>");
    expect(otherWays.indexOf("<strong>New table</strong>")).toBeLessThan(otherWays.indexOf("<strong>Open a Tachiko work file</strong>"));
  });

  it("offers column authoring only when the host can save its result", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    const withWriter = render({ view, onAddColumn: async () => ({ kind: "confirmed" }), onRenameColumn: async () => ({ kind: "confirmed" }), onRemoveColumn: async () => ({ kind: "confirmed" }) });
    expect(withWriter).toContain('data-column-action="+ column"');
    expect(withWriter).toContain("Column actions for ");
    // Reader-only/rollback hosts pass no column handlers: view actions remain,
    // but no authoring action; the header remains focusable for its menu.
    const readerOnly = render({ view });
    expect(readerOnly).toContain('data-column-action="Sort A → Z"');
    expect(readerOnly).toContain('data-column-action="Filter…"');
    expect(readerOnly).not.toContain('data-column-action="+ column"');
    expect(readerOnly).not.toContain('data-column-action="Rename…"');
    expect(readerOnly).not.toContain('data-column-action="Remove…"');
    expect(readerOnly).toContain('class="ts-col-head" tabindex="0"');
  });

  it.each([false, true])("requiredness actions follow native scalar declarations (compact=%s)", compact => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: compact }) });
    try {
      const view = makeView();
      view.table.native_table_profile = true;
      const onSetColumnRequiredness = async () => ({ kind: "confirmed" as const });
      for (const type of ["text", "number", "date", "boolean"]) {
        for (const column of view.table.columns) { column.field_type = type; column.required = false; }
        const markup = render({ view, onSetColumnRequiredness });
        expect(markup.includes("Require a value")).toBe(true);
      }
      for (const column of view.table.columns) { column.field_type = "text"; column.required = true; }
      expect(render({ view, onSetColumnRequiredness })).toContain("Allow blanks");
      view.table.native_table_profile = false;
      expect(render({ view, onSetColumnRequiredness })).not.toContain("Allow blanks");
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])("rule action follows native Text/Number declarations (compact=%s)", compact => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: compact }) });
    try {
      const view = makeView();
      view.table.native_table_profile = true;
      const onSetColumnConstraint = async () => ({ kind: "confirmed" as const });
      const ruleAction = compact ? "Rule for “" : 'data-column-action="Rule…"';
      for (const type of ["text", "number", "date", "boolean"]) {
        for (const column of view.table.columns) column.field_type = type;
        const markup = render({ view, onSetColumnConstraint });
        expect(markup.includes(ruleAction)).toBe(type === "text" || type === "number");
      }
      for (const column of view.table.columns) column.field_type = "text";
      view.table.native_table_profile = false;
      expect(render({ view, onSetColumnConstraint })).not.toContain(ruleAction);
      view.table.native_table_profile = true;
      expect(render({ view })).not.toContain(ruleAction);
    } finally { vi.unstubAllGlobals(); }
  });

  it("offers Number format only for number columns with a native writer", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    const onSetColumnNumberFormat = async () => ({ kind: "confirmed" as const });
    for (const column of view.table.columns) {
      column.field_type = column.id === "c-impact" ? "number" : "text";
    }
    const markup = render({ view, onSetColumnNumberFormat });
    expect(markup).toContain('aria-label="Number format…"');
    expect(markup.match(/data-column-action="Number format…"/g)).toHaveLength(1);
    expect(render({ view })).not.toContain("Number format…");
    view.table.native_table_profile = false;
    expect(render({ view, onSetColumnNumberFormat })).not.toContain("Number format…");
  });

  it("offers one compact Column menu with column handlers alone and no interactive headers", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    try {
      const view = makeView();
      view.table.native_table_profile = true;
      const markup = render({ view, onAddColumn: async () => ({ kind: "confirmed" }), onRenameColumn: async () => ({ kind: "confirmed" }), onRemoveColumn: async () => ({ kind: "confirmed" }) });
      const header = markup.slice(markup.indexOf("<thead>"), markup.indexOf("</thead>"));
      expect(header).not.toMatch(/<button|<summary|tabindex=/);
      expect(markup).toContain('aria-label="Column"');
      expect(markup).toContain("Rename “title”…");
      expect(markup).toContain("Remove “title”…");
      expect(markup).toContain("Add column…");
      // The Column menu is view-only at heart: it stays without handlers or
      // native editing, but shows only sort and filter there.
      const viewOnly = render({ view });
      expect(viewOnly).toContain('aria-label="Column"');
      expect(viewOnly).toContain("Sort A → Z");
      expect(viewOnly).not.toContain("Add column…");
      view.table.native_table_profile = false;
      const imported = render({ view, onAddColumn: async () => ({ kind: "confirmed" }) });
      expect(imported).toContain('aria-label="Column"');
      expect(imported).not.toContain("Add column…");
      expect(imported).not.toContain("Remove “");
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])("offers imported Rename without changing Add/Remove (compact=%s)", compact => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: compact }) });
    try {
      const view = makeView();
      view.table.native_table_profile = true;
      const props = { view, onAddColumn: async () => ({ kind: "confirmed" as const }), onRenameColumn: async () => ({ kind: "confirmed" as const }), onRemoveColumn: async () => ({ kind: "confirmed" as const }) };
      const native = render(props);
      const imported = render({ ...props, interop: { importInspection: null, cleanupPreview: null, ledger: [], downloadStatus: "idle", downloadError: null, metadata: { version: 1, sheets: [{
        schema_id: view.table.collection.id, name: "Sheet", has_header: true,
        columns: [{ field_id: view.table.columns[0]!.id, name: "Original heading", width: null }], rows: [],
      }] } } });
      expect(native).toContain("Rename");
      expect(imported).toContain("Rename");
      expect(imported.includes('class="ts-col-head" tabindex="0"')).toBe(!compact);
      if (compact) {
        for (const markup of [native, imported]) {
          expect(markup).toContain("Add column…");
          expect(markup).toContain("Remove “");
        }
      } else {
        expect(native).toContain('class="ts-col-head" tabindex="0"');
        for (const markup of [native, imported]) {
          expect(markup).toContain('data-column-action="+ column"');
          expect(markup).toContain('data-column-action="Remove…"');
        }
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("renders a navigable client-only draft row inside the grid", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    const markup = render({ view, onInsertRow: async () => ({ kind: "confirmed", view }) });
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    expect(body).not.toContain("ts-entry-row");
    const footer = markup.slice(markup.indexOf("<tfoot"), markup.indexOf("</tfoot>"));
    expect(footer).toContain('<tfoot role="rowgroup"');
    expect(footer).toContain('class="ts-entry-row"');
    expect(footer).toContain('role="presentation" class="ts-entry-feedback"');
    expect(footer.indexOf('class="ts-entry-row"')).toBeLessThan(footer.indexOf('class="ts-entry-actions"'));
    expect(footer).toContain(`colSpan="${tableColumns(view.table).length + 1}"`);
    expect(footer).toContain('class="ts-entry-actions"');
    expect(markup.indexOf("<tfoot")).toBeGreaterThan(markup.indexOf("</tbody>"));
    expect(markup).toContain('aria-label="New row"');
    expect(markup).toContain(">Add row</button>");
    expect(markup).toContain(">Discard</button>");
  });

  it("renders the projection's column totals without calculating them", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.column_totals = { "c-impact": 1800 };
    const markup = render({ view });
    expect(markup).toContain('<tr class="ts-totals-row" aria-label="Column totals"');
    expect(markup.match(/<tfoot/g)).toHaveLength(1);
    expect(markup).toContain('data-testid="total:c-impact"');
    expect(markup).toContain(">1800</td>");
  });

  it("renders unavailable column totals with an explanation", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.column_totals = { "c-impact": null };
    const markup = render({ view });
    expect(markup).toContain("Unavailable");
    expect(markup).toContain('title="A value in this column has no available result."');
  });

  it("omits the totals row when the projection has no column totals", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    expect(render({ view })).not.toContain("ts-totals-row");
  });

  it.each([127, 128, 8406, 10_000])("offers drafts only below the insertion gate (%i stored rows)", count => {
    const view = makeView();
    view.table.native_table_profile = true;
    view.table.rows = Array.from({ length: count }, (_, i) => ({ ...view.table.rows[0]!, id: `row-${i}`, key: `row-${i}` }));
    const markup = render({ view, onInsertRow: async () => ({ kind: "confirmed", view }) });
    expect(markup.includes('aria-label="New row"')).toBe(count < 10_000);
    expect(markup.includes("This table has reached the 10,000-row limit for adding rows here. Nothing was changed.")).toBe(count >= 10_000);
    if (count > 200) expect(markup).toContain(`aria-rowcount="${count + 1 + Number(count < 10_000)}"`);
    expect(view.table.rows).toHaveLength(count);
  });

  it("reserves windowed scroll height outside the table and leaves small tables intrinsic", () => {
    const view = makeView();
    const seed = view.table.rows[0]!;
    view.table.rows = Array.from({ length: 8406 }, (_, index) => ({ ...seed, id: `row-${index}`, key: `row-${index}` }));
    view.table.collection.entity_count = view.table.rows.length;
    const markup = render({ view });
    expect(markup).toContain('<div class="ts-grid-extent" style="min-height:269024px"><table');
    expect(markup).toContain('aria-rowcount="8407"');
    expect((markup.match(/class="ts-row(?: ts-row--selected)?"/g) ?? []).length).toBe(80);
    const small = render({ view: makeView() });
    expect(small).not.toContain('class="ts-grid-extent"');
    expect(small).toContain('<div class="ts-grid-scroll"><table');
  });

  it("publishes only the completed queued appearance after composition ends", () => {
    const queued = { kind: "built-in", profileId: "minimal-focus", density: "comfortable" } as const;
    expect(shouldPublishAppearanceCompositionEnd(queued, {
      ...appearanceSnapshot,
      selection: queued,
      pendingSelection: null,
      composing: false,
    })).toBe(true);
    expect(shouldPublishAppearanceCompositionEnd(queued, {
      ...appearanceSnapshot,
      pendingSelection: queued,
      composing: true,
    })).toBe(false);
    expect(shouldPublishAppearanceCompositionEnd(queued, {
      ...appearanceSnapshot,
      selection: { kind: "built-in", profileId: "tachiko", density: "compact" },
      pendingSelection: null,
      composing: false,
    })).toBe(false);

    const imported = { kind: "imported", profile: TACHIKO_COMPACT_PORCELAIN_PROFILE } as const;
    expect(shouldPublishAppearanceCompositionEnd(imported, {
      ...appearanceSnapshot,
      selection: { kind: "imported", profile: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE } },
      pendingSelection: null,
      composing: false,
    })).toBe(true);
  });

  it("places the controlled selector in Home and reports preference load notices", () => {
    const markup = render({});
    const homeHeader = markup.slice(markup.indexOf("ts-home-head"), markup.indexOf("</header>"));
    expect(homeHeader).toContain('aria-haspopup="dialog"');
    expect(homeHeader).toContain(">Appearance</button>");
    expect(homeHeader).toContain("Tachiko Sheet");

    const warned = render({ appearancePreference: {
      ...appearancePreference,
      getSnapshot: () => ({ ...appearanceSnapshot, notice: "invalid-preference" }),
    } });
    expect(warned).toContain("Saved appearance could not be loaded. Using Tachiko for this session.");
  });

  it("places Appearance before document commands and outside workbook Views", () => {
    const markup = render({ view: makeView() });
    const headerStart = markup.indexOf("ts-workbook-head");
    const selectorStart = markup.indexOf("ts-appearance-selector", headerStart);
    const commandsStart = markup.indexOf('aria-label="Document commands"', headerStart);
    const viewsStart = markup.indexOf('aria-label="Workbook views"', headerStart);
    expect(selectorStart).toBeGreaterThan(headerStart);
    expect(selectorStart).toBeLessThan(commandsStart);
    expect(commandsStart).toBeLessThan(viewsStart);
  });

  it("places Views above the workspace and table tabs in the stable footer", () => {
    const markup = render({ view: makeView(), currentness: "pending", dirty: true, outcome: "pending" });
    const headerStart = markup.indexOf("ts-workbook-head");
    const contextStart = markup.indexOf("ts-work-context", headerStart);
    const panelStart = markup.indexOf('class="ts-panel');
    expect(markup.slice(headerStart, contextStart)).toContain('data-testid="save-status"');
    expect(markup.slice(headerStart, contextStart)).toContain("Copies: this browser on this device");
    const footerStart = markup.indexOf("ts-workspace-footer");
    expect(panelStart).toBeGreaterThan(contextStart);
    expect(footerStart).toBeGreaterThan(panelStart);
    expect(markup.indexOf("ts-workbook-table-slot")).toBeLessThan(footerStart);
    expect(markup.indexOf("ts-workbook-secondary-slot")).toBeLessThan(footerStart);
    expect(markup.indexOf('aria-label="Workbook views"')).toBeLessThan(panelStart);
    expect(markup.slice(footerStart)).toContain('aria-label="Sheets"');
    expect(markup.slice(footerStart)).toContain("Work:");
    expect(markup.slice(footerStart)).toContain("Values:");
    expect(markup.slice(footerStart)).toContain('data-testid="operation-outcome"');
    expect(markup.slice(footerStart)).toContain("2 rows · 4 columns");
  });

  it("resolves the one-shot Sales focus from the actual Catalog PEN and price projections", () => {
    const view = makeView();
    expect(salesEntryFocusTarget(view, { occurrence: "occ-1", collection: "release_items", field: "price" })).toBe(null);
    expect(salesEntryFocusTarget(view, { occurrence: "other", collection: "release_items", field: "price" })).toBe(null);
    const salesView: WorkbookView = {
      ...view,
      table: {
        ...view.table,
        collection: { ...view.table.collection, key: "catalog" },
        columns: [
          { id: "sku", key: "code", display_name: "code", field_type: "text", required: true },
          { id: "cost", key: "price", display_name: "price", field_type: "number", required: true },
        ],
        rows: [{
          id: "catalog-pen", key: "pen",
          fields: [
            projected("catalog-pen", "sku", { kind: "text", value: "PEN" }),
            projected("catalog-pen", "cost", { kind: "number", value: 800 }),
          ],
        }],
      },
    };
    expect(salesEntryFocusTarget(salesView, { occurrence: "occ-1", collection: "catalog", field: "price" })).toEqual({ entity: "catalog-pen", field: "cost" });
  });

  it("limits the compact landing layout to its exact Sales occurrence, Catalog identity, and three fields", () => {
    const view = makeView();
    const catalogView: WorkbookView = {
      ...view,
      table: { ...view.table, collection: { id: "catalog-identity", key: "catalog", display_name: "catalog", headerless: false, data_start_row: 2, entity_count: 1 }, columns: [
        { id: "code-id", key: "code", display_name: "code", field_type: "text", required: true },
        { id: "category-id", key: "category", display_name: "category", field_type: "text", required: true },
        { id: "price-id", key: "price", display_name: "price", field_type: "number", required: true },
      ] },
    };
    const marker = { occurrence: "occ-1", collectionId: "catalog-identity" };
    expect(salesCatalogLayoutEligible(catalogView, marker)).toBe(true);
    expect(salesCatalogLayoutEligible({ ...catalogView, occurrence: "replacement" }, marker)).toBe(false);
    expect(salesCatalogLayoutEligible({ ...catalogView, table: { ...catalogView.table, collection: { ...catalogView.table.collection, id: "other" } } }, marker)).toBe(false);
    expect(salesCatalogLayoutEligible({ ...catalogView, table: { ...catalogView.table, columns: [...catalogView.table.columns, { id: "fourth", key: "note", display_name: "note", field_type: "text", required: true }] } }, marker)).toBe(false);
  });

  it("renders linked Brief facts with the actual projection identity", () => {
    const view = makeView();
    const markup = renderToStaticMarkup(
      createElement(BriefFacts, {
        entity: entityA,
        occurrence: "occ-1",
        revision: "rev-1",
        currentness: "pending",
        row: view.table.rows[0]!,
        columns: tableColumns(view.table),
      }),
    );
    const impact = cellMarkup(markup, `brief:${entityA}:c-impact`, "</td>");
    expect(impact).not.toBe(null);
    expect(textOf(impact as string)).toBe("5");
    expect(impact).toContain(`data-work-entity="${entityA}"`);
    expect(impact).toContain('data-work-occurrence="occ-1"');
    expect(impact).toContain('data-work-revision="rev-1"');
    expect(impact).toContain('data-work-currentness="pending"');
    expect(impact).toContain("ts-fact-value--numeric");
    expect(markup).not.toContain(">entity-a<");
    expect(markup).not.toContain(">entity-b<");
    expect(markup).toContain("<th scope=\"col\">Column</th><th scope=\"col\">Value</th>");
    expect(textOf(cellMarkup(markup, `brief:${entityA}:c-notes`, "</td>") as string)).toBe("first note");
    expect(cellMarkup(markup, `brief:${entityA}:c-title`, "</td>")).not.toContain("ts-fact-value--numeric");
    expect(cellMarkup(markup, `brief:${entityA}:c-priority`, "</td>")).toContain("ts-fact-value--numeric");
    expect(cellMarkup(markup, `brief:${entityB}:c-impact`, "</td>")).toBe(null);
  });

  it("renders the canonical Home proposition and orders saved copies newest first", () => {
    const older = "2026-09-12T10:00:00.000Z";
    const newer = "2026-09-13T10:00:00.000Z";
    const markup = render({ copies: [
      { name: "review-copy", savedAt: older },
      { name: "latest-copy", savedAt: newer },
    ] });
    expect(markup).toContain('data-testid="open-project"');
    expect(markup).toContain("webkitdirectory");
    expect(markup).toContain("Change a value, and the summaries and charts that use it update.");
    expect(markup).toContain("Sales and catalog");
    expect(markup).toContain("Open sales example");
    expect(markup).toContain('aria-label="Catalog prices times Sales quantities gives Sales by product"');
    expect(markup).toContain('class="ts-home-flow-icon" viewBox="0 0 16 16"');
    expect(markup).toContain('class="ts-home-flow-icon ts-home-flow-icon--chart"');
    expect(markup).toContain("Import a CSV or Excel file");
    expect(markup).toContain("You check the columns and their types before anything is added. Up to 32 sheets of 32 columns and 128 rows each (1,024 rows in all). One plain sheet without formulas can hold up to 8,406 rows and 25,218 cells. CSV text or Excel files up to 2 MB; an Excel file can unpack to at most 8 MB. Larger plain sheets also have a 1 MB limit on cell text. Some styles and features are not imported.");
    expect(markup).toContain("Open a project folder");
    expect(markup).toContain("Release plan example");
    expect(markup).toContain("Choose file…");
    expect(markup).toContain("Choose folder…");
    expect(markup).toContain("Saved in this browser on this device.");
    expect(markup).toContain("Open saved review-copy");
    expect(markup).toContain("Open saved latest-copy");
    const latestTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(newer));
    expect(markup).toContain(`Saved 13 September 2026, ${latestTime}`);
    expect(markup.indexOf("latest-copy")).toBeLessThan(markup.indexOf("review-copy"));
    expect(markup).not.toContain('data-testid="project-ready"');
  });

  it("keeps the Home visible but locks work actions during startup unavailability", () => {
    const markup = render({ startupUnavailable: true, message: "private runtime failure detail" });
    expect(markup).toContain("Tachiko couldn’t start in this browser");
    expect(markup).toContain("Examples, files and saved copies can’t be opened until it starts.");
    expect(markup).not.toContain("private runtime failure detail");
    expect(markup).toContain(">Reload page</button>");
    expect(markup).toContain("Open sales example");
    expect(markup).toContain("Other ways to start");
    expect(markup).toContain("Saved copies");
    expect(markup).toContain('type="file" accept=".csv,.xlsx');
    expect(markup).toContain('data-testid="open-project"');
    expect(markup.match(/<button[^>]*>Open<\/button>/)?.[0]).toContain("disabled=");
    expect(markup.match(/<button[^>]*>Open sales example<\/button>/)?.[0]).toContain("disabled=");
    expect(markup.match(/<button[^>]*>Reload page<\/button>/)?.[0]).not.toContain("disabled=");
    expect(markup).not.toContain(">Refresh</button>");
  });

  it("does not expose stale saved rows while inventory is checking or unavailable", () => {
    const copies = [{ name: "old-copy", savedAt: "2026-09-12T10:00:00.000Z" }];
    const checking = render({ copies, copiesStatus: "checking" });
    expect(checking).toContain("Checking saved copies…");
    expect(checking).not.toContain("Open saved old-copy");
    const unavailable = render({ copies, copiesStatus: "unavailable" });
    expect(unavailable).toContain("Saved copies couldn’t be read.");
    expect(unavailable).toContain("Try again");
    expect(unavailable).toContain("ts-home-copy-unavailable-icon");
    expect(unavailable).not.toContain("Open saved old-copy");
    const empty = render({ copies: [], copiesStatus: "ready" });
    expect(empty).toContain("No saved copies yet");
  });

  it("keeps an unknown publication on the visible Home with only Recovery actions enabled", () => {
    const markup = render({ currentness: "unknown", message: "private runtime failure detail" });
    expect(markup).toContain("Tachiko Sheet");
    expect(markup).toContain("Change a value, and the summaries and charts that use it update.");
    expect(markup).toContain("Refresh required");
    expect(markup).toContain(">Refresh</button>");
    expect(markup).toContain("Close and abandon recovery");
    expect(markup.match(/<button[^>]*>Open sales example<\/button>/)?.[0]).toContain("disabled=");
    expect(markup.match(/<button[^>]*>Open<\/button>/)?.[0]).toContain("disabled=");
  });

  it("preserves accepted unbroken and CJK saved names on their dedicated Home action", () => {
    const names = ["x".repeat(160), "保存された作業".repeat(32)];
    const markup = render({ copies: names.map((name) => ({ name, savedAt: "2026-09-12T10:00:00.000Z" })) });
    for (const name of names) {
      expect(markup).toContain(`Open saved ${name}`);
      expect(markup).toContain('class="ts-home-copy-action"');
    }
  });

  it("describes only name whitespace whose rendered or accessible identity can collapse", () => {
    expect(describeSavedCopyNameWhitespace("Plan review")).toBe(null);
    expect(describeSavedCopyNameWhitespace(" Plan"))
      .toBe("Name contains a space at character 1.");
    expect(describeSavedCopyNameWhitespace("Plan "))
      .toBe("Name contains a space at character 5.");
    expect(describeSavedCopyNameWhitespace("Plan  review"))
      .toBe("Name contains 2 consecutive spaces starting at character 5.");
    expect(describeSavedCopyNameWhitespace("A \tB"))
      .toBe("Name contains a space at character 2, and a tab at character 3.");
    expect(describeSavedCopyNameWhitespace("A\u00a0B"))
      .toBe("Name contains a no-break space at character 2.");
    expect(describeSavedCopyNameWhitespace("A\u2002B"))
      .toBe("Name contains an en space at character 2.");
    expect(describeSavedCopyNameWhitespace("x😀\u00a0y"))
      .toBe("Name contains a no-break space at character 3.");
    expect(describeSavedCopyNameWhitespace("Plan\u200breview"))
      .toBe("Name contains a zero-width space (U+200B, format character) at character 5.");
    expect(describeSavedCopyNameWhitespace("Sol1b59adf Plan\u200breview"))
      .toBe("Name contains a zero-width space (U+200B, format character) at character 16.");
    expect(describeSavedCopyNameWhitespace("A\u0000\u007fB"))
      .toBe("Name contains a control character (U+0000, control character) at character 2, and a delete control (U+007F, control character) at character 3.");
    expect(describeSavedCopyNameWhitespace("A\u0001\u0001B"))
      .toBe("Name contains 2 consecutive control characters (U+0001, control character) starting at character 2.");
    expect(describeSavedCopyNameWhitespace("A\u0080B"))
      .toBe("Name contains a control character (U+0080, control character) at character 2.");
    expect(describeSavedCopyNameWhitespace("A\u202eB"))
      .toBe("Name contains a right-to-left override (U+202E, format character) at character 2.");
    expect(describeSavedCopyNameWhitespace("A\u200c\u200dB"))
      .toBe("Name contains a zero-width non-joiner (U+200C, format character) at character 2, and a zero-width joiner (U+200D, format character) at character 3.");
    expect(describeSavedCopyNameWhitespace("A\u00ad\u034fB"))
      .toBe("Name contains a soft hyphen (U+00AD, format character) at character 2, and a combining grapheme joiner (U+034F, default-ignorable character) at character 3.");
    expect(describeSavedCopyNameWhitespace("A\ufe0fB"))
      .toBe("Name contains an emoji variation selector (U+FE0F, default-ignorable character) at character 2.");
    expect(describeSavedCopyNameWhitespace("😀\u{e0100}x"))
      .toBe("Name contains a supplementary variation selector (U+E0100, default-ignorable character) at character 2.");
    expect(describeSavedCopyNameWhitespace("x\u{e0067}\u{e007f}y"))
      .toBe("Name contains a tag character (U+E0067, format character) at character 2, and a tag character (U+E007F, format character) at character 3.");
    expect(describeSavedCopyNameWhitespace("A\u0600B"))
      .toBe("Name contains an Arabic number sign (U+0600, format character) at character 2.");
    expect(describeSavedCopyNameWhitespace("A\u2063B"))
      .toBe("Name contains a format character (U+2063, format character) at character 2.");
    expect(describeSavedCopyNameWhitespace("x\u3164y"))
      .toBe("Name contains a Hangul filler (U+3164, default-ignorable character) at character 2.");
    expect(describeSavedCopyNameWhitespace("😀\u115f"))
      .toBe("Name contains a default-ignorable character (U+115F, default-ignorable character) at character 2.");
    expect(describeSavedCopyNameWhitespace("x😀\u200b\u200by"))
      .toBe("Name contains 2 consecutive zero-width spaces (U+200B, format character) starting at character 3.");
    expect(describeSavedCopyNameWhitespace("A \u200bB"))
      .toBe("Name contains a space at character 2, and a zero-width space (U+200B, format character) at character 3.");
    expect(describeSavedCopyNameWhitespace("Cafe\u0301 保存🙂🏽")).toBe(null);

    const markup = render({
      busy: true,
      copies: [
        { name: "Plan review", savedAt: "2026-09-12T10:00:00.000Z" },
        { name: "Plan  review", savedAt: "2026-09-12T10:00:00.000Z" },
        { name: "A\u00a0B", savedAt: "2026-09-12T10:00:00.000Z" },
      ],
    });
    expect(markup).toContain("Open saved Plan  review");
    const whitespaceButton = markup.match(/<button[^>]*aria-label="Open saved Plan  review"[^>]*>/)?.[0];
    expect(whitespaceButton).toBeDefined();
    const describedBy = whitespaceButton?.match(/aria-describedby="([^"]+)"/)?.[1]?.split(" ") ?? [];
    expect(describedBy).toHaveLength(2);
    expect(markup).toContain(`id="${describedBy[0]}" role="note">An operation is in progress`);
    expect(markup).toContain(`id="${describedBy[1]}"`);
    expect(markup).toContain("Name contains 2 consecutive spaces starting at character 5.");
    const descriptionIds = [...markup.matchAll(/<span class="ts-visually-hidden" id="([^"]+)">/g)].map((match) => match[1]);
    expect(descriptionIds).toHaveLength(2);
    expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
    expect(descriptionIds.some((id) => id.includes("Plan") || id.includes("A\u00a0B"))).toBe(false);
  });

  it("formats saved metadata through actual non-whole-hour local timezones", () => {
    const priorTimezone = process.env.TZ;
    const savedAt = "2026-09-12T20:00:00.000Z";
    try {
      process.env.TZ = "Asia/Kolkata";
      expect(new Date(savedAt).getTimezoneOffset()).toBe(-330);
      expect(render({ copies: [{ name: "Kolkata", savedAt }] }))
        .toContain("Saved 13 September 2026, 01:30");

      process.env.TZ = "Asia/Kathmandu";
      expect(new Date(savedAt).getTimezoneOffset()).toBe(-345);
      expect(render({ copies: [{ name: "Kathmandu", savedAt }] }))
        .toContain("Saved 13 September 2026, 01:45");
    } finally {
      if (priorTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = priorTimezone;
    }
  });

  it("renders table cells keyed by entity and field with occurrence/revision/entity/currentness", () => {
    const markup = render({ view: makeView() });
    const cell = cellMarkup(markup, `cell:${entityA}:c-impact`);
    expect(cell).not.toBe(null);
    expect(textOf(cell as string)).toBe("5");
    expect(cell).toContain('data-work-occurrence="occ-1"');
    expect(cell).toContain('data-work-revision="rev-1"');
    expect(cell).toContain(`data-work-entity="${entityA}"`);
    expect(cell).toContain('data-work-currentness="current"');
    expect(textOf(cellMarkup(markup, `cell:${entityA}:c-priority`) as string)).toBe("10");
    expect(textOf(cellMarkup(markup, `cell:${entityB}:c-priority`) as string)).toBe("Unavailable");
    expect(markup).toContain('data-testid="project-ready"');
    expect(markup).toContain("Table");
    expect(markup).toContain("Brief");
    expect(markup).not.toContain("brief:");
    expect(markup).not.toContain("Decision notes");
  });

  it("describes the client-only sort and filter status in one line", () => {
    const columns = tableColumns(makeView().table);
    expect(rowViewStatusText(columns, {}, 2, 2)).toBe(null);
    expect(rowViewStatusText(columns, { sort: { field: "c-impact", direction: "desc" } }, 2, 2))
      .toBe("Sorted by impact ↓");
    expect(rowViewStatusText(columns, { filters: [{ field: "c-title", kind: "contains", text: "alpha" }] }, 12, 40))
      .toBe("Showing 12 of 40 rows");
    expect(rowViewStatusText(columns, {
      sort: { field: "c-title", direction: "asc" },
      filters: [{ field: "c-title", kind: "contains", text: "alpha" }],
    }, 12, 40)).toBe("Sorted by title ↑ · Showing 12 of 40 rows");
  });

  it.each([false, true])("keeps sort and filter on a table without native editing (compact=%s)", compact => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: compact }) });
    try {
      const view = makeView();
      view.table.native_table_profile = false;
      const markup = render({
        view,
        onAddColumn: async () => ({ kind: "confirmed" }),
        onRenameColumn: async () => ({ kind: "confirmed" }),
        onRemoveColumn: async () => ({ kind: "confirmed" }),
        onSetColumnRequiredness: async () => ({ kind: "confirmed" }),
      });
      expect(markup).toContain("Sort A → Z");
      expect(markup).toContain("Sort Z → A");
      expect(markup).toContain("Filter…");
      // Schema and requiredness mutations stay native-only.
      expect(markup).not.toContain("Add column…");
      expect(markup).not.toContain('data-column-action="+ column"');
      expect(markup).not.toContain('data-column-action="Rename…"');
      expect(markup).not.toContain('data-column-action="Remove…"');
      expect(markup).not.toContain("Rename “");
      expect(markup).not.toContain("Remove “");
      expect(markup).not.toContain("Require a value");
      expect(markup).not.toContain("Allow blanks");
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps the stored row order and shows no view status without sort or filter", () => {
    const view = makeView();
    const markup = render({ view });
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    expect(body.indexOf(`data-work-entity="${entityA}"`)).toBeLessThan(body.indexOf(`data-work-entity="${entityB}"`));
    expect(markup).not.toContain('data-testid="row-view-status"');
    expect(markup).not.toContain(">Clear sort</button>");
    expect(markup).not.toContain(">Clear filter</button>");
    expect(markup).not.toContain("ts-column-view-marker");
  });

  it("renders cells from the field order when the projection has no columns", () => {
    const markup = render({ view: makeView({ columns: false }) });
    expect(cellMarkup(markup, `cell:${entityA}:c-impact`)).not.toBe(null);
  });

  it("describes blanks and empty Text while decorating only optional stored empty Text", () => {
    const view = makeView();
    view.table.columns = [
      { id: "optional", key: "optional", display_name: "Optional", field_type: "text", required: false },
      { id: "required", key: "required", display_name: "Required", field_type: "text", required: true },
      { id: "date", key: "date", display_name: "Date", field_type: "date", required: false },
      { id: "boolean", key: "boolean", display_name: "Paid", field_type: "boolean", required: false },
    ];
    view.table.rows = [
      { id: entityA, key: "a", blank_fields: ["optional", "date", "boolean"], fields: [projected(entityA, "required", { kind: "text", value: "" })] },
      { id: entityB, key: "b", fields: [projected(entityB, "optional", { kind: "text", value: "" }), projected(entityB, "required", { kind: "text", value: "" })] },
    ];
    const markup = render({ view });
    const marker = cellMarkup(markup, `cell:${entityB}:optional`)!;
    expect(marker).toContain('ts-cell--empty-text');
    expect(marker).toContain('aria-description="Empty text"');
    expect(marker).not.toContain('title="Empty text"');
    expect(marker).toContain('<span class="ts-cell-value" aria-hidden="true">&quot;&quot;</span>');
    for (const id of ["optional", "date", "boolean"]) {
      const blank = cellMarkup(markup, `cell:${entityA}:${id}`)!;
      expect(blank).toContain('aria-description="Blank"');
      expect(blank).not.toContain('title="Blank"');
      expect(textOf(blank)).toBe("");
      expect(blank).not.toContain('ts-cell--empty-text');
    }
    const required = cellMarkup(markup, `cell:${entityB}:required`)!;
    expect(required).toContain('aria-description="Empty text"');
    expect(required).not.toContain('ts-cell--empty-text');
    expect(textOf(required)).toBe("");
    expect(cellMarkup(markup, `cell:${entityB}:date`)).not.toContain('aria-description="Blank"');
  });

  it("renders diagnostic long Latin and CJK cells with complete combined titles", () => {
    const values = [
      "Review partner brief and confirm ownership, launch timing, and rollback notes for the next release",
      "檢查鍵盤導覽、窄視窗水平捲動，以及長文字欄位的完整值存取體驗",
    ];
    for (const value of values) {
      const markup = render({ view: makeView({ titleValue: value, titleDiagnostic: true }) });
      const cell = cellMarkup(markup, `cell:${entityA}:c-title`);
      expect(cell).not.toBe(null);
      expect(cell).toContain('class="ts-cell ts-cell--warning"');
      expect(cell).toContain(`title="stale: revision too old — ${value}"`);
      expect(textOf(cell as string)).toBe(value);
    }
  });

  it("never claims a save that did not happen", () => {
    const unsaved = render({ view: makeView() });
    expect(chipText(unsaved, "save-status")).toBe("Not saved yet");
    const failed = render({ view: makeView(), saveStatus: "failed" });
    expect(chipText(failed, "save-status")).toBe("Save failed");
    expect(failed).not.toContain("Saved on this device");
    expect(render({ view: makeView(), saveStatus: "saving" })).not.toContain("Saved on this device");
    const saved = render({ view: makeView(), saveStatus: "saved" });
    expect(chipText(saved, "save-status")).toBe("Saved on this device");
  });

  it("distinguishes unchanged work from edited unsaved work", () => {
    const unchanged = render({ view: makeView(), dirty: false });
    expect(chipText(unchanged, "work-state")).toBe("Unchanged");
    expect(unchanged).toContain('data-work-state="unchanged"');
    const edited = render({ view: makeView(), dirty: true });
    expect(chipText(edited, "work-state")).toBe("Edited — not saved");
    expect(edited).toContain('data-work-state="edited"');
    const initialSales = render({ view: makeView(), dirty: true, salesInitialNotSaved: true });
    expect(chipText(initialSales, "work-state")).toBe("Not saved yet");
    expect(initialSales).toContain('data-work-state="edited"');
    const initialWorkChip = initialSales.slice(initialSales.indexOf('data-testid="work-state"') - 120, initialSales.indexOf('data-testid="work-state"'));
    expect(initialWorkChip).toContain("ts-chip--unchanged");
    expect(initialWorkChip).not.toContain("ts-chip--edited");
  });

  it("renders occurrence-bound Results cards and hides their values during global recovery", () => {
    const view = makeView();
    const report = { definitionId: "summary-1", type: "bar" as const, title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false };
    const current = render({
      view,
      dirty: true,
      j4DefinitionIds: ["summary-1"],
      j4Results: [{ definitionId: "summary-1", revision: "rev-1", groups: [{ category: "PEN", value: 800 }], diagnostics: [] }],
      report,
      salesEntryTip: { occurrence: "occ-1", collection: "release_items", field: "price" },
      salesInitialNotSaved: true,
    });
    expect(current).toContain('role="region" aria-label="Results"');
    expect(current).toContain('data-result-state="H"');
    expect(current).toContain("Sales by product");
    expect(current).toContain(">PEN<");
    expect(current).toContain(">800<");
    expect(current).toContain("Not saved yet");
    expect(current).toContain('data-testid="work-state"');
    expect(current).toContain('data-testid="save-status">Not saved yet</span>');
    expect(current).toContain("Change the PEN price. Sales by product updates on the right.");
    expect(current).toContain("<strong>Try it</strong>");
    const salesTipMarkup = current.slice(current.indexOf('data-testid="sales-tip"'), current.indexOf('aria-label="Results"'));
    expect(salesTipMarkup).not.toContain("Not saved yet");
    expect(current.indexOf('data-testid="sales-tip"')).toBeLessThan(current.indexOf('aria-label="Results"'));
    const resultsHeader = current.slice(current.indexOf('class="ts-results-heading"'), current.indexOf('class="ts-result-cards"'));
    expect(resultsHeader).toContain(">Hide results</button>");
    expect(current.indexOf('aria-label="Sales by product values"')).toBeLessThan(current.indexOf("ts-mini-chart-region"));
    expect(current).toContain("The chart is shown in Report.");
    const unknown = render({
      view, currentness: "unknown", outcome: "unknown", j4DefinitionIds: ["summary-1"],
      j4Results: [{ definitionId: "summary-1", revision: "rev-1", groups: [{ category: "PEN", value: 800 }], diagnostics: [] }],
    });
    expect(unknown).toContain('data-result-state="G"');
    expect(unknown).not.toContain(">800<");
    expect(unknown).toContain("These results can’t be confirmed. Use Refresh in the header to read the work again.");
  });

  it("uses the approved Sales tip copy for confirmed, pending, attention, and refresh states", () => {
    const base = {
      view: makeView(),
      j4DefinitionIds: ["summary-1"],
      j4Results: [summaryResult("summary-1", 800)],
      report: { definitionId: "summary-1", type: "bar" as const, title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false },
      salesEntryTip: { occurrence: "occ-1", collection: "release_items", field: "price" },
    };
    const updated = render({ ...base, salesExampleChanged: true });
    expect(updated).toContain("<strong>Updated</strong>");
    expect(updated).toContain("Sales by product includes your change. Save a copy to keep it.");

    const updating = render({ ...base, currentness: "pending" });
    expect(updating).toContain("<strong>Updating</strong>");
    expect(updating).toContain("Wait for confirmation before editing.");

    const attention = render({ ...base, j4Results: [{ ...summaryResult("summary-1", 800), diagnostics: [{ code: "stale", entity: null, field: null, lookup_key: null, candidates: [] }] }] });
    expect(attention).toContain("<strong>Needs attention</strong>");
    expect(attention).toContain("Check Results for the next step.");

    const refresh = render({ ...base, currentness: "unknown" });
    expect(refresh).toContain("<strong>Needs refresh</strong>");
    expect(refresh).toContain("Values could not be confirmed. Refresh first.");
  });

  it("marks unknown outcomes and freshness instead of presenting values as current", () => {
    expect(chipText(render({ view: makeView() }), "operation-outcome")).toBe(null);
    const markup = render({ view: makeView(), outcome: "unknown", currentness: "unknown" });
    expect(chipText(markup, "operation-outcome")).toBe("Outcome needs review");
    expect(chipText(markup, "currentness")).toBe("Needs refresh");
    expect(cellMarkup(markup, `cell:${entityA}:c-impact`)).toContain('data-work-currentness="unknown"');
    expect(markup).toContain("These values could not be confirmed");
    expect(markup).not.toContain("Saved on this device");
  });

  it("exposes currentness with text and a matching non-color state hook", () => {
    for (const [currentness, label] of [["current", "Up to date"], ["pending", "Updating…"], ["unknown", "Needs refresh"]] as const) {
      const markup = render({ view: makeView(), currentness });
      expect(chipText(markup, "currentness")).toBe(label);
      expect(markup).toContain(`class="ts-chip ts-chip--${currentness}"`);
    }
  });

  it("keeps internal revision, collection, and row identities out of normal chrome", () => {
    const markup = render({ view: makeView() });
    expect(markup).toContain("2 rows");
    // The header row is row 1, so the first data row head reads 2.
    expect(markup).toContain(">2</th>");
    expect(markup).not.toContain("release_items ·");
    expect(markup).not.toContain("revision rev-1");
    expect(markup).not.toContain("playtest_notes");
    expect(markup).not.toContain('title="number"');
    // Entity/revision values remain in data-* witnesses for acceptance and
    // recovery tooling; only visible chrome must stay free of them.
    expect(markup).toContain('data-work-entity="entity-a"');
  });

  it("surfaces a single alert only when there is a message", () => {
    expect(render({ view: makeView() })).not.toContain('role="alert"');
    const markup = render({ view: makeView(), message: "the work rejected that value" });
    expect(markup.split('role="alert"').length - 1).toBe(1);
    expect(markup).toContain("the work rejected that value");
  });

  it("disables opening while an operation is in progress and explains why", () => {
    const markup = render({ busy: true });
    expect(markup).toContain("Opening…");
    expect(markup).toContain("An operation is in progress");
    expect(markup).toContain("disabled");
  });

  it("keeps report readiness across table selection but resets it for source changes and removal", () => {
    const report = {
      definitionId: "definition-1",
      type: "bar" as const,
      title: "Saved report",
      categoryLabel: "Category",
      valueLabel: "Value",
      legendVisible: true,
    };
    const result: KeyedGroupedSumResult = {
      definitionId: "definition-1",
      revision: "rev-1",
      groups: [{ category: "Alpha", value: 3 }],
      diagnostics: [],
    };
    const view = { occurrence: "occ-1", revision: "rev-1" };
    const ready = reportRenderResetKey(view, report, [result], "current");
    expect(reportRenderResetKey(view, report, [result], "current")).toBe(ready);
    expect(reportRenderResetKey({ ...view, revision: "rev-2" }, report, [result], "current")).not.toBe(ready);
    expect(reportRenderResetKey(view, report, [], "current")).not.toBe(ready);
    expect(reportRenderResetKey(view, null, [result], "current")).not.toBe(ready);
    expect(reportRenderResetKey(view, report, [result], "unknown")).not.toBe(ready);
  });

  it("keeps every summary refresh control reachable when results are missing", () => {
    expect(missingKeyedGroupedSumDefinitionIds(
      ["definition-1", "definition-2"],
      [summaryResult("definition-2", 800)],
    )).toEqual(["definition-1"]);
  });

  it("retains all definition controls after clearing every result", () => {
    expect(missingKeyedGroupedSumDefinitionIds(
      ["definition-1", "definition-2"],
      [],
    )).toEqual(["definition-1", "definition-2"]);
  });
});

describe("work-file entry and Save availability", () => {
  it("allows local Save for portable-origin work", () => {
    const markup = render({ view: { ...makeView(), openedFromWorkFile: true } });
    const save = markup.match(/<button[^>]*>Save a copy<\/button>/);
    expect(save).not.toBeNull();
    expect(save![0]).not.toContain("disabled");
  });

  it("explains unavailable portable writes when the writer is disabled for rollback", () => {
    const markup = render({ view: { ...makeView(), openedFromWorkFile: true }, workFileSaveUnavailableReason: "Download the work file to keep these changes." });
    const save = markup.match(/<button[^>]*aria-describedby="([^"]+)"[^>]*>Save a copy<\/button>/);
    expect(save).not.toBeNull();
    expect(save![0]).toContain("disabled");
    expect(markup).toContain(`id="${save![1]}"`);
    expect(markup).toContain("Download the work file to keep these changes.");
  });
});


describe("formula bar presentation", () => {
  it("renders one bar above the grid and never shows a formula without a focused cell", () => {
    const markup = render({ view: makeView() });
    expect(markup).toContain('data-testid="formula-bar"');
    expect(markup).toContain(FORMULA_BAR_NO_CELL);
    expect(markup).toContain('placeholder="Enter a formula"');
    expect(markup.indexOf('data-testid="formula-bar"')).toBeLessThan(markup.indexOf('class="ts-grid-scroll"'));
    expect(markup).not.toContain("impact + friction");
  });

  it("marks a projected formula cell as read-only in the grid", () => {
    const markup = render({ view: makeView() });
    const cell = cellMarkup(markup, `cell:${entityA}:c-priority`)!;
    expect(cell).toContain('class="ts-cell ts-cell--computed ts-cell--formula"');
    expect(cell).toContain('aria-readonly="true"');
  });
});

describe("native insertion limit presentation", () => {
  it("removes the draft and Add row at 10,000 stored records and exposes the limit as a status", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    const row = view.table.rows[0]!;
    const record = (id: string) => ({ ...row, id, fields: row.fields.map(field => ({ ...field, target: { ...field.target, entity: id } })) });
    view.table.rows = Array.from({ length: 9_999 }, (_, index) => record(`row-${index}`));
    const before = render({ view, onInsertRow: async () => ({ kind: "confirmed" }) });
    expect(before).toContain('class="ts-entry-row"');
    expect(before).toContain('>Add row</button>');
    expect(before).not.toContain('ts-native-insertion-limit');
    view.table.rows.push(record("inserted"));
    const after = render({ view, onInsertRow: async () => ({ kind: "confirmed" }) });
    expect(after).not.toContain('class="ts-entry-row"');
    expect(after).not.toContain('>Add row</button>');
    expect(after).toContain('class="ts-hint ts-native-insertion-limit" role="status">This table has reached the 10,000-row limit for adding rows here. Nothing was changed.</p>');
  });
});


describe("format strip", () => {
  it("shows controls for the focused column type and blocks changes when busy", () => {
    const view = makeView();
    view.table.native_table_profile = true;
    const handlers = { onSetColumnAlignment: async () => ({ kind: "confirmed" as const }), onSetColumnNumberFormat: async () => ({ kind: "confirmed" as const }), onSetColumnDateFormat: async () => ({ kind: "confirmed" as const }) };
    let markup = render({ view, ...handlers });
    const strip = () => markup.slice(markup.indexOf('aria-label="Format"'), markup.indexOf('</div>', markup.indexOf('aria-label="Format"')));
    expect(strip()).toContain('class="ts-format-strip"');
    expect(strip()).toContain('aria-label="Align center"');
    expect(strip()).not.toContain('aria-label="Currency"');
    view.table.columns[0]!.field_type = "number";
    markup = render({ view, ...handlers, busy: true });
    expect(strip()).toContain('aria-label="Currency"');
    expect(strip()).toMatch(/aria-label="Currency"[^>]*disabled/);
    view.table.columns[0]!.field_type = "date";
    markup = render({ view, ...handlers });
    expect(strip()).toContain('aria-label="Date format"');
    expect(strip()).not.toContain('aria-label="Currency"');
  });
});


describe("cell editor formula roles", () => {
  it("keeps plain formulas as textboxes and exposes matching suggestions as a combobox", () => {
    const editor = (value: string) => renderToStaticMarkup(createElement("input", {
      "aria-label": "Edit cell",
      ...cellEditorListAttributes(functionSuggestions(value, value.length)?.names.length ?? 0, 0, true),
    }));
    expect(editor("=Amount * 2")).not.toContain('role="combobox"');
    expect(editor("=SU")).toContain('role="combobox"');
    expect(editor("=SU")).toContain('aria-expanded="true"');
  });
});


describe("formula completion boundaries", () => {
  it("resets selection for a changed list and clamps acceptance", () => {
    const old = { key: "A-list", open: true, index: 5, navigated: true };
    const changed = formulaOptionsUi(old, "SU-list", "cell");
    expect(changed).toEqual({ open: true, index: 0, navigated: false });
    expect(formulaTabKeepsField(true, changed)).toBe(true);
    expect(formulaOptionsUi(null, "SU-list", "cell").index).toBe(-1);
    expect(formulaOptionsUi({ key: "cell", open: true, index: -1 }, "SU-list", "cell").index).toBe(-1);
    expect(formulaOptionIndex(5, 3)).toBe(2);
    expect(formulaOptionIndex(-1, 3)).toBe(0);
    expect(formulaOptionIndex(0, 0)).toBeNull();
  });
  it("picks the highlighted suggestion after navigating the same list", () => {
    const navigated = { key: "SU-list", open: true, index: 0, navigated: true };
    const ui = formulaOptionsUi(navigated, "SU-list", "cell");
    expect(ui).toBe(navigated);
    expect(formulaTabKeepsField(true, ui)).toBe(false);
  });
  it("does not keep a token that is not an exact field", () => {
    expect(formulaTabKeepsField(false, { open: true, index: -1 })).toBe(false);
    expect(formulaTabKeepsField(false, { open: true, index: 0, navigated: true })).toBe(false);
  });
  it("keeps an exact field in a fresh list", () => {
    const ui = formulaOptionsUi(null, "SU-list", "cell");
    expect(ui).toEqual({ open: true, index: -1, navigated: false });
    expect(formulaTabKeepsField(true, ui)).toBe(true);
  });
  it("only offers formulas where commit accepts them", () => {
    expect(cellEditorFormulaSource({ entity: "row", kind: "number", value: "=SU" })).toBe("SU");
    expect(cellEditorFormulaSource({ entity: "row", kind: "auto", value: "=SU" })).toBe("SU");
    expect(cellEditorFormulaSource({ entity: "row", kind: "text", value: "=SU" })).toBeNull();
    expect(cellEditorFormulaSource({ entity: DRAFT_ROW, kind: "number", value: "=SU" })).toBeNull();
  });
});


describe("session-only frozen first column", () => {
  it.each([false, true])("renders frozen cells only on wide screens (phone=%s)", async phone => {
    const { useState } = await vi.importActual<typeof import("react")>("react");
    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: phone && query.includes("max-width") }) });
    vi.mocked(React.useState).mockImplementation(((initial: unknown) => useState(
      initial && typeof initial === "object" && "byCollection" in initial
        ? { occurrence: "occ-1", byCollection: { release_items: { freezeFirstColumn: true } } }
        : initial,
    )) as typeof React.useState);
    try {
      const view = makeView();
      view.table.native_table_profile = true;
      const markup = render({ view, onInsertRow: async () => ({ kind: "confirmed" }) });
      expect(markup.includes("ts-frozen-first-column")).toBe(!phone);
      if (!phone) {
        expect(markup).toContain('aria-label="Freeze first column" data-column-action="Freeze first column" aria-pressed="true"');
        expect(markup.match(/ts-frozen-first-column/g)).toHaveLength(4); // header, two rows, entry
      }
    } finally {
      vi.mocked(React.useState).mockImplementation(useState);
      vi.unstubAllGlobals();
    }
  });

  it.each([249.9, 250, 250.1])("suspends freeze only above half the scrollport (A=%s)", async columnWidth => {
    const { useState } = await vi.importActual<typeof import("react")>("react");
    vi.mocked(React.useState).mockImplementation(((initial: unknown) => useState(
      initial && typeof initial === "object" && "byCollection" in initial
        ? { occurrence: "occ-1", byCollection: { release_items: { freezeFirstColumn: true } } }
        : initial && typeof initial === "object" && "gutterWidth" in initial
          ? { gutterWidth: 50, columnWidth, scrollportWidth: 600 }
          : initial,
    )) as typeof React.useState);
    try {
      const markup = render({ view: makeView() });
      expect(markup.includes("ts-frozen-first-column")).toBe(columnWidth <= 250);
      expect(markup.includes("Column A is too wide to freeze in this window.")).toBe(columnWidth > 250);
      expect(markup).toContain('aria-label="Freeze first column" data-column-action="Freeze first column" aria-pressed="true"');
    } finally {
      vi.mocked(React.useState).mockImplementation(useState);
    }
  });

  it("starts unfrozen and offers exactly one toggle", () => {
    const markup = render({ view: makeView() });
    expect(markup).not.toContain("ts-frozen-first-column");
    expect(markup.match(/aria-label="Freeze first column"/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="false"');
  });

  it.each([0, 15])("reveals a cell within the client area with a %i px vertical scrollbar", scrollbarWidth => {
    const scrollport = {
      scrollLeft: 0, scrollTop: 0,
      clientLeft: 2, clientWidth: 200 - scrollbarWidth, clientTop: 0, clientHeight: 400,
      getBoundingClientRect: () => ({ left: 10, right: 214, top: 0, bottom: 400 }),
      querySelector: () => null,
    };
    const cell = {
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ left: 110 - scrollport.scrollLeft, right: 210 - scrollport.scrollLeft, top: 50, bottom: 82 }),
    };
    expect(scrollCellIntoGridNearest(cell as unknown as HTMLElement, scrollport as unknown as HTMLElement)).toBe(true);
    expect(scrollport.scrollLeft).toBe(scrollbarWidth === 0 ? 0 : 13);
    expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(10 + scrollport.clientLeft + scrollport.clientWidth);
  });

  it("reveals a target behind the frozen strip", () => {
    let scrollLeft = 200;
    const scrollport = {
      clientTop: 0, clientHeight: 400, clientLeft: 0, clientWidth: 600,
      getBoundingClientRect: () => ({ left: 0, right: 600, top: 0, bottom: 400 }),
      querySelector: (selector: string) => selector === "thead" ? null : ({ getBoundingClientRect: () => ({ right: 208, width: 48 }) }),
      get scrollLeft() { return scrollLeft; },
      set scrollLeft(value) { scrollLeft = value; },
    };
    const cell = {
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ left: 300 - scrollLeft, right: 400 - scrollLeft, top: 50, bottom: 82 }),
    };
    expect(scrollCellIntoGridNearest(cell as unknown as HTMLElement, scrollport as unknown as HTMLElement)).toBe(true);
    expect(scrollLeft).toBe(92);
  });
});

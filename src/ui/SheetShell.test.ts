import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { AppearancePreferenceController, AppearancePreferenceSnapshot } from "../application/appearance-preference.js";
import type { KeyedGroupedSumResult, SheetShellProps, WorkbookView } from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "./interface-profile/profile.js";
import {
  focusRevealNextScrollTop,
  focusRevealScrollDelta,
  focusRevealStillCurrent,
  missingKeyedGroupedSumDefinitionIds,
  salesEntryFocusTarget,
  salesCatalogLayoutEligible,
  describeSavedCopyNameWhitespace,
  reportRenderResetKey,
  shouldPublishAppearanceCompositionEnd,
  SheetShell,
} from "./SheetShell.js";
import { fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
import { notesFieldFor, rowEntity, tableColumns } from "./projection-access.js";

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
    { id: "c-title", key: "title", field_type: "text" },
    { id: "c-impact", key: "impact", field_type: "number" },
    { id: "c-priority", key: "priority", field_type: "number" },
    { id: "c-notes", key: "notes", field_type: "text" },
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
    collections: [{ id: "col-1", key: "release_items", entity_count: rows.length }],
    table: {
      revision: "rev-1",
      collection: { id: "col-1", key: "release_items", entity_count: rows.length },
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
    onCommit: async () => true,
    localHistory: { occurrence: null, revision: null, undoCount: 0, redoCount: 0 },
    onHistory: async () => null,
    onCreateCopy: async () => true,
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
    expect(calculated.title).toBe("Calculated value");
    expect(calculated.title).not.toContain("impact + friction");
    const pending = fieldDisplay(
      projected(entityA, "c-priority", null, { formula: { source: "[playtest_notes.impact] + 1" } }),
    );
    expect(pending.title).toBe("Calculated value without a current result");
    expect(pending.title).not.toContain("playtest_notes");

    const failure = fieldDisplay(
      projected(entityA, "c-priority", null, {
        calculated: { status: "failure", code: "div0", message: "division by zero" },
      }),
    );
    expect(failure.text).toBe("Calculation failed");
    expect(failure.tone).toBe("warning");
    expect(failure.title).toBe("div0: division by zero");

    const unavailable = fieldDisplay(projected(entityA, "c-priority", null, { calculated: { status: "unavailable" } }));
    expect(unavailable.text).toBe("Unavailable");
    expect(unavailable.tone).toBe("muted");
  });

  it("marks missing projections, empty values and diagnostics explicitly", () => {
    expect(fieldDisplay(null).text).toBe("Not loaded");
    expect(fieldDisplay(projected(entityA, "c-title", { kind: "text", value: "" })).text).toBe("Empty");
    const withDiagnostic = fieldDisplay(
      projected(entityA, "c-impact", { kind: "number", value: 5 }, {
        diagnostics: [{ code: "stale", message: "revision too old", path: "impact" }],
      }),
    );
    expect(withDiagnostic.tone).toBe("warning");
    expect(withDiagnostic.title).toBe("stale: revision too old");
    expect(withDiagnostic.text).toBe("5");
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
    expect(unknownMutation).not.toContain("change was published");

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
    expect(notesFieldFor(view.table.rows[0]!, [{ id: "other", key: "title", field_type: "text" }])).toBe(null);
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

  it("keeps Table before the stable footer and reserves the secondary slot after it", () => {
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
    expect(markup.indexOf("ts-workbook-secondary-slot")).toBeGreaterThan(footerStart);
    expect(markup.slice(footerStart)).toContain('aria-label="Workbook views"');
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
          { id: "sku", key: "code", field_type: "text" },
          { id: "cost", key: "price", field_type: "number" },
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
      table: { ...view.table, collection: { id: "catalog-identity", key: "catalog", entity_count: 1 }, columns: [
        { id: "code-id", key: "code", field_type: "text" },
        { id: "category-id", key: "category", field_type: "text" },
        { id: "price-id", key: "price", field_type: "number" },
      ] },
    };
    const marker = { occurrence: "occ-1", collectionId: "catalog-identity" };
    expect(salesCatalogLayoutEligible(catalogView, marker)).toBe(true);
    expect(salesCatalogLayoutEligible({ ...catalogView, occurrence: "replacement" }, marker)).toBe(false);
    expect(salesCatalogLayoutEligible({ ...catalogView, table: { ...catalogView.table, collection: { ...catalogView.table.collection, id: "other" } } }, marker)).toBe(false);
    expect(salesCatalogLayoutEligible({ ...catalogView, table: { ...catalogView.table, columns: [...catalogView.table.columns, { id: "fourth", key: "note", field_type: "text" }] } }, marker)).toBe(false);
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
    expect(markup).toContain("<th scope=\"col\">Field</th><th scope=\"col\">Value</th>");
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

  it("renders cells from the field order when the projection has no columns", () => {
    const markup = render({ view: makeView({ columns: false }) });
    expect(cellMarkup(markup, `cell:${entityA}:c-impact`)).not.toBe(null);
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
    expect(markup).toContain(">1</th>");
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

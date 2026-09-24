import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { AppearancePreferenceController, AppearancePreferenceSnapshot } from "../application/appearance-preference.js";
import type { KeyedGroupedSumResult, SheetShellProps, WorkbookView } from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "./interface-profile/profile.js";
import {
  missingKeyedGroupedSumDefinitionIds,
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
    expect(markup).not.toContain('data-testid="operation-outcome"');
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
    expect(markup).toContain('data-testid="open-project" type="file" multiple="" disabled=""');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Try example<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Open saved copy<\/button>/);
    expect(markup).not.toContain('data-testid="project-ready"');
    expect(markup).not.toContain("Save a copy");
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

  it("keeps truthful save scope in the header and Views with work/value status after each workspace", () => {
    const markup = render({ view: makeView(), currentness: "pending", dirty: true, outcome: "pending" });
    const headerStart = markup.indexOf("ts-workbook-head");
    const contextStart = markup.indexOf("ts-work-context", headerStart);
    const panelStart = markup.indexOf('class="ts-panel');
    const footerStart = markup.indexOf("ts-workspace-footer");
    expect(markup.slice(headerStart, contextStart)).toContain('data-testid="save-status"');
    expect(markup.slice(headerStart, contextStart)).toContain("Copies: this browser on this device");
    expect(footerStart).toBeGreaterThan(panelStart);
    expect(markup.slice(footerStart)).toContain('aria-label="Workbook views"');
    expect(markup.slice(footerStart)).toContain("Work:");
    expect(markup.slice(footerStart)).toContain("Values:");
    expect(markup.slice(footerStart)).toContain('data-testid="operation-outcome"');
    expect(markup.slice(footerStart)).toContain("2 rows · 4 columns");
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
    const impact = cellMarkup(markup, `brief:${entityA}:c-impact`, "</dd>");
    expect(impact).not.toBe(null);
    expect(textOf(impact as string)).toBe("5");
    expect(impact).toContain(`data-work-entity="${entityA}"`);
    expect(impact).toContain('data-work-occurrence="occ-1"');
    expect(impact).toContain('data-work-revision="rev-1"');
    expect(impact).toContain('data-work-currentness="pending"');
    expect(markup).not.toContain(">entity-a<");
    expect(markup).not.toContain(">entity-b<");
    expect(textOf(cellMarkup(markup, `brief:${entityA}:c-notes`, "</dd>") as string)).toBe("first note");
    expect(cellMarkup(markup, `brief:${entityB}:c-impact`, "</dd>")).toBe(null);
  });

  it("renders home open controls and saved copies by actual name", () => {
    const markup = render({ copies: [{ name: "review-copy", savedAt: "2026-09-12T10:00:00.000Z" }] });
    expect(markup).toContain('data-testid="open-project"');
    expect(markup).toContain("webkitdirectory");
    expect(markup).toContain("Try example");
    expect(markup).toContain("Open saved review-copy");
    expect(markup).toContain("2026-09-12T10:00:00.000Z");
    expect(markup).not.toContain('data-testid="project-ready"');
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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { SheetShellProps, WorkbookView } from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
import { SheetShell } from "./SheetShell.js";
import { fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
import { notesFieldFor, rowEntity, tableColumns } from "./projection-access.js";

const entityA = "entity-a";
const entityB = "entity-b";

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

function makeView(options: { columns?: boolean } = {}): WorkbookView {
  const columns = [
    { id: "c-title", key: "title", field_type: "text" },
    { id: "c-impact", key: "impact", field_type: "number" },
    { id: "c-priority", key: "priority", field_type: "number" },
    { id: "c-notes", key: "notes", field_type: "text" },
  ];
  const rows = [
    {
      id: entityA,
      key: "alpha",
      fields: [
        projected(entityA, "c-title", { kind: "text", value: "Alpha work" }),
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

function makeProps(overrides: Partial<SheetShellProps> = {}): SheetShellProps {
  return {
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
    expect(reference.title).toBe(`Reference to ${entityB}`);
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
    expect(calculated.title).toBe("Formula: impact + friction");

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
  it("keeps Refresh available when a replacement opened without a confirmed projection", () => {
    const markup = render({ currentness: "unknown", outcome: "unknown" });
    expect(markup).toContain('aria-label="Recovery"');
    expect(markup).toContain("Work opened; freshness unconfirmed");
    expect(markup).toContain(">Refresh</button>");
    expect(markup).not.toContain("could not be opened");
  });

  it("does not render an editable stale workbook during published recovery", () => {
    const markup = render({ view: null, currentness: "unknown", outcome: "unknown" });
    expect(markup).not.toContain('data-testid="cell-editor"');
    expect(markup).toContain('aria-label="Recovery"');
    expect(markup).toContain(">Refresh</button>");
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

  it("marks unknown outcomes and freshness instead of presenting values as current", () => {
    expect(chipText(render({ view: makeView() }), "operation-outcome")).toBe("No pending operation");
    const markup = render({ view: makeView(), outcome: "unknown", currentness: "unknown" });
    expect(chipText(markup, "operation-outcome")).toBe("Outcome unknown");
    expect(chipText(markup, "currentness")).toBe("Freshness unknown");
    expect(cellMarkup(markup, `cell:${entityA}:c-impact`)).toContain('data-work-currentness="unknown"');
    expect(markup).toContain("These values are not confirmed current");
    expect(markup).not.toContain("Saved on this device");
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
});

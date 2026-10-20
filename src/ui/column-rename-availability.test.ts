import { describe, expect, it, vi } from "vitest";
import type { InteropMetadata, WorkbookView } from "../contracts.js";
import { canRenameColumns, IMPORTED_RENAME_UNAVAILABLE } from "./column-rename-availability.js";
import { submitColumnIntent, type ColumnDialogState } from "./column-operations.js";

const table = (): WorkbookView["table"] => ({
  revision: "r1", collection: { id: "s", key: "table", display_name: "Table", entity_count: 0 },
  native_table_profile: true, rows: [],
  columns: [{ id: "f", key: "column_1", display_name: "column_1", field_type: "text", required: false }],
});
const metadata = (): InteropMetadata => ({ version: 1, sheets: [{
  schema_id: "s", name: "Sheet", has_header: true,
  columns: [{ field_id: "f", name: "Item", width: null }], rows: [],
}] });

describe("Work #560 capability and rollback Rename availability", () => {
  it("enables imported native Rename with the marker, preserving native eligibility", () => {
    expect(canRenameColumns(table(), metadata(), true)).toBe(true);
    expect(canRenameColumns({ ...table(), native_table_profile: false }, metadata(), true)).toBe(false);
    expect(canRenameColumns(null, metadata(), true)).toBe(false);
  });
  it("blocks the whole table if sourceNames supplies any current field heading", () => {
    const current = table();
    current.columns.push({ ...current.columns[0]!, id: "added", key: "added", display_name: "Added" });
    expect(canRenameColumns(current, metadata(), false)).toBe(false);
    current.columns[0]!.display_name = "Explicit-looking name";
    expect(canRenameColumns(current, metadata(), false)).toBe(false);
    current.columns[0]!.display_name = current.columns[0]!.key;
    expect(canRenameColumns(current, metadata(), false)).toBe(false);
  });
  it("keeps native non-imported Rename and rejects non-native or absent tables", () => {
    expect(canRenameColumns(table(), null)).toBe(true);
    expect(canRenameColumns({ ...table(), native_table_profile: undefined }, null)).toBe(false);
    expect(canRenameColumns(null, metadata())).toBe(false);
  });
  it.each(["other table", "other field", "headerless", "blank heading"])("does not invent an imported-heading restriction for %s", kind => {
    const incoming = metadata();
    const sheet = incoming.sheets[0]!;
    if (kind === "other table") sheet.schema_id = "foreign";
    if (kind === "other field") sheet.columns[0]!.field_id = "foreign";
    if (kind === "headerless") sheet.has_header = false;
    if (kind === "blank heading") sheet.columns[0]!.name = " \t ";
    expect(canRenameColumns(table(), incoming, false)).toBe(true);
  });
  it("matches the existing legacy column projection fallback", () => {
    const current = table();
    current.columns = [];
    current.rows = [{ id: "e", key: "row", fields: [{
      target: { entity: "e", field: "f" }, address: "f", stored: { kind: "text", value: "x" },
      formula: null, calculated: null, diagnostics: [], editable_scalar: "text",
    }] }];
    expect(canRenameColumns(current, metadata(), false)).toBe(false);
  });
});

describe("column dialog dispatch guard", () => {
  const state: ColumnDialogState = { kind: "rename", occurrence: "o", revision: "r1", collection: "table", rowEntities: ["e"], field: "f", name: "Item" };
  const draft = { name: "Current item", fieldType: "text" as const, fill: "fill", required: true };
  const handlers = () => ({
    onRenameColumn: vi.fn(async () => ({ kind: "confirmed" as const })),
    onAddColumn: vi.fn(async () => ({ kind: "confirmed" as const })),
    onRemoveColumn: vi.fn(async () => ({ kind: "confirmed" as const })),
  });
  it("refuses a stale open Rename dialog using the current metadata, without dispatch", async () => {
    const context = { table: table(), metadata: null as InteropMetadata | null, explicitDisplayNames: false, ...handlers() };
    expect(canRenameColumns(context.table, context.metadata)).toBe(true);
    context.metadata = metadata();
    expect(await submitColumnIntent(state, draft, context)).toEqual({ kind: "refused", message: IMPORTED_RENAME_UNAVAILABLE });
    for (const handler of [context.onRenameColumn, context.onAddColumn, context.onRemoveColumn]) expect(handler).not.toHaveBeenCalled();
  });
  it("dispatches imported Rename when explicit presence is supported", async () => {
    const context = { table: table(), metadata: metadata(), explicitDisplayNames: true, ...handlers() };
    expect(await submitColumnIntent(state, draft, context)).toEqual({ kind: "confirmed" });
    expect(context.onRenameColumn).toHaveBeenCalledExactlyOnceWith(state, "table", "f", draft.name);
  });
  it("keeps native non-imported Rename's exact witness, target and raw name", async () => {
    const context = { table: table(), metadata: null, ...handlers() };
    const raw = { ...draft, name: "  column_1  " };
    expect(await submitColumnIntent(state, raw, context)).toEqual({ kind: "confirmed" });
    expect(context.onRenameColumn).toHaveBeenCalledExactlyOnceWith(state, "table", "f", raw.name);
  });
  it("leaves Add and Remove dispatch and initializers unchanged on the gated table", async () => {
    const context = { table: table(), metadata: metadata(), ...handlers() };
    const add: ColumnDialogState = { kind: "add", occurrence: "o", revision: "r1", collection: "table", rowEntities: ["e"] };
    expect(await submitColumnIntent(add, draft, context)).toEqual({ kind: "confirmed" });
    expect(context.onAddColumn).toHaveBeenCalledExactlyOnceWith(add, "table", draft.name, "text", [{ entity: "e", input: { kind: "text", value: "fill" } }], true);
    const remove: ColumnDialogState = { ...state, kind: "remove" };
    expect(await submitColumnIntent(remove, draft, context)).toEqual({ kind: "confirmed" });
    expect(context.onRemoveColumn).toHaveBeenCalledExactlyOnceWith(remove, "table", "f");
    expect(context.onRenameColumn).not.toHaveBeenCalled();
  });
});

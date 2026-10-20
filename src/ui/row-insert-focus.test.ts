import { describe, expect, it } from "vitest";
import type { WorkbookView } from "../contracts.js";
import { DRAFT_ROW } from "./row-entry-model.js";
import { rowInsertFocusTarget } from "./row-insert-focus.js";

const table = (entities: string[], fields = ["first", "second"]): WorkbookView["table"] => ({
  revision: "after", collection: { id: "table", key: "table", display_name: "Table", entity_count: entities.length },
  native_table_profile: true,
  columns: fields.map(id => ({ id, key: id, display_name: id, field_type: "text", required: true })),
  rows: entities.map(id => ({ id, key: id, fields: [] })),
});

describe("row insertion completion focus", () => {
  const before = Array.from({ length: 127 }, (_, i) => `row-${i}`);
  it.each(["Enter", "Add row"])("targets the inserted row in the submitted column at 127→128 (%s)", () => {
    // Projection order need not append the new entity at the end.
    expect(rowInsertFocusTarget(table(["inserted", ...before]), false, before, "second"))
      .toEqual({ entity: "inserted", field: "second" });
  });
  it("falls back to the last stored row's first cell when the insertion or column cannot be resolved", () => {
    expect(rowInsertFocusTarget(table(before), false, before, "second"))
      .toEqual({ entity: before.at(-1), field: "first" });
    expect(rowInsertFocusTarget(table(["inserted", ...before]), false, before, "removed"))
      .toEqual({ entity: before.at(-1), field: "first" });
  });
  it("keeps first-column draft focus below the gate", () => {
    expect(rowInsertFocusTarget(table(["inserted"]), true, [], "second"))
      .toEqual({ entity: DRAFT_ROW, field: "first" });
  });
  it("does not invent a cell when no row or column survives", () => {
    expect(rowInsertFocusTarget(table([]), false, [], "second")).toBeNull();
    expect(rowInsertFocusTarget(table(["inserted"], []), false, [], "second")).toBeNull();
  });
});

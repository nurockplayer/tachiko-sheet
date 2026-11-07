import { describe, expect, it } from "vitest";
import { fillSelectionPlan, FillSelectionRefusal } from "./fill-selection.js";
import { rectangle } from "./clipboard.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const column = (id: string): TableColumn => ({ id, key: id, display_name: id, field_type: "text", required: false });
const columns = [column("a"), column("b")];

function row(index: number, values: Record<string, string>, formulas: string[] = []): TableRow {
  return {
    id: `row-${index}`,
    key: `row-${index}`,
    fields: Object.entries(values).map(([field, value]) => ({
      target: { entity: `entity-${index}`, field },
      address: `${index}.${field}`,
      stored: { kind: "text" as const, value },
      formula: formulas.includes(field) ? { source: `=${field}${index + 1}` } : null,
      calculated: null,
      diagnostics: [],
      editable_scalar: formulas.includes(field) ? null : "text" as const,
    })),
  };
}

const area = (top: number, left: number, bottom: number, right: number) => rectangle({ row: top, column: left }, { row: bottom, column: right });

describe("fill selection request planning", () => {
  describe("boolean cells", () => {
    const flag: TableColumn = { ...column("a"), field_type: "boolean" };
    const flagRow: TableRow = {
      id: "row-0",
      key: "row-0",
      fields: [{
        target: { entity: "entity-0", field: "a" },
        address: "0.a",
        stored: { kind: "boolean" as const, value: false },
        formula: null,
        calculated: null,
        diagnostics: [],
        editable_scalar: "boolean" as const,
      }],
    };

    it("reads an entry the way a cell commit does", () => {
      expect(fillSelectionPlan([flagRow], [flag], area(0, 0, 0, 0), " TRUE ", true)).toEqual([
        { target: { entity: "entity-0", field: "a" }, input: { kind: "boolean", value: true } },
      ]);
    });

    it("refuses an entry that isn't true or false instead of storing false", () => {
      expect(() => fillSelectionPlan([flagRow], [flag], area(0, 0, 0, 0), "maybe", true)).toThrow(FillSelectionRefusal);
    });
  });

  it("fills every cell of the rectangle with the entry", () => {
    const rows = [row(0, { a: "old-a", b: "old-b" }), row(1, { a: "next-a", b: "next-b" })];
    expect(fillSelectionPlan(rows, columns, area(0, 0, 1, 1), "fill", true)).toEqual([
      { target: { entity: "entity-0", field: "a" }, input: { kind: "text", value: "fill" } },
      { target: { entity: "entity-0", field: "b" }, input: { kind: "text", value: "fill" } },
      { target: { entity: "entity-1", field: "a" }, input: { kind: "text", value: "fill" } },
      { target: { entity: "entity-1", field: "b" }, input: { kind: "text", value: "fill" } },
    ]);
  });

  it("refuses a formula entry", () => {
    const rows = [row(0, { a: "x" })];
    expect(() => fillSelectionPlan(rows, columns, area(0, 0, 0, 0), "=1+1", true))
      .toThrow("Enter the formula in one cell, then fill it with Ctrl+D. Nothing was filled.");
    expect(() => fillSelectionPlan(rows, columns, area(0, 0, 0, 0), "=1+1", true)).toThrow(FillSelectionRefusal);
  });

  it("refuses a range above 1,024 cells", () => {
    expect(() => fillSelectionPlan([], columns, { top: 0, left: 0, bottom: 513, right: 1 }, "fill", true))
      .toThrow("The fill range exceeds the 1,024-cell limit. Nothing was filled.");
  });

  it("refuses a non-native table", () => {
    expect(() => fillSelectionPlan([row(0, { a: "x" })], columns, area(0, 0, 0, 0), "fill", false))
      .toThrow("This table cannot be filled here. Nothing was filled.");
  });

  it("refuses a cell with no editable slot or a formula cell", () => {
    const locked = [row(0, { a: "x" }), { ...row(1, { a: "y" }), fields: row(1, { a: "y" }).fields.map(field => ({ ...field, editable_scalar: undefined })) }];
    expect(() => fillSelectionPlan(locked as never, columns, area(0, 0, 1, 0), "fill", true))
      .toThrow("The selection includes a cell that can't be edited here. Nothing was filled.");
    const formulas = [row(0, { a: "x" }), row(1, { a: "y" }, ["a"])];
    expect(() => fillSelectionPlan(formulas, columns, area(0, 0, 1, 0), "fill", true))
      .toThrow("The selection includes a cell that can't be edited here. Nothing was filled.");
  });

  it("gives no edit for a cell that already holds the entry", () => {
    const rows = [row(0, { a: "fill" }), row(1, { a: "other" })];
    expect(fillSelectionPlan(rows, columns, area(0, 0, 1, 0), "fill", true)).toEqual([
      { target: { entity: "entity-1", field: "a" }, input: { kind: "text", value: "fill" } },
    ]);
  });

  it("clears every cell with an empty entry", () => {
    const rows = [row(0, { a: "one", b: "two" })];
    expect(fillSelectionPlan(rows, columns, area(0, 0, 0, 1), "", true)).toEqual([
      { target: { entity: "entity-0", field: "a" }, input: { kind: "clear" } },
      { target: { entity: "entity-0", field: "b" }, input: { kind: "clear" } },
    ]);
  });
});

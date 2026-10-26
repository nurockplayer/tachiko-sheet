import { describe, expect, it } from "vitest";
import { fillDownPlan } from "./fill-down.js";
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
      editable_scalar: "text" as const,
    })),
  };
}

describe("fill down request planning", () => {
  it("plans formula destinations in display order with relative rows", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" }), row(2, { a: "4" })];
    expect(fillDownPlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 2, column: 0 }), true)).toEqual({
      kind: "formula",
      request: {
        source: { entity: "entity-0", field: "a" },
        destinations: [{ entity: "entity-1", field: "a" }, { entity: "entity-2", field: "a" }],
        fixed_references: [], relative_rows: true, relative_columns: false,
      },
      count: 2,
    });
  });

  it("refuses a formula selection wider than one column", () => {
    const rows = [row(0, { a: "2", b: "x" }, ["a"]), row(1, { a: "3", b: "y" })];
    expect(() => fillDownPlan(rows, columns, rectangle({ row: 0, column: 0 }, { row: 1, column: 1 }), true))
      .toThrow("Fill a formula down one column at a time. Nothing was filled.");
  });

  it("fills top values across two columns and three rows", () => {
    const rows = [row(0, { a: "top-a", b: "top-b" }), row(1, { a: "old-a1", b: "old-b1" }), row(2, { a: "old-a2", b: "old-b2" })];
    expect(fillDownPlan(rows, columns, rectangle({ row: 0, column: 0 }, { row: 2, column: 1 }), true)).toEqual({
      kind: "values",
      edits: [
        { target: { entity: "entity-1", field: "a" }, input: { kind: "text", value: "top-a" } },
        { target: { entity: "entity-2", field: "a" }, input: { kind: "text", value: "top-a" } },
        { target: { entity: "entity-1", field: "b" }, input: { kind: "text", value: "top-b" } },
        { target: { entity: "entity-2", field: "b" }, input: { kind: "text", value: "top-b" } },
      ],
      count: 4,
    });
  });

  it("refuses a destination formula during a values fill", () => {
    const rows = [row(0, { a: "top" }), row(1, { a: "calculated" }, ["a"] )];
    expect(() => fillDownPlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1, column: 0 }), true))
      .toThrow("The fill range includes a calculated or non-editable cell. Nothing was filled.");
  });

  it.each([null, rectangle({ row: 0, column: 0 }, { row: 0, column: 0 })])("refuses a null area or single row", area => {
    expect(() => fillDownPlan([], columns, area, true)).toThrow("Select at least two rows to fill down.");
  });

  it("refuses a non-native table", () => {
    expect(() => fillDownPlan([row(0, { a: "top" }), row(1, { a: "next" })], [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1, column: 0 }), false))
      .toThrow("This table cannot be filled here. Nothing was filled.");
  });

  it("refuses a destination range above 1,024 cells", () => {
    expect(() => fillDownPlan([], columns, { top: 0, left: 0, bottom: 513, right: 1 }, true))
      .toThrow("The fill range exceeds the 1,024-cell limit. Nothing was filled.");
  });
});

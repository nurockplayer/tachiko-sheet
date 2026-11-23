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
      // Work projects a formula cell with no editable scalar (scalar_kind of a formula is None).
      editable_scalar: formulas.includes(field) ? null : "text" as const,
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
        fixed_references: [], relative_rows: false, relative_columns: false,
      },
      count: 2,
    });
  });

  it("refuses a formula fill while the view is sorted or filtered", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" })];
    expect(() => fillDownPlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1, column: 0 }), true, false))
      .toThrow("Clear the sort and filter to fill a formula down. Nothing was filled.");
  });

  it("replaces a destination's existing formula but refuses a non-editable cell", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" }, ["a"])];
    expect(fillDownPlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1, column: 0 }), true)).toMatchObject({ kind: "formula", count: 1 });
    const locked = [row(0, { a: "2" }, ["a"]), { ...row(1, { a: "3" }), fields: row(1, { a: "3" }).fields.map(field => ({ ...field, editable_scalar: undefined })) }];
    expect(() => fillDownPlan(locked as never, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1, column: 0 }), true))
      .toThrow("The fill range includes a calculated or non-editable cell. Nothing was filled.");
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

  it("refuses a destination range above 100,000 cells", () => {
    const rows = Array.from({ length: 100_001 }, (_, index) => row(index, { a: index ? "old" : "new" }));
    expect(fillDownPlan(rows, [columns[0]!], { top: 0, left: 0, bottom: 100_000, right: 0 }, true)).toMatchObject({ kind: "values", count: 100_000 });
    expect(() => fillDownPlan([], columns, { top: 0, left: 0, bottom: 100_001, right: 0 }, true))
      .toThrow("The fill range exceeds the 100,000-cell limit. Nothing was filled.");
  });
});

describe("directional fill planning", () => {
  const booleanColumns = [column("a"), { ...column("b"), field_type: "boolean" }];
  const source = { top: 0, left: 0, bottom: 0, right: 0 };
  const area = { ...source, right: 1 };
  function booleanRow(index: number, value: string): TableRow {
    const result = row(index, { a: value });
    result.fields.push({
      target: { entity: `entity-${index}`, field: "b" }, address: `${index}.b`,
      stored: { kind: "boolean", value: true }, editable_scalar: "boolean",
      formula: null, calculated: null, diagnostics: [],
    });
    return result;
  }

  it.each(["TRUE", "True", "tRuE", "FALSE", "False", "fAlSe"])("normalizes %s when filling into Yes/No", value => {
    expect(fillDownPlan([booleanRow(0, value)], booleanColumns, area, true, true, source)).toEqual({
      kind: "values", count: 1,
      edits: [{ target: { entity: "entity-0", field: "b" }, input: { kind: "boolean", value: value.toLowerCase() === "true" } }],
    });
  });

  it.each(["1", "0", "not a boolean", " true "])("refuses the whole fill for %s after planning a valid Boolean", value => {
    const rows = [booleanRow(0, "TRUE"), booleanRow(1, value)];
    if (value === "1" || value === "0") rows[1]!.fields[0] = {
      ...rows[1]!.fields[0]!, stored: { kind: "number", value: Number(value) }, editable_scalar: "number",
    };
    const before = structuredClone(rows);
    expect(() => fillDownPlan(rows, booleanColumns, { ...area, bottom: 1 }, true, true, { ...source, bottom: 1 }))
      .toThrow("A filled Yes/No value must be true or false. Nothing was filled.");
    expect(rows).toEqual(before);
  });

  it("clears an optional Yes/No cell for an empty source without converting it to false", () => {
    expect(fillDownPlan([booleanRow(0, "")], booleanColumns, area, true, true, source)).toEqual({
      kind: "values", count: 1,
      edits: [{ target: { entity: "entity-0", field: "b" }, input: { kind: "clear" } }],
    });
  });

  it("refuses an empty source for a required Yes/No cell", () => {
    expect(() => fillDownPlan([booleanRow(0, "")], [booleanColumns[0]!, { ...booleanColumns[1]!, required: true }], area, true, true, source))
      .toThrow("This Yes/No column needs a value in every row.");
  });

  it.each([0, 2])("refuses a sideways formula copy into column %s", destination => {
    const rows = [row(0, { a: "1", b: "2", c: "3" }, ["b"])];
    const source = { top: 0, left: 1, bottom: 0, right: 1 };
    const area = { ...source, left: Math.min(1, destination), right: Math.max(1, destination) };
    expect(() => fillDownPlan(rows, [...columns, column("c")], area, true, true, source))
      .toThrow("Filling formulas sideways is not available yet.");
  });

  it("copies each value in a column horizontally in one batch", () => {
    const rows = [row(0, { a: "x", b: "old" }), row(1, { a: "y", b: "old" })];
    expect(fillDownPlan(rows, columns, { top: 0, left: 0, bottom: 1, right: 1 }, true, true, { top: 0, left: 0, bottom: 1, right: 0 })).toEqual({
      kind: "values", count: 2, edits: [
        { target: { entity: "entity-0", field: "b" }, input: { kind: "text", value: "x" } },
        { target: { entity: "entity-1", field: "b" }, input: { kind: "text", value: "y" } },
      ],
    });
  });

  it("delegates upward formula references to Work", () => {
    const rows = [row(0, { a: "1", b: "2" }), row(1, { a: "3", b: "4" }, ["b"])];
    const source = { top: 1, left: 1, bottom: 1, right: 1 };
    const area = { ...source, top: 0 };
    expect(fillDownPlan(rows, columns, area, true, true, source)).toEqual({
      kind: "formula", count: 1, request: {
        source: { entity: "entity-1", field: "b" },
        destinations: [{ entity: "entity-0", field: "b" }],
        fixed_references: [], relative_rows: false, relative_columns: false,
      },
    });
  });
});

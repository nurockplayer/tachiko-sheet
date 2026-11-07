import { describe, expect, it } from "vitest";
import { formulaPastePlan, type CopiedFormula } from "./formula-paste.js";
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
      formula: formulas.includes(field) ? { source: `=${field}${index + 1}*2` } : null,
      calculated: null,
      diagnostics: [],
      // Work projects a formula cell with no editable scalar (scalar_kind of a formula is None).
      editable_scalar: formulas.includes(field) ? null : "text" as const,
    })),
  };
}

const copied: CopiedFormula = { entity: "entity-0", field: "a", formula: "=a1*2", text: "2" };
const cell = (rowIndex: number, columnIndex = 0) => rectangle({ row: rowIndex, column: columnIndex }, { row: rowIndex, column: columnIndex });

describe("formula paste planning", () => {
  it("plans one destination below the source with relative rows", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" }), row(2, { a: "4" })];
    expect(formulaPastePlan(rows, [columns[0]!], cell(1), copied)).toEqual({
      kind: "formula",
      request: {
        source: { entity: "entity-0", field: "a" },
        destinations: [{ entity: "entity-1", field: "a" }],
        fixed_references: [], relative_rows: true, relative_columns: false,
      },
      count: 1,
    });
  });

  it("fills every selected row and skips the source's own row", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" }), row(2, { a: "4" })];
    expect(formulaPastePlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 2, column: 0 }), copied)).toMatchObject({
      kind: "formula",
      request: { destinations: [{ entity: "entity-1", field: "a" }, { entity: "entity-2", field: "a" }] },
      count: 2,
    });
  });

  it("replaces a destination's existing formula", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" }, ["a"])];
    expect(formulaPastePlan(rows, [columns[0]!], cell(1), copied)).toMatchObject({ kind: "formula", count: 1 });
  });

  it("is unchanged when only the source's own row is selected", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" })];
    expect(formulaPastePlan(rows, [columns[0]!], cell(0), copied)).toEqual({ kind: "unchanged" });
  });

  it("leaves an ordinary paste alone for another column, a wider area, a changed formula or an unknown row", () => {
    const rows = [row(0, { a: "2", b: "x" }, ["a"]), row(1, { a: "3", b: "y" })];
    expect(formulaPastePlan(rows, columns, cell(1, 1), copied)).toBeNull();
    expect(formulaPastePlan(rows, columns, rectangle({ row: 1, column: 0 }, { row: 1, column: 1 }), copied)).toBeNull();
    expect(formulaPastePlan(rows, columns, cell(1), { ...copied, formula: "=b1*2" })).toBeNull();
    expect(formulaPastePlan(rows, columns, cell(1), { ...copied, entity: "entity-gone" })).toBeNull();
    expect(formulaPastePlan(rows, columns, null, copied)).toBeNull();
  });

  it("refuses a formula paste while the view is sorted or filtered", () => {
    const rows = [row(0, { a: "2" }, ["a"]), row(1, { a: "3" })];
    expect(() => formulaPastePlan(rows, [columns[0]!], cell(1), copied, false))
      .toThrow("Clear the sort and filter to paste a formula. Nothing was pasted.");
  });

  it("refuses a non-editable destination", () => {
    const rows = [row(0, { a: "2" }, ["a"]), { ...row(1, { a: "3" }), fields: row(1, { a: "3" }).fields.map(field => ({ ...field, editable_scalar: undefined })) }];
    expect(() => formulaPastePlan(rows as never, [columns[0]!], cell(1), copied))
      .toThrow("The fill range includes a calculated or non-editable cell. Nothing was filled.");
  });

  it("refuses a destination range above 1,024 cells", () => {
    const rows = Array.from({ length: 1_026 }, (_, index) => row(index, { a: String(index) }, index === 0 ? ["a"] : []));
    expect(() => formulaPastePlan(rows, [columns[0]!], rectangle({ row: 0, column: 0 }, { row: 1_025, column: 0 }), copied))
      .toThrow("The paste range exceeds the 1,024-cell limit. Nothing was pasted.");
  });
});

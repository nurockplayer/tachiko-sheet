import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { A1_HEADER_ROW, a1ColumnLetter, a1Geometry, a1GeometryFor, a1RowNumber } from "./a1-geometry.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const columns: TableColumn[] = [
  { id: "c-name", key: "name", display_name: "Name", field_type: "text", required: true },
  { id: "c-price", key: "price", display_name: "Price", field_type: "number", required: true },
];

function row(entity: string, value: string): TableRow {
  const fields: FieldProjection[] = [{
    target: { entity, field: "c-name" },
    address: `tables/items/${entity}/c-name`,
    stored: { kind: "text", value },
    formula: null,
    calculated: null,
    diagnostics: [],
    editable_scalar: "text",
  }];
  return { id: entity, key: entity, blank_fields: [], fields };
}

describe("a1ColumnLetter", () => {
  it("names columns like a spreadsheet", () => {
    expect(a1ColumnLetter(0)).toBe("A");
    expect(a1ColumnLetter(25)).toBe("Z");
    expect(a1ColumnLetter(26)).toBe("AA");
    expect(a1ColumnLetter(27)).toBe("AB");
    expect(a1ColumnLetter(701)).toBe("ZZ");
    expect(a1ColumnLetter(702)).toBe("AAA");
  });
});

describe("a1RowNumber", () => {
  it("puts the first displayed data row on row 2, below the header row", () => {
    expect(A1_HEADER_ROW).toBe(1);
    expect(a1RowNumber(0)).toBe(2);
    expect(a1RowNumber(1)).toBe(3);
    expect(a1RowNumber(10)).toBe(12);
  });
});

describe("a1Geometry", () => {
  it("reports the header row, the displayed row entities and the column ids in order", () => {
    expect(a1Geometry([row("alpha", "Alpha"), row("beta", "Beta")], columns)).toEqual({
      headerRow: 1,
      rows: ["alpha", "beta"],
      columns: ["c-name", "c-price"],
    });
  });

  it("keeps the displayed order, not the stored one", () => {
    expect(a1Geometry([row("beta", "Beta"), row("alpha", "Alpha")], columns).rows).toEqual(["beta", "alpha"]);
    expect(a1Geometry([], columns)).toEqual({ headerRow: 1, rows: [], columns: ["c-name", "c-price"] });
  });
});

describe("a1GeometryFor", () => {
  // row-2 is display index 0 (A1 row 2) through row-9 at A1 row 9.
  const rows = Array.from({ length: 8 }, (_, index) => row(`row-${index + 2}`, `Row ${index + 2}`));

  it("keeps the owner row and the rows it names, with the header just above", () => {
    expect(a1GeometryFor(rows, columns, "row-5", { rows: [3], range: false })).toEqual({
      headerRow: 2,
      rows: ["row-3", "row-4", "row-5"],
      columns: ["c-name", "c-price"],
    });
  });

  it("clamps a reference to row 1 to the first data row", () => {
    expect(a1GeometryFor(rows, columns, "row-5", { rows: [1], range: false })).toEqual({
      headerRow: 1,
      rows: ["row-2", "row-3", "row-4", "row-5"],
      columns: ["c-name", "c-price"],
    });
  });

  it("clamps an address past the end to the last displayed row", () => {
    expect(a1GeometryFor(rows, columns, "row-5", { rows: [99], range: false })).toEqual({
      headerRow: 4,
      rows: ["row-5", "row-6", "row-7", "row-8", "row-9"],
      columns: ["c-name", "c-price"],
    });
  });

  it("keeps every row for a range", () => {
    expect(a1GeometryFor(rows, columns, "row-5", { rows: [2, 9], range: true })).toEqual(a1Geometry(rows, columns));
  });

  it("keeps every row when the owner is not displayed", () => {
    expect(a1GeometryFor(rows, columns, "row-elsewhere", { rows: [3], range: false })).toEqual(a1Geometry(rows, columns));
  });

  it("returns null when the row ids do not fit one request", () => {
    const many = Array.from({ length: 2_000 }, (_, index) => row(`row-${index}-${"x".repeat(40)}`, `Row ${index}`));
    expect(a1GeometryFor(many, columns, many[0]!.id, { rows: [2], range: true })).toBeNull();
  });
});

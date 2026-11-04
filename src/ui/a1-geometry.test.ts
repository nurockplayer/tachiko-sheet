import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { A1_HEADER_ROW, a1ColumnLetter, a1Geometry, a1RowNumber } from "./a1-geometry.js";
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

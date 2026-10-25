import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { TableColumn, TableRow } from "./projection-access.js";
import { pastePastVisibleRows, rowViewOrder } from "./row-view.js";

const columns: TableColumn[] = [
  { id: "c-name", key: "name", display_name: "Name", field_type: "text", required: true },
  { id: "c-price", key: "price", display_name: "Price", field_type: "number", required: true },
];

function field(entity: string, fieldId: string, stored: FieldProjection["stored"]): FieldProjection {
  return {
    target: { entity, field: fieldId },
    address: `tables/items/${entity}/${fieldId}`,
    stored,
    formula: null,
    calculated: null,
    diagnostics: [],
    editable_scalar: stored && stored.kind !== "reference" ? stored.kind : null,
  };
}

function row(
  entity: string,
  values: { name?: string; price?: number | null },
  blankFields: string[] = [],
): TableRow {
  const fields: FieldProjection[] = [];
  if (values.name !== undefined) fields.push(field(entity, "c-name", { kind: "text", value: values.name }));
  if (values.price !== undefined && values.price !== null) fields.push(field(entity, "c-price", { kind: "number", value: values.price }));
  return { id: entity, key: entity, blank_fields: blankFields, fields };
}

const alpha = row("alpha", { name: "Alpha", price: 10 });
const beta = row("beta", { name: "beta", price: 2 });
const gamma = row("gamma", { name: "Gamma", price: 1 });
const blankName = row("blank-name", { price: 5 }, ["c-name"]);
const blankPrice = row("blank-price", { name: "Delta" }, ["c-price"]);

describe("rowViewOrder", () => {
  it("sorts Number columns numerically and keeps blanks last in both directions", () => {
    const rows = [alpha, blankPrice, beta, gamma];
    expect(rowViewOrder(rows, columns, { sort: { field: "c-price", direction: "asc" } }).map(row => row.id))
      .toEqual(["gamma", "beta", "alpha", "blank-price"]);
    expect(rowViewOrder(rows, columns, { sort: { field: "c-price", direction: "desc" } }).map(row => row.id))
      .toEqual(["alpha", "beta", "gamma", "blank-price"]);
  });

  it("sorts Text like a spreadsheet and keeps blank or empty text last both ways", () => {
    const decimal = row("decimal", { name: "item 10", price: 10 });
    const single = row("single", { name: "item 2", price: 20 });
    const empty = row("empty", { name: "" });
    const rows = [decimal, blankName, single, empty];
    expect(rowViewOrder(rows, columns, { sort: { field: "c-name", direction: "asc" } }).map(row => row.id))
      .toEqual(["single", "decimal", "blank-name", "empty"]);
    expect(rowViewOrder(rows, columns, { sort: { field: "c-name", direction: "desc" } }).map(row => row.id))
      .toEqual(["decimal", "single", "blank-name", "empty"]);
    expect(rowViewOrder([row("lower", { name: "alpha" }), row("upper", { name: "Alpha" })], columns,
      { sort: { field: "c-name", direction: "asc" } }).map(row => row.id))
      .toEqual(["lower", "upper"]);
  });

  it("is stable for equal values and leaves the original order without settings", () => {
    const first = row("first", { name: "Same", price: 1 });
    const second = row("second", { name: "same", price: 1 });
    const rows = [first, blankName, second];
    expect(rowViewOrder(rows, columns)).toEqual(rows);
    expect(rowViewOrder(rows, columns, { sort: { field: "c-price", direction: "asc" } }).map(row => row.id))
      .toEqual(["first", "second", "blank-name"]);
  });

  it("filters on the displayed text without case sensitivity and trims the query", () => {
    const rows = [alpha, beta, gamma];
    expect(rowViewOrder(rows, columns, { filter: { field: "c-name", text: "  BET " } }).map(row => row.id))
      .toEqual(["beta"]);
    expect(rowViewOrder(rows, columns, { filter: { field: "c-name", text: "   " } })).toEqual(rows);
  });

  it("keeps edited or added rows visible even when they stop matching the filter", () => {
    const kept = new Set(["beta"]);
    expect(rowViewOrder([alpha, beta, gamma], columns, {
      filter: { field: "c-name", text: "alpha" },
      kept,
    }).map(row => row.id)).toEqual(["alpha", "beta"]);
  });
});

describe("pastePastVisibleRows", () => {
  it("separates a paste that ends inside the visible rows from one that runs past them", () => {
    expect(pastePastVisibleRows(0, 2, 2)).toBe(false);
    expect(pastePastVisibleRows(1, 2, 2)).toBe(true);
    expect(pastePastVisibleRows(0, 3, 2)).toBe(true);
  });
});

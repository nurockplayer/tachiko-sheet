import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { TableColumn, TableRow } from "./projection-access.js";
import { pastePastVisibleRows, rowViewBlockRows, rowViewDisplaySignature, rowViewFilterKeyAction, rowViewKeepingRows, rowViewOrder, rowViewPasteRefusal, rowViewRecordForOccurrence, rowViewSettingsForColumns, rowViewSettingsForFilter } from "./row-view.js";

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

describe("rowViewPasteRefusal", () => {
  it("refuses a paste past the last displayed row only while sorted or filtered", () => {
    expect(rowViewPasteRefusal({}, 0, 2, 3)).toBe(null);
    expect(rowViewPasteRefusal({}, 2, 2, 3)).toBe(null);
    expect(rowViewPasteRefusal({ sort: { field: "c-name", direction: "asc" } }, 2, 2, 3))
      .toBe("Clear the sort to paste past the last row.");
    expect(rowViewPasteRefusal({ filter: { field: "c-name", text: "a" } }, 2, 2, 3))
      .toBe("Clear the filter to paste past the visible rows.");
    expect(rowViewPasteRefusal({ sort: { field: "c-name", direction: "asc" }, filter: { field: "c-name", text: "a" } }, 2, 2, 3))
      .toBe("Clear the sort and filter to paste past the visible rows.");
  });

  it("allows a paste that ends on the last displayed row", () => {
    const settings = { sort: { field: "c-name", direction: "asc" as const }, filter: { field: "c-name", text: "a" } };
    expect(rowViewPasteRefusal(settings, 0, 2, 2)).toBe(null);
    expect(rowViewPasteRefusal(settings, 1, 2, 3)).toBe(null);
  });

  it("ignores a filter whose text is blank", () => {
    expect(rowViewPasteRefusal({ filter: { field: "c-name", text: "   " } }, 2, 2, 3)).toBe(null);
  });
});

describe("rowViewRecordForOccurrence", () => {
  const installed = { occurrence: "occ-1", byCollection: { items: { sort: { field: "c-name", direction: "asc" as const } } } };

  it("keeps settings while the projection is temporarily missing", () => {
    expect(rowViewRecordForOccurrence(installed, undefined)).toBe(installed);
    expect(rowViewRecordForOccurrence(installed, null)).toBe(installed);
    expect(rowViewRecordForOccurrence(installed, "occ-1")).toBe(installed);
  });

  it("clears settings only for a different confirmed occurrence", () => {
    expect(rowViewRecordForOccurrence(installed, "occ-2")).toEqual({ occurrence: "occ-2", byCollection: {} });
    expect(rowViewRecordForOccurrence({ occurrence: null, byCollection: {} }, "occ-1")).toEqual({ occurrence: "occ-1", byCollection: {} });
  });
});

describe("rowViewSettingsForColumns", () => {
  it("drops settings that reference a removed column", () => {
    const settings = { sort: { field: "c-name", direction: "asc" as const }, filter: { field: "c-price", text: "1" }, kept: new Set(["alpha"]) };
    expect(rowViewSettingsForColumns(settings, new Set(["c-price"]))).toEqual({
      sort: undefined, filter: { field: "c-price", text: "1" }, kept: new Set(["alpha"]),
    });
    expect(rowViewSettingsForColumns(settings, new Set(["c-name"]))).toEqual({
      sort: { field: "c-name", direction: "asc" }, filter: undefined, kept: undefined,
    });
  });

  it("keeps settings through a rename, which leaves the id unchanged", () => {
    const settings = { sort: { field: "c-name", direction: "asc" as const }, filter: { field: "c-price", text: "1" }, kept: new Set(["alpha"]) };
    expect(rowViewSettingsForColumns(settings, new Set(["c-name", "c-price"]))).toBe(settings);
  });
});

describe("confirmed insertion visibility", () => {
  const added = row("added", { name: "Zeta", price: 99 });
  const filtered = { filter: { field: "c-name", text: "alpha" } };

  it("keeps a reported inserted row visible under the active filter", () => {
    const settings = rowViewKeepingRows(filtered, ["added"]);
    expect(settings.kept).toEqual(new Set(["added"]));
    expect(rowViewOrder([alpha, added], columns, settings).map(row => row.id)).toEqual(["alpha", "added"]);
  });

  it("keeps nothing when no filter is active", () => {
    expect(rowViewKeepingRows({}, ["added"])).toEqual({});
  });

  it("keeps nothing when the publication named no row", () => {
    expect(rowViewKeepingRows(filtered, []).kept).toBeUndefined();
  });

  it("survives a table switch and back", () => {
    const tableA = rowViewKeepingRows(filtered, ["added"]);
    const record = { occurrence: "occ-1", byCollection: { a: tableA, b: { sort: { field: "c-name", direction: "asc" as const } } } };
    // Switching tables and returning to the same occurrence keeps A's entry.
    const returned = rowViewRecordForOccurrence(record, "occ-1");
    expect(rowViewOrder([alpha, added], columns, returned.byCollection.a!).map(row => row.id)).toEqual(["alpha", "added"]);
    // A different confirmed occurrence clears it.
    expect(rowViewRecordForOccurrence(record, "occ-2").byCollection.a).toBeUndefined();
  });

  it("is discarded when the filter changes or is cleared, but kept when re-applied unchanged", () => {
    const settings = rowViewKeepingRows(filtered, ["added"]);
    expect(rowViewSettingsForFilter(settings, "c-name", "alpha").kept).toBe(settings.kept);
    expect(rowViewSettingsForFilter(settings, "c-name", "beta").kept).toBeUndefined();
    expect(rowViewSettingsForFilter(settings, "c-name", "  ").kept).toBeUndefined();
  });
});

describe("rowViewDisplaySignature", () => {
  it("changes when the sort field or direction changes, so a selection is cleared", () => {
    const ascending = rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" } });
    expect(rowViewDisplaySignature({ sort: { field: "c-name", direction: "desc" } })).not.toBe(ascending);
    expect(rowViewDisplaySignature({ sort: { field: "c-price", direction: "asc" } })).not.toBe(ascending);
    expect(rowViewDisplaySignature({})).not.toBe(ascending);
    expect(rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" } })).toBe(ascending);
  });

  it("changes with the filter and keeps the sort and filter apart", () => {
    const filtered = rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" }, filter: { field: "c-name", text: "a" } });
    expect(rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" } })).not.toBe(filtered);
    expect(rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" }, filter: { field: "c-name", text: "b" } })).not.toBe(filtered);
    expect(rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" }, filter: { field: "c-name", text: "a" } })).toBe(filtered);
    // Each part is delimited, so a filter text cannot impersonate a sort.
    expect(rowViewDisplaySignature({ filter: { field: "c-name", text: "asc" } }))
      .not.toBe(rowViewDisplaySignature({ sort: { field: "c-name", direction: "asc" } }));
  });
});

describe("rowViewBlockRows", () => {
  it("addresses the displayed rows, not the stored order", () => {
    const a = row("a", { name: "Apple" });
    const b = row("b", { name: "Banana" });
    const c = row("c", { name: "Cherry" });
    const sorted = rowViewOrder([c, a, b], columns, { sort: { field: "c-name", direction: "asc" } });
    expect(sorted.map(row => row.id)).toEqual(["a", "b", "c"]);
    // Paste two rows from the first displayed row: targets A then B.
    expect(rowViewBlockRows(sorted, 0, 2).map(row => row.id)).toEqual(["a", "b"]);
    // Clearing the first displayed row targets A, never the stored first row C.
    expect(rowViewBlockRows(sorted, 0, 1).map(row => row.id)).toEqual(["a"]);
  });
});

describe("rowViewFilterKeyAction", () => {
  it("applies on a typed Enter and cancels on Escape", () => {
    expect(rowViewFilterKeyAction({ key: "Enter" })).toBe("apply");
    expect(rowViewFilterKeyAction({ key: "Escape" })).toBe("cancel");
  });

  it("does nothing for an IME composition key", () => {
    expect(rowViewFilterKeyAction({ key: "Enter", composing: true })).toBe(null);
    expect(rowViewFilterKeyAction({ key: "Enter", keyCode: 229 })).toBe(null);
    expect(rowViewFilterKeyAction({ key: "p" })).toBe(null);
  });
});

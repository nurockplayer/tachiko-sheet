import { describe, expect, it } from "vitest";
import { findGridMatches, findStatusText, stepGridMatch } from "./find-in-grid.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const column = (id: string): TableColumn => ({ id, key: id, display_name: id, field_type: "text", required: false });
const text = (field: string, value: string) => ({ target: { entity: "e", field }, address: field, stored: { kind: "text", value }, formula: null, calculated: null, diagnostics: [], editable_scalar: "text" });
const row = (id: string, values: Record<string, string>): TableRow => ({ id, key: id, blank_fields: [], fields: Object.entries(values).map(([field, value]) => text(field, value)) } as unknown as TableRow);

describe("find in grid", () => {
  const columns = [column("a"), column("b")];
  const rows = [row("r1", { a: "Alpha", b: "x" }), row("r2", { a: "y", b: "Beta ALPHA" })];

  it("matches case-insensitively across columns in row-then-column order", () => {
    const matches = findGridMatches(rows, columns, "alpha");
    expect(matches.map(({ field, rowIndex }) => [field, rowIndex])).toEqual([["a", 0], ["b", 1]]);
  });

  it("returns no matches for an empty or whitespace query", () => {
    expect(findGridMatches(rows, columns, "")).toEqual([]);
    expect(findGridMatches(rows, columns, "   ")).toEqual([]);
  });

  it("keeps meaningful spaces in the query", () => {
    const named = [row("r1", { a: "ACME Products", b: "ACMEProducts" })];
    expect(findGridMatches(named, columns, "acme ").map(match => match.field)).toEqual(["a"]);
  });

  it("wraps forward and backward and starts before the first match from -1", () => {
    expect(stepGridMatch(3, -1, 1)).toBe(0);
    expect(stepGridMatch(3, -1, -1)).toBe(2);
    expect(stepGridMatch(3, 2, 1)).toBe(0);
    expect(stepGridMatch(3, 0, -1)).toBe(2);
    expect(stepGridMatch(0, 0, 1)).toBe(-1);
  });

  it("formats the status text", () => {
    expect(findStatusText(0, -1)).toBe("No matches");
    expect(findStatusText(3, -1)).toBe("0 of 3");
    expect(findStatusText(3, 1)).toBe("2 of 3");
  });
});

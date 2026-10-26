import { describe, expect, it } from "vitest";

import type { CapacityFailureProjection } from "../../public/core-kit/runtime/protocol.js";
import { capacityForView, capacityMessage } from "./capacity-message.js";

const base = { code: "capacity_exceeded", current_revision: "r1", message: "capacity", diagnostics: [], maximum: 1000, attempted: 1200 } as const;

describe("capacityMessage", () => {
  it.each([
    ["table_rows", "This table can hold up to 1,000 rows; this change would make 1,200. Nothing was changed."],
    ["table_fields", "This table can hold up to 1,000 columns; this change would make 1,200. Nothing was changed."],
    ["populated_cells", "This workbook can hold up to 1,000 filled cells; this change would make 1,200. Nothing was changed."],
    ["total_entities", "This workbook can hold up to 1,000 rows across all tables; this change would make 1,200. Nothing was changed."],
    ["collections", "This workbook can hold up to 1,000 tables; this change would make 1,200. Nothing was changed."],
    ["formulas", "This workbook can hold up to 1,000 formulas; this change would make 1,200. Nothing was changed."],
    ["formula_ast_nodes", "The formulas in this workbook can hold up to 1,000 parts in all; this change would make 1,200. Nothing was changed."],
    ["dependency_edges", "The formulas in this workbook can hold up to 1,000 references in all; this change would make 1,200. Nothing was changed."],
  ] as const)("formats %s refusals", (limit, expected) => {
    const failure = { ...base, limit, ...(limit === "table_rows" || limit === "table_fields" ? { collection: "items" } : {}) } as unknown as CapacityFailureProjection;
    expect(capacityMessage(failure)).toBe(expected);
  });

  it("names a refused table that is not the one on screen", () => {
    const failure = { ...base, limit: "table_rows", collection: "c-other" } as unknown as CapacityFailureProjection;
    expect(capacityMessage(failure, "The table “Orders”")).toBe("The table “Orders” can hold up to 1,000 rows; this change would make 1,200. Nothing was changed.");
  });
});

describe("capacityForView", () => {
  const reading = { occurrence: "o1", revision: "r1", collectionId: "c1", rows: 95, maximum: 100 };
  const view = (occurrence: string, revision: string, id: string) => ({ occurrence, revision, table: { collection: { id } } });

  it("shows a reading only on the table, revision and occurrence it was read for", () => {
    expect(capacityForView(reading, view("o1", "r1", "c1"))).toEqual({ rows: 95, maximum: 100 });
    expect(capacityForView(reading, view("o1", "r1", "c2"))).toBeNull();
    expect(capacityForView(reading, view("o1", "r2", "c1"))).toBeNull();
    expect(capacityForView(reading, view("o2", "r1", "c1"))).toBeNull();
    expect(capacityForView(null, view("o1", "r1", "c1"))).toBeNull();
  });
});

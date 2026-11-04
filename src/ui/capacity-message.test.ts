import { describe, expect, it } from "vitest";

import type { CapacityFailureProjection } from "../../public/core-kit/runtime/protocol.js";
import { capacityForView, capacityMessage, importCapacityMessage } from "./capacity-message.js";

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

describe("importCapacityMessage", () => {
  // Work may stop counting early, so a limit it names is a lower bound.
  it.each([
    ["table_rows", "The sheet “Orders” has at least 200 rows; Tachiko can import up to 128 rows per sheet. The workbook was not imported."],
    ["table_fields", "The sheet “Orders” has at least 40 columns; Tachiko can import up to 32 columns per sheet. The workbook was not imported."],
    ["collections", "The workbook has at least 40 sheets; Tachiko can import up to 32. The workbook was not imported."],
    ["total_entities", "The workbook has at least 2,000 rows in all; Tachiko can import up to 1,024. The workbook was not imported."],
    ["formulas", "The workbook has at least 40 formulas; Tachiko can import up to 32. The workbook was not imported."],
  ] as const)("names the %s limit and the refused sheet", (limit, expected) => {
    const failure = {
      ...base,
      limit,
      attempted: limit === "total_entities" ? 2000 : limit === "table_rows" ? 200 : 40,
      maximum: limit === "total_entities" ? 1024 : limit === "table_rows" ? 128 : 32,
      ...(limit === "table_rows" || limit === "table_fields" ? { collection: "Orders" } : {}),
    } as unknown as CapacityFailureProjection;
    expect(importCapacityMessage(failure)).toBe(expected);
  });

  it("never names a sheet for a workbook-wide limit", () => {
    const failure = { ...base, limit: "formulas", maximum: 32, attempted: 40 } as unknown as CapacityFailureProjection;
    expect(importCapacityMessage(failure)).not.toContain("sheet “");
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

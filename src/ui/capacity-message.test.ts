import { describe, expect, it } from "vitest";

import type { CapacityFailureProjection } from "../../public/core-kit/runtime/protocol.js";
import { capacityMessage } from "./capacity-message.js";

const base = { code: "capacity_exceeded", current_revision: "r1", message: "capacity", diagnostics: [], maximum: 1000, attempted: 1200 } as const;

describe("capacityMessage", () => {
  it.each([
    ["table_rows", "This table can hold up to 1,000 rows; this change would make 1,200. Nothing was changed."],
    ["table_fields", "This table can hold up to 1,000 columns; this change would make 1,200. Nothing was changed."],
    ["populated_cells", "This workbook can hold up to 1,000 filled cells; this change would make 1,200. Nothing was changed."],
    ["total_entities", "This workbook can hold up to 1,000 rows across all tables; this change would make 1,200. Nothing was changed."],
    ["collections", "This workbook can hold up to 1,000 tables; this change would make 1,200. Nothing was changed."],
    ["formulas", "This workbook can hold up to 1,000 formulas; this change would make 1,200. Nothing was changed."],
    ["formula_ast_nodes", "This change makes the formulas too large for one workbook (limit 1000). Nothing was changed."],
    ["dependency_edges", "This change makes the formulas too large for one workbook (limit 1000). Nothing was changed."],
  ] as const)("formats %s refusals", (limit, expected) => {
    const failure = { ...base, limit, ...(limit === "table_rows" || limit === "table_fields" ? { collection: "items" } : {}) } as unknown as CapacityFailureProjection;
    expect(capacityMessage(failure)).toBe(expected);
  });
});

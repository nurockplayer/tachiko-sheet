import { describe, expect, it } from "vitest";
import { tableRefusal } from "./table-refusals.js";

describe("table delete refusals", () => {
  it.each([
    ["last_table", "Keep at least one table in this work. Add another table before deleting this one. Nothing was changed."],
    ["table_referenced", "This table is used by a formula, reference or cross-table summary. Remove those references before deleting it. Nothing was changed."],
    ["missing_collection", "This table is no longer available. Refresh the work before trying again."],
    ["capacity_exceeded", "Existing wording"],
  ])("explains %s", (refusalCode, expected) => {
    expect(tableRefusal({ kind: "refused", refusalCode, message: "Existing wording" })).toBe(expected);
  });
});

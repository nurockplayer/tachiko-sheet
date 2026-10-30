import { describe, expect, it } from "vitest";
import { constraintMessage } from "./constraint-message.js";

const names = (field: string) => ({ f1: "Priority", f2: "Status" } as Record<string, string>)[field];
const range = { kind: "number_inclusive_range", min: 1, max: 5 };
const list = { kind: "text_literal_set", values: ["Doing", "Done", "Todo"] };

describe("constraintMessage", () => {
  it("names the column and its rule for a refused value", () => {
    expect(constraintMessage({ reason: "field_value", schema: "s", field: "f1", constraint: range, offending_rows: 1 }, names)).toBe("Priority must be between 1 and 5.");
    expect(constraintMessage({ reason: "field_value", schema: "s", field: "f2", constraint: list, offending_rows: 1 }, names)).toBe("Status must be one of Doing, Done or Todo.");
  });

  it("counts existing rows that block a new rule", () => {
    expect(constraintMessage({ reason: "existing_values", schema: "s", field: "f1", constraint: range, offending_rows: 1 }, names)).toBe("1 row in Priority is not between 1 and 5. Change it first, or choose a rule that fits.");
    expect(constraintMessage({ reason: "existing_values", schema: "s", field: "f2", constraint: list, offending_rows: 3 }, names)).toBe("3 rows in Status are not one of Doing, Done or Todo. Change them first, or choose a rule that fits.");
  });

  it("falls back without ids, shortens long lists, and leaves declarations and unknown shapes to the caller", () => {
    expect(constraintMessage({ reason: "field_value", schema: "s", field: "other", constraint: range, offending_rows: 1 }, names)).toBe("This column must be between 1 and 5.");
    const long = { kind: "text_literal_set", values: ["a", "b", "c", "d", "e", "f", "g"] };
    expect(constraintMessage({ reason: "field_value", schema: "s", field: "f2", constraint: long, offending_rows: 1 }, names)).toBe("Status must be one of its allowed values.");
    expect(constraintMessage({ reason: "declaration", schema: "s", field: "f1", constraint: range, offending_rows: 0 }, names)).toBeNull();
    expect(constraintMessage({ reason: "declaration", offending_rows: 0 }, names)).toBeNull();
    expect(constraintMessage(undefined, names)).toBeNull();
  });
});

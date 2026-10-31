import { describe, expect, it } from "vitest";
import type { ColumnProjection, GroupTotalsProjection } from "../../public/core-kit/runtime/protocol.js";
import {
  defaultGroupSetup,
  defaultThenBucket,
  groupDimensions,
  groupDimensionHeader,
  groupKeyLabel,
  groupRefusalMessage,
  groupScopeFor,
  groupTotalsTsv,
  groupableColumns,
  measureColumns,
} from "./group-totals.js";

function column(id: string, display_name: string, field_type: string): ColumnProjection {
  return { id, key: id, display_name, field_type, required: false };
}

const DATE = column("date", "Date", "date");
const CATEGORY = column("category", "Category", "text");
const CLEARED = column("cleared", "Cleared", "boolean");
const AMOUNT = column("amount", "Amount", "number");
const FEE = column("fee", "Fee", "number");
const COLUMNS = [DATE, CATEGORY, CLEARED, AMOUNT, FEE];

const PROJECTION: GroupTotalsProjection = {
  revision: "r1",
  dimensions: [{ field: "category" }, { field: "date", bucket: "month" }],
  measures: ["amount"],
  rows: 5,
  totals: [-12.5],
  groups: [
    { keys: [{ kind: "text", value: "Food" }, { kind: "month", value: "2026-01" }], rows: 3, totals: [-12.5] },
    { keys: [{ kind: "text", value: "" }, { kind: "blank" }], rows: 2, totals: [null] },
  ],
};

describe("group totals columns", () => {
  it("offers Text, Date and Yes/No columns to group by and Number columns to sum", () => {
    expect(groupableColumns(COLUMNS).map(({ id }) => id)).toEqual(["date", "category", "cleared"]);
    expect(measureColumns(COLUMNS).map(({ id }) => id)).toEqual(["amount", "fee"]);
  });

  it("defaults to a month bucket and the first Number column", () => {
    expect(defaultGroupSetup(CATEGORY, COLUMNS)).toEqual({
      dimension: "category", bucket: "month", then: null, thenBucket: "month", measures: ["amount"],
    });
  });

  it("picks a second bucket so the same Date column is not grouped twice at month", () => {
    expect(defaultThenBucket(DATE, "month", DATE)).toBe("year");
    expect(defaultThenBucket(DATE, "year", DATE)).toBe("month");
    expect(defaultThenBucket(CATEGORY, "month", DATE)).toBe("month");
    expect(defaultThenBucket(DATE, "month", CATEGORY)).toBe("month");
  });

  it("builds the wire dimensions, with a bucket only for Date columns", () => {
    expect(groupDimensions(COLUMNS, { dimension: "category", bucket: "month", then: DATE.id, thenBucket: "year", measures: ["amount"] })).toEqual([
      { field: "category" },
      { field: "date", bucket: "year" },
    ]);
    expect(groupDimensions(COLUMNS, { dimension: "date", bucket: "value", then: null, thenBucket: "month", measures: ["amount"] })).toEqual([
      { field: "date", bucket: "value" },
    ]);
  });

  it("keeps an empty text key apart from a blank group and spells booleans as the grid does", () => {
    expect(groupKeyLabel({ kind: "text", value: "Food" })).toBe("Food");
    expect(groupKeyLabel({ kind: "text", value: "" })).toBe("(empty)");
    expect(groupKeyLabel({ kind: "blank" })).toBe("(blank)");
    expect(groupKeyLabel({ kind: "boolean", value: true })).toBe("true");
    expect(groupKeyLabel({ kind: "boolean", value: false })).toBe("false");
    expect(groupKeyLabel({ kind: "date", value: "2026-01-02" })).toBe("2026-01-02");
    expect(groupKeyLabel({ kind: "month", value: "2026-01" })).toBe("2026-01");
    expect(groupKeyLabel({ kind: "year", value: "2026" })).toBe("2026");
  });

  it("names a Date dimension by its bucket", () => {
    expect(groupDimensionHeader(CATEGORY, undefined)).toBe("Category");
    expect(groupDimensionHeader(DATE, "value")).toBe("Date (day)");
    expect(groupDimensionHeader(DATE, "month")).toBe("Date (month)");
    expect(groupDimensionHeader(DATE, "year")).toBe("Date (year)");
  });
});

describe("group totals clipboard text", () => {
  it("writes the header, Work's groups and the Total row with unformatted numbers", () => {
    expect(groupTotalsTsv(PROJECTION, COLUMNS).split("\n")).toEqual([
      "Category\tDate (month)\tRows\tAmount",
      "Food\t2026-01\t3\t-12.5",
      "(empty)\t(blank)\t2\t",
      "Total\t\t5\t-12.5",
    ]);
  });
});

describe("group totals refusals", () => {
  it("turns Work's refusal codes into the panel's messages", () => {
    expect(groupRefusalMessage("group_limit_exceeded", "x")).toBe("More than 200 groups. Group by a column with fewer different values, or filter the rows first.");
    expect(groupRefusalMessage("result_size_exceeded", "x")).toBe("These totals are too large to show. Group by a column with shorter values, or filter the rows first.");
    expect(groupRefusalMessage("invalid_group_query", "No such column.")).toBe("Totals are unavailable: No such column.");
  });
});

describe("group scope", () => {
  it("covers every row when nothing is hidden", () => {
    expect(groupScopeFor(null, ["a", "b"], 60_000)).toEqual({ kind: "all" });
    expect(groupScopeFor(["a", "b"], ["a", "b"], 60_000)).toEqual({ kind: "all" });
  });

  it("sends the shorter of the shown and hidden entity lists", () => {
    expect(groupScopeFor(["a"], ["a", "b", "c"], 60_000)).toEqual({ kind: "entities", entities: ["a"] });
    expect(groupScopeFor(["a", "b", "c"], ["a", "b", "c", "d"], 60_000)).toEqual({ kind: "except", entities: ["d"] });
  });

  it("returns null when even the shorter list exceeds the wire budget", () => {
    expect(groupScopeFor(["a", "b", "c"], ["a", "b", "c", "d"], 1)).toBeNull();
    expect(groupScopeFor(["a"], ["a", "b", "c"], 1)).toBeNull();
  });
});

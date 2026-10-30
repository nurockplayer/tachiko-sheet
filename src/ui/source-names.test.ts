import { describe, expect, it } from "vitest";
import type { InteropMetadata } from "../contracts.js";
import { copyColumnNames, sourceNames } from "./source-names.js";

const sheet = (schema_id: string, name: string, has_header: boolean, columns: string[]) => ({
  schema_id, name, has_header, columns: columns.map((column, index) => ({ field_id: `${schema_id}-f${index}`, name: column, width: null })), rows: [],
});
const metadata = (...sheets: ReturnType<typeof sheet>[]) => ({ version: 1, sheets } as unknown as InteropMetadata);

describe("source names", () => {
  it("names CSV work and its table after the file and columns after headers", () => {
    const names = sourceNames(metadata(sheet("s1", "sheet_1", true, ["item", " quantity ", ""])), "january-sales.csv");
    expect(names.title).toBe("january-sales.csv");
    expect(names.table("s1")).toBe("january-sales");
    expect(names.column("s1", "s1-f0")).toBe("item");
    expect(names.column("s1", "s1-f1")).toBe(" quantity ");
    expect(names.column("s1", "s1-f2")).toBeNull();
  });

  it("uses worksheet names for XLSX and falls back when unknown or headerless", () => {
    const names = sourceNames(metadata(sheet("a", "Catalog", true, ["code"]), sheet("b", "Sales", false, ["A"])), "book.xlsx");
    expect(names.table("a")).toBe("Catalog");
    expect(names.table("b")).toBe("Sales");
    expect(names.column("b", "b-f0")).toBeNull();
    expect(names.table("missing")).toBeNull();
    expect(sourceNames(null, "x.csv").title).toBeNull();
  });
});

describe("Work explicit display-name presence", () => {
  const current = (explicit = false, name = "Current item"): import("../contracts.js").WorkbookView["table"] => ({
    revision: "r1", collection: { id: "s1", key: "sheet", display_name: "Sheet", entity_count: 0 }, rows: [],
    native_table_profile: true,
    columns: [
      { id: "s1-f1", key: "column_2", display_name: "Amount", field_type: "number", required: false },
      { id: "s1-f0", key: "column_1", display_name: name, field_type: "text", required: false, ...(explicit ? { display_name_explicit: true as const } : {}) },
    ],
  });
  const imported = () => metadata(sheet("s1", "Sheet", true, ["Item", "Quantity"]));

  it("joins by stable field ID and replaces metadata only for explicit current names", () => {
    expect(sourceNames(imported(), null, current(true), true).column("s1", "s1-f0")).toBe("Current item");
    expect(sourceNames(imported(), null, current(false), true).column("s1", "s1-f0")).toBe("Item");
    expect(sourceNames(imported(), null, current(true), true).column("s1", "s1-f1")).toBe("Quantity");
  });
  it("keeps an explicit generated-key spelling and exact explicit text", () => {
    for (const name of ["column_1", "  Current item  "]) {
      expect(sourceNames(imported(), null, current(true, name), true).column("s1", "s1-f0")).toBe(name);
    }
  });
  it("falls back to the current name for a missing metadata field without inventing foreign matches", () => {
    const missing = metadata(sheet("s1", "Sheet", true, []));
    expect(sourceNames(missing, null, current(true), true).column("s1", "s1-f0")).toBe("Current item");
    expect(sourceNames(missing, null, current(false), true).column("s1", "s1-f0")).toBe("Current item");
    expect(sourceNames(missing, null, current(true), true).column("foreign", "s1-f0")).toBeNull();
  });
  it("keeps a blank or whitespace imported heading identifiable through the projected name", () => {
    for (const heading of ["", "   "]) {
      const blank = metadata(sheet("s1", "Sheet", true, [heading, "Quantity"]));
      expect(sourceNames(blank, null, current(false, "column_1"), true).column("s1", "s1-f0")).toBe("column_1");
      expect(sourceNames(blank, null, current(true, "Renamed"), true).column("s1", "s1-f0")).toBe("Renamed");
    }
    const spaced = metadata(sheet("s1", "Sheet", true, ["  Item  ", "Quantity"]));
    expect(sourceNames(spaced, null, current(false), true).column("s1", "s1-f0")).toBe("  Item  ");
  });
  it("uses current projections for non-imported tables", () => {
    expect(sourceNames(null, null, current(false), true).column("s1", "s1-f0")).toBe("Current item");
  });
  it("keeps metadata precedence when the capability marker is absent", () => {
    expect(sourceNames(imported(), null, current(true), false).column("s1", "s1-f0")).toBe("Item");
    expect(sourceNames(null, null, current(true), false).column("s1", "s1-f0")).toBe("Current item");
  });
});

describe("copy column names", () => {
  const columns = [
    { id: "f0", display_name: "column_1" },
    { id: "f1", display_name: "column_2" },
    { id: "f2", display_name: "column_3" },
    { id: "f3", display_name: "Kept" },
  ];

  it("sends the shown names, trimmed as Work trims them", () => {
    const shown: Record<string, string> = { f0: "Date", f1: "\u3000Description ", f3: "Kept" };
    expect(copyColumnNames(columns, field => shown[field] ?? null)).toEqual({ f0: "Date", f1: "Description" });
  });

  it("leaves out names that would collide once trimmed, keeping Work's own name there", () => {
    const shown: Record<string, string> = { f0: "Amount", f1: " Amount ", f2: "column_4", f3: "Note" };
    expect(copyColumnNames([...columns, { id: "f4", display_name: "column_4" }], field => shown[field] ?? null))
      .toEqual({ f3: "Note" });
  });

  it("rechecks after a dropped name gives a column back its own name", () => {
    const shown: Record<string, string> = { f0: "Amount", f1: " Amount ", f2: "column_1" };
    expect(copyColumnNames(columns, field => shown[field] ?? null)).toEqual({});
  });

  it("leaves out blank and over-long names", () => {
    const shown: Record<string, string> = { f0: "  ", f1: "x".repeat(4_097), f2: "é".repeat(2_048) };
    expect(copyColumnNames(columns, field => shown[field] ?? null)).toEqual({ f2: "é".repeat(2_048) });
  });
});

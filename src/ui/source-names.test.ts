import { describe, expect, it } from "vitest";
import type { InteropMetadata } from "../contracts.js";
import { sourceNames } from "./source-names.js";

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
    expect(names.column("s1", "s1-f1")).toBe("quantity");
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

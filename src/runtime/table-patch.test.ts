import { describe, expect, it } from "vitest";
import type { FieldProjection, TableProjection } from "../../public/core-kit/experimental-client.js";
import { patchTable } from "./table-patch.js";

function field(entity: string, value: number): FieldProjection {
  return { target: { entity, field: "amount" }, address: `${entity}.amount`, stored: { kind: "number", value },
    formula: null, calculated: null, diagnostics: [], editable_scalar: "number" };
}
function table(): TableProjection {
  return { revision: "r1", collection: { id: "c", key: "table", display_name: "Table", entity_count: 2 },
    columns: [{ id: "amount", key: "amount", display_name: "Amount", field_type: "number", required: false }], rows: ["e1", "e2"].map(id => ({ id, key: id, fields: [field(id, 1)] })) };
}

describe("patchTable", () => {
  it("replaces the whole cell projection", () => {
    const changed = field("e1", 9);
    expect(patchTable(table(), [changed])!.rows[0]!.fields[0]).toEqual(changed);
  });
  it("patches a formula result in another row", () => {
    const result: FieldProjection = { ...field("e2", 18), stored: null, formula: { source: "9 * 2" },
      calculated: { status: "value", value: 18 } };
    expect(patchTable(table(), [field("e1", 9), result])!.rows[1]!.fields[0]).toEqual(result);
  });
  it("refuses an unknown entity", () => expect(patchTable(table(), [field("missing", 9)])).toBeNull());
  it("refuses an unknown field", () => {
    expect(patchTable(table(), [{ ...field("e1", 9), target: { entity: "e1", field: "missing" } }])).toBeNull();
  });
  it("does not mutate inputs and retains untouched row objects", () => {
    const before = table();
    const snapshot = structuredClone(before);
    const changed = [field("e1", 9)];
    const changeSnapshot = structuredClone(changed);
    const after = patchTable(before, changed)!;
    expect(before).toEqual(snapshot);
    expect(changed).toEqual(changeSnapshot);
    expect(after).not.toBe(before);
    expect(after.rows[0]).not.toBe(before.rows[0]);
    expect(after.rows[1]).toBe(before.rows[1]);
  });
  it("refuses conflicting duplicate targets", () => {
    expect(patchTable(table(), [field("e1", 8), field("e1", 9)])).toBeNull();
  });
  it("accepts identical duplicate targets regardless of property order", () => {
    const cell = field("e1", 9);
    expect(patchTable(table(), [cell, { ...cell, target: { field: "amount", entity: "e1" } }])).not.toBeNull();
  });
});

function cell(id: string, value = 1): FieldProjection {
  return { ...field("e1", value), target: { entity: "e1", field: id }, address: `e1.${id}` };
}
function sparseTable(): TableProjection {
  const base = table();
  return { ...base, columns: ["a", "b", "c"].map(id => ({ ...base.columns[0]!, id, key: id })),
    rows: [{ id: "e1", key: "e1", fields: [cell("a"), cell("c")], blank_fields: ["b"] }] };
}
function blank(id: string): FieldProjection {
  return { ...cell(id), blank: true, stored: null, editable_scalar: null };
}

describe("canonical sparse rows", () => {
  it("clears a present cell and orders blank IDs by column", () => {
    const before = sparseTable();
    const snapshot = structuredClone(before);
    const after = patchTable(before, [blank("a")])!;
    expect(after.rows[0]).toEqual({ id: "e1", key: "e1", fields: [cell("c")], blank_fields: ["a", "b"] });
    expect(before).toEqual(snapshot);
  });
  it("fills a middle blank cell in column order and omits empty blank_fields", () => {
    expect(patchTable(sparseTable(), [cell("b", 2)])!.rows[0]).toEqual({
      id: "e1", key: "e1", fields: [cell("a"), cell("b", 2), cell("c")],
    });
  });
  it("fills one cell then clears another in one changed list", () => {
    expect(patchTable(sparseTable(), [cell("b", 2), blank("a")])!.rows[0]).toEqual({
      id: "e1", key: "e1", fields: [cell("b", 2), cell("c")], blank_fields: ["a"],
    });
  });
  it("represents a row left with all cells blank", () => {
    expect(patchTable(sparseTable(), [blank("c"), blank("a")])!.rows[0]).toEqual({
      id: "e1", key: "e1", fields: [], blank_fields: ["a", "b", "c"],
    });
  });
  it("drops display from changed cells without mutating them", () => {
    const changed = { ...cell("b", 2), display: "2.00" };
    expect(patchTable(sparseTable(), [changed])!.rows[0]!.fields[1]).toEqual(cell("b", 2));
    expect(changed.display).toBe("2.00");
  });
  it.each(["field order", "blank order", "missing", "overlap", "duplicate", "display", "unknown"])(
    "refuses existing rows with %s", reason => {
      const before = sparseTable();
      const row = before.rows[0]!;
      switch (reason) {
        case "field order": row.fields.reverse(); break;
        case "blank order": row.fields = [cell("b")]; row.blank_fields = ["c", "a"]; break;
        case "missing": row.blank_fields = []; break;
        case "overlap": row.blank_fields = ["a"]; break;
        case "duplicate": row.fields = [cell("a"), cell("a")]; break;
        case "display": row.fields[0] = { ...cell("a"), display: "1.00" }; break;
        case "unknown": row.blank_fields = ["unknown"]; break;
      }
      expect(patchTable(before, [cell("b", 2)])).toBeNull();
    });
  it("refuses a noncanonical untouched row too", () => {
    const before = sparseTable();
    before.rows.push({ id: "bad", key: "bad", fields: [] });
    expect(patchTable(before, [cell("b", 2)])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { FieldProjection, TableProjection } from "../../public/core-kit/experimental-client.js";
import { patchTable } from "./table-patch.js";

function field(entity: string, value: number): FieldProjection {
  return { target: { entity, field: "amount" }, address: `${entity}.amount`, stored: { kind: "number", value },
    formula: null, calculated: null, diagnostics: [], editable_scalar: "number", display: `${value}.00` };
}
function table(): TableProjection {
  return { revision: "r1", collection: { id: "c", key: "table", display_name: "Table", entity_count: 2 },
    columns: [], rows: ["e1", "e2"].map(id => ({ id, key: id, fields: [field(id, 1)] })) };
}

describe("patchTable", () => {
  it("replaces the whole cell including display text", () => {
    const changed = field("e1", 9);
    expect(patchTable(table(), [changed])!.rows[0]!.fields[0]).toEqual(changed);
  });
  it("patches a formula result in another row", () => {
    const result = { ...field("e2", 18), formula: { source: "9 * 2" } };
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
    expect(patchTable(table(), [cell, { display: cell.display, ...cell }])).not.toBeNull();
  });
});

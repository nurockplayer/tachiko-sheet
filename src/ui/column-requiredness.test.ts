import { describe, expect, it, vi } from "vitest";
import type { WorkbookView } from "../contracts.js";
import { canChangeRequiredness, completeBlankCount, newColumnInput, requirednessRefusal } from "./column-requiredness.js";
import { initialColumnDraft, submitColumnIntent } from "./column-operations.js";

describe("column requiredness intent", () => {
  for (const field_type of ["text", "number", "date", "boolean"] as const) {
    it(`shapes explicit default and required ${field_type} declarations`, () => {
      expect(newColumnInput({ name: "A", field_type })).toEqual({ name: "A", field_type, required: !["text", "number"].includes(field_type) });
      expect(newColumnInput({ name: "A", field_type, required: true }).required).toBe(true);
      expect(newColumnInput({ name: "A", field_type, required: false }).required).toBe(!["text", "number"].includes(field_type));
    });
  }
  const state = { kind: "add" as const, occurrence: "o", revision: "r", collection: "c", rowEntities: ["e1", "e2"] };
  for (const fieldType of ["text", "number", "date", "boolean"] as const) {
    for (const required of [false, true]) {
      it(`shapes add ${fieldType} required=${required} without relying on defaults`, async () => {
        const draft = { ...initialColumnDraft(state), fieldType, required, name: "Raw name", fill: fieldType === "boolean" ? "no" : "12" };
        const onAddColumn = vi.fn(async () => ({ kind: "confirmed" as const }));
        const context = { table: null, metadata: null, onAddColumn };
        await submitColumnIntent(state, draft, context);
        const effectiveRequired = required || !["text", "number"].includes(fieldType);
        expect(onAddColumn.mock.calls[0]?.slice(0, 4)).toEqual([state, "c", "Raw name", fieldType]);
        const args = onAddColumn.mock.calls[0] as unknown as unknown[];
        expect(args[5]).toBe(effectiveRequired);
        expect(args[4]).toEqual(effectiveRequired ? state.rowEntities.map(entity => ({ entity, input: fieldType === "text" ? { kind: "text", value: "12" } : fieldType === "number" ? { kind: "number", input: "12" } : fieldType === "date" ? { kind: "date", value: "12" } : { kind: "boolean", value: false } })) : undefined);
        if (!effectiveRequired) {
          await submitColumnIntent(state, { ...draft, fillExisting: true }, context);
          expect((onAddColumn.mock.calls[1] as unknown as unknown[])[4]).toHaveLength(2);
        }
      });
    }
  }
  const table = (type = "text", native = true) => ({ native_table_profile: native, revision: "r", collection: { entity_count: 1 }, columns: [{ id: "f", field_type: type, required: false }], rows: [{ id: "e", blank_fields: ["f"], fields: [] }] }) as unknown as WorkbookView["table"];
  it("offers only native Text/Number requiredness, independent of imported Rename", () => {
    for (const type of ["text", "number", "date", "boolean", "reference"]) for (const native of [true, false]) {
      expect(canChangeRequiredness(table(type, native), "f")).toBe(native && ["text", "number"].includes(type));
    }
    expect(canChangeRequiredness(table(), "missing")).toBe(false);
    expect(canChangeRequiredness(null, "f")).toBe(false);
  });
  it("counts only complete current presence projections", () => {
    expect(completeBlankCount(table(), "f", "r")).toBe(1);
    expect(completeBlankCount(table(), "f", "old")).toBeNull();
    const partial = table(); partial.collection.entity_count = 2;
    expect(completeBlankCount(partial, "f", "r")).toBeNull();
    const absentCoverage = table(); absentCoverage.rows[0]!.blank_fields = [];
    expect(completeBlankCount(absentCoverage, "f", "r")).toBeNull();
    const emptyText = table(); emptyText.rows[0]!.blank_fields = [];
    emptyText.rows[0]!.fields = [{ target: { entity: "e", field: "f" }, stored: { kind: "text", value: "" } }] as typeof emptyText.rows[0]["fields"];
    expect(completeBlankCount(emptyText, "f", "r")).toBe(0);
    expect(requirednessRefusal("blank values", "edit_rejected", null, "Price")).toBe("blank values");
    expect(requirednessRefusal("blank values", "edit_rejected", 3, "Price")).toBe("3 rows in Price are blank. Fill them before requiring a value.");
    expect(requirednessRefusal("semantic command was rejected: field 'row.field/column' does not exist", "edit_rejected", 1, "Extra")).toBe("1 row in Extra is blank. Fill it before requiring a value.");
    expect(requirednessRefusal("semantic command was rejected: field 'row.field/column' does not exist", "edit_rejected", 0, "Extra")).toBe("semantic command was rejected: field 'row.field/column' does not exist");
    expect(requirednessRefusal("Stale revision", "stale_revision", 3, "Price")).toBe("Stale revision");
    expect(requirednessRefusal("This change belongs to an older view. Refresh before trying again.", undefined, 3, "Price")).toBe("This change belongs to an older view. Refresh before trying again.");
  });
});

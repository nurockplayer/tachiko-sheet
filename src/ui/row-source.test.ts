import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { rowSource, type RowSource } from "./row-source.js";
import type { TableRow } from "./projection-access.js";

function field(entity: string, fieldId: string, value: string): FieldProjection {
  return {
    target: { entity, field: fieldId },
    address: `tables/items/${entity}/${fieldId}`,
    stored: { kind: "text", value },
    formula: null,
    calculated: null,
    diagnostics: [],
    editable_scalar: "text",
  };
}

function row(entity: string, value: string): TableRow {
  return { id: entity, key: entity, fields: [field(entity, "c-name", value)] };
}

function table(rows: TableRow[], revision = "rev-1"): Parameters<typeof rowSource>[0] {
  return {
    revision,
    collection: { id: "col-1", key: "items", display_name: "Items", entity_count: rows.length },
    columns: [{ id: "c-name", key: "name", display_name: "Name", field_type: "text", required: true }],
    rows,
  };
}

function entities(source: RowSource): string[] {
  return source.rows(0, source.total).map((candidate) => candidate.key);
}

describe("rowSource", () => {
  it("exposes the row count and indexes the stored order", () => {
    const source = rowSource(table([row("alpha", "A"), row("beta", "B"), row("gamma", "C")]));
    expect(source.total).toBe(3);
    expect(source.rowAt(0)?.key).toBe("alpha");
    expect(source.rowAt(2)?.key).toBe("gamma");
    expect(source.rowAt(3)).toBeUndefined();
    expect(source.rowAt(-1)).toBeUndefined();
  });

  it("returns a range without running past the table", () => {
    const source = rowSource(table([row("alpha", "A"), row("beta", "B"), row("gamma", "C")]));
    expect(source.rows(1, 2).map((candidate) => candidate.key)).toEqual(["beta", "gamma"]);
    expect(source.rows(2, 5).map((candidate) => candidate.key)).toEqual(["gamma"]);
    expect(source.rows(3, 1)).toEqual([]);
    expect(source.rows(0, 0)).toEqual([]);
    expect(source.rows(0, -1)).toEqual([]);
  });

  it("resolves entities to rows and back to their index", () => {
    const source = rowSource(table([row("alpha", "A"), row("beta", "B")]));
    expect(source.byEntity("beta")?.key).toBe("beta");
    expect(source.indexOf("beta")).toBe(1);
    expect(source.byEntity("missing")).toBeUndefined();
    expect(source.indexOf("missing")).toBe(-1);
  });

  it("identifies rows by their first FieldTarget entity", () => {
    const projected = row("row-id", "A");
    const source = rowSource(table([{ ...projected, id: "stored-id", key: "stored-key" }]));
    expect(source.byEntity("row-id")?.id).toBe("stored-id");
    expect(source.indexOf("stored-id")).toBe(-1);
  });

  it("handles an empty table", () => {
    const source = rowSource(table([]));
    expect(source.total).toBe(0);
    expect(source.rowAt(0)).toBeUndefined();
    expect(source.rows(0, 10)).toEqual([]);
    expect(source.byEntity("alpha")).toBeUndefined();
    expect(source.indexOf("alpha")).toBe(-1);
    expect(source.allRowsForNow()).toEqual([]);
  });

  it("reports every row as loaded and hands out the whole in-memory rows", () => {
    const rows = [row("alpha", "A"), row("beta", "B")];
    const source = rowSource(table(rows));
    expect(source.loaded(0)).toBe(true);
    expect(source.loaded(1)).toBe(true);
    expect(source.allRowsForNow()).toBe(rows);
    expect(entities(source)).toEqual(["alpha", "beta"]);
  });

  it("memoizes one source per table object", () => {
    const projected = table([row("alpha", "A")]);
    expect(rowSource(projected)).toBe(rowSource(projected));
    expect(rowSource(projected)).not.toBe(rowSource(table([row("alpha", "A")])));
  });

  it("keeps working after rows are replaced in place", () => {
    const projected = table([row("alpha", "A")]);
    const source = rowSource(projected);
    projected.rows = [row("beta", "B")];
    projected.collection.entity_count = 1;
    expect(source.total).toBe(1);
    expect(source.byEntity("beta")?.key).toBe("beta");
  });
});

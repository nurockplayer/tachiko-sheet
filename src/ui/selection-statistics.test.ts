import { describe, expect, it } from "vitest";
import { rectangle } from "./clipboard.js";
import { selectionStatisticsTargets } from "./selection-statistics.js";
import type { TableColumn, TableRow } from "./projection-access.js";

const row = (id: string): TableRow => ({ id, key: id, fields: [] });
const column = (id: string): TableColumn => ({ id, key: id, display_name: id, field_type: "number", required: false });
const rows = [row("e3"), row("e1"), row("e2")];
const columns = [column("a"), column("b")];

describe("selection statistics targets", () => {
  it("maps a reversed rectangle using displayed row order and stable field IDs", () => {
    expect(selectionStatisticsTargets(rows, columns, rectangle({ row: 2, column: 1 }, { row: 1, column: 0 })))
      .toEqual([{ entity: "e1", field: "a" }, { entity: "e1", field: "b" }, { entity: "e2", field: "a" }, { entity: "e2", field: "b" }]);
  });
  it("maps the whole displayed column, excluding filtered rows and including retained rows", () => {
    expect(selectionStatisticsTargets([rows[2]!, rows[0]!], columns, { top: 0, bottom: 1, left: 1, right: 1 }))
      .toEqual([{ entity: "e2", field: "b" }, { entity: "e3", field: "b" }]);
  });
  it("does not read cell values and includes 100,000 targets beyond the DOM window", () => {
    const largeRows = Array.from({ length: 10_000 }, (_, index) => {
      const projected = row(`e${index}`);
      Object.defineProperty(projected, "fields", { value: [{ target: { entity: projected.id, field: "f0" },
        get stored(): never { throw new Error("values must not be read"); },
        get calculated(): never { throw new Error("values must not be read"); } }] });
      return projected;
    });
    const largeColumns = Array.from({ length: 10 }, (_, index) => column(`f${index}`));
    const targets = selectionStatisticsTargets(largeRows, largeColumns, { top: 0, bottom: 9_999, left: 0, right: 9 });
    expect(targets).toHaveLength(100_000);
    expect(targets[99_999]).toEqual({ entity: "e9999", field: "f9" });
  });
  it("rejects single cells, missing endpoints, reversed unnormalized bounds and draft positions", () => {
    for (const area of [
      { top: 0, bottom: 0, left: 0, right: 0 },
      { top: -1, bottom: 1, left: 0, right: 1 },
      { top: 0, bottom: 3, left: 0, right: 1 },
      { top: 2, bottom: 0, left: 0, right: 1 },
      { top: 0, bottom: 2, left: 1, right: 0 },
      { top: 0, bottom: 1, left: -1, right: 1 },
      { top: 0, bottom: 1, left: 0, right: 2 },
    ]) expect(selectionStatisticsTargets(rows, columns, area)).toEqual([]);
  });
});

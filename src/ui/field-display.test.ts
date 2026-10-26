import { describe, expect, it } from "vitest";
import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { TableColumn, TableRow } from "./projection-access.js";
import { cellDisplay } from "./field-display.js";

describe("field display", () => {
  it("uses the column number format for cell display", () => {
    const field: FieldProjection = {
      target: { entity: "e1", field: "amount" }, address: "e1.amount",
      stored: { kind: "number", value: 1234.5 }, formula: null, calculated: null,
      diagnostics: [], editable_scalar: "number",
    };
    const row: TableRow = { id: "e1", key: "e1", fields: [field] };
    const column: TableColumn = {
      id: "amount", key: "amount", display_name: "Amount", field_type: "number", required: true,
      number_format: { decimals: 2, kind: { type: "plain" }, thousands_separator: true },
    };
    expect(cellDisplay(row, column).text).toBe("1,234.50");
  });
});

import { describe, expect, it } from "vitest";
import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { TableColumn, TableRow } from "./projection-access.js";
import { cellDisplay, fieldClipboardText, formatNumber, formatNumberFor, seedTextOf } from "./field-display.js";

describe("field display", () => {
  it("shows an unformatted number to 15 significant digits, as other spreadsheets do", () => {
    expect(formatNumber(1455.7999999999997)).toBe("1455.8");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-85.4)).toBe("-85.4");
    expect(formatNumber(3200)).toBe("3200");
    expect(formatNumber(123456789012.345)).toBe("123456789012.345");
    expect(formatNumber(1e21)).toBe("1e+21");
    expect(formatNumber(0.000001234)).toBe("0.000001234");
    expect(formatNumberFor(1455.7999999999997, undefined)).toBe("1455.8");
    const field: FieldProjection = {
      target: { entity: "e1", field: "total" }, address: "e1.total",
      stored: null, formula: null, calculated: { status: "value", value: 0.1 + 0.2 },
      diagnostics: [], editable_scalar: null,
    } as unknown as FieldProjection;
    const row: TableRow = { id: "e1", key: "e1", fields: [field] };
    const column: TableColumn = { id: "total", key: "total", display_name: "Total", field_type: "number", required: true };
    expect(cellDisplay(row, column).text).toBe("0.3");
    // Copy and the editor seed keep Work's exact value.
    expect(fieldClipboardText(field)).toBe(String(0.1 + 0.2));
    expect(seedTextOf(field)).toBe("0.30000000000000004");
    const stored = { ...field, stored: { kind: "number", value: 1455.7999999999997 }, calculated: null } as unknown as FieldProjection;
    expect(seedTextOf(stored)).toBe("1455.7999999999997");
  });

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

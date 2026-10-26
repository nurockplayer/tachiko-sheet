import { describe, expect, it } from "vitest";
import { columnFormatDraft, columnFormatInput, columnFormatSettlement } from "./column-format.js";
import { formatNumberFor } from "./field-display.js";

describe("column number format", () => {
  it("parses decimals and uppercases valid currency codes", () => {
    expect(columnFormatInput({ ...columnFormatDraft(), decimals: "0", type: "currency", code: "jpy" }))
      .toEqual({ input: { decimals: 0, kind: { type: "currency", code: "JPY" }, thousands_separator: true } });
    expect(columnFormatInput({ ...columnFormatDraft(), decimals: "11" })).toEqual({ error: "Enter 0 to 10 decimal places." });
    expect(columnFormatInput({ ...columnFormatDraft(), decimals: "" })).toEqual({ error: "Enter 0 to 10 decimal places." });
    expect(columnFormatInput({ ...columnFormatDraft(), decimals: "  " })).toEqual({ error: "Enter 0 to 10 decimal places." });
    expect(columnFormatInput({ ...columnFormatDraft(), type: "currency", code: "US" })).toEqual({ error: "Enter a three-letter currency code." });
  });

  it("settles confirmed, refused, and recovery outcomes", () => {
    expect(columnFormatSettlement({ kind: "confirmed" })).toEqual({ close: true, error: null, confirmed: true });
    expect(columnFormatSettlement({ kind: "refused", message: "Work refused this format." })).toEqual({ close: false, error: "Work refused this format.", confirmed: false });
    expect(columnFormatSettlement({ kind: "recovery" })).toEqual({ close: true, error: null, confirmed: false });
  });

  it("formats numbers with the declared locale options", () => {
    expect(formatNumberFor(1234.5, { decimals: 2, kind: { type: "plain" }, thousands_separator: true })).toBe("1,234.50");
    expect(formatNumberFor(0.25, { decimals: 0, kind: { type: "percent" }, thousands_separator: true })).toBe("25%");
    expect(formatNumberFor(1234.5, { decimals: 0, kind: { type: "currency", code: "JPY" }, thousands_separator: true })).toBe("¥1,235");
    expect(formatNumberFor(4.5, { decimals: 2, kind: { type: "currency", code: "BAD_CODE" }, thousands_separator: true })).toBe("4.5");
    expect(formatNumberFor(4.5, undefined)).toBe("4.5");
  });
});

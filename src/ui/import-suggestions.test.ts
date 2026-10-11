import { describe, expect, it } from "vitest";
import type { SourceCell, SourceValue } from "../../public/core-kit/runtime/interop-protocol.js";
import { sourcePreviewText, suggestColumnType } from "./import-suggestions.js";

const cell = (value: SourceValue): SourceCell => ({ value, formula: null, style: {} as SourceCell["style"] });
const text = (value: string) => cell({ kind: "text", value });
const column = (...values: SourceCell[]) => values.map((value) => [value]);

describe("import type suggestions", () => {
  it("suggests Number only for plain decimal columns", () => {
    expect(suggestColumnType(column(text("3"), text("200"), text("-4.50"), cell({ kind: "empty" })), 0)).toBe("number");
    expect(suggestColumnType(column(cell({ kind: "number", value: 12 }), text("7")), 0)).toBe("number");
  });

  it("keeps identifiers and ambiguous values as Text", () => {
    for (const value of ["00123", "0001700000000097", "1234567890123456", "1e5", "1,000", " 3", "TRUE", "2026-10-11", "PEN"]) {
      expect(suggestColumnType(column(text("1"), text(value)), 0), value).toBe("text");
    }
    expect(suggestColumnType(column(cell({ kind: "empty" })), 0)).toBe("text");
    expect(suggestColumnType([], 0)).toBe("text");
  });

  it("renders preview values without inventing content", () => {
    expect(sourcePreviewText(undefined)).toBe("");
    expect(sourcePreviewText({ kind: "empty" })).toBe("");
    expect(sourcePreviewText({ kind: "boolean", value: false })).toBe("FALSE");
    expect(sourcePreviewText({ kind: "text", value: " PEN " })).toBe(" PEN ");
  });
});

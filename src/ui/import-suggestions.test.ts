import { describe, expect, it } from "vitest";
import type { SourceCell, SourceValue } from "../../public/core-kit/runtime/interop-protocol.js";
import { chooseImportType, chosenImportTypes, importConfirmationMessage, importRefusalMessage, sourcePreviewText, suggestColumnType } from "./import-suggestions.js";

const cell = (value: SourceValue): SourceCell => ({ value, formula: null, style: {} as SourceCell["style"] });
const text = (value: string) => cell({ kind: "text", value });
const column = (...values: SourceCell[]) => values.map((value) => [value]);

describe("import type suggestions", () => {
  it("suggests Number only for plain decimal columns", () => {
    expect(suggestColumnType(column(text("3"), text("200"), text("-4.5"), cell({ kind: "empty" })), 0)).toBe("number");
    expect(suggestColumnType(column(cell({ kind: "number", value: 12 }), text("7")), 0)).toBe("number");
  });

  it("keeps identifiers and ambiguous values as Text", () => {
    for (const value of ["00123", "0001700000000097", "1234567890123456", "1e5", "1,000", " 3", "TRUE", "2026-10-11", "PEN",
      "999999999999999.99", "123456789012345.123456789012345", "-0", "-0.00", "4.50", "1.", ".5", "0.0000001"]) {
      expect(suggestColumnType(column(text("1"), text(value)), 0), value).toBe("text");
    }
    expect(suggestColumnType(column(cell({ kind: "empty" })), 0)).toBe("text");
    expect(suggestColumnType(column(cell({ kind: "number", value: -0 })), 0)).toBe("text");
    expect(suggestColumnType(Array.from({ length: 65 }, () => [text("3")]), 0), "large lossless numeric sources suggest Number").toBe("number");
    expect(suggestColumnType(Array.from({ length: 64 }, () => [text("3")]), 0)).toBe("number");
    expect(suggestColumnType([], 0)).toBe("text");
  });

  it("renders preview values without inventing content", () => {
    expect(sourcePreviewText(undefined)).toBe("");
    expect(sourcePreviewText({ kind: "empty" })).toBe("");
    expect(sourcePreviewText({ kind: "boolean", value: false })).toBe("FALSE");
    expect(sourcePreviewText({ kind: "text", value: " PEN " })).toBe(" PEN ");
  });
});

describe("import refusal message", () => {
  it("explains beta size limits and damaged files in plain language, keeping the detail", () => {
    const limit = importRefusalMessage(new Error("project transfer is invalid: Text capacity requires one headered, default-style 8,406-row three-Text table"));
    expect(limit).toMatch(/^This file is outside what this beta can open: .*1–16.*Text or finite Number.*8,406 rows.*25,218 cells.*Nothing was imported\. \(Details: project transfer is invalid: Text capacity/);
    expect(importRefusalMessage(new Error("project transfer is invalid: CSV exceeds 8,406 row or column bounds"))).toMatch(/outside what this beta can open.*CSV exceeds/);
    expect(importRefusalMessage(new Error("project transfer is invalid: Missing ZIP end directory"))).toMatch(/^This file could not be read\./);
    expect(importRefusalMessage(new Error("something else"))).toBe("The spreadsheet could not be inspected. Nothing was imported. (Details: something else)");
    expect(importRefusalMessage(new Error("project transfer is invalid: Cell column exceeds profile"))).toMatch(/outside what this beta can open/);
    expect(importRefusalMessage(new Error("project transfer is invalid: Worksheet exceeds the bounded Text/Number capacity rectangle"))).toMatch(/outside what this beta can open/);
    expect(importRefusalMessage(null)).toBe("The spreadsheet could not be inspected. Nothing was imported.");
    const typed = Object.assign(new Error("TableRows capacity exceeded: maximum 8406, attempted 8407"), { failure: { code: "capacity_exceeded" } });
    expect(importRefusalMessage(typed)).toMatch(/^This file is outside what this beta can open: .*Nothing was imported\. \(Details: TableRows capacity exceeded/);
    expect(importRefusalMessage(new Error("TableRows capacity exceeded: maximum 8406, attempted 8407"))).toMatch(/^This file is outside what this beta can open/);
  });
});

describe("import confirmation errors", () => {
  it("explains known limits and conversion errors while retaining recovery truth", () => {
    expect(importConfirmationMessage("8,406-row capacity requires selected Text/Number fields and no extra columns")).toMatch(/^This file is outside/);
    expect(importConfirmationMessage("conversion requires an unambiguous finite decimal Number")).toMatch(/^A column could not be converted to Number/);
    for (const message of ["The import outcome is unknown; Refresh is required.", "The native runtime stopped unexpectedly.", "The opened work could not be confirmed."]) {
      expect(importConfirmationMessage(message)).toBe(message);
    }
  });
});

describe("import type choices", () => {
  it("uses the current suggestions until the person chooses, and never an earlier inspection's choice", () => {
    const first = [["text", "number"]];
    expect(chosenImportTypes(null, first)).toBe(first);
    const chosen = chooseImportType(null, first, 0, 1, "text");
    expect(chosenImportTypes(chosen, first)).toEqual([["text", "text"]]);
    expect(first).toEqual([["text", "number"]]);
    // A new inspection (new suggestions) starts from its own suggestions.
    const second = [["number", "number"]];
    expect(chosenImportTypes(chosen, second)).toBe(second);
    expect(chosenImportTypes(chooseImportType(chosen, second, 0, 0, "date"), second)).toEqual([["date", "number"]]);
  });
});

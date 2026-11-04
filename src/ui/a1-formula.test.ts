import { describe, expect, it } from "vitest";

import { A1_NOTE_TEXT, a1RefusalText, a1TranslationNeedsPreview, isTachikoFormulaSource, utf8SpanToUtf16 } from "./a1-formula.js";

describe("isTachikoFormulaSource", () => {
  it("treats a bracketed reference as Tachiko source and anything else as Excel text", () => {
    expect(isTachikoFormulaSource("[.impact]*[.friction]")).toBe(true);
    expect(isTachikoFormulaSource("IF([.done], 1, 0)")).toBe(true);
    expect(isTachikoFormulaSource("B2*C2")).toBe(false);
    expect(isTachikoFormulaSource("")).toBe(false);
  });
});

describe("utf8SpanToUtf16", () => {
  it("maps a byte span after multi-byte characters onto UTF-16 indices", () => {
    // "π" is two UTF-8 bytes and one UTF-16 unit; "😀" is four bytes and two units.
    expect(utf8SpanToUtf16("π+B2", { start: 3, end: 5 })).toEqual([2, 4]);
    expect(utf8SpanToUtf16("😀B2", { start: 4, end: 6 })).toEqual([2, 4]);
    expect(utf8SpanToUtf16("B2*π", { start: 0, end: 2 })).toEqual([0, 2]);
  });

  it("clamps inside a character to its start and past the end to the length", () => {
    expect(utf8SpanToUtf16("π+B2", { start: 1, end: 4 })).toEqual([0, 3]);
    expect(utf8SpanToUtf16("B2", { start: 0, end: 99 })).toEqual([0, 2]);
    expect(utf8SpanToUtf16("B2", { start: -1, end: -1 })).toEqual([0, 0]);
  });

  it("keeps an empty span collapsed and never inverts it", () => {
    expect(utf8SpanToUtf16("B2*C2", { start: 2, end: 2 })).toEqual([2, 2]);
    expect(utf8SpanToUtf16("B2*C2", { start: 4, end: 2 })).toEqual([4, 4]);
  });
});

describe("a1TranslationNeedsPreview", () => {
  it("asks for confirmation when the source changes or Work adds a note", () => {
    expect(a1TranslationNeedsPreview("B2*C2", { source: "B2*C2", notes: [] })).toBe(false);
    expect(a1TranslationNeedsPreview(" B2*C2 ", { source: "B2*C2", notes: [] })).toBe(false);
    expect(a1TranslationNeedsPreview("B2*C2", { source: "[.impact]*[.friction]", notes: [] })).toBe(true);
    expect(a1TranslationNeedsPreview("B2*C2", { source: "B2*C2", notes: ["relative_copy_semantics_changed"] })).toBe(true);
  });
});

describe("A1_NOTE_TEXT", () => {
  it("has readable text for every note Work can return", () => {
    expect(A1_NOTE_TEXT.relative_copy_semantics_changed).toContain("Copying this formula");
    expect(A1_NOTE_TEXT.range_tracks_collection).toContain("entire column");
  });
});

describe("a1RefusalText", () => {
  const base = { message: "work detail", spanText: "", lastRow: 4, lastColumn: "D" };

  it("quotes the offending span when Work supplied one", () => {
    expect(a1RefusalText({ ...base, code: "out_of_bounds", spanText: "B99" }))
      .toBe("“B99” is outside the table: it has rows 2–4 and columns A–D.");
    expect(a1RefusalText({ ...base, code: "header_reference", spanText: "B1" }))
      .toContain("“B1” is the row of column names");
  });

  it("says what each code means without a span, with no stray leading space", () => {
    expect(a1RefusalText({ ...base, code: "unsupported_range" }))
      .toBe("That range isn't supported: SUM, AVERAGE and COUNT work only over a whole column (for example B2:B4) while no filter hides rows.");
    expect(a1RefusalText({ ...base, code: "unsupported_function" })).toContain("That function isn't available.");
    expect(a1RefusalText({ ...base, code: "unsupported_function" })).toContain("IF, AND, OR, NOT, ROUND, ISBLANK, MIN, MAX");
    expect(a1RefusalText({ ...base, code: "unsupported_operator" })).toBe("That operator isn't supported in formulas.");
    expect(a1RefusalText({ ...base, code: "unknown_sheet" })).toContain("That reference refers to another table");
    expect(a1RefusalText({ ...base, code: "out_of_bounds" }))
      .toBe("This cell reference is outside the table: it has rows 2–4 and columns A–D.");
    expect(a1RefusalText({ ...base, code: "header_reference" })).toContain("That reference is the row of column names");
    expect(a1RefusalText({ ...base, code: "formula_syntax", spanText: "B2+" })).toBe("The formula can't be read near “B2+”.");
    expect(a1RefusalText({ ...base, code: "formula_syntax" })).toBe("The formula can't be read.");
    expect(a1RefusalText({ ...base, code: "formula_type_mismatch" })).toBe("This column can't hold the result of this formula. work detail");
    expect(a1RefusalText({ ...base, code: "formula_cycle" })).toBe("This formula would depend on its own result.");
    expect(a1RefusalText({ ...base, code: "invalid_geometry" })).toContain("clear the filter");
    expect(a1RefusalText({ ...base, code: "stale_revision" })).toContain("Press Enter");
  });

  it("keeps Work's own message for a code this sheet does not explain", () => {
    expect(a1RefusalText({ ...base, code: "new_work_code" })).toBe("work detail");
  });
});

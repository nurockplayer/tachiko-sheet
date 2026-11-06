import { describe, expect, it } from "vitest";

import { A1_TOO_MANY_ROWS, A1_NOTE_TEXT, a1EditorStillCurrent, a1NoteText, a1References, a1RefusalText, isTachikoFormulaSource, utf8SpanToUtf16 } from "./a1-formula.js";

describe("isTachikoFormulaSource", () => {
  it("treats a bracketed reference as Tachiko source and anything else as Excel text", () => {
    expect(isTachikoFormulaSource("[.impact]*[.friction]")).toBe(true);
    expect(isTachikoFormulaSource("IF([.done], 1, 0)")).toBe(true);
    expect(isTachikoFormulaSource("B2*C2")).toBe(false);
    expect(isTachikoFormulaSource("")).toBe(false);
  });
});

describe("a1References", () => {
  it("names no rows for text without an address", () => {
    for (const text of ["1+2", "IF(TRUE,1,2)", "LOG10(5)", '"B2"&1', "1.5E3", "Amount*2"]) {
      expect(a1References(text), text).toEqual({ rows: [], range: false });
    }
  });

  it("names the row of every A1 address outside string literals", () => {
    expect(a1References("B3*$C$4").rows).toEqual([3, 4]);
    expect(a1References("b3").rows).toEqual([3]);
    expect(a1References("Sheet2!B3").rows).toEqual([3]);
  });

  it("marks a range", () => {
    expect(a1References("SUM(B2:B9)")).toEqual({ rows: [2, 9], range: true });
    expect(a1References("SUM(B:B)")).toEqual({ rows: [], range: true });
  });
});

describe("A1_TOO_MANY_ROWS", () => {
  it("names the way out", () => {
    expect(A1_TOO_MANY_ROWS).toContain("closer to this row");
    expect(A1_TOO_MANY_ROWS).toContain("smaller table");
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

describe("a1NoteText", () => {
  it("joins Work's notes into one line, or nothing when there are none", () => {
    expect(a1NoteText([])).toBe(null);
    expect(a1NoteText(["relative_copy_semantics_changed"])).toContain("Copying this formula");
    expect(a1NoteText(["relative_copy_semantics_changed", "range_tracks_collection"]))
      .toContain("Copying this formula");
    expect(a1NoteText(["relative_copy_semantics_changed", "range_tracks_collection"]))
      .toContain("entire column");
  });
});

describe("a1EditorStillCurrent", () => {
  const requested = { entity: "row-1", field: "impact", value: "=D2*2", identity: "view\u0000row-1\u0000impact", instance: 7 };
  const live = (overrides = {}) => ({
    editor: { entity: requested.entity, field: requested.field, value: requested.value, instance: requested.instance },
    focus: { entity: requested.entity, field: requested.field },
    identity: requested.identity,
    ...overrides,
  });

  it("keeps an answer for the same cell, text and focus", () => {
    expect(a1EditorStillCurrent(requested, live())).toBe(true);
  });

  it("drops an answer after more typing, another cell, or a closed editor", () => {
    expect(a1EditorStillCurrent(requested, live({ editor: { ...live().editor, value: "=D2*3" } }))).toBe(false);
    expect(a1EditorStillCurrent(requested, live({ editor: { ...live().editor, entity: "row-2" } }))).toBe(false);
    expect(a1EditorStillCurrent(requested, live({ editor: { ...live().editor, field: "friction" } }))).toBe(false);
    expect(a1EditorStillCurrent(requested, live({ editor: null }))).toBe(false);
  });

  it("drops an answer once the editor was reopened for the same text", () => {
    expect(a1EditorStillCurrent(requested, live({ editor: { ...live().editor, instance: requested.instance + 1 } }))).toBe(false);
  });

  it("drops an answer once the grid focus left the edited cell", () => {
    expect(a1EditorStillCurrent(requested, live({ focus: { entity: "row-2", field: "impact" } }))).toBe(false);
    expect(a1EditorStillCurrent(requested, live({ focus: { entity: "row-1", field: "friction" } }))).toBe(false);
    expect(a1EditorStillCurrent(requested, live({ focus: null }))).toBe(false);
  });

  it("drops an answer once the revision changed the cell's identity", () => {
    expect(a1EditorStillCurrent(requested, live({ identity: "newer-view\u0000row-1\u0000impact" }))).toBe(false);
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

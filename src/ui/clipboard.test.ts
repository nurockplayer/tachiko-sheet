import { describe, expect, it } from "vitest";
import { PASTE_MAX_ROWS, clipboardBoolean, decodeTsv, encodeTsv, pasteRefusal, rectangle, routePaste, stepAddress, type PasteContext } from "./clipboard.js";

describe("quoted TSV", () => {
  it.each([
    ["a\tb\r\nc\td\r\n", [["a", "b"], ["c", "d"]]],
    ['"a\tb"\t"line 1\nline 2"\t"say ""yes"""', [["a\tb", "line 1\nline 2", 'say "yes"']]],
    ['"a\r\nb"\tc', [["a\r\nb", "c"]]],
    ["a\n\n", [["a"], [""]]],
    ["\t\r\n", [["", ""]]],
    ["", [[""]]],
    ['""', [[""]]],
    ["a\tb\t", [["a", "b", ""]]],
  ])("decodes %j without padding, trimming or numeric coercion", (text, expected) => expect(decodeTsv(text as string)).toEqual(expected));
  it.each(['a"b', '"open', '"closed"tail', '"a" "b"', 'a\t"b"c'])('refuses malformed quoting %j', value => expect(() => decodeTsv(value)).toThrow(/quote/));
  it("round-trips tabs, newlines, CRLF, quotes, blank cells and literal formula text", () => {
    const values = [["=1+1", "a\tb", 'a"b', ""], ["x\r\ny", "\n", "1300", ""]];
    expect(decodeTsv(encodeTsv(values))).toEqual(values);
    expect(decodeTsv(encodeTsv([["x"], [""]]))).toEqual([["x"], [""]]);
    expect(encodeTsv([["a", "b\tc", '"d"']])).toBe('a\t"b\tc"\t"""d"""');
  });
});
const context = (overrides: Partial<PasteContext> = {}): PasteContext => ({ native: true, draft: false, blocked: false, pendingDraft: false,
  start: { row: 0, column: 0 }, rowCount: 2, columnTypes: ["text", "number", "boolean"], editable: () => true, ...overrides });
const block = [["a", "1,300", "TRUE"], ["b", "", "false"], ["c", "$5", "FaLsE"]];
describe("paste routing", () => {
  it("overwrites and appends one block; only exact Boolean tokens are case-folded", () => {
    const original = structuredClone(block);
    expect(routePaste(block, context())).toEqual({ kind: "publish", rows: [["a", "1,300", "true"], ["b", "", "false"], ["c", "$5", "false"]] });
    expect(block).toEqual(original);
    expect(clipboardBoolean(" TRUE ", "boolean")).toBe(" TRUE ");
    expect(clipboardBoolean("TRUE", "text")).toBe("TRUE");
    expect(clipboardBoolean("yes", "boolean")).toBe("yes");
  });
  it.each([
    [context({ native: false }), block, /Imported tables can't gain rows by paste/ ],
    [context({ blocked: true }), block, /current edit/],
    [context({ pendingDraft: true }), block, /discard/],
    [context(), [["a"], ["b", "c"]], /different widths/],
    [context(), [["a", "b", "c", "d"]], /too wide/],
    [context({ start: { row: 127, column: 0 }, rowCount: 128 }), [["a"], ["b"]], /128-row/],
    [context({ editable: () => false }), [["a"]], /calculated or non-editable/],
    [context({ start: { row: 1, column: 1 } }), [["1", "true"], ["2", "false"]], /every column/],
    [context(), [["a"], ["b"], ["c"]], /every column/],
    [context({ draft: true }), block, /one row/],
    [context({ start: { row: -1, column: 0 } }), [["a"]], /current cell/],
  ] as const)("refuses whole blocks", (ctx, values, message) => {
    expect(routePaste(values as string[][], ctx)).toMatchObject({ kind: "refused", message: expect.stringMatching(message) });
  });
  it("routes imported overwrites to edit, using all existing rows beyond native row 128", () => {
    expect(routePaste(block.slice(0, 2), context({ native: false }))).toEqual({ kind: "edit", rows: [["a", "1,300", "true"], ["b", "", "false"]] });
    expect(routePaste([["", "10/19/2026"]], context({ native: false, rowCount: 200, start: { row: 199, column: 0 }, columnTypes: ["number", "date"] })))
      .toEqual({ kind: "edit", rows: [["", "10/19/2026"]] });
    expect(routePaste([["4"]], context({ native: false, start: { row: 1, column: 1 } }))).toEqual({ kind: "edit", rows: [["4"]] });
  });
  it("refuses imported appends, blocked, ragged, wide and any non-editable target before dispatch", () => {
    for (const overrides of [{ rowCount: 0 }, { start: { row: 2, column: 0 } }, { draft: true }]) {
      expect(routePaste([["a"]], context({ native: false, ...overrides }))).toEqual({ kind: "refused", message: "Imported tables can't gain rows by paste. Nothing was pasted." });
    }
    for (const [overrides, rows, message] of [
      [{ blocked: true }, [["a"]], /current edit/],
      [{ pendingDraft: true }, [["a"]], /discard/],
      [{}, [["a"], ["b", "c"]], /different widths/],
      [{}, [["a", "b", "c", "d"]], /too wide/],
      [{ editable: (r: number, c: number) => !(r === 1 && c === 2) }, block.slice(0, 2), /non-editable/],
    ] as const) expect(routePaste(rows as string[][], context({ native: false, ...overrides }))).toMatchObject({ kind: "refused", message: expect.stringMatching(message) });
  });
  it("bounds imported edits at 1,024 cells without imposing that count bound on native paste", () => {
    const rows = Array.from({ length: 128 }, () => Array(8).fill("a"));
    const ctx = context({ native: false, rowCount: 128, columnTypes: Array(9).fill("text") });
    expect(routePaste(rows, ctx).kind).toBe("edit");
    rows[0]!.push("a"); // ragged refusal still wins
    expect(routePaste(rows, ctx).kind).toBe("refused");
    rows.forEach(row => { if (row.length === 8) row.push("a"); });
    expect(routePaste(rows, ctx)).toMatchObject({ kind: "refused", message: expect.stringContaining("1,024-cell") });
    expect(routePaste(rows, { ...ctx, native: true }).kind).toBe("publish");
  });
  it("accepts only exact Boolean tokens for typed imported edits", () => {
    for (const value of ["yes", " TRUE ", "", "0"]) expect(routePaste([[value]], context({ native: false, columnTypes: ["boolean"] })))
      .toMatchObject({ kind: "refused", message: expect.stringContaining("true or false") });
    expect(routePaste([["FaLsE"]], context({ native: false, columnTypes: ["boolean"] }))).toEqual({ kind: "edit", rows: [["false"]] });
  });
  it("fills a partial draft without publishing or losing existing draft permission", () => {
    expect(routePaste([["2", "TRUE"]], context({ draft: true, pendingDraft: true, start: { row: 2, column: 1 } })))
      .toEqual({ kind: "draft", rows: [["2", "true"]] });
  });
  it("permits exactly row 128 and a partial existing-row overwrite", () => {
    expect(routePaste([["a", "1", "true"]], context({ rowCount: 127, start: { row: 127, column: 0 } })).kind).toBe("publish");
    expect(routePaste([["2"]], context({ start: { row: 1, column: 1 } }))).toEqual({ kind: "publish", rows: [["2"]] });
  });
  it("passes raw Number and Date input to Work", () => {
    expect(routePaste([["", "10/19/2026"]], context({ columnTypes: ["number", "date"] }))).toEqual({ kind: "publish", rows: [["", "10/19/2026"]] });
  });
});
describe("selection and refusal presentation", () => {
  it("normalizes reverse selections to a top-left anchor", () => expect(rectangle({ row: 4, column: 2 }, { row: 1, column: 0 })).toEqual({ top: 1, left: 0, bottom: 4, right: 2 }));
  it("extends within data boundaries without wrapping or including the draft", () => {
    expect(stepAddress({ row: 0, column: 0 }, "ArrowLeft", 3, 3)).toEqual({ row: 0, column: 0 });
    expect(stepAddress({ row: 2, column: 2 }, "ArrowDown", 3, 3)).toEqual({ row: 2, column: 2 });
    expect(stepAddress({ row: 0, column: 1 }, "ArrowRight", 3, 3)).toEqual({ row: 0, column: 2 });
  });
  it("does not infer a cell from type-only refusal evidence", () => {
    expect(pasteRefusal("core refusal", "number")).toMatch(/12 or 12.5/);
    expect(pasteRefusal("core refusal", "date")).toMatch(/YYYY-MM-DD/);
    expect(pasteRefusal("core refusal")).toBe("core refusal");
    expect(pasteRefusal("private bridge limit", undefined, "request_too_large")).toBe("The pasted text is too large to paste here. Nothing was pasted.");
  });
});

describe("bounded clipboard decoding", () => {
  it("accepts exactly the row bound, with or without one final separator", () => {
    const block = Array.from({ length: PASTE_MAX_ROWS }, (_, i) => `r${i}\tx`).join("\n");
    expect(decodeTsv(block)).toHaveLength(PASTE_MAX_ROWS);
    expect(decodeTsv(`${block}\n`)).toHaveLength(PASTE_MAX_ROWS);
  });
  it("refuses one row past the bound before materializing the rest", () => {
    const huge = Array.from({ length: 50_000 }, (_, i) => `r${i}`).join("\n");
    expect(() => decodeTsv(huge)).toThrow(/128-row limit/);
    expect(() => decodeTsv(Array.from({ length: PASTE_MAX_ROWS + 1 }, () => "a").join("\n"))).toThrow(/128-row limit/);
  });
  it("refuses oversized text before scanning it", () => {
    expect(() => decodeTsv("a".repeat(11), PASTE_MAX_ROWS, 10)).toThrow(/too large/);
  });
});

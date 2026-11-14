import { describe, expect, it } from "vitest";
import { FORMULA_FUNCTIONS, functionHint, functionSuggestions, insertFunction } from "./formula-hints.js";

const suggestions = (value: string, caret = value.length) => functionSuggestions(value, caret);
const hint = (value: string) => functionHint(value, value.length)?.name ?? null;

describe("formula hints", () => {
  it("suggests matching names in table order and inserts at the caret", () => {
    const match = suggestions("=su");
    expect(match).toEqual({ start: 1, end: 3, names: ["SUM", "SUMIF", "SUMIFS"] });
    expect(insertFunction("=su+1", match!, "SUM")).toEqual({ value: "=SUM(+1", caret: 5 });
    expect(suggestions("=rou")?.names).toEqual(["ROUND", "ROUNDUP", "ROUNDDOWN"]);
    expect(suggestions("=SUMIFS")).toBeNull();
    expect(suggestions("=z")).toBeNull();
    expect(suggestions("=a")?.names.length).toBeLessThanOrEqual(8);
    expect(FORMULA_FUNCTIONS.length).toBe(30);
  });
  it("respects boundaries and the character after the caret", () => {
    for (const value of ["SU", "=$A", "=A1:SU", "=A1SU", "=x.SU", "=x_SU", "=SU("]) expect(suggestions(value)).toBeNull();
    expect(suggestions("=SUx", 3)).toBeNull();
    expect(suggestions("=A1+2", 2)).toBeNull();
    expect(suggestions("=SU", 3)?.names).toEqual(["SUM", "SUMIF", "SUMIFS"]);
    expect(suggestions("=SU(", 3)).toBeNull();
    for (const value of ["=1+SU", "=(SU", "=IF(1, SU"]) expect(suggestions(value)?.names[0]).toBe("SUM");
  });
  it("skips strings including doubled quotes", () => {
    expect(suggestions('="SU')).toBeNull();
    expect(hint('=IF("SUM(')).toBeNull();
    expect(hint('=IF("a""b",SUM(1,')).toBe("SUM");
  });
  it("finds the innermost known unclosed call", () => {
    expect(hint("=IF(SUM(1,")).toBe("SUM");
    expect(hint("=IF(SUM(1),")).toBe("IF");
    expect(hint("=IF(UNKNOWN(1,")).toBe("IF");
    expect(hint("IF(")).toBeNull();
    expect(hint("=UNKNOWN(")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { nativeInsertionFits, nativeInsertionLimitReached } from "./native-insertion-limit.js";

describe("working-size native insertion gate", () => {
  it.each([0, 1, 128, 9_999])("offers insertion below the gate with %i stored records", count => {
    expect(nativeInsertionLimitReached(count)).toBe(false);
    expect(nativeInsertionFits(count, 10_000 - count)).toBe(true);
    expect(nativeInsertionFits(count, 10_001 - count)).toBe(false);
  });
  it.each([10_000, 10_001])("suppresses insertion at or beyond the gate with %i records", count => {
    expect(nativeInsertionLimitReached(count)).toBe(true);
    expect(nativeInsertionFits(count, 1)).toBe(false);
  });
});

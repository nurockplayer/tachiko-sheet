import { describe, expect, it } from "vitest";
import { nativeInsertionFits, nativeInsertionLimitReached } from "./native-insertion-limit.js";

describe("375da29f native insertion gate", () => {
  it.each([0, 1, 127])("offers insertion below the gate with %i stored records", count => {
    expect(nativeInsertionLimitReached(count)).toBe(false);
    expect(nativeInsertionFits(count, 128 - count)).toBe(true);
    expect(nativeInsertionFits(count, 129 - count)).toBe(false);
  });
  it.each([128, 129, 205, 8406])("suppresses insertion at or beyond the gate with %i records", count => {
    expect(nativeInsertionLimitReached(count)).toBe(true);
    expect(nativeInsertionFits(count, 1)).toBe(false);
  });
});

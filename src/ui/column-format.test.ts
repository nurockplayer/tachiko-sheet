import { describe, expect, it } from "vitest";
import { nextStripAlignment, nextStripNumberFormat } from "./column-format.js";

describe("format strip actions", () => {
  it("toggles formats while preserving other settings", () => {
    const currency = nextStripNumberFormat(undefined, "currency");
    expect(currency).toEqual({ decimals: 2, kind: { type: "currency", code: "USD" }, thousands_separator: false });
    expect(nextStripNumberFormat(currency, "currency").kind).toEqual({ type: "plain" });
    const percent = nextStripNumberFormat(currency, "percent");
    expect(nextStripNumberFormat(percent, "percent").kind).toEqual({ type: "plain" });
    expect(nextStripNumberFormat(currency, "separator").thousands_separator).toBe(true);
    expect(nextStripNumberFormat(currency, "more").decimals).toBe(3);
    expect(nextStripNumberFormat({ ...currency, decimals: 0 }, "fewer").decimals).toBe(0);
    expect(nextStripNumberFormat({ ...currency, decimals: 10 }, "more").decimals).toBe(10);
  });
  it("toggles alignment back to default", () => {
    expect(nextStripAlignment(null, "center")).toBe("center");
    expect(nextStripAlignment("center", "center")).toBeNull();
  });
});

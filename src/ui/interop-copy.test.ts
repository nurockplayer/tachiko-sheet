import { describe, expect, it } from "vitest";
import { findingCategoryLabel, findingMessage } from "./interop-copy.js";

describe("import/export disclosure copy", () => {
  it("keeps every CSV export loss visible in task language", () => {
    const original = "CSV exports selected-sheet scalar values only. Formula definitions, presentation formatting, and other sheets are not preserved; retain the source project.";
    const text = findingMessage(original);
    expect(text).toContain("only cell values from the selected sheet");
    expect(text).toContain("Formulas, formatting, and other sheets are not kept");
    expect(text).toContain("keep the source work");
    expect(findingCategoryLabel("lossy_on_export")).toBe("Export limitations");
    expect(findingCategoryLabel("unsupported_safe_disabled")).toBe("Unsupported — disabled");
  });

  it("preserves unrecognized and changed producer warnings without guessing their meaning", () => {
    for (const message of [
      "This file contains an unsupported feature. Nothing was imported.",
      "Export is rebuilt from current stable identities and authoritative values. A new limitation applies.",
      "__proto__",
    ]) expect(findingMessage(message)).toBe(message);
  });
});

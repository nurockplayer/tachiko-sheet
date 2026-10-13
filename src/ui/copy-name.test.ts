import { describe, expect, it } from "vitest";
import { suggestedCopyName } from "./copy-name.js";

describe("copy name suggestions", () => {
  it("uses the work or source name without a file extension", () => {
    expect(suggestedCopyName("  Sales and catalog  ", [])).toBe("Sales and catalog copy");
    expect(suggestedCopyName("orders.CSV", [])).toBe("orders copy");
    expect(suggestedCopyName("orders.xlsx", [])).toBe("orders copy");
    expect(suggestedCopyName("plan.roproj", [])).toBe("plan copy");
    expect(suggestedCopyName("annual.plan", [])).toBe("annual.plan copy");
  });

  it("provides a non-empty fallback", () => {
    for (const title of [null, "", "  ", ".csv"]) {
      expect(suggestedCopyName(title, [])).toBe("Untitled work copy");
    }
  });

  it("avoids exact names in the available create-only list, including suffix gaps", () => {
    const names = ["Plan copy", "Plan copy 2", "Plan copy 4"];
    expect(suggestedCopyName("Plan", names)).toBe("Plan copy 3");
    expect(names).toEqual(["Plan copy", "Plan copy 2", "Plan copy 4"]);
    expect(suggestedCopyName("Plan", ["Plan copy "])).toBe("Plan copy");
  });
});

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

  it("keeps the last successful names while a list refresh is delayed", async () => {
    let names = ["Plan copy", "Plan copy 2"];
    let release!: (names: string[]) => void;
    const refresh = new Promise<string[]>((resolve) => { release = resolve; })
      .then((next) => { names = next; });
    expect(suggestedCopyName("Plan", names)).toBe("Plan copy 3");
    release([...names, "Plan copy 3"]);
    await refresh;
    expect(suggestedCopyName("Plan", names)).toBe("Plan copy 4");
  });

  it("keeps known names and confirmed session saves after a failed refresh", () => {
    const names = ["Plan copy"];
    const savedInSession = new Set(["Plan copy 2"]);
    const suggestion = suggestedCopyName("Plan", names, savedInSession);
    expect(suggestion).toBe("Plan copy 3");
    expect([...names, ...savedInSession]).not.toContain(suggestion);
    expect(names).toEqual(["Plan copy"]);
    expect([...savedInSession]).toEqual(["Plan copy 2"]);
  });

  it("avoids a name saved in this session before its list refresh completes", () => {
    const retainedNames: string[] = [];
    const savedInSession = new Set<string>();
    const first = suggestedCopyName("Plan", retainedNames, savedInSession);
    savedInSession.add(first);
    const reopened = suggestedCopyName("Plan", retainedNames, savedInSession);
    expect(first).toBe("Plan copy");
    expect(reopened).toBe("Plan copy 2");
    savedInSession.add(reopened);
    expect(suggestedCopyName("Plan", retainedNames, savedInSession)).toBe("Plan copy 3");
  });
});

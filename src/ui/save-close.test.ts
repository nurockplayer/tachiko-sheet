import { describe, expect, it } from "vitest";
import type { SheetShellProps, WorkbookView } from "../contracts.js";
import { savedCloseIsConfirmed } from "./save-close.js";

describe("Close after a copy", () => {
  const savedView = { occurrence: "work-a", revision: "r2" };
  const confirmed = {
    view: { ...savedView } as WorkbookView,
    saveStatus: "saved", dirty: false, currentness: "current",
  } satisfies Pick<SheetShellProps, "view" | "saveStatus" | "dirty" | "currentness">;

  it("requires a confirmed saved current work with no drafts", () => {
    expect(savedCloseIsConfirmed(savedView, confirmed, false)).toBe(true);
    expect(savedCloseIsConfirmed(savedView, confirmed, true)).toBe(false);
    expect(savedCloseIsConfirmed(savedView, { ...confirmed, dirty: true }, false)).toBe(false);
    expect(savedCloseIsConfirmed(savedView, { ...confirmed, view: null }, false)).toBe(false);
    for (const saveStatus of ["failed", "saving", "not-saved"] as const) {
      expect(savedCloseIsConfirmed(savedView, { ...confirmed, saveStatus }, false)).toBe(false);
    }
    for (const currentness of ["unknown", "pending"] as const) {
      expect(savedCloseIsConfirmed(savedView, { ...confirmed, currentness }, false)).toBe(false);
    }
  });

  it("never closes a replaced work or a changed revision using earlier save evidence", () => {
    for (const view of [
      { ...confirmed.view, occurrence: "work-b" },
      { ...confirmed.view, revision: "r3" },
    ]) expect(savedCloseIsConfirmed(savedView, { ...confirmed, view }, false)).toBe(false);
  });
});

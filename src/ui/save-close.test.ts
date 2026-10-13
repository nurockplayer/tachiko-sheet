import { describe, expect, it } from "vitest";
import type { SheetShellProps, WorkbookView } from "../contracts.js";
import { closeSaveUnavailableReason, savedCloseIsConfirmed } from "./save-close.js";

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

describe("Save a copy unavailable reason", () => {
  const ready = { saveStatus: "not-saved", currentness: "current", busy: false } as const;

  it("preserves the previous disabled condition across every state and draft combination", () => {
    for (const saveStatus of ["not-saved", "saving", "saved", "failed"] as const) {
      for (const currentness of ["current", "pending", "unknown"] as const) {
        for (const controlsLocked of [false, true]) {
          for (const cellDraftActive of [false, true]) {
            for (const anyNotesDraft of [false, true]) {
              for (const hasInvalidReportDraft of [false, true]) {
                const drafts = cellDraftActive || anyNotesDraft || hasInvalidReportDraft;
                const previouslyDisabled = controlsLocked || currentness !== "current" || saveStatus === "saving" || drafts;
                expect(closeSaveUnavailableReason({ saveStatus, currentness, busy: controlsLocked }, drafts) !== null)
                  .toBe(previouslyDisabled);
              }
            }
          }
        }
      }
    }
  });

  it("explains every state that disables Save a copy, and nothing when it is available", () => {
    expect(closeSaveUnavailableReason(ready, false)).toBeNull();
    expect(closeSaveUnavailableReason(ready, true)).toMatch(/unfinished edits/);
    expect(closeSaveUnavailableReason({ ...ready, currentness: "unknown" }, false)).toMatch(/refresh/);
    expect(closeSaveUnavailableReason({ ...ready, currentness: "pending" }, false)).toMatch(/wait for confirmation/);
    expect(closeSaveUnavailableReason({ ...ready, saveStatus: "saving" }, false)).toMatch(/still finishing/);
    expect(closeSaveUnavailableReason({ ...ready, busy: true }, false)).toMatch(/still finishing/);
  });
});

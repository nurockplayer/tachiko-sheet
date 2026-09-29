import { describe, expect, it } from "vitest";
import type { PublicationProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";
import { confirmHistoryCommand, confirmScalarHistory, emptyLocalHistory, KNOWN_HISTORY_LIMIT, observeLocalHistory } from "./local-history.js";

function view(occurrence = "occ-1", revision = "r0"): WorkbookView {
  return { title: "Work", occurrence, revision, collections: [], table: { revision, collection: { key: "items", id: "items", entity_count: 0 }, columns: [], rows: [] } };
}
function publication(base: string, resulting: string): PublicationProjection {
  return { base_revision: base, resulting_revision: resulting, entities: [], fields: [], affected_calculations: [] };
}

describe("disposable local history knowledge", () => {
  it("starts empty, caps at core capacity, and clears redo after an admitted scalar publication", () => {
    let state = emptyLocalHistory(view());
    for (let revision = 0; revision < KNOWN_HISTORY_LIMIT + 3; revision += 1) {
      const next = `r${revision + 1}`;
      state = confirmScalarHistory(state, view("occ-1", next), publication(`r${revision}`, next), true);
    }
    expect(state.undoCount).toBe(64);
    state = { ...state, redoCount: 3 };
    state = confirmScalarHistory(state, view("occ-1", "r68"), publication("r67", "r68"), true);
    expect(state).toMatchObject({ undoCount: 64, redoCount: 0, revision: "r68" });
  });

  it("moves one known step for successful undo and redo publications", () => {
    const current = { ...emptyLocalHistory(view("occ-1", "r2")), undoCount: 2 };
    const undone = confirmHistoryCommand(current, view("occ-1", "r3"), publication("r2", "r3"), "undo");
    expect(undone).toMatchObject({ undoCount: 1, redoCount: 1 });
    const redone = confirmHistoryCommand(undone, view("occ-1", "r4"), publication("r3", "r4"), "redo");
    expect(redone).toMatchObject({ undoCount: 2, redoCount: 0 });
  });

  it("preserves known history for same-revision reads and clears on barriers or incoherence", () => {
    const current = { ...emptyLocalHistory(view("occ-1", "r2")), undoCount: 2, redoCount: 1 };
    expect(observeLocalHistory(current, view("occ-1", "r2"))).toBe(current);
    expect(observeLocalHistory(current, view("occ-1", "r3"))).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(confirmScalarHistory(current, view("occ-1", "r3"), publication("r1", "r3"), true)).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(confirmScalarHistory(current, view("occ-1", "r3"), publication("r2", "r3"), false)).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(observeLocalHistory(current, view("occ-2", "r2"))).toMatchObject({ occurrence: "occ-2", undoCount: 0, redoCount: 0 });
  });
});

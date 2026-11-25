import { describe, expect, it } from "vitest";
import type { PublicationProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";
import { applyViewHistory, confirmHistoryCommand, confirmScalarHistory, emptyLocalHistory, KNOWN_HISTORY_LIMIT, observeLocalHistory, recordViewHistory } from "./local-history.js";

function view(occurrence = "occ-1", revision = "r0"): WorkbookView {
  return { title: "Work", occurrence, revision, collections: [], table: { revision, collection: { key: "items", display_name: "items", id: "items", headerless: false, data_start_row: 2, entity_count: 0 }, columns: [], rows: [] } };
}
function publication(base: string, resulting: string): PublicationProjection {
  return { base_revision: base, resulting_revision: resulting, entities: [], fields: [], affected_calculations: [], schemas: [], schema_fields: [] };
}

describe("disposable local history knowledge", () => {
  it("starts empty, caps at core capacity, and clears redo after an admitted scalar publication", () => {
    let state = emptyLocalHistory(view());
    for (let revision = 0; revision < KNOWN_HISTORY_LIMIT + 3; revision += 1) {
      const next = `r${revision + 1}`;
      state = confirmScalarHistory(state, view("occ-1", next), publication(`r${revision}`, next), true);
    }
    expect(state.undo).toHaveLength(64);
    state = { ...state, redo: ["work", "work", "work"] };
    state = confirmScalarHistory(state, view("occ-1", "r68"), publication("r67", "r68"), true);
    expect(state.undo).toHaveLength(64);
    expect(state).toMatchObject({ redo: [], revision: "r68" });
  });

  it("moves one known step for successful undo and redo publications", () => {
    const current = { ...emptyLocalHistory(view("occ-1", "r2")), undo: ["work", "work"] as const };
    const undone = confirmHistoryCommand(current, view("occ-1", "r3"), publication("r2", "r3"), "undo");
    expect(undone).toMatchObject({ undo: ["work"], redo: ["work"] });
    const redone = confirmHistoryCommand(undone, view("occ-1", "r4"), publication("r3", "r4"), "redo");
    expect(redone).toMatchObject({ undo: ["work", "work"], redo: [] });
  });

  it("undoes and redoes edit, sort, edit in order and only publishes Work steps", () => {
    let sorted = false;
    const sort = (direction: "undo" | "redo") => { sorted = direction === "redo"; };
    let state = confirmScalarHistory(emptyLocalHistory(view()), view("occ-1", "r1"), publication("r0", "r1"), true);
    state = recordViewHistory(state, sort);
    sorted = true;
    state = confirmScalarHistory(state, view("occ-1", "r2"), publication("r1", "r2"), true);

    expect(applyViewHistory(state, "undo")).toBeNull();
    state = confirmHistoryCommand(state, view("occ-1", "r3"), publication("r2", "r3"), "undo");
    expect(sorted).toBe(true);
    state = applyViewHistory(state, "undo")!;
    expect(state.revision).toBe("r3");
    expect(sorted).toBe(false);
    expect(applyViewHistory(state, "undo")).toBeNull();
    state = confirmHistoryCommand(state, view("occ-1", "r4"), publication("r3", "r4"), "undo");
    expect(state.undo).toEqual([]);

    expect(applyViewHistory(state, "redo")).toBeNull();
    state = confirmHistoryCommand(state, view("occ-1", "r5"), publication("r4", "r5"), "redo");
    expect(sorted).toBe(false);
    state = applyViewHistory(state, "redo")!;
    expect(state.revision).toBe("r5");
    expect(sorted).toBe(true);
    expect(applyViewHistory(state, "redo")).toBeNull();
    state = confirmHistoryCommand(state, view("occ-1", "r6"), publication("r5", "r6"), "redo");
    expect(state).toMatchObject({ undo: ["work", sort, "work"], redo: [] });
  });

  it("clears redo when a new sort branches from an undone edit", () => {
    const current = { ...emptyLocalHistory(view()), redo: ["work"] as const };
    const sort = () => {};
    expect(recordViewHistory(current, sort)).toMatchObject({ undo: [sort], redo: [] });
  });

  it("preserves known history for same-revision reads and clears on barriers or incoherence", () => {
    const current = { ...emptyLocalHistory(view("occ-1", "r2")), undo: ["work", () => {}] as const, redo: ["work"] as const };
    expect(observeLocalHistory(current, view("occ-1", "r2"))).toBe(current);
    expect(observeLocalHistory(current, view("occ-1", "r3"))).toMatchObject({ undo: [], redo: [] });
    expect(confirmScalarHistory(current, view("occ-1", "r3"), publication("r1", "r3"), true)).toMatchObject({ undo: [], redo: [] });
    expect(confirmScalarHistory(current, view("occ-1", "r3"), publication("r2", "r3"), false)).toMatchObject({ undo: [], redo: [] });
    expect(observeLocalHistory(current, view("occ-2", "r2"))).toMatchObject({ occurrence: "occ-2", undo: [], redo: [] });
  });
});

import { describe, expect, it } from "vitest";
import type { WorkbookView, KeyedGroupedSumResult } from "../../src/contracts.js";
import { UnknownOperationOutcomeError } from "../../src/contracts.js";
import { createMutationCompletion, completionMayUpdateUi, survivingFocusedKey, firstUsableCompletionTarget, saveCompletionIsCurrent, type MutationCompletionPort, type MutationRecovery } from "../../src/app/mutation-completion.js";
import { emptyLocalHistory, observeLocalHistory } from "../../src/application/local-history.js";

function view(revision = "r0"): WorkbookView {
  return { title: "Work", occurrence: "sales", revision, collections: [], table: { revision, collection: { key: "items", id: "items", entity_count: 0 }, columns: [], rows: [] } };
}
const witness = { occurrence: "sales", revision: "r0" };
function harness() {
  const state: ReturnType<MutationCompletionPort["state"]> = { view: view(), history: { ...emptyLocalHistory(view()), undoCount: 1 }, currentness: "current", savedRevision: "r0", definitionIds: ["d1"], results: [] };
  let recovery: MutationRecovery | null = null, dirty = false, reads = 0;
  let observed: KeyedGroupedSumResult[] = [];
  const port: MutationCompletionPort = {
    state: () => state,
    newTable: { close: async () => {}, resetClosed() {}, retainDraft() {}, closeFailed(): never { throw new Error("close failed"); } },
    installView(next) { state.view = next; state.history = next ? observeLocalHistory(state.history, next) : emptyLocalHistory(); },
    installHistory(next) { state.history = next; }, clearResults() { state.results = []; },
    async readResults() { reads++; return observed; }, async readView() { return view("r1"); },
    installResults(results) { state.results = results; state.definitionIds = results.map(r => r.definitionId); },
    restoreResults(prior) { Object.assign(state, prior); }, upsertResult() {}, dropResult() {}, clearPreview() {},
    markDirty() { dirty = true; }, markNotSaved() { state.savedRevision = null; },
    endInitial() {}, markSalesChanged() {}, observeSales() {}, setCurrentness(next) { state.currentness = next; }, setOutcome() {}, setMessage() {},
    recover(next) { recovery = next; state.view = null; dirty = true; state.savedRevision = null; }, acceptSave() { dirty = false; },
  };
  return { completion: createMutationCompletion(port), state, get recovery() { return recovery; }, get dirty() { return dirty; }, get reads() { return reads; }, observed(results: KeyedGroupedSumResult[]) { observed = results; } };
}

describe("mutation completion boundaries", () => {
  it("does not install a partial J4 set or preserve local history after known publication", async () => {
    const h = harness();
    const result = await h.completion.run({ kind: "scalar", witness, edit: { kind: "number", input: "250" }, dispatch: async () => ({ view: view("r1"), publication: { base_revision: "r0", resulting_revision: "r1", entities: [], fields: [], affected_calculations: [] } }) });
    expect(result.kind).toBe("known-publication-recovery");
    expect(h.state.view).toBeNull(); expect(h.state.savedRevision).toBeNull(); expect(h.dirty).toBe(true);
    expect(h.state.history.undoCount).toBe(0); expect(h.reads).toBe(1);
    expect(h.recovery?.resetPreview).toBe(true);
  });
  it("retains scalar input for review without fabricating known publication", async () => {
    const h = harness(); let dispatches = 0;
    await h.completion.run({ kind: "scalar", witness, edit: { kind: "number", input: "250" }, dispatch: async () => { dispatches++; throw new UnknownOperationOutcomeError("edit", { cause: new Error("lost reply") }); } });
    expect(h.recovery).toMatchObject({ kind: "unknown-outcome", resetPreview: false, retainedInput: '{"kind":"number","input":"250"}' });
    expect(dispatches).toBe(1); expect(h.reads).toBe(0); expect(h.dirty).toBe(true);
  });
  it("preserves summary inventory on a trusted scalar refusal", async () => {
    const h = harness();
    const result = await h.completion.run({ kind: "scalar", witness, edit: { kind: "number", input: "bad" }, dispatch: async () => { throw new Error("not a number"); } });
    expect(result.kind).toBe("refused"); expect(h.state.view).toEqual(view());
    expect(h.state.definitionIds).toEqual(["d1"]); expect(h.state.savedRevision).toBe("r0"); expect(h.recovery).toBeNull();
  });
  it("keeps the existing history refusal recovery policy", async () => {
    const h = harness();
    await h.completion.run({ kind: "history", direction: "undo", witness, dispatch: async () => { throw new Error("refused"); } });
    expect(h.recovery).toMatchObject({ kind: "unknown-outcome" }); expect(h.state.history.undoCount).toBe(0);
  });
  it("leaves cleanup summaries to explicit Refresh rather than re-querying on publication", async () => {
    const h = harness();
    const result = await h.completion.run({ kind: "cleanup", witness, dispatch: async () => view("r1") });
    expect(result.kind).toBe("published"); expect(h.reads).toBe(0); expect(h.state.definitionIds).toEqual(["d1"]);
    expect(h.state.results).toEqual([]); expect(h.state.savedRevision).toBeNull(); expect(h.dirty).toBe(true);
  });
});

describe("completion UI and host witnesses", () => {
  it("allows focus only for the same occurrence and uninterrupted intent", () => {
    const intent = { generation: 4, occurrence: "sales" };
    expect(completionMayUpdateUi(intent, intent)).toBe(true);
    expect(completionMayUpdateUi(intent, { ...intent, generation: 5 })).toBe(false);
    expect(completionMayUpdateUi(intent, { ...intent, occurrence: "replacement" })).toBe(false);
    expect(completionMayUpdateUi({ generation: 4, occurrence: null }, { generation: 4, occurrence: null })).toBe(false);
  });
  it("keeps a surviving Tab stop independently of where the user moved DOM focus", () => {
    const prior = { rows: ["a", "b", "c"], fields: ["price", "code"] };
    expect(survivingFocusedKey("b\u0000price", prior, { rows: ["a", "c"], fields: prior.fields })).toBe("c\u0000price");
    expect(survivingFocusedKey("c\u0000price", prior, { rows: ["a"], fields: prior.fields })).toBe("a\u0000price");
    expect(survivingFocusedKey("b\u0000price", prior, { rows: [], fields: prior.fields })).toBeNull();
    expect(firstUsableCompletionTarget(["newer-focus", "published-cell", "initiator", "Refresh"], t => t !== null)).toBe("newer-focus");
  });
  it("refuses a Save receipt from another occurrence even with an equal revision", () => {
    expect(saveCompletionIsCurrent(witness, witness, "r0", "r0")).toBe(true);
    expect(saveCompletionIsCurrent(witness, { occurrence: "replacement", revision: "r0" }, "r0", "r0")).toBe(false);
    expect(saveCompletionIsCurrent(witness, view("r1"), "r0", "r0")).toBe(false);
    expect(saveCompletionIsCurrent(witness, witness, "r0", "r1")).toBe(false);
  });
});

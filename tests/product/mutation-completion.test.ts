import { describe, expect, it } from "vitest";
import type { WorkbookView, KeyedGroupedSumResult } from "../../src/contracts.js";
import { UnknownOperationOutcomeError } from "../../src/contracts.js";
import { createMutationCompletion, completionMayUpdateUi, survivingFocusedKey, firstUsableCompletionTarget, saveCompletionIsCurrent, type MutationCompletionPort, type MutationRecovery, type MutationCommand } from "../../src/app/mutation-completion.js";
import { emptyLocalHistory, observeLocalHistory } from "../../src/application/local-history.js";

function view(revision = "r0"): WorkbookView {
  return { title: "Work", occurrence: "sales", revision, collections: [], table: { revision, collection: { key: "items", id: "items", entity_count: 0 }, columns: [], rows: [] } };
}
const witness = { occurrence: "sales", revision: "r0" };
function harness() {
  const state: ReturnType<MutationCompletionPort["state"]> = { view: view(), history: { ...emptyLocalHistory(view()), undoCount: 1 }, currentness: "current", savedRevision: "r0", definitionIds: ["d1"], results: [] };
  let recovery: MutationRecovery | null = null, dirty = false, reads = 0;
  const effects: string[] = [];
  const markers = { initial: "sales" as string | null, changed: null as string | null };
  let inFlight = true;
  const finish = () => { inFlight = false; effects.push("finish"); };
  let observed: KeyedGroupedSumResult[] = [];
  const port: MutationCompletionPort = {
    state: () => state,
    newTable: {
      close: async () => { effects.push("close"); },
      resetClosed() { effects.push("reset-closed"); state.view = null; state.history = emptyLocalHistory(); markers.initial = null; markers.changed = null; },
      retainDraft() { effects.push("retain-draft"); dirty = true; },
      closeFailed(): never { effects.push("close-failed"); throw new Error("close failed"); },
    },
    installView(next) { port.installHistory(next ? observeLocalHistory(state.history, next) : emptyLocalHistory()); state.view = next; effects.push(`value:${next?.revision ?? "none"}`); },
    installHistory(next) { state.history = next; effects.push(`history:${next.undoCount}/${next.redoCount}`); }, clearResults() { state.results = []; effects.push("clear-results"); },
    async readResults() { reads++; effects.push("read-results"); return observed; }, async readView() { effects.push("read-view"); return view("r1"); },
    installResults(results) { state.results = results; state.definitionIds = results.map(r => r.definitionId); effects.push("results"); },
    restoreResults(prior) { Object.assign(state, prior); effects.push("restore-results"); }, upsertResult() { effects.push("upsert-result"); }, dropResult() { effects.push("drop-result"); }, clearPreview() { effects.push("preview"); },
    markDirty() { dirty = true; effects.push("dirty"); }, markNotSaved() { state.savedRevision = null; effects.push("not-saved"); },
    endInitial(occurrence) { if (markers.initial === occurrence) markers.initial = null; effects.push("initial-ended"); },
    markSalesChanged(occurrence) { markers.changed = occurrence; effects.push("sales-changed"); },
    observeSales(next) { port.endInitial(next.occurrence); port.markSalesChanged(next.occurrence); },
    setCurrentness(next) { state.currentness = next; effects.push(`currentness:${next}`); },
    setOutcome(next) { effects.push(`outcome:${next}`); }, setMessage(message) { effects.push(message === null ? "message-cleared" : "message"); },
    recover(next) {
      recovery = next; effects.push(`recovery:${next.kind}`);
      port.installView(null); port.clearResults(); port.markDirty(); port.markNotSaved();
      port.setCurrentness("unknown"); port.setOutcome(next.kind === "unknown-outcome" ? "unknown" : "idle");
      if (next.resetPreview) port.clearPreview();
      port.setMessage(next.message);
    }, acceptSave() { dirty = false; effects.push("saved"); },
  };
  return { completion: createMutationCompletion(port), state, port, effects, markers, finish, get inFlight() { return inFlight; }, get recovery() { return recovery; }, get dirty() { return dirty; }, get reads() { return reads; }, observed(results: KeyedGroupedSumResult[]) { observed = results; } };
}

describe("mutation completion boundaries", () => {
  it("does not install a partial J4 set or preserve local history after known publication", async () => {
    const h = harness();
    const result = await h.completion.run({ kind: "scalar", witness, edit: { kind: "number", input: "250" }, dispatch: async () => ({ view: view("r1"), publication: { base_revision: "r0", resulting_revision: "r1", entities: [], fields: [], affected_calculations: [], schemas: [], schema_fields: [] } }) });
    expect(result.kind).toBe("known-publication-recovery");
    expect(h.state.view).toBeNull(); expect(h.state.savedRevision).toBeNull(); expect(h.dirty).toBe(true);
    expect(h.state.history.undoCount).toBe(0); expect(h.reads).toBe(1);
    expect(h.recovery?.resetPreview).toBe(true);
  });
  it("accepts the authoritative post-Undo inventory when summary creation is undone", async () => {
    const h = harness(); h.observed([]);
    const result = await h.completion.run({ kind: "history", direction: "undo", witness,
      dispatch: async () => ({ view: view("r1"), publication: { base_revision: "r0", resulting_revision: "r1", entities: [], fields: [], schemas: [], schema_fields: [], affected_calculations: [] } }) });
    expect(result.kind).toBe("published");
    expect(h.state.definitionIds).toEqual([]); expect(h.state.currentness).toBe("current");
    expect(h.state.history).toMatchObject({ undoCount: 0, redoCount: 1, revision: "r1" });
    expect(h.recovery).toBeNull();
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

// Literal effect sequences characterized from 52aef66 App.tsx: history precedes
// installView; completePublishedObservation finishes before App's finally/end.
// These are base oracles, not arrays generated by the implementation under test.
const trackedBase = ["message-cleared", "currentness:pending", "dispatch", "history:2/0", "history:2/0", "value:r1", "preview", "dirty", "not-saved", "read-results", "results", "initial-ended", "sales-changed", "currentness:current", "outcome:idle", "finish", "focus"];
const publication = { base_revision: "r0", resulting_revision: "r1", entities: [], fields: [{ entity: "a", field: "price" }], affected_calculations: [], schemas: [], schema_fields: [] };
const result = { definitionId: "d1", revision: "r1", groups: [], diagnostics: [] } as unknown as KeyedGroupedSumResult;

describe("52aef66 completion effect order", () => {
  for (const path of ["scalar", "insert", "delete", "undo", "redo", "cleanup", "summary"] as const) {
    it(`completes ${path} publication, history, markers, save truth and completion/focus order`, async () => {
      const h = harness(); h.observed([result]);
      if (path === "redo") h.state.history = { ...h.state.history, undoCount: 0, redoCount: 1 };
      const dispatch = async () => { h.effects.push("dispatch"); return { view: view("r1"), publication }; };
      const command: MutationCommand = path === "scalar" ? { kind: "scalar", witness, edit: { kind: "number", input: "250" }, dispatch }
        : path === "insert" || path === "delete" ? { kind: "rows", witness, dispatch }
        : path === "undo" || path === "redo" ? { kind: "history", witness, direction: path, dispatch }
        : path === "cleanup" ? { kind: "cleanup", witness, dispatch: async () => { h.effects.push("dispatch"); return view("r1"); } }
        : { kind: "summary", witness, dispatch };
      if (path === "summary") h.port.setMessage(null); // App's binding preflight.
      await h.completion.run(command, completion => completion, h.finish);
      h.effects.push("focus");
      const expected = path === "cleanup"
        ? ["dispatch", "clear-results", "initial-ended", "history:0/0", "value:r1", "dirty", "not-saved", "preview", "outcome:idle", "finish", "focus"]
        : path === "summary"
        ? ["message-cleared", "currentness:pending", "clear-results", "dispatch", "initial-ended", "read-view", "read-results", "history:2/0", "history:2/0", "value:r1", "results", "preview", "dirty", "not-saved", "currentness:current", "outcome:idle", "finish", "focus"]
        : trackedBase.map(effect => effect === "history:2/0" ? `history:${path === "undo" ? "0/1" : path === "redo" ? "1/0" : "2/0"}` : effect);
      expect(h.effects).toEqual(expected);
      expect(h.markers).toEqual({ initial: null, changed: path === "cleanup" || path === "summary" ? null : "sales" });
      expect(h.dirty).toBe(true); expect(h.state.savedRevision).toBeNull(); expect(h.inFlight).toBe(false);
    });
  }
  for (const kind of ["scalar", "rows", "history", "cleanup", "summary"] as const) {
    for (const mode of ["known-publication-recovery", "unknown-outcome"] as const) {
      it(`preserves ${kind} ${mode} markers before recovery and before any Refresh`, () => {
        const h = harness();
        h.completion.recover(mode, kind === "scalar" ? { kind, witness, edit: { kind: "number", input: "250" } }
          : kind === "history" ? { kind, witness, direction: "undo" } : { kind, witness });
        const tracked = ["scalar", "rows", "history"].includes(kind);
        expect(h.effects).toEqual([
          ...(tracked ? ["history:0/0"] : []),
          ...(mode === "known-publication-recovery" ? ["initial-ended", ...(tracked ? ["sales-changed"] : [])] : []),
          `recovery:${mode}`, "history:0/0", "value:none", "clear-results", "dirty", "not-saved", "currentness:unknown",
          `outcome:${mode === "unknown-outcome" ? "unknown" : "idle"}`,
          ...(mode === "known-publication-recovery" || kind === "cleanup" ? ["preview"] : []), "message",
        ]);
        expect(h.markers).toEqual({ initial: mode === "known-publication-recovery" ? null : "sales", changed: mode === "known-publication-recovery" && tracked ? "sales" : null });
      });
    }
  }
  for (const kind of ["scalar", "rows", "history", "cleanup", "summary"] as const) {
    it(`preserves ${kind} trusted refusal completion order`, async () => {
      const h = harness();
      const dispatch = async () => { h.effects.push("dispatch"); throw new Error("refused"); };
      const command: MutationCommand = kind === "scalar" ? { kind, witness, edit: { kind: "number", input: "bad" }, dispatch }
        : kind === "history" ? { kind, witness, direction: "undo", dispatch } : { kind, witness, dispatch };
      if (kind === "summary") h.port.setMessage(null);
      await h.completion.run(command, completion => completion, h.finish); h.effects.push("focus");
      const expected = kind === "history"
        ? ["message-cleared", "currentness:pending", "dispatch", "history:0/0", "recovery:unknown-outcome", "history:0/0", "value:none", "clear-results", "dirty", "not-saved", "currentness:unknown", "outcome:unknown", "message", "finish", "focus"]
        : kind === "cleanup" ? ["dispatch", "outcome:idle", "preview", "message", "finish", "focus"]
        : ["message-cleared", "currentness:pending", ...(kind === "summary" ? ["clear-results"] : []), "dispatch",
          ...(kind === "scalar" || kind === "summary" ? ["restore-results"] : []),
          ...(kind === "summary" ? ["currentness:current", "outcome:idle"] : ["outcome:idle", "currentness:current"]),
          ...(kind !== "rows" ? ["message"] : []), "finish", "focus"];
      expect(h.effects).toEqual(expected); expect(h.markers).toEqual({ initial: "sales", changed: null });
      expect(h.inFlight).toBe(false);
    });
  }
  it("clears in-flight in the base completion turn before the next render opportunity", async () => {
    const h = harness(); h.observed([result]);
    let lockedAtFrame: boolean | undefined;
    const original = h.port.setOutcome;
    h.port.setOutcome = outcome => {
      original(outcome);
      if (outcome === "idle") queueMicrotask(() => queueMicrotask(() => { lockedAtFrame = h.inFlight; }));
    };
    await h.completion.run({ kind: "history", direction: "undo", witness, dispatch: async () => ({ view: view("r1"), publication }) }, completion => completion, h.finish);
    await Promise.resolve();
    expect(lockedAtFrame).toBe(false);
  });
  it("preserves targeted J4 Refresh completion order without dirty/marker effects", async () => {
    const h = harness();
    await h.completion.refreshSummary(witness, "d1", async () => { h.effects.push("dispatch"); return { ...result, revision: "r0" }; }, h.finish);
    h.effects.push("focus");
    expect(h.effects).toEqual(["message-cleared", "currentness:pending", "dispatch", "upsert-result", "currentness:current", "outcome:idle", "finish", "focus"]);
    expect(h.markers).toEqual({ initial: "sales", changed: null }); expect(h.dirty).toBe(false);
  });
  it("preserves confirmed New table dirty/finish/focus order", async () => {
    const h = harness();
    await h.completion.newTable(async () => { h.effects.push("dispatch"); return { kind: "confirmed" }; }, new Error("unconfirmed"), h.finish);
    h.effects.push("focus");
    expect(h.effects).toEqual(["dispatch", "dirty", "finish", "focus"]);
  });
  it("disposes uncertain New table before retaining the draft and completing", async () => {
    const h = harness(), unconfirmed = new Error("unconfirmed");
    await expect(h.completion.newTable(async () => { h.effects.push("dispatch"); return { kind: "unknown-recovery" }; }, unconfirmed, h.finish)).rejects.toBe(unconfirmed);
    expect(h.effects).toEqual(["dispatch", "close", "reset-closed", "retain-draft", "finish"]);
    expect(h.markers).toEqual({ initial: null, changed: null });
  });
});

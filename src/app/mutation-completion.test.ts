/**
 * Formula refusals are Work's words. These cases pin that only a formula
 * refusal skips the explanatory prefix, and that Work's 1-based character
 * position is forwarded when it exists.
 */
import { describe, expect, it } from "vitest";

import { UnknownOperationOutcomeError, type WorkbookView } from "../contracts.js";
import { emptyLocalHistory } from "../application/local-history.js";
import { PublishedProjectionRecoveryError } from "../runtime/session.js";
import { createMutationCompletion, type MutationCompletionPort, type MutationRecovery } from "./mutation-completion.js";

const view = {
  title: "Plan",
  occurrence: "occ-1",
  revision: "rev-1",
  collections: [],
  table: { revision: "rev-1", collection: { id: "col-1", key: "plan", display_name: "Plan", entity_count: 0 }, columns: [], rows: [], native_table_profile: true },
} as unknown as WorkbookView;

function harness(): { port: MutationCompletionPort; messages: Array<string | null>; recoveries: MutationRecovery[] } {
  const messages: Array<string | null> = [];
  const recoveries: MutationRecovery[] = [];
  const target = {
    state: () => ({
      view,
      history: emptyLocalHistory(),
      currentness: "current" as const,
      savedRevision: view.revision,
      definitionIds: [],
      results: [],
    }),
    setMessage: (message: string | null) => { messages.push(message); },
    recover: (recovery: MutationRecovery) => { recoveries.push(recovery); },
  };
  const proxy = new Proxy(target, {
    get(object, key) { return key in object ? object[key as keyof typeof object] : () => undefined; },
  });
  return { port: proxy as unknown as MutationCompletionPort, messages, recoveries };
}

function refusal(failure: { code: string; message: string; position?: number; diagnostics?: unknown[] }): Error {
  return Object.assign(new Error(failure.message), { failure });
}

const witness = { occurrence: "occ-1", revision: "rev-1" };

describe("mutation completion formula refusal", () => {
  it("shows Work's refusal message verbatim with its position", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "scalar",
      witness,
      edit: { kind: "formula", source: "1 +" },
      dispatch: async () => { throw refusal({ code: "invalid_formula", message: "Unexpected end of input.", position: 4 }); },
    });
    expect(result).toEqual({ kind: "refused", message: "Unexpected end of input.", position: 4 });
  });

  it("keeps a formula refusal out of the global banner: the bar shows it", async () => {
    const { port, messages } = harness();
    await createMutationCompletion(port).run({
      kind: "scalar",
      witness,
      edit: { kind: "formula", source: "1 +" },
      dispatch: async () => { throw refusal({ code: "invalid_formula", message: "Unexpected end of input.", position: 4 }); },
    });
    // The run clears the banner itself; the refusal must not set it again.
    expect(messages).not.toContain("Unexpected end of input.");
    expect(messages.at(-1)).toBeNull();
  });

  it("adds no position when Work's refusal has none", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "scalar",
      witness,
      edit: { kind: "formula", source: "nope" },
      dispatch: async () => { throw refusal({ code: "invalid_formula", message: "Unknown reference." }); },
    });
    expect(result).toEqual({ kind: "refused", message: "Unknown reference." });
  });

  it("keeps the explanatory prefix for a non-formula refusal", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "scalar",
      witness,
      edit: { kind: "text", value: "x" },
      dispatch: async () => { throw refusal({ code: "invalid_text", message: "Text is not allowed here." }); },
    });
    expect(result).toEqual({ kind: "refused", message: "The change was not applied. (Details: Text is not allowed here.)" });
  });
});

describe("mutation completion duplicate recovery", () => {
  const publication = { base_revision: "rev-1", resulting_revision: "rev-2", entities: [], fields: [], affected_calculations: [], schemas: [], schema_fields: [] };

  it("keeps the submitted duplicate name visible after a lost acknowledgement", async () => {
    const { port, recoveries } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      retainedInput: "Plan copy",
      dispatch: async () => { throw new UnknownOperationOutcomeError("lost transport"); },
    });
    expect(result).toEqual({ kind: "unknown-outcome" });
    // The dialog closed with the submission; the name must survive in the
    // message and in the retained input, and the operation is not replayed.
    const recovery = recoveries.at(-1)!;
    expect(recovery.message).toContain("“Plan copy”");
    expect(recovery.message).toContain("not retried");
    expect(recovery.retainedInput).toBe("Plan copy");
  });

  it("names the duplicate when a published copy could not be confirmed", async () => {
    const { port, recoveries } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      retainedInput: "Plan copy",
      dispatch: async () => { throw new PublishedProjectionRecoveryError(publication, new Error("lost read")); },
    });
    expect(result).toEqual({ kind: "known-publication-recovery" });
    expect(recoveries.at(-1)?.message).toContain("“Plan copy”");
  });

  it("keeps the generic wording for a row change with no retained input", async () => {
    const { port, recoveries } = harness();
    await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => { throw new UnknownOperationOutcomeError("lost transport"); },
    });
    const recovery = recoveries.at(-1)!;
    expect(recovery.message).toContain("row change");
    expect(recovery.retainedInput).toBeUndefined();
  });

  it("relays Work's blank count for a required_values_missing refusal", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => { throw refusal({ code: "required_values_missing", message: "2 rows have no value in this column.", diagnostics: [{ facts: [{ name: "blank_count", value: "2" }] }] }); },
    });
    expect(result).toMatchObject({ kind: "refused", refusalCode: "required_values_missing", blankCount: 2 });
  });
});

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

function refusal(failure: { code: string; message: string; position?: number; diagnostics?: unknown[]; constraint_failure?: unknown; limit?: string; maximum?: number; attempted?: number; collection?: string }): Error {
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

  it("shows Work's R2 type-mismatch refusal verbatim", async () => {
    const { port } = harness();
    const message = "Formula reference '[.title]' is not a Number field.";
    const result = await createMutationCompletion(port).run({
      kind: "scalar",
      witness,
      edit: { kind: "formula", source: "[.title] * 2" },
      dispatch: async () => { throw refusal({ code: "formula_type_mismatch", message }); },
    });
    expect(result).toEqual({ kind: "refused", message });
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

describe("mutation completion capacity refusal", () => {
  it("shows the capacity message for a refused rows command", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => {
        throw refusal({ code: "capacity_exceeded", message: "capacity_exceeded", limit: "table_rows", maximum: 100, attempted: 101, collection: view.table.collection.id });
      },
    });
    expect(result).toMatchObject({
      kind: "refused",
      message: "This table can hold up to 100 rows; this change would make 101. Nothing was changed.",
      refusalCode: "capacity_exceeded",
    });
  });

  it("names the refused table when it is not the one on screen", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => {
        throw refusal({ code: "capacity_exceeded", message: "capacity_exceeded", limit: "table_rows", maximum: 100, attempted: 101, collection: "c-elsewhere" });
      },
    });
    expect(result).toMatchObject({ kind: "refused", message: "Another table can hold up to 100 rows; this change would make 101. Nothing was changed." });
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

  it("shows Work's column-rule refusal verbatim", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => { throw refusal({ code: "invalid_constraint_declaration", message: "The lowest value is above the highest value.", constraint_failure: { reason: "declaration", offending_rows: 0 } }); },
    });
    expect(result).toMatchObject({ kind: "refused", message: "The lowest value is above the highest value.", refusalCode: "invalid_constraint_declaration" });
  });

  it("words a refused value by the column's rule, never Work's ids", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => { throw refusal({ code: "field_constraint_violation", message: "field 'native_table_x.native_table_field_y' refuses this value outside its constraint (allowed range: 1 to 5)", constraint_failure: { reason: "field_value", schema: "native_table_x", field: "native_table_field_y", constraint: { kind: "number_inclusive_range", min: 1, max: 5 }, offending_rows: 1 } }); },
    });
    expect(result).toMatchObject({ kind: "refused", message: "This column must be between 1 and 5.", refusalCode: "field_constraint_violation" });
  });

  it("keeps the explanatory prefix for other row refusals", async () => {
    const { port } = harness();
    const result = await createMutationCompletion(port).run({
      kind: "rows",
      witness,
      dispatch: async () => { throw refusal({ code: "stale_revision", message: "The work changed." }); },
    });
    expect(result).toMatchObject({ kind: "refused", message: "The row change was not applied. (Details: The work changed.)" });
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

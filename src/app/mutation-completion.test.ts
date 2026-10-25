/**
 * Formula refusals are Work's words. These cases pin that only a formula
 * refusal skips the explanatory prefix, and that Work's 1-based character
 * position is forwarded when it exists.
 */
import { describe, expect, it } from "vitest";

import type { WorkbookView } from "../contracts.js";
import { emptyLocalHistory } from "../application/local-history.js";
import { createMutationCompletion, type MutationCompletionPort } from "./mutation-completion.js";

const view = {
  title: "Plan",
  occurrence: "occ-1",
  revision: "rev-1",
  collections: [],
  table: { revision: "rev-1", collection: { id: "col-1", key: "plan", display_name: "Plan", entity_count: 0 }, columns: [], rows: [], native_table_profile: true },
} as unknown as WorkbookView;

function harness(): { port: MutationCompletionPort; messages: Array<string | null> } {
  const messages: Array<string | null> = [];
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
  };
  const proxy = new Proxy(target, {
    get(object, key) { return key in object ? object[key as keyof typeof object] : () => undefined; },
  });
  return { port: proxy as unknown as MutationCompletionPort, messages };
}

function refusal(failure: { code: string; message: string; position?: number }): Error {
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

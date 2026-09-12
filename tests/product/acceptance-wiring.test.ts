/**
 * Focused unit evidence for the acceptance-only wiring module. This is not the
 * browser acceptance: it exercises the real instrumentation logic (dispatch
 * counting, one bounded reply loss with a retained genuine receipt) with an
 * injected public-client fake.
 */
import { describe, expect, it } from "vitest";
import { UnknownOperationOutcomeError, type CoreKit, type KitLoader } from "../../src/contracts.js";
import { hashCanonicalFiles } from "../../src/acceptance/canonical-hash.js";
import {
  executeRequestCount,
  failNextOpenProjection,
  installAcceptance,
  lastReceipt,
  loseNextExecuteReply,
  openProjectRequestCount,
  settleFaultWindow,
  wrapKitLoader,
} from "../../src/acceptance/sheet-foundation.js";

function projection(overrides: Record<string, unknown> = {}) {
  return {
    base_revision: "r1",
    resulting_revision: "r2",
    entities: ["e"],
    fields: [],
    affected_calculations: [],
    ...overrides,
  };
}

function fakeKit(onEdit: () => Promise<ReturnType<typeof projection>>): { kit: CoreKit; calls: () => number } {
  const state = { calls: 0 };
  const client = {
    editNumber: async () => {
      state.calls += 1;
      return onEdit();
    },
    queryTable: async (collection: string) => ({ collection, rows: [], columns: [], revision: "r1" }),
  };
  const kit = {
    createExperimentalDesignerClient: () => client,
  } as unknown as CoreKit;
  return { kit, calls: () => state.calls };
}

describe("acceptance canonical hash", () => {
  const encoder = new TextEncoder();
  const file = (path: string, text: string) => ({ path, bytes: encoder.encode(text).buffer });

  it("is deterministic and independent of input order", async () => {
    const left = await hashCanonicalFiles([file("b.json", "second"), file("a.json", "first")]);
    const right = await hashCanonicalFiles([file("a.json", "first"), file("b.json", "second")]);
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when opaque bytes change", async () => {
    const before = await hashCanonicalFiles([file("a.json", "first")]);
    const after = await hashCanonicalFiles([file("a.json", "second")]);
    expect(after).not.toBe(before);
  });
});

describe("acceptance kit instrumentation", () => {
  it("counts genuine scalar-edit dispatches and returns the real projection", async () => {
    const { kit, calls } = fakeKit(async () => projection());
    const loader: KitLoader = wrapKitLoader(async () => kit);
    const instrumented = (await loader()).createExperimentalDesignerClient();
    const start = executeRequestCount();
    const result = await instrumented.editNumber("r1", { entity: "e", field: "f" }, "3");
    expect(result.resulting_revision).toBe("r2");
    expect(calls()).toBe(1);
    expect(executeRequestCount() - start).toBe(1);
  });

  it("loses exactly one real reply after dispatch, retains the receipt and never retries", async () => {
    const { kit, calls } = fakeKit(async () => projection({ resulting_revision: "r7" }));
    const loader: KitLoader = wrapKitLoader(async () => kit);
    const instrumented = (await loader()).createExperimentalDesignerClient();
    const start = executeRequestCount();
    loseNextExecuteReply();
    await expect(
      instrumented.editNumber("r1", { entity: "e", field: "f" }, "3"),
    ).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
    await settleFaultWindow();
    expect(calls()).toBe(1);
    expect(executeRequestCount() - start).toBe(1);
    expect(lastReceipt()?.resulting_revision).toBe("r7");
    const next = await instrumented.editNumber("r2", { entity: "e", field: "f" }, "4");
    expect(next.resulting_revision).toBe("r7");
    expect(calls()).toBe(2);
  });

  it("fails only the next real post-open projection reply", async () => {
    const { kit } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    failNextOpenProjection();
    await expect(instrumented.queryTable("items")).rejects.toThrow("replacement projection reply");
    await expect(instrumented.queryTable("items")).resolves.toMatchObject({ collection: "items" });
  });

  it("exposes the observation global only after installation", () => {
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    try {
      expect(scope.window.__tachikoAcceptance).toBeUndefined();
      installAcceptance({ runtime: {} as never, copies: {} as never });
      const api = scope.window.__tachikoAcceptance as Record<string, unknown>;
      for (const name of [
        "observe",
        "savedHash",
        "failNextSave",
        "loseNextExecuteReply",
        "failNextOpenProjection",
        "openProjectRequestCount",
        "executeRequestCount",
        "settleFaultWindow",
        "saveObservation",
        "unknownObservation",
        "lastReceipt",
      ]) {
        expect(typeof api[name]).toBe("function");
      }
    } finally {
      scope.window = previous;
    }
  });
});

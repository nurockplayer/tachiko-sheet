/**
 * Focused unit evidence for the acceptance-only wiring module. This is not the
 * browser acceptance: it exercises the real instrumentation logic (dispatch
 * counting, one bounded reply loss with a retained genuine receipt) with an
 * injected public-client fake.
 */
import { describe, expect, it, vi } from "vitest";
import { UnknownOperationOutcomeError, type CoreKit, type KitLoader } from "../../src/contracts.js";
import { hashCanonicalFiles } from "../../src/acceptance/canonical-hash.js";
import {
  executeRequestCount,
  acceptanceHarnessVersion,
  armTargetedQueryReplyFault,
  coreFailureProbe,
  deferSecondScalarRequeryReply,
  failSecondScalarRequeryReplyAfterFirst,
  failNextOpenProjection,
  importSpreadsheetRequestCount,
  installAcceptance,
  lastReceipt,
  loseNextExecuteReply,
  loseNextImportBeforeDispatch,
  loseNextImportReplyAfterDispatch,
  openProjectRequestCount,
  resetCoreFailureProbe,
  resetTargetedQueryReplyFault,
  resetScalarRequeryFaultProbe,
  releaseSecondScalarRequeryReply,
  scalarRequeryFaultProbe,
  settleFaultWindow,
  targetedQueryFaultProbe,
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

function fakeKit(onEdit: () => Promise<ReturnType<typeof projection>>): { kit: CoreKit; calls: () => number; importCalls: () => number; queryCalls: () => number } {
  const state = { calls: 0, importCalls: 0, queryCalls: 0 };
  const client = {
    openProject: async () => ({}) as never,
    importSpreadsheet: async () => {
      state.importCalls += 1;
      return { imported: true } as never;
    },
    editNumber: async () => {
      state.calls += 1;
      return onEdit();
    },
    commitCleanup: async () => {
      state.calls += 1;
      return onEdit();
    },
    queryTable: async (collection: string) => ({ collection, rows: [], columns: [], revision: "r1" }),
    observeOccurrence: async () => ({ scope: "occurrence-1", revision: "r2" }),
    queryKeyedGroupedSum: async (definitionId: string) => {
      state.queryCalls += 1;
      return { definitionId, revision: "r2", groups: [], diagnostics: [] };
    },
  };
  const kit = {
    createExperimentalDesignerClient: () => client,
  } as unknown as CoreKit;
  return { kit, calls: () => state.calls, importCalls: () => state.importCalls, queryCalls: () => state.queryCalls };
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
  it("records typed core observation failures without exposing payloads", async () => {
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    const view = { title: "probe", occurrence: "o1", revision: "r1", collections: [], table: {} } as never;
    let failed: Error | null = null;
    let calls = 0;
    const originalRead = async () => {
      calls += 1;
      if (failed) throw failed;
      return view;
    };
    const runtime = { read: originalRead };
    try {
      installAcceptance({ runtime: runtime as never, copies: {} as never });
      const first = await runtime.read();
      expect(first).toBe(view);
      expect(calls).toBe(1);

      const cause = new Error("no resident project");
      cause.name = "DesignerRuntimeError";
      Object.assign(cause, { failure: { code: "no_project_open" } });
      failed = new Error("No resident work is available.", { cause });
      failed.name = "NoResidentWorkError";
      resetCoreFailureProbe();
      await expect(runtime.read()).rejects.toBe(failed);
      expect(calls).toBe(2);
    } finally {
      scope.window = previous;
    }
    expect(coreFailureProbe()).toEqual({
      name: "NoResidentWorkError",
      causeName: "DesignerRuntimeError",
      causeFailureCode: "no_project_open",
    });
  });

  it("discards only the targeted real reply for its observed definition, occurrence, revision, and client", async () => {
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    const fake = fakeKit(async () => projection());
    try {
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await client.observeOccurrence();
      await client.queryKeyedGroupedSum("definition-a");
      const runtime = {
        queryKeyedGroupedSum: (_witness: { occurrence: string; revision: string }, definitionId: string) =>
          client.queryKeyedGroupedSum(definitionId),
        discoverKeyedGroupedSums: async () => [],
      };
      installAcceptance({ runtime: runtime as never, copies: {} as never });
      armTargetedQueryReplyFault("definition-a", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({
        armed: true,
        definitionId: "definition-a",
        occurrence: "occurrence-1",
        revision: "r2",
        owningClientIdentity: expect.any(Number),
        consumed: false,
      });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(2);
      expect(targetedQueryFaultProbe()).toMatchObject({
        armed: false,
        definitionId: "definition-a",
        occurrence: "occurrence-1",
        revision: "r2",
        actualReplyRevision: "r2",
        consumed: true,
        resetReason: null,
      });
    } finally {
      resetTargetedQueryReplyFault();
      scope.window = previous;
    }
  });

  it("leaves no delayed targeted fault after a missing prerequisite, mismatched witness, or other client", async () => {
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    const fake = fakeKit(async () => projection());
    try {
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await client.observeOccurrence();
      await client.queryKeyedGroupedSum("definition-a");
      let rejectNextTargetRequest = false;
      const runtime = {
        queryKeyedGroupedSum: (_witness: { occurrence: string; revision: string }, definitionId: string) =>
          rejectNextTargetRequest
            ? (rejectNextTargetRequest = false, Promise.reject(new Error("target request canceled before dispatch")))
            : client.queryKeyedGroupedSum(definitionId),
        discoverKeyedGroupedSums: async () => [],
      };
      installAcceptance({ runtime: runtime as never, copies: {} as never });

      armTargetedQueryReplyFault("missing-definition", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, resetReason: "prerequisite-unavailable" });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "missing-definition"))
        .resolves.toMatchObject({ revision: "r2" });

      armTargetedQueryReplyFault("definition-a", "occurrence-1", "r2");
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "stale" }, "definition-a"))
        .resolves.toMatchObject({ revision: "r2" });
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, consumed: false, resetReason: "request-identity-or-revision-mismatch" });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .resolves.toMatchObject({ revision: "r2" });

      armTargetedQueryReplyFault("definition-a", "occurrence-1", "r2");
      const otherClient = kit.createExperimentalDesignerClient();
      await otherClient.observeOccurrence();
      await expect(otherClient.queryKeyedGroupedSum("definition-a")).resolves.toMatchObject({ revision: "r2" });
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, consumed: false, resetReason: "query-identity-or-revision-mismatch" });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .resolves.toMatchObject({ revision: "r2" });

      armTargetedQueryReplyFault("definition-a", "occurrence-1", "r2");
      rejectNextTargetRequest = true;
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .rejects.toThrow(/canceled before dispatch/);
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, consumed: false, resetReason: "target-call-failed-before-consumption" });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .resolves.toMatchObject({ revision: "r2" });

      armTargetedQueryReplyFault("definition-a", "occurrence-1", "r2");
      await client.openProject();
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, consumed: false, resetReason: "workbook-replaced" });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" }, "definition-a"))
        .resolves.toMatchObject({ revision: "r2" });
      expect(fake.queryCalls()).toBe(8);
    } finally {
      resetTargetedQueryReplyFault();
      scope.window = previous;
    }
  });

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

  it("loses a real cleanup commit reply after exactly one dispatch", async () => {
    const { kit, calls } = fakeKit(async () => projection({ resulting_revision: "cleanup-r7" }));
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const start = executeRequestCount();
    loseNextExecuteReply();
    const commit = instrumented.commitCleanup;
    expect(commit).toBeDefined();
    await expect(commit!.call(instrumented, "r1", "preview-1")).rejects.toBeInstanceOf(
      UnknownOperationOutcomeError,
    );
    await settleFaultWindow();
    expect(calls()).toBe(1);
    expect(executeRequestCount() - start).toBe(1);
    expect(lastReceipt()?.resulting_revision).toBe("cleanup-r7");
  });

  it("fails only the next real post-open projection reply", async () => {
    const { kit } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    failNextOpenProjection();
    await expect(instrumented.queryTable("items")).rejects.toThrow("replacement projection reply");
    await expect(instrumented.queryTable("items")).resolves.toMatchObject({ collection: "items" });
  });

  it("counts only an actually dispatched public openProject call", async () => {
    const { kit } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const before = openProjectRequestCount();
    await instrumented.openProject(new ArrayBuffer(0));
    expect(openProjectRequestCount() - before).toBe(1);
  });

  it("keeps the before-dispatch import delivery arm at zero real dispatches", async () => {
    const { kit, importCalls } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const before = importSpreadsheetRequestCount();
    loseNextImportBeforeDispatch();
    await expect(instrumented.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never)).rejects.toBeInstanceOf(
      UnknownOperationOutcomeError,
    );
    expect(importCalls()).toBe(0);
    expect(importSpreadsheetRequestCount() - before).toBe(0);
  });

  it("loses an import reply only after exactly one successful real dispatch", async () => {
    const { kit, importCalls } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const before = importSpreadsheetRequestCount();
    loseNextImportReplyAfterDispatch();
    await expect(instrumented.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never)).rejects.toBeInstanceOf(
      UnknownOperationOutcomeError,
    );
    expect(importCalls()).toBe(1);
    expect(importSpreadsheetRequestCount() - before).toBe(1);
  });

  it("keeps before-dispatch and post-dispatch import fault arms mutually exclusive", async () => {
    const { kit, importCalls } = fakeKit(async () => projection());
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const before = importSpreadsheetRequestCount();
    loseNextImportReplyAfterDispatch();
    loseNextImportBeforeDispatch();
    await expect(instrumented.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never)).rejects.toBeInstanceOf(
      UnknownOperationOutcomeError,
    );
    expect(importCalls()).toBe(0);
    loseNextImportBeforeDispatch();
    loseNextImportReplyAfterDispatch();
    await expect(instrumented.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never)).rejects.toBeInstanceOf(
      UnknownOperationOutcomeError,
    );
    expect(importCalls()).toBe(1);
    expect(importSpreadsheetRequestCount() - before).toBe(1);
  });

  it("preserves an underlying import rejection when post-dispatch reply loss is armed", async () => {
    const failure = new Error("real import rejected");
    const client = {
      importSpreadsheet: async () => Promise.reject(failure),
    };
    const kit = {
      createExperimentalDesignerClient: () => client,
    } as unknown as CoreKit;
    const instrumented = (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
    const before = importSpreadsheetRequestCount();
    loseNextImportReplyAfterDispatch();
    await expect(instrumented.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never)).rejects.toBe(failure);
    expect(importSpreadsheetRequestCount() - before).toBe(1);
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
        "loseNextOpenReply",
        "loseNextImportBeforeDispatch",
        "loseNextImportReplyAfterDispatch",
        "failNextImportProjection",
        "failNextOpenProjection",
        "failNextJ4PostPublicationRead",
        "failSecondScalarRequeryReplyAfterFirst",
        "deferSecondScalarRequeryReply",
        "releaseSecondScalarRequeryReply",
        "resetScalarRequeryFaultProbe",
        "scalarRequeryFaultProbe",
        "armTargetedQueryReplyFault",
        "resetTargetedQueryReplyFault",
        "targetedQueryFaultProbe",
        "openProjectRequestCount",
        "importSpreadsheetRequestCount",
        "executeRequestCount",
        "settleFaultWindow",
        "saveObservation",
        "unknownObservation",
        "lastReceipt",
        "exportDispatchCounts",
        "copyWriteDispatchCounts",
        "acceptanceHarnessVersion",
        "resetCoreFailureProbe",
        "coreFailureProbe",
      ]) {
        expect(typeof api[name]).toBe("function");
      }
    } finally {
      scope.window = previous;
    }
  });

  it("identifies the acceptance bundle version", () => {
    expect(acceptanceHarnessVersion()).toBe("j4-scalar-edit-requery-fault-v2");
  });

  it("discards only the second real grouped query after an acknowledged scalar publication", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await client.editNumber("r1", { entity: "entity", field: "field" }, "250");
      await expect(client.queryKeyedGroupedSum("definition-1")).resolves.toMatchObject({ revision: "r2" });
      await expect(client.queryKeyedGroupedSum("definition-2")).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toEqual({
        publicationAcknowledged: true,
        invokedDefinitionIds: ["definition-1", "definition-2"],
        discardedDefinitionId: "definition-2",
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("clears the requested requery fault when its scalar publication is rejected", async () => {
    resetScalarRequeryFaultProbe();
    let publicationCalls = 0;
    const fake = fakeKit(async () => {
      publicationCalls += 1;
      if (publicationCalls === 1) throw new Error("known rejected edit");
      return projection();
    });
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await expect(client.editNumber("r1", { entity: "entity", field: "field" }, "bad")).rejects.toThrow("known rejected edit");
      await expect(client.editNumber("r1", { entity: "entity", field: "field" }, "250")).resolves.toMatchObject({ resulting_revision: "r2" });
      await expect(client.queryKeyedGroupedSum("definition-1")).resolves.toMatchObject({ revision: "r2" });
      await expect(client.queryKeyedGroupedSum("definition-2")).resolves.toMatchObject({ revision: "r2" });
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toEqual({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("clears an armed requery fault when the Work occurrence is replaced before discovery", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await client.editNumber("r1", { entity: "entity", field: "field" }, "250");
      await client.openProject({} as never);
      await expect(client.queryKeyedGroupedSum("definition-1")).resolves.toMatchObject({ revision: "r2" });
      await expect(client.queryKeyedGroupedSum("definition-2")).resolves.toMatchObject({ revision: "r2" });
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toEqual({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("clears the arm when a grouped discovery exits before its second definition query", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const kit = await wrapKitLoader(async () => fake.kit)();
      const client = kit.createExperimentalDesignerClient();
      await client.editNumber("r1", { entity: "entity", field: "field" }, "250");
      const runtime = {
        discoverKeyedGroupedSums: async () => [],
      };
      const scope = globalThis as unknown as { window: Record<string, unknown> };
      const previous = scope.window;
      scope.window = {};
      try {
        installAcceptance({ runtime: runtime as never, copies: {} as never });
        await runtime.discoverKeyedGroupedSums();
      } finally {
        scope.window = previous;
      }
      await expect(client.queryKeyedGroupedSum("definition-1")).resolves.toMatchObject({ revision: "r2" });
      await expect(client.queryKeyedGroupedSum("definition-2")).resolves.toMatchObject({ revision: "r2" });
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toEqual({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("resets an unconsumed deferred reply before arming a fresh hold", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      resetScalarRequeryFaultProbe();

      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      const client = (await wrapKitLoader(async () => fake.kit)()).createExperimentalDesignerClient();
      await client.editNumber("r1", { entity: "entity", field: "field" }, "250");
      await expect(client.queryKeyedGroupedSum("definition-1")).resolves.toMatchObject({ revision: "r2" });
      const second = client.queryKeyedGroupedSum("definition-2");
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let completed = false;
      void second.then(() => { completed = true; }, () => { completed = true; });
      expect(completed).toBe(false);
      releaseSecondScalarRequeryReply();
      await expect(second).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({ discardedDefinitionId: "definition-2", secondReplyHeld: false });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("re-arms a deferred reply after resetting an active hold", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      const client = (await wrapKitLoader(async () => fake.kit)()).createExperimentalDesignerClient();
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      await client.editNumber("r1", { entity: "entity", field: "field" }, "250");
      await expect(client.queryKeyedGroupedSum("old-definition-1")).resolves.toMatchObject({ revision: "r2" });
      const oldSecond = client.queryKeyedGroupedSum("old-definition-2");
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      resetScalarRequeryFaultProbe();
      // Reset and re-arm synchronously while the old pause continuation is
      // still queued. Its completion must not consume or release this hold.
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      await expect(oldSecond).resolves.toMatchObject({ revision: "r2" });
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
      await client.editNumber("r2", { entity: "entity", field: "field" }, "300");
      await expect(client.queryKeyedGroupedSum("new-definition-1")).resolves.toMatchObject({ revision: "r2" });
      const newSecond = client.queryKeyedGroupedSum("new-definition-2");
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let completed = false;
      void newSecond.then(() => { completed = true; }, () => { completed = true; });
      expect(completed).toBe(false, "the previous hold continuation must not release the new hold");
      releaseSecondScalarRequeryReply();
      await expect(newSecond).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(4);
      expect(scalarRequeryFaultProbe().discardedDefinitionId).toBe("new-definition-2");
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });
});

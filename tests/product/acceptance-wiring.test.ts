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

function fakeKit(
  onEdit: () => Promise<ReturnType<typeof projection>>,
  onQuery: (definitionId: string) => Promise<{ revision: string; definitionId: string }> = async (definitionId) => ({ revision: "r2", definitionId }),
  observedOccurrence = "occurrence-1",
): { kit: CoreKit; calls: () => number; importCalls: () => number; queryCalls: () => number; closeCalls: () => number } {
  const state = { calls: 0, importCalls: 0, queryCalls: 0, closeCalls: 0 };
  let client: ReturnType<CoreKit["createExperimentalDesignerClient"]> | null = null;
  const createClient = (): ReturnType<CoreKit["createExperimentalDesignerClient"]> => client ??= ({
    openProject: async () => ({}) as never,
    closeProject: async () => { state.closeCalls += 1; },
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
    observeOccurrence: async () => ({ scope: observedOccurrence, revision: "r2" }),
    bootstrap: async () => ({ revision: "r2", keyed_grouped_sum_definition_ids: ["definition-1", "definition-2"] }),
    queryKeyedGroupedSum: async (definitionId: string) => {
      state.queryCalls += 1;
      return { ...await onQuery(definitionId), groups: [], diagnostics: [] };
    },
  } as unknown as ReturnType<CoreKit["createExperimentalDesignerClient"]>);
  const kit = {
    createExperimentalDesignerClient: createClient,
  } as unknown as CoreKit;
  return {
    kit,
    calls: () => state.calls,
    importCalls: () => state.importCalls,
    queryCalls: () => state.queryCalls,
    closeCalls: () => state.closeCalls,
  };
}

async function scalarRuntime(
  kit: CoreKit,
  ids = ["definition-1", "definition-2"],
  occurrence = "occurrence-1",
  postPublicationError?: Error,
  beforeEditDispatch?: () => Promise<void>,
  beforeCloseDispatch?: () => Promise<void>,
  prepareClient?: (client: ReturnType<CoreKit["createExperimentalDesignerClient"]>) => void,
  beforeDiscoveryBootstrap?: () => Promise<void>,
  beforeReadDispatch?: () => Promise<void>,
) {
  let client: ReturnType<CoreKit["createExperimentalDesignerClient"]> | null = null;
  const runtime = {
    read: async () => {
      await beforeReadDispatch?.();
      return client!.observeOccurrence() as never;
    },
    openFiles: async (...args: unknown[]) => client!.openProject(...args as never),
    edit: async (witness: { occurrence: string; revision: string }, target = { entity: "entity", field: "field" }, change = "250") => {
      await beforeEditDispatch?.();
      const receipt = await client!.editNumber(witness.revision, target, change);
      if (postPublicationError) throw postPublicationError;
      return { occurrence, revision: receipt.resulting_revision } as never;
    },
    discoverKeyedGroupedSums: async (witness: { occurrence: string; revision: string }) => {
      await beforeDiscoveryBootstrap?.();
      const snapshot = await client!.bootstrap();
      if (snapshot.revision !== witness.revision) throw new Error("discovery bootstrap revision mismatch");
      const definitionIds = snapshot.keyed_grouped_sum_definition_ids ?? ids;
      const results = [];
      for (const id of definitionIds) results.push(await client!.queryKeyedGroupedSum(id));
      return results as never;
    },
    queryKeyedGroupedSum: async (witness: { occurrence: string; revision: string }, definitionId: string) =>
      client!.queryKeyedGroupedSum(definitionId),
    close: async () => {
      await beforeCloseDispatch?.();
      await client!.closeProject();
    },
  };
  const scope = globalThis as unknown as { window: Record<string, unknown> };
  const previousWindow = scope.window;
  scope.window = {};
  const kitLoader = wrapKitLoader(async () => kit);
  installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });
  const linkedKit = await kitLoader();
  client = linkedKit.createExperimentalDesignerClient();
  prepareClient?.(client);
  return { runtime, client, kitLoader, restoreWindow: () => { scope.window = previousWindow; } };
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
  it("binds a recognized wrapped loader once to one exact runtime", () => {
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    const kitLoader = wrapKitLoader(async () => ({ createExperimentalDesignerClient: () => ({}) } as unknown as CoreKit));
    const firstRuntime = { read: async () => ({}) };
    try {
      installAcceptance({ runtime: firstRuntime as never, copies: {} as never, kitLoader });
      expect(() => installAcceptance({ runtime: { read: async () => ({}) } as never, copies: {} as never, kitLoader }))
        .toThrow(/cannot be rebound to another runtime/);
      expect(() => installAcceptance({ runtime: { read: async () => ({}) } as never, copies: {} as never, kitLoader: (async () => ({}) as never) }))
        .toThrow(/registered wrapped kit loader/);
    } finally {
      scope.window = previous;
    }
  });

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
    const kitLoader = wrapKitLoader(async () => ({ createExperimentalDesignerClient: () => ({}) } as unknown as CoreKit));
    try {
      installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });
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
      const kitLoader = wrapKitLoader(async () => fake.kit);
      const kit = await kitLoader();
      const client = kit.createExperimentalDesignerClient();
      await client.observeOccurrence();
      await client.queryKeyedGroupedSum("definition-a");
      const runtime = {
        queryKeyedGroupedSum: (_witness: { occurrence: string; revision: string }, definitionId: string) =>
          client.queryKeyedGroupedSum(definitionId),
        discoverKeyedGroupedSums: async () => [],
      };
      installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });
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
      const kitLoader = wrapKitLoader(async () => fake.kit);
      const kit = await kitLoader();
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
      installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });

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
      const kitLoader = wrapKitLoader(async () => ({ createExperimentalDesignerClient: () => ({}) } as unknown as CoreKit));
      installAcceptance({ runtime: {} as never, copies: {} as never, kitLoader });
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
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const edited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(edited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        attemptId: expect.any(Number),
        publicationAcknowledged: true,
        clientIdentity: expect.any(Number),
        occurrence: "occurrence-1",
        publicationCallId: expect.any(Number),
        revision: "r2",
        discoveryInvocationId: expect.any(Number),
        suppliedWitness: { occurrence: "occurrence-1", revision: "r2" },
        invokedDefinitionIds: ["definition-1", "definition-2"],
        discardedDefinitionId: "definition-2",
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each([
    ["resolves with equal revision", "resolve", "r2"],
    ["resolves with different revision", "resolve", "r1"],
    ["rejects", "reject", "r2"],
  ] as const)("preserves a pending attempt while an old query %s settles, then faults only its fresh discovery", async (_label, outcome, oldRevision) => {
    resetScalarRequeryFaultProbe();
    let releaseOldQuery!: (value: { revision: string; definitionId: string }) => void;
    let rejectOldQuery!: (error: Error) => void;
    let queryNumber = 0;
    const fake = fakeKit(async () => projection(), async (definitionId) => definitionId === "definition-1"
      && ++queryNumber === 1
      ? new Promise((resolve, reject) => { releaseOldQuery = resolve; rejectOldQuery = reject; })
      : { revision: "r2", definitionId });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const oldEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(releaseOldQuery).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      if (outcome === "resolve") {
        releaseOldQuery({ revision: oldRevision, definitionId: "definition-1" });
        await expect(oldDiscovery).resolves.toHaveLength(2);
      } else {
        const failure = new Error("old real query failed");
        rejectOldQuery(failure);
        await expect(oldDiscovery).rejects.toBe(failure);
      }

      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        invalidReason: null,
      });
      const newEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(newEdited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);

      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: true,
        invokedDefinitionIds: ["definition-1", "definition-2"],
        discardedDefinitionId: "definition-2",
        revision: newEdited.revision,
      });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not attribute an old query from another client or occurrence to a fresh attempt", async () => {
    resetScalarRequeryFaultProbe();
    let releaseOldQuery!: (value: { revision: string; definitionId: string }) => void;
    const oldFake = fakeKit(async () => projection(), async (definitionId) => definitionId === "definition-1"
      ? new Promise((resolve) => { releaseOldQuery = resolve; })
      : { revision: "r2", definitionId });
    const oldHarness = await scalarRuntime(oldFake.kit);
    let restoreFreshWindow = () => {};
    let oldOwnerIdentity: number | null = null;
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const oldEdited = await oldHarness.runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      oldOwnerIdentity = scalarRequeryFaultProbe().clientIdentity;
      const oldDiscovery = oldHarness.runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(releaseOldQuery).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      const newFake = fakeKit(async () => projection());
      const newHarness = await scalarRuntime(newFake.kit, ["definition-1", "definition-2"], "occurrence-2");
      restoreFreshWindow = newHarness.restoreWindow;
      failSecondScalarRequeryReplyAfterFirst();
      const newEdited = await newHarness.runtime.edit({ occurrence: "occurrence-2", revision: "r1" });
      releaseOldQuery({ revision: "r2", definitionId: "definition-1" });
      await expect(oldDiscovery).resolves.toHaveLength(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: true,
        clientIdentity: expect.any(Number),
        occurrence: "occurrence-2",
        revision: newEdited.revision,
        invokedDefinitionIds: [],
      });
      expect(scalarRequeryFaultProbe().clientIdentity).not.toBe(oldOwnerIdentity);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreFreshWindow();
      oldHarness.restoreWindow();
    }
  });

  it.each(["resolve", "reject", "lose reply"] as const)("isolates an armed delayed old publication that %s", async (outcome) => {
    resetScalarRequeryFaultProbe();
    let settleOld!: (value: ReturnType<typeof projection>) => void;
    let rejectOld!: (error: Error) => void;
    let calls = 0;
    const fake = fakeKit(async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve, reject) => { settleOld = resolve; rejectOld = reject; });
      return projection();
    });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      const receiptBefore = lastReceipt();
      failSecondScalarRequeryReplyAfterFirst();
      if (outcome === "lose reply") loseNextExecuteReply();
      const oldEdit = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await vi.waitFor(() => expect(settleOld).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      if (outcome === "lose reply") {
        settleOld(projection({ resulting_revision: "r3" }));
        await expect(oldEdit).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
      } else if (outcome === "resolve") {
        settleOld(projection({ resulting_revision: "r3" }));
        await expect(oldEdit).resolves.toMatchObject({ revision: "r3" });
      } else {
        const failure = new Error("old publication rejected");
        rejectOld(failure);
        await expect(oldEdit).rejects.toBe(failure);
      }
      expect(lastReceipt()).toEqual(receiptBefore);
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invalidReason: null });
      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdit).toMatchObject({ revision: "r2" });
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: true, revision: "r2", discardedDefinitionId: "definition-2" });
      expect(calls).toBe(2);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each(["normal", "lost-reply"] as const)("does not adopt an unarmed publication held after dispatch across reset/rearm (%s)", async (outcome) => {
    resetScalarRequeryFaultProbe();
    let settleOld!: (value: ReturnType<typeof projection>) => void;
    let calls = 0;
    const fake = fakeKit(async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { settleOld = resolve; });
      return projection();
    });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      const receiptBefore = lastReceipt();
      if (outcome === "lost-reply") loseNextExecuteReply();
      const oldEdit = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await vi.waitFor(() => expect(settleOld).toBeTypeOf("function"));
      failSecondScalarRequeryReplyAfterFirst();
      settleOld(projection({ resulting_revision: "r3" }));
      if (outcome === "lost-reply") await expect(oldEdit).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
      else await expect(oldEdit).resolves.toMatchObject({ revision: "r3" });
      expect(lastReceipt()).toEqual(receiptBefore);
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invalidReason: null });
      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdit).toMatchObject({ revision: "r2" });
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: true, revision: "r2", discardedDefinitionId: "definition-2" });
      expect(calls).toBe(2);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each(["resolves to a mismatched revision", "rejects"] as const)("does not let an old discovery bootstrap that %s change the fresh attempt", async (outcome) => {
    resetScalarRequeryFaultProbe();
    let settleOldBootstrap!: (value: { revision: string; keyed_grouped_sum_definition_ids: string[] }) => void;
    let rejectOldBootstrap!: (error: Error) => void;
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    const originalBootstrap = client.bootstrap;
    let calls = 0;
    client.bootstrap = async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve, reject) => { settleOldBootstrap = resolve; rejectOldBootstrap = reject; });
      return originalBootstrap();
    };
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const oldEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(settleOldBootstrap).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      if (outcome === "resolves to a mismatched revision") {
        settleOldBootstrap({ revision: "r1", keyed_grouped_sum_definition_ids: ["definition-1", "definition-2"] });
        await expect(oldDiscovery).rejects.toThrow("discovery bootstrap revision mismatch");
      } else {
        const failure = new Error("old bootstrap rejected");
        rejectOldBootstrap(failure);
        await expect(oldDiscovery).rejects.toBe(failure);
      }
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invalidReason: null });
      const freshEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdited).toMatchObject({ revision: "r2" });
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: true, revision: "r2", discardedDefinitionId: "definition-2" });
      expect(fake.queryCalls()).toBe(2);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each(["mismatches", "rejects"] as const)("does not let an old discovery bootstrap that %s retire a new attempt", async (outcome) => {
    resetScalarRequeryFaultProbe();
    let settleOldBootstrap!: (value: { revision: string; keyed_grouped_sum_definition_ids: string[] }) => void;
    let rejectOldBootstrap!: (error: Error) => void;
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    const originalBootstrap = client.bootstrap;
    let bootstrapCalls = 0;
    client.bootstrap = async () => {
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) return new Promise((resolve, reject) => { settleOldBootstrap = resolve; rejectOldBootstrap = reject; });
      return originalBootstrap();
    };
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const oldEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(settleOldBootstrap).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      if (outcome === "mismatches") {
        settleOldBootstrap({ revision: "r1", keyed_grouped_sum_definition_ids: ["definition-1", "definition-2"] });
        await expect(oldDiscovery).rejects.toThrow(/bootstrap revision mismatch/);
      } else {
        const failure = new Error("old bootstrap rejected");
        rejectOldBootstrap(failure);
        await expect(oldDiscovery).rejects.toBe(failure);
      }
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invalidReason: null });
      const freshEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdited).toMatchObject({ revision: "r2" });
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: true, revision: "r2", discardedDefinitionId: "definition-2" });
      expect(fake.queryCalls()).toBe(2);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not inject into a new discovery while an unarmed old bootstrap is still in flight", async () => {
    resetScalarRequeryFaultProbe();
    let releaseOldBootstrap!: (value: { revision: string; keyed_grouped_sum_definition_ids: string[] }) => void;
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    const realBootstrap = client.bootstrap;
    let bootstrapCalls = 0;
    client.bootstrap = async () => {
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) return new Promise((resolve) => { releaseOldBootstrap = resolve; });
      return realBootstrap();
    };
    try {
      const oldDiscovery = runtime.discoverKeyedGroupedSums({ occurrence: "occurrence-1", revision: "r2" } as never);
      await vi.waitFor(() => expect(releaseOldBootstrap).toBeTypeOf("function"));

      failSecondScalarRequeryReplyAfterFirst();
      releaseOldBootstrap({ revision: "r2", keyed_grouped_sum_definition_ids: ["definition-1", "definition-2"] });
      await expect(oldDiscovery).resolves.toHaveLength(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        invalidReason: null,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });

      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(4);
    } finally {
      releaseOldBootstrap?.({ revision: "r2", keyed_grouped_sum_definition_ids: ["definition-1", "definition-2"] });
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not assign a late second query from an old discovery to the overlapping new discovery", async () => {
    resetScalarRequeryFaultProbe();
    let releaseOldFirstQuery!: (value: { revision: string; definitionId: string }) => void;
    let calls = 0;
    const fake = fakeKit(async () => projection(), async (definitionId) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseOldFirstQuery = resolve; });
      return { revision: "r2", definitionId };
    });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const oldEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdit as never);
      await vi.waitFor(() => expect(releaseOldFirstQuery).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      releaseOldFirstQuery({ revision: "r2", definitionId: "definition-1" });
      await expect(oldDiscovery).resolves.toHaveLength(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        invalidReason: null,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });

      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(4);
    } finally {
      releaseOldFirstQuery?.({ revision: "r2", definitionId: "definition-1" });
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("preserves a pending attempt across an old unarmed edit delayed before publication dispatch", async () => {
    resetScalarRequeryFaultProbe();
    let releaseOldEdit!: () => void;
    let editEntries = 0;
    let editCalls = 0;
    const fake = fakeKit(async () => {
      editCalls += 1;
      return projection({ resulting_revision: editCalls === 1 ? "r3" : "r2" });
    });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit, ["definition-1", "definition-2"], "occurrence-1", undefined, () => {
      editEntries += 1;
      if (editEntries === 1) return new Promise<void>((resolve) => { releaseOldEdit = resolve; });
      return Promise.resolve();
    });
    try {
      const oldEdit = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await vi.waitFor(() => expect(releaseOldEdit).toBeTypeOf("function"));
      failSecondScalarRequeryReplyAfterFirst();
      releaseOldEdit();
      await expect(oldEdit).resolves.toMatchObject({ revision: "r3" });
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        publicationCallId: null,
        invalidReason: null,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
      });
      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdit).toMatchObject({ revision: "r2" });
      expect(fake.calls()).toBe(2);
      expect(fake.queryCalls()).toBe(2);
    } finally {
      releaseOldEdit?.();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not retroactively bind a pre-load invocation after reset and rearm", async () => {
    resetScalarRequeryFaultProbe();
    let releaseBeforeLoader!: () => void;
    let releaseLoader!: () => void;
    let oldEntry!: () => void;
    const oldEntryReached = new Promise<void>((resolve) => { oldEntry = resolve; });
    const beforeLoader = new Promise<void>((resolve) => { releaseBeforeLoader = resolve; });
    const loaderGate = new Promise<void>((resolve) => { releaseLoader = resolve; });
    let loaderCalls = 0;
    let editCalls = 0;
    const fake = fakeKit(async () => {
      editCalls += 1;
      return projection({ resulting_revision: "r2" });
    });
    const kitLoader = wrapKitLoader(async () => {
      loaderCalls += 1;
      await loaderGate;
      return fake.kit;
    });
    let clientPromise: Promise<ReturnType<CoreKit["createExperimentalDesignerClient"]>> | null = null;
    const clientForRuntime = (): Promise<ReturnType<CoreKit["createExperimentalDesignerClient"]>> => {
      clientPromise ??= kitLoader().then((kit) => kit.createExperimentalDesignerClient());
      return clientPromise;
    };
    const runtime = {
      read: async () => (await clientForRuntime()).observeOccurrence() as never,
      edit: async (witness: { occurrence: string; revision: string }) => {
        if (editCalls === 0) {
          oldEntry();
          await beforeLoader;
        }
        const client = await clientForRuntime();
        const receipt = await client.editNumber(witness.revision, { entity: "entity", field: "field" }, "250");
        return { occurrence: witness.occurrence, revision: receipt.resulting_revision } as never;
      },
      discoverKeyedGroupedSums: async (witness: { occurrence: string; revision: string }) => {
        const client = await clientForRuntime();
        const snapshot = await client.bootstrap();
        if (snapshot.revision !== witness.revision) throw new Error("discovery bootstrap revision mismatch");
        const ids = snapshot.keyed_grouped_sum_definition_ids ?? [];
        const results = [];
        for (const id of ids) results.push(await client.queryKeyedGroupedSum(id));
        return results as never;
      },
      queryKeyedGroupedSum: async (_witness: { occurrence: string; revision: string }, definitionId: string) =>
        (await clientForRuntime()).queryKeyedGroupedSum(definitionId),
      close: async () => (await clientForRuntime()).closeProject(),
    };
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });
    try {
      const previousReceipt = lastReceipt();
      const oldEdit = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await oldEntryReached;
      failSecondScalarRequeryReplyAfterFirst();
      releaseBeforeLoader();
      await vi.waitFor(() => expect(loaderCalls).toBe(1));
      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      releaseLoader();
      await expect(oldEdit).resolves.toMatchObject({ revision: "r2" });
      expect(lastReceipt()).toEqual(previousReceipt);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        publicationCallId: null,
        invokedDefinitionIds: [],
      });

      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(editCalls).toBe(2);
      expect(fake.queryCalls()).toBe(2);
      expect(loaderCalls).toBe(1);
    } finally {
      releaseBeforeLoader();
      releaseLoader();
      resetScalarRequeryFaultProbe();
      scope.window = previous;
    }
  });

  it("credits no publication from competing pre-load runtime origins, then accepts a fresh attempt", async () => {
    resetScalarRequeryFaultProbe();
    let releaseLoader!: () => void;
    let loaderCalls = 0;
    let editEntries = 0;
    let editCalls = 0;
    let clientPromise: Promise<ReturnType<CoreKit["createExperimentalDesignerClient"]>> | null = null;
    const loaderGate = new Promise<void>((resolve) => { releaseLoader = resolve; });
    const fake = fakeKit(async () => {
      editCalls += 1;
      return projection({ resulting_revision: editCalls === 2 ? "r3" : "r2" });
    });
    const kitLoader = wrapKitLoader(async () => {
      loaderCalls += 1;
      await loaderGate;
      return fake.kit;
    });
    const clientForRuntime = (): Promise<ReturnType<CoreKit["createExperimentalDesignerClient"]>> => {
      clientPromise ??= kitLoader().then((kit) => kit.createExperimentalDesignerClient());
      return clientPromise;
    };
    const runtime = {
      read: async () => (await clientForRuntime()).observeOccurrence() as never,
      edit: async (witness: { occurrence: string; revision: string }) => {
        editEntries += 1;
        const client = await clientForRuntime();
        const receipt = await client.editNumber(witness.revision, { entity: "entity", field: "field" }, "250");
        return { occurrence: witness.occurrence, revision: receipt.resulting_revision } as never;
      },
      discoverKeyedGroupedSums: async (witness: { occurrence: string; revision: string }) => {
        const client = await clientForRuntime();
        const snapshot = await client.bootstrap();
        if (snapshot.revision !== witness.revision) throw new Error("discovery bootstrap revision mismatch");
        const ids = snapshot.keyed_grouped_sum_definition_ids ?? [];
        const results = [];
        for (const id of ids) results.push(await client.queryKeyedGroupedSum(id));
        return results as never;
      },
      queryKeyedGroupedSum: async (_witness: { occurrence: string; revision: string }, definitionId: string) =>
        (await clientForRuntime()).queryKeyedGroupedSum(definitionId),
      close: async () => (await clientForRuntime()).closeProject(),
    };
    const scope = globalThis as unknown as { window: Record<string, unknown> };
    const previous = scope.window;
    scope.window = {};
    installAcceptance({ runtime: runtime as never, copies: {} as never, kitLoader });
    try {
      const receiptBefore = lastReceipt();
      const oldOne = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldTwo = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await vi.waitFor(() => expect(editEntries).toBe(2));
      await vi.waitFor(() => expect(loaderCalls).toBe(1));
      failSecondScalarRequeryReplyAfterFirst();
      releaseLoader();
      await expect(oldOne).resolves.toMatchObject({ revision: "r2" });
      await expect(oldTwo).resolves.toMatchObject({ revision: "r3" });
      expect(loaderCalls).toBe(1);
      expect(editCalls).toBe(2);
      expect(lastReceipt()).toEqual(receiptBefore);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        publicationCallId: null,
        invokedDefinitionIds: [],
      });

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(freshEdit).toMatchObject({ revision: "r2" });
      expect(loaderCalls).toBe(1);
      expect(editCalls).toBe(3);
      expect(fake.queryCalls()).toBe(2);
    } finally {
      releaseLoader();
      resetScalarRequeryFaultProbe();
      scope.window = previous;
    }
  });

  it("does not retroactively own an unarmed discovery delayed before bootstrap dispatch", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseOldBootstrap!: () => void;
    let bootstrapEntered!: () => void;
    let bootstrapCalls = 0;
    const entered = new Promise<void>((resolve) => { bootstrapEntered = resolve; });
    const fake = fakeKit(async () => projection());
    const { runtime, restoreWindow } = await scalarRuntime(
      fake.kit,
      ["definition-1", "definition-2"],
      "occurrence-1",
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) {
          bootstrapEntered();
          await new Promise<void>((resolve) => { releaseOldBootstrap = resolve; });
        }
      },
    );
    try {
      const oldDiscovery = runtime.discoverKeyedGroupedSums({ occurrence: "occurrence-1", revision: "r2" } as never);
      await entered;
      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      releaseOldBootstrap();
      await expect(oldDiscovery).resolves.toHaveLength(2);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
      });
      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, resetReason: "prerequisite-unavailable" });

      const freshEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
    } finally {
      releaseOldBootstrap?.();
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not cache or consume a delayed unarmed real query after reset and rearm", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseOldQuery!: (value: { revision: string; definitionId: string }) => void;
    let queryCalls = 0;
    const fake = fakeKit(async () => projection(), async (definitionId) => {
      queryCalls += 1;
      if (queryCalls === 1) return new Promise((resolve) => { releaseOldQuery = resolve; });
      return { revision: "r2", definitionId };
    });
    const { runtime, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      const oldEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const receiptBefore = lastReceipt();
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(releaseOldQuery).toBeTypeOf("function"));

      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      releaseOldQuery({ revision: "r2", definitionId: "definition-1" });
      await expect(oldDiscovery).resolves.toHaveLength(2);
      expect(lastReceipt()).toEqual(receiptBefore);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        attemptId: expect.any(Number),
        invokedDefinitionIds: [],
        queryCallIds: [],
      });
      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: false, resetReason: "prerequisite-unavailable" });

      const freshEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdited as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
    } finally {
      releaseOldQuery?.({ revision: "r2", definitionId: "definition-1" });
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each(["before dispatch", "after dispatch"] as const)("does not let an old occurrence observation refill cache %s", async (delayPoint) => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseOldObservation!: (value: { scope: string; revision: string }) => void;
    let enteredOldRead!: () => void;
    let readDispatches = 0;
    const oldReadEntered = new Promise<void>((resolve) => { enteredOldRead = resolve; });
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(
      fake.kit,
      ["definition-1", "definition-2"],
      "occurrence-1",
      undefined,
      undefined,
      undefined,
      (linkedClient) => {
        const observe = linkedClient.observeOccurrence;
        let calls = 0;
        linkedClient.observeOccurrence = async (...args: unknown[]) => {
          calls += 1;
          if (calls === 2 && delayPoint === "after dispatch") {
            enteredOldRead();
            return new Promise((resolve) => { releaseOldObservation = resolve; });
          }
          if (calls === 2) return { scope: "occurrence-new", revision: "r3" } as never;
          return observe.apply(linkedClient, args as never);
        };
      },
      undefined,
      async () => {
        readDispatches += 1;
        if (delayPoint === "before dispatch" && readDispatches === 2) {
          enteredOldRead();
          await new Promise<void>((resolve) => { releaseOldObservation = () => resolve({ scope: "occurrence-new", revision: "r3" }); });
        }
      },
    );
    try {
      await runtime.read();
      await runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1");
      const oldRead = runtime.read();
      await oldReadEntered;
      resetScalarRequeryFaultProbe();
      failSecondScalarRequeryReplyAfterFirst();
      releaseOldObservation({ scope: "occurrence-new", revision: "r3" });
      await oldRead;

      // This deliberate target setup proves the stale observation did not
      // replace the mapped client's last confirmed occurrence/revision.
      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });
      const currentAttempt = scalarRequeryFaultProbe();
      expect(currentAttempt).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invokedDefinitionIds: [] });
      expect(client).toBeDefined();
    } finally {
      releaseOldObservation?.({ scope: "occurrence-new", revision: "r3" });
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("keeps independent runtime B query and observation evidence while runtime A resets", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseAQuery!: (value: { revision: string; definitionId: string }) => void;
    let aQueryCalls = 0;
    const aFake = fakeKit(async () => projection(), async (definitionId) => {
      aQueryCalls += 1;
      if (aQueryCalls === 1) return new Promise((resolve) => { releaseAQuery = resolve; });
      return { revision: "r2", definitionId };
    });
    const bFake = fakeKit(async () => projection(), undefined, "occurrence-b");
    const bHarness = await scalarRuntime(bFake.kit, ["definition-b"], "occurrence-b");
    const aHarness = await scalarRuntime(aFake.kit, ["definition-a", "definition-a-2"], "occurrence-a");
    try {
      await bHarness.runtime.read();
      await bHarness.runtime.queryKeyedGroupedSum({ occurrence: "occurrence-b", revision: "r2" } as never, "definition-b");
      armTargetedQueryReplyFault("definition-b", "occurrence-b", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });
      resetTargetedQueryReplyFault();

      failSecondScalarRequeryReplyAfterFirst();
      const aEdited = await aHarness.runtime.edit({ occurrence: "occurrence-a", revision: "r1" });
      const aDiscovery = aHarness.runtime.discoverKeyedGroupedSums(aEdited as never);
      await vi.waitFor(() => expect(releaseAQuery).toBeTypeOf("function"));
      resetScalarRequeryFaultProbe();

      await bHarness.runtime.read();
      const bReceipt = await bHarness.runtime.edit({ occurrence: "occurrence-b", revision: "r1" });
      expect(bReceipt).toMatchObject({ occurrence: "occurrence-b", revision: "r2" });
      expect(lastReceipt()).toMatchObject({ resulting_revision: "r2" });

      armTargetedQueryReplyFault("definition-b", "occurrence-b", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });
      await expect(bHarness.runtime.queryKeyedGroupedSum({ occurrence: "occurrence-b", revision: "r2" } as never, "definition-b"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });
      expect(bFake.queryCalls()).toBe(2);

      releaseAQuery({ revision: "r2", definitionId: "definition-a" });
      await expect(aDiscovery).resolves.toHaveLength(2);
      expect(aFake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, publicationAcknowledged: false });
    } finally {
      releaseAQuery?.({ revision: "r2", definitionId: "definition-a" });
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      aHarness.restoreWindow();
      bHarness.restoreWindow();
    }
  });

  it.each(["acknowledged", "lost"] as const)("does not let stale runtime A %s overwrite B's receipt", async (outcome) => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseA!: () => void;
    let aEntered!: () => void;
    const aAtGate = new Promise<void>((resolve) => { aEntered = resolve; });
    const aFake = fakeKit(async () => projection({ resulting_revision: "a-stale" }));
    const aHarness = await scalarRuntime(
      aFake.kit,
      ["definition-a"],
      "occurrence-a",
      undefined,
      async () => {
        aEntered();
        await new Promise<void>((resolve) => { releaseA = resolve; });
      },
    );
    let releaseB!: (value: ReturnType<typeof projection>) => void;
    let bEntered!: () => void;
    const bAtGate = new Promise<void>((resolve) => { bEntered = resolve; });
    const bFake = fakeKit(async () => {
      bEntered();
      return new Promise((resolve) => { releaseB = resolve; });
    });
    let restoreB = () => {};
    try {
      const staleA = aHarness.runtime.edit({ occurrence: "occurrence-a", revision: "r1" });
      await aAtGate;
      resetScalarRequeryFaultProbe();

      const bHarness = await scalarRuntime(bFake.kit, ["definition-b"], "occurrence-b");
      restoreB = bHarness.restoreWindow;
      const currentB = bHarness.runtime.edit({ occurrence: "occurrence-b", revision: "r1" });
      await bAtGate;
      if (outcome === "lost") loseNextExecuteReply();
      releaseA();
      if (outcome === "lost") await expect(staleA).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
      else await expect(staleA).resolves.toMatchObject({ revision: "a-stale" });
      releaseB(projection({ resulting_revision: "b-current" }));
      await expect(currentB).resolves.toMatchObject({ revision: "b-current" });
      expect(lastReceipt()).toMatchObject({ resulting_revision: "b-current" });
      expect(aFake.calls()).toBe(1);
      expect(bFake.calls()).toBe(1);
    } finally {
      releaseA?.();
      releaseB?.(projection({ resulting_revision: "b-current" }));
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreB();
      aHarness.restoreWindow();
    }
  });

  it("preserves B's target arm across a stale A publication dispatch", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseA!: () => void;
    let aEntered!: () => void;
    const aAtGate = new Promise<void>((resolve) => { aEntered = resolve; });
    const aFake = fakeKit(async () => projection({ resulting_revision: "a-stale" }));
    const aHarness = await scalarRuntime(
      aFake.kit,
      ["definition-a"],
      "occurrence-a",
      undefined,
      async () => {
        aEntered();
        await new Promise<void>((resolve) => { releaseA = resolve; });
      },
    );
    let restoreB = () => {};
    try {
      const staleA = aHarness.runtime.edit({ occurrence: "occurrence-a", revision: "r1" });
      await aAtGate;
      resetScalarRequeryFaultProbe();

      const bFake = fakeKit(async () => projection(), undefined, "occurrence-b");
      const bHarness = await scalarRuntime(bFake.kit, ["definition-b"], "occurrence-b");
      restoreB = bHarness.restoreWindow;
      await bHarness.runtime.read();
      await bHarness.runtime.queryKeyedGroupedSum({ occurrence: "occurrence-b", revision: "r2" } as never, "definition-b");
      armTargetedQueryReplyFault("definition-b", "occurrence-b", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });

      releaseA();
      await expect(staleA).resolves.toMatchObject({ revision: "a-stale" });
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, consumed: false });
      await expect(bHarness.runtime.queryKeyedGroupedSum({ occurrence: "occurrence-b", revision: "r2" } as never, "definition-b"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });
      expect(aFake.calls()).toBe(1);
      expect(bFake.queryCalls()).toBe(2);
    } finally {
      releaseA?.();
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreB();
      aHarness.restoreWindow();
    }
  });

  it("does not cache an after-dispatch query or observation once its runtime origin becomes ambiguous", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseQuery!: (value: { revision: string; definitionId: string }) => void;
    let queryEntered!: () => void;
    const queryAtGate = new Promise<void>((resolve) => { queryEntered = resolve; });
    let queryCalls = 0;
    let observationCalls = 0;
    let releaseObservation!: (value: { scope: string; revision: string }) => void;
    let observationEntered!: () => void;
    const observationAtGate = new Promise<void>((resolve) => { observationEntered = resolve; });
    const fake = fakeKit(async () => projection(), async (definitionId) => {
      queryCalls += 1;
      if (queryCalls === 2) {
        queryEntered();
        return new Promise((resolve) => { releaseQuery = resolve; });
      }
      return { revision: "r2", definitionId };
    });
    const { runtime, client, restoreWindow } = await scalarRuntime(
      fake.kit,
      ["definition-1", "definition-2"],
      "occurrence-1",
      undefined,
      undefined,
      undefined,
      (linkedClient) => {
        const observe = linkedClient.observeOccurrence;
        linkedClient.observeOccurrence = async (...args: unknown[]) => {
          observationCalls += 1;
          if (observationCalls === 2) {
            observationEntered();
            return new Promise((resolve) => { releaseObservation = resolve; });
          }
          if (observationCalls === 3) return { scope: "occurrence-stale", revision: "r3" } as never;
          return observe.apply(linkedClient, args as never);
        };
      },
    );
    try {
      await runtime.read();
      await runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1");
      const oldQuery = runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1");
      await queryAtGate;
      const overlappingQuery = runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1");
      await expect(overlappingQuery).resolves.toMatchObject({ definitionId: "definition-1" });
      releaseQuery({ revision: "r2", definitionId: "definition-1" });
      await expect(oldQuery).resolves.toMatchObject({ definitionId: "definition-1" });
      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });

      resetTargetedQueryReplyFault();
      const oldObservation = runtime.read();
      await observationAtGate;
      const overlappingObservation = runtime.read();
      await expect(overlappingObservation).resolves.toMatchObject({ scope: "occurrence-stale", revision: "r3" });
      releaseObservation({ scope: "occurrence-old", revision: "r3" });
      await expect(oldObservation).resolves.toMatchObject({ scope: "occurrence-old", revision: "r3" });
      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });
      expect(fake.queryCalls()).toBe(5);
      expect(client).toBeDefined();
    } finally {
      releaseQuery?.({ revision: "r2", definitionId: "definition-1" });
      releaseObservation?.({ scope: "occurrence-old", revision: "r3" });
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("does not refill occurrence evidence from a read that settles after its runtime closes", async () => {
    resetScalarRequeryFaultProbe();
    resetTargetedQueryReplyFault();
    let releaseLateRead!: (value: { scope: string; revision: string }) => void;
    let lateReadEntered!: () => void;
    const lateReadStarted = new Promise<void>((resolve) => { lateReadEntered = resolve; });
    let observations = 0;
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(
      fake.kit,
      ["definition-1", "definition-2"],
      "occurrence-1",
      undefined,
      undefined,
      undefined,
      (linkedClient) => {
        const observe = linkedClient.observeOccurrence;
        linkedClient.observeOccurrence = async (...args: unknown[]) => {
          observations += 1;
          if (observations === 2) {
            lateReadEntered();
            return new Promise((resolve) => { releaseLateRead = resolve; });
          }
          return observe.apply(linkedClient, args as never);
        };
      },
    );
    try {
      await runtime.read();
      await runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1");
      const lateRead = runtime.read();
      await lateReadStarted;
      await runtime.close();
      releaseLateRead({ scope: "occurrence-after-close", revision: "r3" });
      await lateRead;

      armTargetedQueryReplyFault("definition-1", "occurrence-1", "r2");
      expect(targetedQueryFaultProbe()).toMatchObject({ armed: true, owningClientIdentity: expect.any(Number) });
      await expect(runtime.queryKeyedGroupedSum({ occurrence: "occurrence-1", revision: "r2" } as never, "definition-1"))
        .rejects.toThrow(/targeted grouped-summary query reply discarded/);
      expect(targetedQueryFaultProbe()).toMatchObject({ consumed: true, actualReplyRevision: "r2" });
      expect(fake.closeCalls()).toBe(1);
    } finally {
      releaseLateRead?.({ scope: "occurrence-after-close", revision: "r3" });
      resetTargetedQueryReplyFault();
      resetScalarRequeryFaultProbe();
      restoreWindow();
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
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      await expect(runtime.edit({ occurrence: "occurrence-1", revision: "r1" })).rejects.toThrow("known rejected edit");
      await expect(runtime.edit({ occurrence: "occurrence-1", revision: "r1" })).resolves.toMatchObject({ revision: "r2" });
      expect(fake.queryCalls()).toBe(0);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("retires the owned attempt on an unknown scalar publication outcome without retrying", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      loseNextExecuteReply();
      await expect(runtime.edit({ occurrence: "occurrence-1", revision: "r1" })).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
      expect(fake.calls()).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, publicationAcknowledged: false });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it.each(["normal", "lost-reply"] as const)("does not record an edit receipt after its runtime closes (%s)", async (outcome) => {
    resetScalarRequeryFaultProbe();
    let settleOld!: (value: ReturnType<typeof projection>) => void;
    let calls = 0;
    const fake = fakeKit(async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { settleOld = resolve; });
      return projection();
    });
    const { runtime, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      const receiptBefore = lastReceipt();
      if (outcome === "lost-reply") loseNextExecuteReply();
      const oldEdit = runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await vi.waitFor(() => expect(settleOld).toBeTypeOf("function"));
      await runtime.close();
      failSecondScalarRequeryReplyAfterFirst();
      settleOld(projection({ resulting_revision: "r3" }));
      if (outcome === "lost-reply") await expect(oldEdit).rejects.toBeInstanceOf(UnknownOperationOutcomeError);
      else await expect(oldEdit).resolves.toMatchObject({ revision: "r3" });
      expect(lastReceipt()).toEqual(receiptBefore);
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invokedDefinitionIds: [] });

      const freshEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(freshEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(calls).toBe(2);
      expect(fake.closeCalls()).toBe(1);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("retires the owned attempt when publication succeeds but its following observation fails", async () => {
    resetScalarRequeryFaultProbe();
    const failure = new Error("post-publication observation failed");
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit, ["definition-1", "definition-2"], "occurrence-1", failure);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      await expect(runtime.edit({ occurrence: "occurrence-1", revision: "r1" })).rejects.toBe(failure);
      expect(fake.calls()).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, publicationAcknowledged: false });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("clears an armed requery fault when the Work occurrence is replaced before discovery", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await runtime.openFiles({} as never);
      expect(fake.queryCalls()).toBe(0);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("clears the arm when a grouped discovery exits before its second definition query", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
      client.bootstrap = async () => ({ revision: "r2", keyed_grouped_sum_definition_ids: ["definition-1"] });
      try {
        failSecondScalarRequeryReplyAfterFirst();
        const edited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
        await runtime.discoverKeyedGroupedSums(edited as never);
      } finally {
        restoreWindow();
      }
      expect(fake.queryCalls()).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("retires only its current attempt when the real grouped query rejects", async () => {
    resetScalarRequeryFaultProbe();
    const failure = new Error("current Work query failed");
    const fake = fakeKit(async () => projection(), async () => { throw failure; });
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      const edited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(edited as never)).rejects.toBe(failure);
      expect(fake.queryCalls()).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, publicationAcknowledged: false, invokedDefinitionIds: [] });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("resets an unconsumed deferred reply before arming a fresh hold", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    try {
      const { runtime, restoreWindow } = await scalarRuntime(fake.kit);
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      resetScalarRequeryFaultProbe();

      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      const edited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const second = runtime.discoverKeyedGroupedSums(edited as never);
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let completed = false;
      void second.then(() => { completed = true; }, () => { completed = true; });
      expect(completed).toBe(false);
      releaseSecondScalarRequeryReply();
      await expect(second).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({ discardedDefinitionId: "definition-2", secondReplyHeld: false });
      restoreWindow();
    } finally {
      resetScalarRequeryFaultProbe();
    }
  });

  it("re-arms a deferred reply after resetting an active hold", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    const { runtime, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      const oldEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldSecond = runtime.discoverKeyedGroupedSums(oldEdited as never);
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      resetScalarRequeryFaultProbe();
      // Reset and re-arm synchronously while the old pause continuation is
      // still queued. Its completion must not consume or release this hold.
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      await expect(oldSecond).resolves.toHaveLength(2);
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: false,
        invokedDefinitionIds: [],
        discardedDefinitionId: null,
        secondReplyHeld: false,
      });
      const newEdited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const newSecond = runtime.discoverKeyedGroupedSums(newEdited as never);
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let completed = false;
      void newSecond.then(() => { completed = true; }, () => { completed = true; });
      expect(completed).toBe(false, "the previous hold continuation must not release the new hold");
      releaseSecondScalarRequeryReply();
      await expect(newSecond).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(4);
      expect(scalarRequeryFaultProbe().discardedDefinitionId).toBe("definition-2");
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("settles the held second real query when the owning runtime closes", async () => {
    resetScalarRequeryFaultProbe();
    const fake = fakeKit(async () => projection());
    const { runtime, restoreWindow } = await scalarRuntime(fake.kit);
    try {
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      const edited = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const discovery = runtime.discoverKeyedGroupedSums(edited as never);
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let settled = false;
      const settledDiscovery = discovery.then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });

      await runtime.close();
      await vi.waitFor(() => expect(settled).toBe(true));
      await expect(settledDiscovery).resolves.toHaveLength(2);
      expect(fake.closeCalls()).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, secondReplyHeld: false, discardedDefinitionId: null });
    } finally {
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("keeps a delayed rejecting close bound to its entry owner and preserves a fresh attempt", async () => {
    resetScalarRequeryFaultProbe();
    let releaseClose!: () => void;
    let closeDispatches = 0;
    const failure = new Error("real close failed");
    const fake = fakeKit(async () => projection());
    const { runtime, client, restoreWindow } = await scalarRuntime(fake.kit, ["definition-1", "definition-2"], "occurrence-1", undefined, undefined, async () => {
      await new Promise<void>((resolve) => { releaseClose = resolve; });
    }, (client) => { client.closeProject = async () => { closeDispatches += 1; throw failure; }; });
    try {
      failSecondScalarRequeryReplyAfterFirst();
      deferSecondScalarRequeryReply();
      const oldEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const oldDiscovery = runtime.discoverKeyedGroupedSums(oldEdit as never);
      await vi.waitFor(() => expect(scalarRequeryFaultProbe().secondReplyHeld).toBe(true));
      let oldSettled = false;
      const settledOldDiscovery = oldDiscovery.then((value) => { oldSettled = true; return value; }, (error) => { oldSettled = true; throw error; });

      const closing = runtime.close();
      await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"));
      await vi.waitFor(() => expect(oldSettled).toBe(true));
      await expect(settledOldDiscovery).resolves.toHaveLength(2);

      failSecondScalarRequeryReplyAfterFirst();
      releaseClose();
      await expect(closing).rejects.toBe(failure);
      expect(closeDispatches).toBe(1);
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: false, attemptId: expect.any(Number), invalidReason: null });

      const newEdit = await runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      await expect(runtime.discoverKeyedGroupedSums(newEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
      expect(fake.queryCalls()).toBe(4);
    } finally {
      releaseClose?.();
      resetScalarRequeryFaultProbe();
      restoreWindow();
    }
  });

  it("uses only the owning public client for closeProject fallback cancellation", async () => {
    resetScalarRequeryFaultProbe();
    const firstFake = fakeKit(async () => projection());
    const firstHarness = await scalarRuntime(firstFake.kit);
    const secondFake = fakeKit(async () => projection());
    let restoreSecondWindow = () => {};
    try {
      failSecondScalarRequeryReplyAfterFirst();
      await firstHarness.runtime.edit({ occurrence: "occurrence-1", revision: "r1" });
      const firstOwner = scalarRequeryFaultProbe().clientIdentity;
      await firstHarness.client.closeProject();
      expect(scalarRequeryFaultProbe()).toMatchObject({ attemptId: null, publicationAcknowledged: false });

      const secondHarness = await scalarRuntime(secondFake.kit, ["definition-1", "definition-2"], "occurrence-2");
      restoreSecondWindow = secondHarness.restoreWindow;
      failSecondScalarRequeryReplyAfterFirst();
      const newEdit = await secondHarness.runtime.edit({ occurrence: "occurrence-2", revision: "r1" });
      expect(scalarRequeryFaultProbe()).toMatchObject({ publicationAcknowledged: true, occurrence: "occurrence-2", revision: newEdit.revision });
      await firstHarness.client.closeProject();
      expect(scalarRequeryFaultProbe()).toMatchObject({
        publicationAcknowledged: true,
        clientIdentity: expect.any(Number),
        occurrence: "occurrence-2",
        revision: newEdit.revision,
        invokedDefinitionIds: [],
      });
      expect(scalarRequeryFaultProbe().clientIdentity).not.toBe(firstOwner);
      await expect(secondHarness.runtime.discoverKeyedGroupedSums(newEdit as never)).rejects.toThrow(/second grouped-summary query reply discarded/);
    } finally {
      resetScalarRequeryFaultProbe();
      restoreSecondWindow();
      firstHarness.restoreWindow();
    }
  });
});

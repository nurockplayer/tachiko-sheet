/**
 * The wrapper's one-shot import scheduling gate is deterministic test wiring,
 * not proof of the real-core/browser pending-import acceptance.
 */
import { describe, expect, it } from "vitest";
import { setImmediate } from "node:timers/promises";
import type { CoreKit } from "../../src/contracts.js";
import {
  deferNextImportApplication,
  importSpreadsheetRequestCount,
  releaseImportApplication,
  wrapKitLoader,
} from "../../src/acceptance/sheet-foundation.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function instrumentedImportClient(
  importSpreadsheet: () => Promise<unknown>,
): Promise<ReturnType<CoreKit["createExperimentalDesignerClient"]>> {
  const kit = {
    createExperimentalDesignerClient: () => ({ importSpreadsheet }),
  } as unknown as CoreKit;
  return (await wrapKitLoader(async () => kit)()).createExperimentalDesignerClient();
}

function importSpreadsheet(
  client: ReturnType<CoreKit["createExperimentalDesignerClient"]>,
): Promise<unknown> {
  return client.importSpreadsheet(new ArrayBuffer(0), "csv" as never, {} as never, {} as never);
}

describe("acceptance import application gate scheduling", () => {
  it("holds a successful real reply until release and does not gate the next call", async () => {
    const pendingRealReply = deferred<unknown>();
    const acceptedReply = { imported: true };
    const nextReply = { imported: "next" };
    let calls = 0;
    const client = await instrumentedImportClient(() => {
      calls += 1;
      return calls === 1 ? pendingRealReply.promise : Promise.resolve(nextReply);
    });
    const dispatchesBefore = importSpreadsheetRequestCount();

    deferNextImportApplication();
    const result = importSpreadsheet(client);
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    pendingRealReply.resolve(acceptedReply);
    await setImmediate();

    try {
      expect(settled).toBe(false);
      expect(calls).toBe(1);
      expect(importSpreadsheetRequestCount() - dispatchesBefore).toBe(1);
    } finally {
      releaseImportApplication();
    }

    await expect(result).resolves.toBe(acceptedReply);
    await expect(importSpreadsheet(client)).resolves.toBe(nextReply);
    expect(calls).toBe(2);
    expect(importSpreadsheetRequestCount() - dispatchesBefore).toBe(2);
  });

  it("holds and then preserves a real rejection without replaying the next call", async () => {
    const pendingRealReply = deferred<unknown>();
    const failure = new Error("real import rejected");
    const nextReply = { imported: "next" };
    let calls = 0;
    const client = await instrumentedImportClient(() => {
      calls += 1;
      return calls === 1 ? pendingRealReply.promise : Promise.resolve(nextReply);
    });
    const dispatchesBefore = importSpreadsheetRequestCount();

    deferNextImportApplication();
    const result = importSpreadsheet(client);
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    pendingRealReply.reject(failure);
    await setImmediate();

    try {
      expect(settled).toBe(false);
      expect(calls).toBe(1);
      expect(importSpreadsheetRequestCount() - dispatchesBefore).toBe(1);
    } finally {
      releaseImportApplication();
    }

    await expect(result).rejects.toBe(failure);
    await expect(importSpreadsheet(client)).resolves.toBe(nextReply);
    expect(calls).toBe(2);
    expect(importSpreadsheetRequestCount() - dispatchesBefore).toBe(2);
  });
});

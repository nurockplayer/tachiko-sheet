import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalCopies, LOCAL_OPAQUE_COPIES_STORE } from "../host/local-copies.js";
import { savedCopyPresentation } from "../App.js";
import { WORK_FILE_MAX_BYTES, type WorkFileSavedCopy } from "../contracts.js";

const host = createLocalCopies();
afterEach(async () => { await host.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function copy(bytes = new ArrayBuffer(1)): WorkFileSavedCopy {
  return { kind: "work-file", formatVersion: 1, name: "Portable", savedAt: "2026-10-14T00:00:00Z", revision: "r1", bytes,
    presentation: { version: 1, snapshotRevision: "r1", snapshotDigest: "0".repeat(64), report: {
      definitionId: "d1", type: "line", title: "Local", categoryLabel: "Category", valueLabel: "Amount", legendVisible: true,
    } } };
}

// Supply persisted input without IndexedDB's own transport clone, so spies can
// prove that the production reader/classifier never clones an oversized record.
function installDatabase(record: WorkFileSavedCopy) {
  const database = { close() {}, transaction: vi.fn((_stores, mode) => {
    const tx = { oncomplete: undefined as (() => void) | undefined, objectStore: (store: string) => ({
      get: () => request(store === LOCAL_OPAQUE_COPIES_STORE && mode !== "readwrite" ? record : undefined),
      getAll: () => request(store === LOCAL_OPAQUE_COPIES_STORE ? [record] : []),
      add: vi.fn(() => { queueMicrotask(() => tx.oncomplete?.()); return {}; }),
    }) };
    return tx;
  }) };
  const open = vi.fn(() => request(database));
  vi.stubGlobal("indexedDB", { open });
  return { database, open };
}
function request(result: unknown) {
  const pending = { result, onsuccess: undefined as (() => void) | undefined };
  queueMicrotask(() => pending.onsuccess?.());
  return pending;
}

const invalidImports = [
  { metadata: null, ledger: null },
  { name: "foreign.csv", format: "csv", bytes: new ArrayBuffer(1), metadata: { version: 1, sheets: [] }, ledger: [] },
  null,
];

describe("portable local-copy admission before allocation or replacement", () => {
  it("refuses 64 MiB + 1 on writer, reader, classifier and open preflight without cloning or hashing", async () => {
    const record = copy(new ArrayBuffer(WORK_FILE_MAX_BYTES + 1));
    const slice = vi.spyOn(record.bytes, "slice");
    const clone = vi.spyOn(globalThis, "structuredClone");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const { database, open } = installDatabase(record);
    await expect(host.createWorkFile!(record.name, record)).rejects.toThrow(/resource_limit/);
    expect(open).not.toHaveBeenCalled();
    await expect(host.readAny(record.name)).rejects.toThrow(/resource_limit/);
    expect(await host.list()).toEqual([{ name: record.name, savedAt: record.savedAt }]);
    await expect(savedCopyPresentation(record)).rejects.toThrow(/resource_limit/);
    expect(slice).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    expect(database.transaction.mock.calls.every(([, mode]) => mode === "readonly")).toBe(true);
  });

  it("accepts exactly 64 MiB in writer, reader, classifier and hash preflight", async () => {
    const record = copy(new ArrayBuffer(WORK_FILE_MAX_BYTES));
    const slice = vi.spyOn(record.bytes, "slice");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
    installDatabase(record);
    expect(await host.createWorkFile!(record.name, record)).toMatchObject({ kind: "work-file", revision: "r1" });
    expect((await host.readAny(record.name))?.kind).toBe("work-file");
    expect((await host.list())[0].kind).toBe("work-file");
    expect(await savedCopyPresentation(record)).toBe(record.presentation);
    expect(slice).toHaveBeenCalledTimes(2);
    expect(digest).toHaveBeenCalledExactlyOnceWith("SHA-256", record.bytes);
  });

  it.each(invalidImports)("refuses any imported-source value before write/read/hash: %j", async importedSource => {
    const record = { ...copy(), importedSource } as unknown as WorkFileSavedCopy;
    const slice = vi.spyOn(record.bytes, "slice");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const { open } = installDatabase(record);
    await expect(host.createWorkFile!(record.name, record)).rejects.toThrow(/unsupported import information/);
    expect(open).not.toHaveBeenCalled();
    await expect(host.readAny(record.name)).rejects.toThrow(/unsupported import information/);
    expect((await host.list())[0].kind).toBeUndefined();
    await expect(savedCopyPresentation(record)).rejects.toThrow(/unsupported import information/);
    expect(slice).not.toHaveBeenCalled(); expect(digest).not.toHaveBeenCalled();
  });

  it("validates presentation structure and revision before cloning/hashing; digest before replacement", async () => {
    const record = copy();
    const slice = vi.spyOn(record.bytes, "slice");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).fill(1).buffer);
    installDatabase(record);
    record.presentation!.report.legendVisible = null as unknown as boolean;
    await expect(host.createWorkFile!(record.name, record)).rejects.toThrow(/presentation attachment is invalid/);
    await expect(host.readAny(record.name)).rejects.toThrow(/presentation attachment is invalid/);
    await expect(savedCopyPresentation(record)).rejects.toThrow(/presentation attachment is invalid/);
    record.presentation!.report.legendVisible = true;
    record.presentation!.snapshotRevision = "foreign";
    await expect(host.createWorkFile!(record.name, record)).rejects.toThrow(/report settings do not match/);
    await expect(host.readAny(record.name)).rejects.toThrow(/report settings do not match/);
    await expect(savedCopyPresentation(record)).rejects.toThrow(/report settings do not match/);
    expect(slice).not.toHaveBeenCalled(); expect(digest).not.toHaveBeenCalled();
    record.presentation!.snapshotRevision = record.revision;
    await expect(savedCopyPresentation(record)).rejects.toThrow(/report settings do not match/);
    expect(digest).toHaveBeenCalledTimes(1);
  });
});

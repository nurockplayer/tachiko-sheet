// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AppProps } from "../App.js";
import type { ConfirmedPublication, SheetShellProps, WorkbookView } from "../contracts.js";
import { UnknownOperationOutcomeError } from "../contracts.js";
import { App } from "../App.js";
import { companionDigest } from "../host/import-companion.js";

const shell = vi.hoisted(() => ({ props: null as SheetShellProps | null, saveFile: vi.fn(async (..._args: [string, Blob | Promise<Blob>, import("../contracts.js").ImportCompanion?]): Promise<string | undefined> => undefined), readImportCompanion: vi.fn() }));
vi.mock("../host/host-files.js", () => ({ useHostFiles: () => ({ saveFile: shell.saveFile, readImportCompanion: shell.readImportCompanion }) }));
vi.mock("../ui/SheetShell.js", () => ({ SheetShell: (props: SheetShellProps) => {
  shell.props = props;
  return createElement("div", { role: "alert" }, props.message);
} }));

it.each([
  ["rename", "publication"], ["rename", "inspect"], ["add", "publication"], ["delete", "publication"],
])("keeps exports and Save refused after unknown %s until authoritative %s", async (command, recovery) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1", requiresPortableSave: true,
    collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] } };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const source = { name: "book.xlsx", format: "xlsx", bytes: new Uint8Array([8, 7]).buffer, metadata, ledger: [] };
  const exported = { revision: "r1", bytes: new ArrayBuffer(1), ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), close: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []), openOpaque: vi.fn(async () => view), read: vi.fn(async () => view),
    renameTable: vi.fn(async (): Promise<ConfirmedPublication> => { throw new UnknownOperationOutcomeError("reply lost"); }),
    addTable: vi.fn(async () => { throw new UnknownOperationOutcomeError("reply lost"); }),
    deleteTable: vi.fn(async () => { throw new UnknownOperationOutcomeError("reply lost"); }),
    exportSpreadsheet: vi.fn(async () => exported), exportOpaque: vi.fn(async () => exported), exportWorkFile: vi.fn(async () => exported),
  };
  const copies = { list: vi.fn(async () => []), readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes: new ArrayBuffer(1), importedSource: source })),
    createOpaque: vi.fn(async () => ({ name: "Saved", kind: "opaque", revision: "r1", savedAt: "2026-11-18T00:00:00Z", saveToken: "saved" })) };
  const publication = { base_revision: "r1", resulting_revision: "r1", entities: [], fields: [], affected_calculations: [], schemas: [], schema_fields: [] };
  const props = { runtime, copies, appearancePreference: {} } as unknown as AppProps;
  const container = document.createElement("div");
  const root = createRoot(container);
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, props)));
    await act(async () => current().onOpenSaved("Imported"));
    expect(current().onRenameTable).toBeTypeOf("function");
    expect(current().onAddTable).toBeTypeOf("function");
    await act(async () => {
      const witness = { occurrence: "o1", revision: "r1" };
      if (command === "add") await current().onAddTable!(witness, "Added", []);
      else if (command === "delete") await current().onDeleteTable!(witness, "s1");
      else await current().onRenameTable!(witness, "s1", "New");
    });
    const assertRefused = async () => {
      for (const format of ["xlsx", "csv"] as const) {
        await act(async () => { expect(await current().onPrepareDownload!(format)).toBe(false); });
        await act(async () => { expect(await current().onDownload!(format)).toBe(false); });
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("The sheet names could not be confirmed. Download as .ro to keep your changes, or reopen the workbook.");
      }
      await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: false }); });
      expect(runtime.exportSpreadsheet).not.toHaveBeenCalled();
      expect(runtime.exportOpaque).not.toHaveBeenCalled();
      expect(copies.createOpaque).not.toHaveBeenCalled();
    };
    const downloadRo = async () => {
      await act(async () => { expect(await current().onPrepareDownload!("ro")).toBe(true); });
      await act(async () => { expect(await current().onDownload!("ro")).toBe(true); });
      expect(shell.saveFile).toHaveBeenLastCalledWith("Imported.ro", expect.any(Blob));
    };
    await assertRefused();
    await act(async () => current().onRefresh());
    await assertRefused();
    await downloadRo();
    expect(runtime.exportWorkFile).toHaveBeenLastCalledWith({ occurrence: "o1", revision: "r1" }, undefined);
    // An acknowledged publication without a mapping cannot restore trust either.
    runtime.renameTable.mockImplementation(async () => ({ view, publication }));
    await act(async () => { await current().onRenameTable!({ occurrence: "o1", revision: "r1" }, "s1", "New"); });
    await assertRefused();
    await downloadRo();
    if (recovery === "publication") {
      runtime.renameTable.mockImplementation(async () => ({ view, publication: { ...publication, import_metadata: metadata } }));
      await act(async () => { await current().onRenameTable!({ occurrence: "o1", revision: "r1" }, "s1", "New"); });
    } else {
      runtime.read.mockResolvedValue({ ...view, importMetadata: metadata });
      await act(async () => current().onRefresh());
      expect(runtime.openOpaque).toHaveBeenCalledTimes(1);
    }
    for (const format of ["xlsx", "csv"] as const) {
      await act(async () => { expect(await current().onPrepareDownload!(format)).toBe(true); });
      await act(async () => { expect(await current().onDownload!(format)).toBe(true); });
      expect(runtime.exportSpreadsheet).toHaveBeenCalledWith({ occurrence: "o1", revision: "r1" }, metadata, format);
    }
    // Exercise the browser host with an actual companion and a failed keep.
    const { BROWSER_HOST_FILES } = await vi.importActual<typeof import("../host/host-files.js")>("../host/host-files.js");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.stubGlobal("indexedDB", { open: () => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        Object.assign(request, { result: {
          transaction: () => ({ objectStore: () => ({ put: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } }) }),
          close: () => {},
        } });
        request.onsuccess?.(new Event("success") as Event & { target: IDBOpenDBRequest });
      });
      return request;
    } });
    try {
      runtime.exportWorkFile.mockResolvedValueOnce({ ...exported, importMetadata: metadata } as typeof exported);
      shell.saveFile.mockImplementationOnce(BROWSER_HOST_FILES.saveFile);
      await act(async () => { expect(await current().onPrepareDownload!("ro")).toBe(true); });
      await act(async () => { expect(await current().onDownload!("ro")).toBe(true); });
      expect(shell.saveFile).toHaveBeenLastCalledWith("Imported.ro", expect.any(Blob), expect.objectContaining({ metadata }));
      expect(click).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("imported sheet information could not be stored");
    } finally { click.mockRestore(); create.mockRestore(); vi.unstubAllGlobals(); }
    expect(runtime.exportWorkFile).toHaveBeenLastCalledWith({ occurrence: "o1", revision: "r1" }, metadata);
    runtime.exportWorkFile.mockClear();
    await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: true }); });
    expect(runtime.exportWorkFile).not.toHaveBeenCalled();
    expect(runtime.exportOpaque).toHaveBeenLastCalledWith({ occurrence: "o1", revision: "r1" }, metadata);
    expect(copies.createOpaque).toHaveBeenCalledWith("Saved", expect.objectContaining({ importedSource: source }));
  } finally {
    await act(async () => root.unmount());
  }
});

it("offers Save a copy on a reader-only host after imported XLSX addTable and saves its latest mapping", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const added = { id: "s2", key: "s2", display_name: "Added", headerless: false, data_start_row: 2, entity_count: 0 };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1",
    collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] } };
  const next: WorkbookView = { ...view, revision: "r2", requiresPortableSave: true, openedFromWorkFile: true,
    collections: [collection, added], table: { revision: "r2", collection: added, columns: [], rows: [] } };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const latest = { ...metadata, sheets: [...metadata.sheets, { ...metadata.sheets[0]!, schema_id: "s2", name: "Added" }] };
  const source = { name: "book.xlsx", format: "xlsx", bytes: new Uint8Array([8, 7]).buffer, metadata, ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null), discoverKeyedGroupedSums: vi.fn(async () => []),
    openOpaque: vi.fn(async () => view), read: vi.fn(async () => next),
    addTable: vi.fn(async () => ({ view: next, publication: { base_revision: "r1", resulting_revision: "r2",
      entities: [], fields: [], affected_calculations: [], schemas: [], schema_fields: [], import_metadata: latest } })),
    exportOpaque: vi.fn(async () => ({ revision: "r2", bytes: new ArrayBuffer(1) })), exportWorkFile: vi.fn(),
  };
  const copies = { list: vi.fn(async () => []), readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes: new ArrayBuffer(1), importedSource: source })),
    createOpaque: vi.fn(async () => ({ name: "Saved", kind: "opaque", revision: "r2", savedAt: "2026-11-18T00:00:00Z", saveToken: "saved" })) };
  const root = createRoot(document.createElement("div"));
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, { runtime, copies, appearancePreference: {} } as unknown as AppProps)));
    await act(async () => current().onOpenSaved("Imported"));
    await act(async () => { await current().onAddTable!({ occurrence: "o1", revision: "r1" }, "Added", []); });
    expect(current().view).toEqual(next);
    expect(current().workFileSaveUnavailableReason).toBeNull();
    await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: true }); });
    expect(runtime.exportWorkFile).not.toHaveBeenCalled();
    expect(copies.createOpaque).toHaveBeenCalledWith("Saved", expect.objectContaining({ revision: "r2", importedSource: { ...source, metadata: latest } }));
  } finally {
    await act(async () => root.unmount());
  }
});

it("allows imported exports and Save after an unknown cell edit and Refresh", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1",
    collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] } };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const source = { name: "book.xlsx", format: "xlsx", bytes: new Uint8Array([8, 7]).buffer, metadata, ledger: [] };
  const exported = { revision: "r1", bytes: new ArrayBuffer(1), ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null), discoverKeyedGroupedSums: vi.fn(async () => []),
    openOpaque: vi.fn(async () => view), read: vi.fn(async () => view),
    editConfirmed: vi.fn(async () => { throw new UnknownOperationOutcomeError("reply lost"); }),
    exportSpreadsheet: vi.fn(async () => exported), exportOpaque: vi.fn(async () => exported),
  };
  const copies = { list: vi.fn(async () => []), readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes: new ArrayBuffer(1), importedSource: source })),
    createOpaque: vi.fn(async () => ({ name: "Saved", kind: "opaque", revision: "r1", savedAt: "2026-11-18T00:00:00Z", saveToken: "saved" })) };
  const root = createRoot(document.createElement("div"));
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, { runtime, copies, appearancePreference: {} } as unknown as AppProps)));
    await act(async () => current().onOpenSaved("Imported"));
    await act(async () => { await current().onCommit({ occurrence: "o1", revision: "r1" }, { entity: "e1", field: "f1" }, { kind: "text", value: "changed" }); });
    expect(current().currentness).toBe("unknown");
    await act(async () => current().onRefresh());
    for (const format of ["csv", "xlsx"] as const) {
      await act(async () => { expect(await current().onPrepareDownload!(format)).toBe(true); });
      await act(async () => { expect(await current().onDownload!(format)).toBe(true); });
      expect(runtime.exportSpreadsheet).toHaveBeenCalledWith({ occurrence: "o1", revision: "r1" }, metadata, format);
    }
    await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: true }); });
  } finally {
    await act(async () => root.unmount());
  }
});


it("retains XLSX origin through a work-file download and reopen, and reads native and legacy origins", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1", collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] }, importMetadata: metadata };
  const bytes = new Uint8Array([8, 7]).buffer;
  const source = { name: "book.xlsx", format: "xlsx", bytes, metadata, ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), close: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []), openOpaque: vi.fn(async () => view),
    openWorkFile: vi.fn(async () => view), read: vi.fn(async () => view),
    exportWorkFile: vi.fn(async () => ({ revision: "r1", bytes, importMetadata: metadata, ledger: [] })),
  };
  const copies = { list: vi.fn(async () => []), readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes, importedSource: source })) };
  const root = createRoot(document.createElement("div"));
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, { runtime, copies, appearancePreference: {} } as unknown as AppProps)));
    await act(async () => current().onOpenSaved("Imported"));
    await act(async () => { expect(await current().onPrepareDownload!("ro")).toBe(true); });
    await act(async () => { expect(await current().onDownload!("ro")).toBe(true); });
    const companion = shell.saveFile.mock.lastCall![2] as import("../contracts.js").ImportCompanion;
    expect(companion.origin).toBe("xlsx");
    const file = new File([bytes], "work.ro");
    for (const [origin, expected] of [["xlsx", "xlsx"], ["native", "native"], [undefined, "imported"]] as const) {
      await act(async () => current().onClose());
      shell.readImportCompanion.mockResolvedValueOnce({ ...companion, origin });
      await act(async () => current().onOpenWorkFile!(file));
      expect(current().importOrigin).toBe(expected);
      expect(current().interop?.metadata).toEqual(metadata);
    }
  } finally {
    shell.readImportCompanion.mockReset();
    await act(async () => root.unmount());
  }
});

it("saves XLSX origin after Refresh recovers an older saved copy without a companion", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1", collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] }, importMetadata: metadata };
  const bytes = new Uint8Array([8, 7]).buffer;
  const importedSource = { name: "book.xlsx", format: "xlsx", bytes, metadata, ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []).mockRejectedValueOnce(new Error("Discovery failed")),
    openOpaque: vi.fn(async () => view), read: vi.fn(async () => view),
    exportOpaque: vi.fn(async () => ({ revision: "r1", bytes, importMetadata: metadata })),
  };
  const copies = {
    list: vi.fn(async () => []),
    readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes, importedSource })),
    createOpaque: vi.fn(async () => ({ name: "Recovered", kind: "opaque", revision: "r1", savedAt: "2026-11-26T00:00:00Z", saveToken: "saved" })),
  };
  const root = createRoot(document.createElement("div"));
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, { runtime, copies, appearancePreference: {} } as unknown as AppProps)));
    await act(async () => current().onOpenSaved("Imported"));
    expect(current().currentness).toBe("unknown");
    await act(async () => current().onRefresh());
    expect(current().currentness).toBe("current");
    await act(async () => { expect(await current().onCreateCopy("Recovered")).toMatchObject({ saved: true }); });
    expect(copies.createOpaque).toHaveBeenCalledWith("Recovered", expect.objectContaining({
      importCompanion: expect.objectContaining({ origin: "xlsx", metadata }),
    }));
  } finally {
    await act(async () => root.unmount());
  }
});

it.each(["xlsx", "csv", "native"] as const)("preserves %s work-file origin after Refresh recovers a failed open projection", async origin => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", headerless: false, data_start_row: 2, entity_count: 0 };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1", collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] }, importMetadata: metadata };
  const bytes = new Uint8Array([8, 7]).buffer;
  const file = new File([bytes], "work.ro");
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []).mockRejectedValueOnce(new Error("Discovery failed")),
    openWorkFile: vi.fn(async () => view), read: vi.fn(async () => view),
    exportWorkFile: vi.fn(async () => ({ revision: "r1", bytes, importMetadata: metadata, ledger: [] })),
  };
  const copies = { list: vi.fn(async () => []) };
  const root = createRoot(document.createElement("div"));
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, { runtime, copies, appearancePreference: {} } as unknown as AppProps)));
    shell.readImportCompanion.mockResolvedValueOnce({ snapshotDigest: await companionDigest(bytes), origin, metadata });
    await act(async () => current().onOpenWorkFile!(file));
    expect(runtime.openWorkFile).toHaveBeenCalledWith(bytes, metadata);
    expect(current().currentness).toBe("unknown");

    await act(async () => current().onRefresh());
    expect(current().currentness).toBe("current");
    expect(current().saveStatus).toBe("not-saved");
    await act(async () => { expect(await current().onPrepareDownload!("ro")).toBe(true); });
    await act(async () => { expect(await current().onDownload!("ro")).toBe(true); });
    expect(shell.saveFile).toHaveBeenLastCalledWith("Imported.ro", expect.any(Blob), expect.objectContaining({ origin, metadata }));
    expect(current().importOrigin).toBe(origin);
  } finally {
    shell.readImportCompanion.mockReset();
    await act(async () => root.unmount());
  }
});

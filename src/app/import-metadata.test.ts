// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AppProps } from "../App.js";
import type { SheetShellProps, WorkbookView } from "../contracts.js";
import { UnknownOperationOutcomeError } from "../contracts.js";
import { App } from "../App.js";

const shell = vi.hoisted(() => ({ props: null as SheetShellProps | null }));
vi.mock("../ui/SheetShell.js", () => ({ SheetShell: (props: SheetShellProps) => {
  shell.props = props;
  return createElement("div", { role: "alert" }, props.message);
} }));

it("refuses metadata-dependent exports and Save after unknown outcome, then admits them after Refresh", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const collection = { id: "s1", key: "s1", display_name: "Original", entity_count: 0 };
  const view: WorkbookView = { title: "Imported", occurrence: "o1", revision: "r1", requiresPortableSave: true,
    collections: [collection], table: { revision: "r1", collection, columns: [], rows: [] } };
  const metadata = { version: 1 as const, sheets: [{ schema_id: "s1", name: "Original", has_header: true, columns: [], rows: [] }] };
  const source = { name: "book.xlsx", format: "xlsx", bytes: new Uint8Array([8, 7]).buffer, metadata, ledger: [] };
  const exported = { revision: "r1", bytes: new ArrayBuffer(1), ledger: [] };
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []), openOpaque: vi.fn(async () => view), read: vi.fn(async () => view),
    renameTable: vi.fn(async () => { throw new UnknownOperationOutcomeError("reply lost"); }),
    exportSpreadsheet: vi.fn(async () => exported), exportOpaque: vi.fn(async () => exported), exportWorkFile: vi.fn(),
  };
  const copies = { list: vi.fn(async () => []), readAny: vi.fn(async () => ({ kind: "opaque", revision: "r1", bytes: new ArrayBuffer(1), importedSource: source })),
    createOpaque: vi.fn(async () => ({ name: "Saved", kind: "opaque", revision: "r1", savedAt: "2026-11-18T00:00:00Z", saveToken: "saved" })) };
  const props = { runtime, copies, appearancePreference: {} } as unknown as AppProps;
  const container = document.createElement("div");
  const root = createRoot(container);
  const current = () => shell.props!;
  try {
    await act(async () => root.render(createElement(App, props)));
    await act(async () => current().onOpenSaved("Imported"));
    expect(current().onRenameTable).toBeTypeOf("function");
    expect(current().onAddTable).toBeTypeOf("function");
    await act(async () => { await current().onRenameTable!({ occurrence: "o1", revision: "r1" }, "s1", "New"); });
    for (const format of ["xlsx", "csv"] as const) {
      await act(async () => { expect(await current().onPrepareDownload!(format)).toBe(false); });
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Reopen or Refresh this workbook before exporting");
    }
    await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: false }); });
    expect(runtime.exportSpreadsheet).not.toHaveBeenCalled();
    expect(runtime.exportOpaque).not.toHaveBeenCalled();
    expect(copies.createOpaque).not.toHaveBeenCalled();
    await act(async () => current().onRefresh());
    await act(async () => { expect(await current().onPrepareDownload!("xlsx")).toBe(true); });
    expect(runtime.exportSpreadsheet).toHaveBeenCalledWith({ occurrence: "o1", revision: "r1" }, metadata, "xlsx");
    await act(async () => { expect(await current().onCreateCopy("Saved")).toMatchObject({ saved: true }); });
    expect(runtime.exportWorkFile).not.toHaveBeenCalled();
    expect(copies.createOpaque).toHaveBeenCalledWith("Saved", expect.objectContaining({ importedSource: source }));
  } finally {
    await act(async () => root.unmount());
  }
});

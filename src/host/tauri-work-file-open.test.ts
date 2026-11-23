// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { App, type AppProps } from "../App.js";
import type { InteropMetadata, WorkbookView } from "../contracts.js";
import { createAppearancePreferenceController } from "../application/appearance-preference.js";
import { HostFilesContext } from "./host-files.js";
import { companionDigest, IMPORT_COMPANION_NOTE } from "./import-companion.js";
import { tauriHostFiles } from "./tauri-host-files.js";

const native = vi.hoisted(() => ({ frame: new Uint8Array() as Uint8Array, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke.mockImplementation(async (command, args) => {
  if (command === "page_identity") return 1;
  if (command === "take_opened_file") return args?.pick ? native.frame.buffer : new ArrayBuffer(0);
  throw new Error(`Unexpected command: ${command}`);
}) }));

function pickedFile(bytes: Uint8Array, companion?: string): Uint8Array {
  const name = new TextEncoder().encode("book.ro");
  if (companion === undefined) {
    const frame = new Uint8Array(5 + name.length + bytes.length);
    new DataView(frame.buffer).setUint32(1, name.length, true);
    frame.set(name, 5);
    frame.set(bytes, 5 + name.length);
    return frame;
  }
  const attachment = new TextEncoder().encode(companion);
  const frame = new Uint8Array(9 + name.length + attachment.length + bytes.length);
  const view = new DataView(frame.buffer);
  frame[0] = 2;
  view.setUint32(1, name.length, true);
  frame.set(name, 5);
  view.setUint32(5 + name.length, attachment.length, true);
  frame.set(attachment, 9 + name.length);
  frame.set(bytes, 9 + name.length + attachment.length);
  return frame;
}

it.each(["imported", "native", "pathless"] as const)("opens a %s .ro from the desktop Home picker", async (kind) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  native.invoke.mockClear();
  const browserDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { open: browserDatabase });
  const bytes = new Uint8Array([1, 2, 3]);
  const metadata: InteropMetadata = { version: 1, sheets: [
    { schema_id: "second", name: "Renamed Second", has_header: true, columns: [], rows: [] },
    { schema_id: "first", name: "First", has_header: true, columns: [], rows: [] },
  ] };
  native.frame = pickedFile(bytes, kind === "imported"
    ? JSON.stringify({ snapshotDigest: await companionDigest(bytes.buffer), metadata }) : undefined);
  const collections = kind === "imported"
    ? metadata.sheets.map(sheet => ({ id: sheet.schema_id, key: sheet.schema_id, display_name: sheet.name, headerless: false, data_start_row: 2, entity_count: 0 }))
    : [{ id: "native", key: "native", display_name: "Native", headerless: false, data_start_row: 2, entity_count: 0 }];
  const view: WorkbookView = { title: "Book", occurrence: "o1", revision: "r1", openedFromWorkFile: true,
    ...(kind === "imported" ? { importMetadata: metadata } : {}), collections,
    table: { revision: "r1", native_table_profile: true, collection: collections[0]!, columns: [], rows: [] } };
  const runtime = {
    prepare: vi.fn(async () => {}), queryCapacity: vi.fn(async () => null),
    discoverKeyedGroupedSums: vi.fn(async () => []), openWorkFile: vi.fn(async () => view),
  };
  const appearancePreference = createAppearancePreferenceController({
    readV2: () => null, readLegacyV1: () => null, writeV2: () => {},
  }, () => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(HostFilesContext.Provider, { value: tauriHostFiles },
      createElement(App, { runtime, copies: { list: async () => [] }, appearancePreference } as unknown as AppProps))));
    const picker = container.querySelector<HTMLInputElement>('[data-testid="open-work-file"]')!;
    expect(picker.type).toBe("file");
    await act(async () => {
      if (kind === "pathless") {
        Object.defineProperty(picker, "files", { value: [new File([bytes], "invoice.ro")] });
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        picker.click();
      }
      await vi.waitFor(() => expect(runtime.openWorkFile).toHaveBeenCalled());
    });
    if (kind === "pathless") expect(native.invoke).not.toHaveBeenCalledWith("take_opened_file", { pick: true });
    else expect(native.invoke).toHaveBeenCalledWith("take_opened_file", { pick: true });
    expect(browserDatabase).not.toHaveBeenCalled();
    if (kind === "imported") {
      expect(runtime.openWorkFile).toHaveBeenCalledWith(bytes.buffer, metadata);
      expect(Array.from(container.querySelectorAll('[aria-label="Sheets"] [role="tab"]'), tab => tab.textContent))
        .toEqual(["Renamed Second", "First"]);
    } else {
      expect(runtime.openWorkFile).toHaveBeenCalledWith(bytes.buffer);
    }
    expect(container.textContent).not.toContain(IMPORT_COMPANION_NOTE);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

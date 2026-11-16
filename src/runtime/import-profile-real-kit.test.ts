import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";
import * as kit from "../../public/core-kit/experimental-client.js";
import { createSheetRuntime } from "./session.js";

// Keep the actual public worker protocol, importer and WASM; only the Worker
// transport is in-process, as in a1-real-kit.test.ts.
async function realClient() {
  const wasm = await readFile(new URL("../../public/core-kit/designer_runtime.wasm", import.meta.url));
  const url = `data:application/wasm;base64,${wasm.toString("base64")}`;
  return new WorkerDesignerClient(() => {
    const scopeEvents = new EventTarget();
    const clientEvents = new EventTarget();
    const send = (target: EventTarget, data: unknown, transfer: Transferable[] = []) => {
      const copy = structuredClone(data, { transfer });
      setTimeout(() => target.dispatchEvent(new MessageEvent("message", { data: copy })), 0);
    };
    const global = globalThis as unknown as { self?: unknown };
    const saved = global.self;
    global.self = {
      addEventListener: (type: string, listener: EventListener) => scopeEvents.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => send(clientEvents, data, transfer),
    };
    try { startDesignerWorker(url); } finally { global.self = saved; }
    return {
      addEventListener: (type: string, listener: EventListener) => clientEvents.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => send(scopeEvents, data, transfer),
      terminate: () => undefined,
    } as unknown as Worker;
  });
}

const options = { delimiter: ",", header: true };
const selection = { column_types: [["text", "number", "number"]] as ("text" | "number")[][], extra_columns: [[]] };

describe("working-size imported sessions with the vendored kit", () => {
  it("admits a 129-row XLSX with a formula through application inspection and import", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    try {
      // Produce a real XLSX with the kit, including a formula so ordinary
      // inspection cannot admit it through the special text-only profile.
      const csv = new TextEncoder().encode("Name,Qty,Total\n" + Array.from({ length: 129 }, (_, i) => `Item ${i},2,0`).join("\n"));
      const seed = await client.importSpreadsheetWorkingSize(csv.buffer, "csv", options, selection);
      const table = seed.opened.window;
      const formula = await client.updateFormula(table.revision, { entity: table.rows[0]!.id, field: table.columns[2]!.id }, "1 + 1");
      const xlsx = await client.exportSpreadsheet(formula.resulting_revision, seed.metadata, "xlsx", table.collection.id);
      await expect(client.inspectSpreadsheet(xlsx.bytes.slice(0), "xlsx", options)).rejects.toThrow(/capacity|limit|128/i);

      const preview = await runtime.inspectSpreadsheet(xlsx.bytes, "xlsx", options);
      expect(preview.sheets[0]!.rows).toHaveLength(129);
      expect(preview.sheets[0]!.rows.some(row => row.some(cell => cell.formula !== null))).toBe(true);
      const imported = await runtime.importSpreadsheet(xlsx.bytes, "xlsx", options, selection);
      expect(imported.metadata.sheets[0]!.rows).toHaveLength(129);
      expect(imported.view.table.collection.entity_count).toBe(129);
    } finally { client.close(); }
  }, 30_000);

  it.each(["csv", "xlsx"] as const)("qualifies %s import, changed cells, save and imported reopen", async format => {
    const client = await realClient();
    try {
      const source = await readFile(new URL(`../../acceptance/j3-interop/fixtures/messy.${format}`, import.meta.url));
      const imported = await client.importSpreadsheetWorkingSize(Uint8Array.from(source).buffer, format, options, selection);
      expect(imported.opened.profile).toBe("working_size");
      const metadata = imported.metadata;
      const retainedMetadata = structuredClone(metadata);
      expect(metadata.sheets).toHaveLength(1);
      expect(metadata.sheets[0]!.columns).toHaveLength(3);
      const table = imported.opened.window;
      const collection = table.collection.key;
      const target = { entity: table.rows[0]!.id, field: table.columns[1]!.id };
      const edited = await client.editNumber(table.revision, target, "42");
      expect(edited.base_revision).toBe(table.revision);
      expect(edited.many).toBeUndefined();
      expect(edited.changed).toHaveLength(1);
      expect(edited.changed![0]).toMatchObject({ target, stored: { kind: "number", value: 42 } });

      const saved = await client.exportProjectV3(edited.resulting_revision);
      expect(saved.revision).toBe(edited.resulting_revision);
      expect(saved.bytes.byteLength).toBeGreaterThan(0);
      await client.closeProject();
      const inspected = await client.inspectImportedProjectWorkingSize(saved.bytes.slice(0), metadata);
      expect(inspected.profile).toBe("working_size");
      expect(inspected.window.rows[0]!.fields).toContainEqual(expect.objectContaining({ target, stored: { kind: "number", value: 42 } }));
      const reopened = await client.openImportedProjectWorkingSize(saved.bytes.slice(0), metadata);
      expect(reopened.profile).toBe("working_size");
      const reedited = await client.editNumber(reopened.window.revision, target, "43");
      expect(reedited.many).toBeUndefined();
      expect(reedited.changed).toHaveLength(1);
      expect(reedited.changed![0]).toMatchObject({ target, stored: { kind: "number", value: 43 } });
      const exported = await client.exportSpreadsheet(reedited.resulting_revision, metadata, format, table.collection.id);
      expect(exported.bytes.byteLength).toBeGreaterThan(0);
      expect(metadata).toEqual(retainedMetadata);

      // A parser refusal must leave both the occurrence and its edited data intact.
      const before = await client.observeOccurrence();
      const beforeTable = await client.queryTableWindow(before.revision, collection, {}, 0, 10);
      await expect(client.importSpreadsheetWorkingSize(new Uint8Array([1, 2, 3]).buffer, "xlsx", options, selection)).rejects.toBeDefined();
      expect(await client.observeOccurrence()).toEqual(before);
      expect(await client.queryTableWindow(before.revision, collection, {}, 0, 10)).toEqual(beforeTable);
    } finally { client.close(); }
  }, 30_000);
});

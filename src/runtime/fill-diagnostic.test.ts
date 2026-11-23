import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";

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
it('projects fill and bold from the pinned kit', async () => {
  const client = await realClient();
  try {
    const bytes = new TextEncoder().encode('Name,Qty,Total\nCoffee,2,20\n').buffer;
    const imported = await client.importSpreadsheetWorkingSize(bytes, 'csv', { delimiter: ',', header: true }, { column_types: [['text', 'number', 'number']], extra_columns: [[]] });
    const table = imported.opened.window;
    const collection = table.collection.key, entities = [table.rows[0]!.id], fields = [table.columns[0]!.id];
    let revision = table.revision;
    for (const changes of [[{kind:'toggle_bold'}], [{kind:'fill', color:'#FFFF00'}]] as const) {
      const reply = await client.setCellStyle(revision, collection, entities, fields, [...changes]);
      revision = reply.resulting_revision;
    }
    const projection = await client.queryTable(collection);
    expect(projection.rows[0]!.styles![0]).toMatchObject({ bold: true, fill: 'FFFF00' });
  } finally { client.close(); }
}, 30000);

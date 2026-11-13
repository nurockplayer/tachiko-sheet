import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";

// Exercise the same client and WASM translator Sheet calls, using Work's A1 examples.
describe("A1 translation with the vendored kit", () => {
  it("accepts IFERROR, exact lookups and date parts", async () => {
    const wasm = await readFile(new URL("../../public/core-kit/designer_runtime.wasm", import.meta.url));
    const url = `data:application/wasm;base64,${wasm.toString("base64")}`;
    const client = new WorkerDesignerClient(() => {
      const scopeEvents = new EventTarget();
      const clientEvents = new EventTarget();
      const send = (target: EventTarget, data: unknown, transfer: Transferable[] = []) => {
        const copy = structuredClone(data, { transfer });
        setTimeout(() => target.dispatchEvent(new MessageEvent("message", { data: copy })), 0);
      };
      const global = globalThis as unknown as { self?: unknown };
      const saved = global.self;
      global.self = { addEventListener: (type: string, listener: EventListener) => scopeEvents.addEventListener(type, listener), postMessage: (data: unknown, transfer?: Transferable[]) => send(clientEvents, data, transfer) };
      try { startDesignerWorker(url); } finally { global.self = saved; }
      return { addEventListener: (type: string, listener: EventListener) => clientEvents.addEventListener(type, listener), postMessage: (data: unknown, transfer?: Transferable[]) => send(scopeEvents, data, transfer), terminate: () => undefined } as unknown as Worker;
    });
    try {
      const opened = await client.newTable("Items", [
        { name: "Name", field_type: "text" }, { name: "Qty", field_type: "number" },
        { name: "Price", field_type: "number" }, { name: "Total", field_type: "number" },
        { name: "When", field_type: "date" },
      ]);
      const collection = opened.table.collection.key;
      let revision = opened.table.revision;
      for (let i = 0; i < 3; i++) {
        const inputs = [
          { kind: "text" as const, value: "x" }, { kind: "number" as const, input: "2" },
          { kind: "number" as const, input: "2" }, { kind: "number" as const, input: "2" },
          { kind: "date" as const, value: "2026-09-05" },
        ];
        const initializers = opened.table.columns.map((column, index) => ({ field: column.id, input: inputs[index]! }));
        revision = (await client.trackerCommand({ type: "insert_row", expected_revision: revision, collection, initializers })).resulting_revision;
      }
      const table = await client.queryTable(collection);
      const columns = table.columns.map(column => column.id);
      const rows = table.rows.map(row => row.id);
      for (const text of ["IFERROR(B2/C2,0)", "VLOOKUP(A3,A2:C4,3,FALSE)", "YEAR(E2)"]) {
        const result = await client.translateA1Formula({ expectedRevision: revision, collectionId: table.collection.id, rowEntityId: rows[1]!, targetFieldId: columns[3]!, text, geometry: { headerRow: 1, rows, columns } });
        expect(result.source, text).toBeTruthy();
      }
    } finally { await client.close(); }
  }, 30_000);
});

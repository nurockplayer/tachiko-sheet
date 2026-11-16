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
          { kind: "text" as const, value: ["x", "y", "z"][i]! }, { kind: "number" as const, input: ["6", "8", "9"][i]! },
          { kind: "number" as const, input: ["2", "7", "11"][i]! }, { kind: "number" as const, input: "2" },
          { kind: "date" as const, value: "2026-09-05" },
        ];
        const initializers = opened.table.columns.map((column, index) => ({ field: column.id, input: inputs[index]! }));
        revision = (await client.trackerCommand({ type: "insert_row", expected_revision: revision, collection, initializers })).resulting_revision;
      }
      const table = await client.queryTable(collection);
      const columns = table.columns.map(column => column.id);
      const rows = table.rows.map(row => row.id);
      const target = { entity: rows[1]!, field: columns[3]! };
      const ref = (row: number, column: number) => ({ entity: rows[row]!, field: columns[column]! });
      const first = table.rows[0]!.key;
      const qty = table.columns[1]!.key;
      const price = table.columns[2]!.key;
      const name = table.columns[0]!.key;
      const when = table.columns[4]!.key;
      const cases = [
        {
          text: "IFERROR(B2/C2,0)", canonical: `IFERROR(([${first}.${qty}] / [${first}.${price}]), 0)`, source: `iferror([${first}.${qty}]/[${first}.${price}],0)`,
          dependencies: [ref(0, 1), ref(0, 2)], initial: 3, changed: 5,
          edit: () => client.editNumber(revision, ref(0, 1), "10"),
        },
        {
          text: "VLOOKUP(A3,A2:C4,3,FALSE)",
          canonical: `LOOKUP([.${name}], [${collection}.${name}:column], [${collection}.${price}:column])`,
          source: `LOOKUP([.${name}],[${collection}.${name}:column],[${collection}.${price}:column])`,
          dependencies: rows.flatMap((_, row) => [ref(row, 0), ref(row, 2)]), initial: 7, changed: 2,
          edit: () => client.editText(revision, ref(1, 0), "x"),
        },
        {
          text: "YEAR(E2)", canonical: `YEAR([${first}.${when}])`, source: `year([${first}.${when}])`,
          dependencies: [ref(0, 4)], initial: 2026, changed: 2027,
          edit: () => client.editDate(revision, ref(0, 4), "2027-01-02"),
        },
      ];
      const bindingKeys = (targets: typeof target[]) => targets.map(value => `${value.entity}/${value.field}`).sort();
      for (const test of cases) {
        const result = await client.translateA1Formula({ expectedRevision: revision, collectionId: table.collection.id, rowEntityId: target.entity, targetFieldId: target.field, text: test.text, geometry: { headerRow: 1, rows, columns } });
        expect(result.source, test.text).toBe(test.source);
        expect(result.revision).toBe(revision);
        revision = (await client.updateFormula(revision, target, result.source)).resulting_revision;
        const explained = await client.explainField(revision, target);
        expect(explained.formula_source).toBe(test.canonical);
        expect(bindingKeys(explained.direct_dependencies.map(dependency => dependency.target)), test.text)
          .toEqual(bindingKeys(test.dependencies));
        expect(explained.value.calculated, test.text).toEqual({ status: "value", value: test.initial });
        revision = (await test.edit()).resulting_revision;
        expect((await client.explainField(revision, target)).value.calculated, test.text)
          .toEqual({ status: "value", value: test.changed });
        if (test.text.startsWith("IFERROR")) {
          revision = (await client.editNumber(revision, ref(0, 2), "0")).resulting_revision;
          expect((await client.explainField(revision, target)).value.calculated).toEqual({ status: "value", value: 0 });
          revision = (await client.editNumber(revision, ref(0, 2), "2")).resulting_revision;
        }
        if (test.text.startsWith("VLOOKUP")) {
          revision = (await client.editNumber(revision, ref(0, 2), "13")).resulting_revision;
          expect((await client.explainField(revision, target)).value.calculated).toEqual({ status: "value", value: 13 });
        }
      }
    } finally { await client.close(); }
  }, 30_000);
});

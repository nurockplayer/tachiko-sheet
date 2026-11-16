import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";
import { fillDownPlan } from "../ui/fill-down.js";
import { formulaPastePlan } from "../ui/formula-paste.js";

describe("formula fill and copy with the vendored kit", () => {
  it.each(["fill", "paste"] as const)("%s rebinds the same row and retains the other row after dependency edits", async mode => {
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
        { name: "Qty", field_type: "number" },
        { name: "Adjustment", field_type: "number" },
        { name: "Total", field_type: "number" },
      ]);
      const collection = opened.table.collection.key;
      let revision = opened.table.revision;
      for (const [qty, adjustment] of [[2, 10], [3, 20], [5, 30], [9, 100]]) {
        revision = (await client.trackerCommand({
          type: "insert_row", expected_revision: revision, collection,
          initializers: opened.table.columns.map((column, index) => ({
            field: column.id, input: { kind: "number" as const, input: String([qty, adjustment, 0][index]) },
          })),
        })).resulting_revision;
      }
      let table = await client.queryTable(collection);
      const columns = table.columns.map(column => column.id);
      const rows = table.rows.map(row => row.id);
      const target = (row: number, column: number) => ({ entity: rows[row]!, field: columns[column]! });
      const translation = await client.translateA1Formula({
        expectedRevision: revision, collectionId: table.collection.id,
        rowEntityId: rows[0]!, targetFieldId: columns[2]!, text: "A2+B5",
        geometry: { headerRow: 1, rows, columns },
      });
      const translatedSource = `[.${table.columns[0]!.key}]+[${table.rows[3]!.key}.${table.columns[1]!.key}]`;
      const source = `([.${table.columns[0]!.key}] + [${table.rows[3]!.key}.${table.columns[1]!.key}])`;
      expect(translation.source).toBe(translatedSource);
      revision = (await client.updateFormula(revision, target(0, 2), translation.source)).resulting_revision;
      table = await client.queryTable(collection);
      const area = { top: mode === "fill" ? 0 : 1, bottom: 2, left: 2, right: 2 };
      const plan = mode === "fill"
        ? fillDownPlan(table.rows, table.columns, area, true)
        : formulaPastePlan(table.rows, table.columns, area, {
          entity: rows[0]!, field: columns[2]!, formula: source, text: "102",
        });
      if (plan?.kind !== "formula") throw new Error("Expected a real formula copy plan");
      revision = (await client.copyFormula(revision, plan.request)).resulting_revision;
      const expectResults = async (values: number[]) => {
        const current = await client.queryTable(collection);
        expect(current.rows.slice(0, 3).map(row => row.fields.find(field => field.target.field === columns[2])?.calculated))
          .toEqual(values.map(value => ({ status: "value", value })));
      };
      for (let row = 0; row < 3; row++) {
        const explained = await client.explainField(revision, target(row, 2));
        expect(explained.formula_source).toBe(source);
        expect(explained.direct_dependencies.map(dependency => dependency.target))
          .toEqual(expect.arrayContaining([target(row, 0), target(3, 1)]));
        expect(explained.direct_dependencies).toHaveLength(2);
      }
      await expectResults([102, 103, 105]);
      revision = (await client.editNumber(revision, target(0, 0), "7")).resulting_revision;
      await expectResults([107, 103, 105]);
      revision = (await client.editNumber(revision, target(1, 0), "11")).resulting_revision;
      await expectResults([107, 111, 105]);
      revision = (await client.editNumber(revision, target(3, 1), "200")).resulting_revision;
      await expectResults([207, 211, 205]);
      revision = (await client.editNumber(revision, target(0, 1), "999")).resulting_revision;
      await expectResults([207, 211, 205]);
    } finally { await client.close(); }
  }, 30_000);
});

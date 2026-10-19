/** Adapter unit evidence only; real output is covered by native-export-local. */
import assert from "node:assert/strict";
import { it } from "vitest";
import type { CoreKit, ViewWitness } from "../contracts.js";
import { createSheetRuntime } from "./session.js";

class FakeDesignerRuntimeError extends Error {
  constructor(readonly failure: { code: string; diagnostics: Array<{ path: string; message: string }> }) { super("Refused"); }
}
const witness = (view: ViewWitness) => ({ occurrence: view.occurrence, revision: view.revision });
async function setup() {
  const collections = [{ id: "one-id", key: "one", entity_count: 1 }, { id: "two-id", key: "two", entity_count: 1 }];
  const calls: unknown[][] = [];
  const client = {
    observeOccurrence: async () => ({ scope: "scope", revision: "r1" }),
    openProject: async () => ({}), closeProject: async () => undefined,
    bootstrap: async () => ({ title: "Native", revision: "r1", default_collection: "one", collections }),
    queryTable: async (key: string) => ({ revision: "r1", collection: collections.find(c => c.key === key)!, columns: [], rows: [] }),
    exportNativeTablesSpreadsheet: async (...args: unknown[]) => {
      calls.push(args);
      return { revision: "r1", bytes: new Uint8Array([1, 2]).buffer, ledger: [] };
    },
  };
  const kit = { DesignerRuntimeError: FakeDesignerRuntimeError, createExperimentalDesignerClient: () => client, preflightCanonicalProjectEntries: () => undefined,
    projectTransferFromEntries: () => new ArrayBuffer(0) } as unknown as CoreKit;
  const runtime = createSheetRuntime(async () => kit);
  return { runtime, view: await runtime.openCanonical([]), calls, client };
}
for (const format of ["csv", "xlsx"] as const) it(`dispatches native ${format} with the live revision and selected key`, async () => {
  const { runtime, view, calls } = await setup();
  const second = await runtime.selectCollection(witness(view), "two");
  const result = await runtime.exportNativeTables(witness(second), "two", format);
  assert.deepEqual(calls, [["r1", "two", format]]);
  assert.deepEqual([...new Uint8Array(result.bytes)], [1, 2]);
  assert.deepEqual(result.ledger, []);
  assert.equal((await runtime.read()).revision, view.revision);
});
it("refuses an old witness and changed selected table before native dispatch", async () => {
  const { runtime, view, calls } = await setup();
  await assert.rejects(runtime.exportNativeTables({ ...witness(view), revision: "old" }, "one", "csv"), /witness does not match/);
  const selecting = runtime.selectCollection(witness(view), "two");
  const exporting = runtime.exportNativeTables(witness(view), "one", "csv");
  await selecting;
  await assert.rejects(exporting, /selected table changed/);
  assert.equal(calls.length, 0);
});
it("rejects incoherent native export revisions", async () => {
  const { runtime, view, client } = await setup();
  client.exportNativeTablesSpreadsheet = async () => ({ revision: "r2", bytes: new ArrayBuffer(0), ledger: [] });
  await assert.rejects(runtime.exportNativeTables(witness(view), "one", "xlsx"), /prepared export/);
});
for (const code of ["native_tables_export_refused", "stale_revision"]) it(`preserves ${code} and resident state`, async () => {
  const { runtime, view, client } = await setup();
  const error = new FakeDesignerRuntimeError({ code, diagnostics: [{ path: "one/A1", message: "Unsupported value" }] });
  client.exportNativeTablesSpreadsheet = async () => { throw error; };
  await assert.rejects(runtime.exportNativeTables(witness(view), "one", "csv"), candidate => candidate === error);
  assert.deepEqual(await runtime.read(), view);
});
it("rejects an in-flight native export when closed", async () => {
  const { runtime, view, client } = await setup();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const original = client.exportNativeTablesSpreadsheet;
  client.exportNativeTablesSpreadsheet = async (...args) => { entered(); await hold; return original(...args); };
  const request = runtime.exportNativeTables(witness(view), "one", "csv");
  await ready; await runtime.close(); release();
  await assert.rejects(request, /session closed/);
});

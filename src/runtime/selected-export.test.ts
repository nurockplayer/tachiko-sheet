/** Injected-client unit evidence only; no real WASM or browser acceptance. */
import assert from "node:assert/strict";
import { it } from "vitest";
import type { CoreKit, InteropMetadata, ViewWitness } from "../contracts.js";
import { createSheetRuntime } from "./session.js";

const sheets = [
  { id: "schema-first", key: "first", entity_count: 1 },
  { id: "schema-second", key: "second", entity_count: 1 },
];
const metadata: InteropMetadata = {
  version: 1,
  sheets: sheets.map((sheet) => ({ schema_id: sheet.id, name: sheet.key, has_header: true, columns: [], rows: [] })),
};
const witness = (view: ViewWitness): ViewWitness => ({ occurrence: view.occurrence, revision: view.revision });

class FakeDesignerRuntimeError extends Error {
  constructor(readonly failure: { code: string; diagnostics: Array<{ path: string; message: string }> }) { super("Refused"); }
}

async function setup() {
  let revision = "r1";
  let scope = "occurrence-1";
  let listed = [...sheets];
  let exportedRevision: string | undefined;
  const calls: Array<{ revision: string; metadata: InteropMetadata; format: string; schema: string }> = [];
  const client = {
    observeOccurrence: async () => ({ scope, revision }),
    openProject: async () => ({}),
    closeProject: async () => undefined,
    bootstrap: async () => ({ title: "Two sheets", revision, default_collection: "first", collections: listed }),
    queryTable: async (key: string) => ({ revision, collection: sheets.find((sheet) => sheet.key === key)!, columns: [], rows: [] }),
    exportSpreadsheet: async (expected: string, incoming: InteropMetadata, format: string, schema: string) => {
      calls.push({ revision: expected, metadata: incoming, format, schema });
      return { revision: exportedRevision ?? expected, bytes: new Uint8Array([1, 2]).buffer, ledger: [] };
    },
  };
  const kit = {
    DesignerRuntimeError: FakeDesignerRuntimeError,
    createExperimentalDesignerClient: () => client,
    preflightCanonicalProjectEntries: () => undefined,
    projectTransferFromEntries: () => new ArrayBuffer(0),
  } as unknown as CoreKit;
  const runtime = createSheetRuntime(async () => kit);
  const first = await runtime.openCanonical([]);
  return { runtime, first, calls, client,
    setRevision: (next: string) => { revision = next; },
    setScope: (next: string) => { scope = next; },
    setCollections: (next: typeof sheets) => { listed = next; },
    setExportedRevision: (next: string) => { exportedRevision = next; },
  };
}

it("preserves an imported-layout refusal, its metadata and resident work without native fallback", async () => {
  const { runtime, first, client } = await setup();
  const originalMetadata = structuredClone(metadata);
  const error = new FakeDesignerRuntimeError({ code: "imported_spreadsheet_export_refused", diagnostics: [{ path: "workbook", message: "Foreign mapping" }] });
  let importedCalls = 0;
  client.exportSpreadsheet = async () => { importedCalls++; throw error; };
  // The fake client intentionally has no native export capability: any silent
  // fallback would replace this exact error with a missing-capability failure.
  await assert.rejects(runtime.exportSpreadsheet(witness(first), metadata, "csv"), candidate => candidate === error);
  assert.equal(importedCalls, 1);
  assert.deepEqual(await runtime.read(), first);
  assert.deepEqual(metadata, originalMetadata);
});

it("exports the selected second table by stable schema ID, not metadata order or display key", async () => {
  const { runtime, first, calls } = await setup();
  const second = await runtime.selectCollection(witness(first), "second");
  await runtime.exportSpreadsheet(witness(second), metadata, "csv");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].schema, "schema-second");
  assert.equal(calls[0].metadata, metadata);
  assert.equal(calls[0].revision, "r1");
});

it("keeps first-table and single-sheet CSV controls working", async () => {
  for (const incoming of [metadata, { ...metadata, sheets: [metadata.sheets[0]] }]) {
    const { runtime, first, calls } = await setup();
    await runtime.exportSpreadsheet(witness(first), incoming, "csv");
    assert.equal(calls[0].schema, "schema-first");
  }
});

it("does not use reordered metadata or sheet names as selection", async () => {
  const { runtime, first, calls } = await setup();
  const incoming = { ...metadata, sheets: [...metadata.sheets].reverse().map((sheet) => ({ ...sheet, name: "same display name" })) };
  await runtime.exportSpreadsheet(witness(first), incoming, "csv");
  assert.equal(calls[0].schema, "schema-first");
});

it("leaves XLSX full-workbook dispatch unchanged after second-table selection", async () => {
  const { runtime, first, calls } = await setup();
  const second = await runtime.selectCollection(witness(first), "second");
  await runtime.exportSpreadsheet(witness(second), metadata, "xlsx");
  assert.equal(calls[0].format, "xlsx");
  assert.equal(calls[0].schema, "schema-first");
  assert.equal(calls[0].metadata.sheets.length, 2);
});

it("refuses an unmapped selected table before exporting", async () => {
  const { runtime, first, calls } = await setup();
  const second = await runtime.selectCollection(witness(first), "second");
  await assert.rejects(runtime.exportSpreadsheet(witness(second), { ...metadata, sheets: [metadata.sheets[0]] }, "csv"), /no unique imported-source/);
  assert.equal(calls.length, 0);
});

it("refuses duplicate metadata bindings instead of selecting the first", async () => {
  const { runtime, first, calls } = await setup();
  await assert.rejects(runtime.exportSpreadsheet(witness(first), { ...metadata, sheets: [metadata.sheets[0], metadata.sheets[0]] }, "csv"), /no unique imported-source/);
  assert.equal(calls.length, 0);
});

for (const [label, listed] of [
  ["missing", [sheets[1]]],
  ["ambiguous", [sheets[0], { ...sheets[1], key: sheets[0].key }]],
  ["empty stable identity", [{ ...sheets[0], id: "" }]],
] as const) {
  it(`refuses a ${label} authoritative selection before exporting`, async () => {
    const { runtime, first, calls, setCollections } = await setup();
    setCollections([...listed]);
    await assert.rejects(runtime.exportSpreadsheet(witness(first), metadata, "csv"), /no unique imported-source/);
    assert.equal(calls.length, 0);
  });
}

it("refuses a stale authoritative catalog without exporting or replacing the resident work", async () => {
  const { runtime, first, calls, setRevision } = await setup();
  setRevision("r2");
  await assert.rejects(runtime.exportSpreadsheet(witness(first), metadata, "csv"), /export table catalog/);
  assert.equal(calls.length, 0);
  assert.equal((await runtime.read()).occurrence, first.occurrence);
});

it("refuses an old view witness before dispatch", async () => {
  const { runtime, first, calls } = await setup();
  await assert.rejects(runtime.exportSpreadsheet({ ...witness(first), revision: "old" }, metadata, "csv"), /witness does not match/);
  assert.equal(calls.length, 0);
});

it("refuses a CSV request queued behind a changed table selection", async () => {
  const { runtime, first, calls } = await setup();
  const selection = runtime.selectCollection(witness(first), "second");
  const exportRequest = runtime.exportSpreadsheet(witness(first), metadata, "csv");
  await selection;
  await assert.rejects(exportRequest, /selected table changed/);
  assert.equal(calls.length, 0);
});

it("rejects an export reply from a different revision", async () => {
  const { runtime, first, calls, setExportedRevision } = await setup();
  setExportedRevision("r2");
  await assert.rejects(runtime.exportSpreadsheet(witness(first), metadata, "csv"), /prepared export/);
  assert.equal(calls.length, 1);
});

it("does not export after the session closes during catalog resolution", async () => {
  const { runtime, first, calls, client } = await setup();
  const readCatalog = client.bootstrap;
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  client.bootstrap = async () => { entered(); await pending; return readCatalog(); };
  const request = runtime.exportSpreadsheet(witness(first), metadata, "csv");
  await ready;
  await runtime.close();
  release();
  await assert.rejects(request, /session closed/);
  assert.equal(calls.length, 0);
});

it("resolves the selected table after a saved-copy open without retaining old occurrence selection", async () => {
  const { runtime, first, calls, setScope } = await setup();
  const second = await runtime.selectCollection(witness(first), "second");
  setScope("reopened-occurrence");
  const reopened = await runtime.openCanonical([]);
  await assert.rejects(runtime.exportSpreadsheet(witness(second), metadata, "csv"), /witness does not match/);
  const selected = await runtime.selectCollection(witness(reopened), "second");
  await runtime.exportSpreadsheet(witness(selected), metadata, "csv");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].schema, "schema-second");
});

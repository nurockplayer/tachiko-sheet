// #146 acceptance-only seed: real pinned Worker/WASM fixture and adapter prerequisites.
// Direct invocation (existing isolated acceptance server on port 4786):
//   SAVE_CLOSURE_ORIGIN=http://127.0.0.1:4786 SAVE_CLOSURE_PREP=/absolute/checkout/acceptance/web-save-closure SAVE_CLOSURE_RECEIPT=/tmp/146-prerequisites.json node tests/product/web-save-closure-prerequisites.mjs
// The server must be started separately with SAVE_CLOSURE_DIST=dist-acceptance node acceptance/web-save-closure/serve.mjs.
// Do not use disk route fulfillment. This seed imports the real served producer and exact-source adapter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prep = path.resolve(process.env.SAVE_CLOSURE_PREP ?? path.join(root, "acceptance/web-save-closure"));
const origin = process.env.SAVE_CLOSURE_ORIGIN;
const receiptPath = process.env.SAVE_CLOSURE_RECEIPT;
assert.ok(origin, "BLOCKED: set SAVE_CLOSURE_ORIGIN to the already-running acceptance server");
assert.ok(receiptPath, "BLOCKED: set SAVE_CLOSURE_RECEIPT to an owned receipt path");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourcePins = {
  "product.ego.mjs": "491dcdec089cbad1b71f442b83752b6c595c396317738770403c6b8c9e91d530",
  "qualify-kit.ego.mjs": "0d3c3214a15afefdaf480e780663e56f0dac224478dbc7a86c635099cf583e91",
  "adapter.ego.mjs": "061c8a4701355685d442fe658d31491d3a7359de302421cda6446fea5983aa1a",
  "../..:tests/product/home-entry.mjs": "bd6336b4938eb9b023eb70a1441d9e9a4523bb9d84483f6a5f536ea84a04d5e6",
};
const fixturePins = {
  "date-only.csv": "7be5f6fad559bc4f70acab457bb34ee82161b47c30767343cc317e96663440e5",
  "unrelated-date.xlsx": "5c48a7fde664b7e230fe4cd773cb08c3c8e18a32c28c0cbfc204aa06953d0cfa",
  "unrelated-date-empty.xlsx": "5dc99efd900e0afc94da1853ef48de095fc61f3ea590c78725b7c8c5ca637e8f",
  "date-only-private.bin": "2ecbb31f59c39550ff856a61c69af11ed0ea4c3ebd89b26ba19fe3d54608dec9",
  "date-only-private.json": "1312dabec0cfb6b8cbf38f6239478198b6e94bdf55b0c09c9e90e04490ee89b0",
};
for (const [file, expected] of Object.entries(sourcePins)) {
  const target = file.startsWith("../..:") ? path.join(root, file.slice(6)) : path.join(prep, file);
  assert.equal(sha256(await readFile(target)), expected, `immutable source drift: ${file}`);
}
for (const [file, expected] of Object.entries(fixturePins)) {
  assert.equal(sha256(await readFile(path.join(prep, "fixtures", file))), expected, `frozen fixture drift: ${file}`);
}

const cases = [
  "KIT-date-only-csv",
  "KIT-unrelated-populated-date-xlsx",
  "KIT-unrelated-empty-date-schema-xlsx",
  "ADAPTER-stale-witness",
  "ADAPTER-stale-bootstrap",
  "ADAPTER-stale-table",
  "ADAPTER-unavailable-unrelated-table",
];
const timeout = Number(process.env.SAVE_CLOSURE_TIMEOUT_MS ?? 15000);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(timeout);
const diagnostics = { pageErrors: [], requestFailures: [] };
page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
page.on("requestfailed", (request) => diagnostics.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  const response = await page.goto(new URL("/qualification.html", origin).href, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, "BLOCKED: existing qualification route unavailable");
  const result = await page.evaluate(async () => {
    const kit = await import("/core-kit/experimental-client.js");
    const { createSheetRuntime } = await import("/prep/.generated/runtime/session.js");
    const rows = (table) => table.rows.map((row) => ({ key: row.key, fields: row.fields.map((field) => ({ field: field.target.field, stored: field.stored })) }));
    const normalized = (table) => ({ collection: { id: table.collection.id, key: table.collection.key }, columns: table.columns.map((column) => ({ id: column.id, key: column.key, type: column.field_type })), rows: table.rows.map((row) => ({ id: row.id, ...rows({ rows: [row] })[0] })) });
    const receipts = [];
    for (const [id, name, format, types] of [
      ["KIT-date-only-csv", "date-only.csv", "csv", [["text", "text", "number", "number", "date"]]],
      ["KIT-unrelated-populated-date-xlsx", "unrelated-date.xlsx", "xlsx", [["text", "number"], ["text", "text", "number"], ["date"]]],
      ["KIT-unrelated-empty-date-schema-xlsx", "unrelated-date-empty.xlsx", "xlsx", [["text", "number"], ["text", "text", "number"], ["date"]]],
    ]) {
      const client = kit.createExperimentalDesignerClient();
      try {
        const bytes = await (await fetch(`/prep/fixtures/${name}`)).arrayBuffer();
        const inspection = await client.inspectSpreadsheet(bytes, format, { delimiter: ",", header: true });
        const imported = await client.importSpreadsheet(bytes, format, { delimiter: ",", header: true }, { column_types: types, extra_columns: types.map(() => []) });
        const beforeOccurrence = await client.observeOccurrence();
        const beforeBoot = await client.bootstrap();
        const before = [];
        for (const collection of beforeBoot.collections) before.push({ key: collection.key, table: normalized(await client.queryTable(collection.key)) });
        const exported = await client.exportProject(beforeBoot.revision);
        await client.inspectImportedProject(exported.bytes.slice(0), imported.metadata);
        await client.closeProject();
        await client.openProject(exported.bytes.slice(0));
        const afterOccurrence = await client.observeOccurrence();
        const afterBoot = await client.bootstrap();
        const after = [];
        for (const collection of afterBoot.collections) after.push({ key: collection.key, table: normalized(await client.queryTable(collection.key)) });
        receipts.push({ id, sourceSheets: inspection.sheets.map((sheet) => [sheet.name, sheet.columns.length, sheet.rows.length]), beforeOccurrence, afterOccurrence, before, after, metadata: imported.metadata, ledger: imported.ledger });
      } finally { client.close(); }
    }
    const adapter = [];
    for (const fault of ["stale-witness", "stale-bootstrap", "stale-table", "unavailable-unrelated-table"]) {
      const client = kit.createExperimentalDesignerClient();
      let armed = false;
      let creates = 0;
      const proxy = new Proxy(client, { get(target, key) {
        const value = target[key];
        if (typeof value !== "function") return value;
        return async (...args) => {
          if (key === "createKeyedGroupedSum") creates++;
          const reply = await value.apply(target, args);
          if (armed && key === "bootstrap" && fault === "stale-bootstrap") return { ...reply, revision: "unrelated-stale-revision" };
          if (armed && key === "queryTable" && args[0] === "sheet_3" && fault === "unavailable-unrelated-table") throw Error("Bounded transport read unavailable: unrelated Date collection");
          if (armed && key === "queryTable" && fault === "stale-table") return { ...reply, revision: "unrelated-stale-revision" };
          return reply;
        };
      } });
      const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => proxy }));
      try {
        const source = await (await fetch("/prep/fixtures/unrelated-date.xlsx")).arrayBuffer();
        const imported = await runtime.importSpreadsheet(source, "xlsx", { delimiter: ",", header: true }, { column_types: [["text", "number"], ["text", "text", "number"], ["date"]], extra_columns: [[], [], []] });
        const witness = { occurrence: imported.view.occurrence, revision: imported.view.revision };
        const catalog = await runtime.listKeyedGroupedSumBindings(witness);
        const before = await runtime.exportOpaque(witness);
        armed = true;
        let error;
        try {
          const maybeStale = fault === "stale-witness" ? { ...witness, occurrence: "not-live" } : witness;
          await runtime.createKeyedGroupedSum(maybeStale, { ordersCollection: "sheet_1", orderLookupKeyField: "column_1", orderQuantityField: "column_2", productsCollection: "sheet_2", productKeyField: "column_1", productCategoryField: "column_2", productPriceField: "column_3" });
        } catch (caught) { error = { name: caught.name, message: caught.message }; }
        armed = false;
        const after = await runtime.exportOpaque(witness);
        adapter.push({ id: `ADAPTER-${fault}`, error, creates, catalog, beforeHash: await crypto.subtle.digest("SHA-256", before.bytes).then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")), afterHash: await crypto.subtle.digest("SHA-256", after.bytes).then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")), beforeRevision: before.revision, afterRevision: after.revision });
      } finally { await runtime.close(); client.close(); }
    }
    return { kit: receipts, adapter };
  });
  const expectedKit = [
    { id: cases[0], sheets: [["Imported table", 5, 2]], types: [["text", "text", "number", "number", "date"]], values: [["PEN", "Stationery", 4, 200, "2026-09-26"], ["NOTE", "Paper", 5, 200, "2026-09-27"]] },
    { id: cases[1], sheets: [["sales", 2, 2], ["catalog", 3, 2], ["dates", 1, 1]], types: [["text", "number"], ["text", "text", "number"], ["date"]], values: [[ ["PEN", 4], ["NOTE", 5] ], [ ["PEN", "Stationery", 200], ["NOTE", "Paper", 200] ], [["2026-09-26"]]] },
    { id: cases[2], sheets: [["sales", 2, 2], ["catalog", 3, 2], ["dates", 1, 0]], types: [["text", "number"], ["text", "text", "number"], ["date"]], values: [[ ["PEN", 4], ["NOTE", 5] ], [ ["PEN", "Stationery", 200], ["NOTE", "Paper", 200] ], []] },
  ];
  for (const [index, expected] of expectedKit.entries()) {
    const actual = result.kit[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.sourceSheets, expected.sheets);
    assert.deepEqual(actual.before.map((collection) => collection.table.columns.map((column) => column.type)), expected.types);
    const actualRows = actual.before.map((collection) => collection.table.rows.map((row) => row.fields.map((field) => field.stored.value)));
    assert.deepEqual(actualRows, index === 0 ? [expected.values] : expected.values);
    const sourceSheets = actual.metadata.sheets;
    assert.deepEqual(actual.before.map((collection) => collection.table.collection.id), sourceSheets.map((sheet) => sheet.schema_id), `${actual.id}: source schema IDs bind to core collections`);
    assert.deepEqual(actual.before.map((collection) => collection.table.columns.map((column) => column.id)), sourceSheets.map((sheet) => sheet.columns.map((column) => column.field_id)), `${actual.id}: source field IDs bind to core columns`);
    assert.deepEqual(actual.before.map((collection) => collection.table.rows.map((row) => row.id)), sourceSheets.map((sheet) => sheet.rows.map((row) => row.entity_id)), `${actual.id}: source entity IDs bind to core rows`);
    assert.deepEqual(actual.after, actual.before, `${actual.id}: entire inventory/types/rows/IDs retained after core close/open`);
    assert.equal(typeof actual.beforeOccurrence.scope, "string");
    assert.notEqual(actual.afterOccurrence.scope, actual.beforeOccurrence.scope, `${actual.id}: fresh occurrence after core close/open`);
  }
  for (const actual of result.adapter) {
    assert.ok(actual.error, `${actual.id}: read fault must refuse`);
    assert.equal(actual.creates, 0, `${actual.id}: no Create dispatch`);
    assert.equal(actual.beforeHash, actual.afterHash, `${actual.id}: whole core bytes unchanged`);
    assert.equal(actual.beforeRevision, actual.afterRevision, `${actual.id}: revision unchanged`);
    assert.ok(actual.catalog.collections.some((collection) => collection.fields.some((field) => field.fieldType === "date")));
  }
  assert.deepEqual([...result.kit.map((item) => item.id), ...result.adapter.map((item) => item.id)], cases);
  assert.deepEqual(diagnostics.pageErrors, [], "browser page errors during prerequisite qualification");
  const receipt = { status: "PASS", boundary: "real pinned Worker/WASM fixtures and exact-source adapter read faults; prerequisites only, not product UI Save evidence", base: "375d25ea12262bec32e2303b3c63662f0b69322f", origin, browserVersion: browser.version(), cases, result, diagnostics };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, cases, browserVersion: receipt.browserVersion, receipt: receiptPath }, null, 2));
} catch (error) {
  const receipt = { status: "BLOCKED_OR_FAIL", boundary: "prerequisite seed execution; classify infrastructure separately from fixed assertion failures", origin, browserVersion: browser.version(), cases, error: { name: error.name, message: error.message, stack: error.stack }, diagnostics };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  throw error;
} finally { await context.close(); await browser.close(); }

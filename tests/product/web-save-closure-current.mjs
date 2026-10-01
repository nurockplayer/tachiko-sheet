// #146 acceptance-only seed, candidate mode only. Historical #118 files and receipts stay immutable.
// Direct invocation: SAVE_CLOSURE_ORIGIN=http://127.0.0.1:4786 SAVE_CLOSURE_PREP=/absolute/checkout/acceptance/web-save-closure SAVE_CLOSURE_RECEIPT=/tmp/146-current.json node tests/product/web-save-closure-current.mjs
// Start the existing isolated server first: SAVE_CLOSURE_DIST=dist-acceptance node acceptance/web-save-closure/serve.mjs
// Mechanical adaptation ledger: start at normal cold Home; use current Open/import and saved-copy controls;
// open command overflow before Close; replace retired E warm-up with visible release-plan example + Close;
// bind result rows by category/value cells; keep original frozen UI cases, values, real-kit counters and faults.
// No runtime calls perform product actions. __tachikoAcceptance is used only for read-only counters/snapshots
// and the existing F read-fault control. R alone inserts the frozen private record for reader compatibility.
// Current-source GREEN qualification is this complete 11-case candidate run after prerequisite PASS; the old
// ego packet's baseline mode is a distinct historical command and is not product acceptance.
// Disposable one-fault-at-a-time RED instructions after clean GREEN: M1 omit hasDateColumn in App.createCopy's
// opaque-selection decision and require A to reject the false canonical Date Save/reopen; M2 remove both App and
// runtime Date guards and require B/C/C-empty to detect producer Create or changed whole-work state; M3 scope both
// guards to selected tables and require C; M4 ignore only the empty Date schema and require C-empty; M5a rewrite
// accepted Date import to Text and require A's real editDate/kind oracle to reject; M5b omit importedSource only
// from Date opaque Save and require source hash/metadata/ledger assertions to reject. Run each in a disposable
// exact-base copy after GREEN, record patch/hash and assertion, then restore pristine product files and rerun.
// Setup/transport/selector errors stay BLOCKED; masked one-layer mutations are not required RED.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prep = path.resolve(process.env.SAVE_CLOSURE_PREP ?? path.join(root, "acceptance/web-save-closure"));
const origin = process.env.SAVE_CLOSURE_ORIGIN;
const receiptPath = process.env.SAVE_CLOSURE_RECEIPT;
const mode = process.env.SAVE_CLOSURE_MODE ?? "candidate";
assert.equal(mode, "candidate", "this current-entry seed runs only in candidate mode; baseline outcomes belong to the immutable #118 ego packet");
assert.ok(origin, "BLOCKED: set SAVE_CLOSURE_ORIGIN to the existing acceptance server");
assert.ok(receiptPath, "BLOCKED: set SAVE_CLOSURE_RECEIPT to an owned receipt path");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sourcePins = {
  "acceptance/web-save-closure/product.ego.mjs": "491dcdec089cbad1b71f442b83752b6c595c396317738770403c6b8c9e91d530",
  "acceptance/web-save-closure/qualify-kit.ego.mjs": "0d3c3214a15afefdaf480e780663e56f0dac224478dbc7a86c635099cf583e91",
  "acceptance/web-save-closure/adapter.ego.mjs": "061c8a4701355685d442fe658d31491d3a7359de302421cda6446fea5983aa1a",
  "tests/product/home-entry.mjs": "bd6336b4938eb9b023eb70a1441d9e9a4523bb9d84483f6a5f536ea84a04d5e6",
};
const fixturePins = {
  "date-only.csv": "7be5f6fad559bc4f70acab457bb34ee82161b47c30767343cc317e96663440e5",
  "unrelated-date.xlsx": "5c48a7fde664b7e230fe4cd773cb08c3c8e18a32c28c0cbfc204aa06953d0cfa",
  "unrelated-date-empty.xlsx": "5dc99efd900e0afc94da1853ef48de095fc61f3ea590c78725b7c8c5ca637e8f",
  "date-only-private.bin": "2ecbb31f59c39550ff856a61c69af11ed0ea4c3ebd89b26ba19fe3d54608dec9",
  "date-only-private.json": "1312dabec0cfb6b8cbf38f6239478198b6e94bdf55b0c09c9e90e04490ee89b0",
  "rows-64.csv": "494c650dc55391a804b5479c64236bc7e05f9fb13c39cc0bd5c835ce66672c07",
  "fields-16.csv": "77424cc5b9161699a2557bf8c099e0c5541e5a8bb7dfc9d6fee3dd9d709bc8cb",
  "rows-65.csv": "7fc5607116678d087679941cfc43693c2b4c90060eca030cde5817ffc5c6ee75",
  "fields-17.csv": "4139cce2a9cdc211b4035a727ef125742fcd1459bae2ab3232616561831397e4",
};
for (const [file, expected] of Object.entries(sourcePins)) assert.equal(sha256(await readFile(path.join(root, file))), expected, `immutable source drift: ${file}`);
for (const [file, expected] of Object.entries(fixturePins)) assert.equal(sha256(await readFile(path.join(prep, "fixtures", file))), expected, `frozen fixture drift: ${file}`);
const xlsxPrerequisite = await readFile(path.join(prep, "evidence/kit-prerequisite.json"));
assert.equal(sha256(xlsxPrerequisite), "df1ec709c3fad46b8b500aa4db073beed75e7640c67f12469f4d35727f691481", "immutable real-kit XLSX metadata/ledger expected-data reference");
const xlsxFixed = JSON.parse(xlsxPrerequisite).result;

const expectedCases = [
  "A-Date-only-normal-Save-fresh-reopen",
  "B-same-table-Date-summary-refusal",
  "C-unrelated-Date-summary-refusal",
  "C-empty-unrelated-Date-schema-refusal",
  "D-canonical-opaque-complete-copy-controls",
  "E-CSV64-row-control",
  "E-CSV16-column-control",
  "E-profile-refusal-rows-65.csv",
  "E-profile-refusal-fields-17.csv",
  "F-existing-read-fault-no-publication-recovery",
  "R-unchanged-private-reader-Date-fixture",
];
const sourceAttribution = {
  originalProductSha256: sourcePins["acceptance/web-save-closure/product.ego.mjs"],
  originalKitSha256: sourcePins["acceptance/web-save-closure/qualify-kit.ego.mjs"],
  originalAdapterSha256: sourcePins["acceptance/web-save-closure/adapter.ego.mjs"],
  homeEntryHelperSha256: sourcePins["tests/product/home-entry.mjs"],
  expectedCases,
};
const timeout = Number(process.env.SAVE_CLOSURE_TIMEOUT_MS ?? 20000);
const profileRoot = await mkdtemp(path.join(os.tmpdir(), "tachiko-146-current-"));
const launchOptions = { headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) };
const prefix = `sheet146-${Date.now()}-${process.pid}`;
const results = [];
const environment = { node: process.version, platform: process.platform, arch: process.arch, origin, mode, profileRoot };
let activeContext;
let activePage;
const diagnostics = { pageErrors: [], requestFailures: [], consoleErrors: [] };

async function start() {
  const profile = await mkdtemp(path.join(profileRoot, "case-"));
  activeContext = await chromium.launchPersistentContext(profile, launchOptions);
  activePage = activeContext.pages()[0] ?? await activeContext.newPage();
  activePage.setDefaultTimeout(timeout);
  activePage.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  activePage.on("requestfailed", (request) => diagnostics.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  activePage.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(message.text()); });
  await activePage.goto(origin, { waitUntil: "domcontentloaded" });
  await waitForColdHome(activePage);
  await activePage.getByText("Choose file…", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await activePage.getByTestId("project-ready").count(), 0, "cold Home must precede Open/import");
  assert.equal(await activePage.getByTestId("currentness").count(), 0, "cold Home has no workbook currentness");
}
async function waitForColdHome(page) {
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByTestId("currentness").count(), 0);
}
async function home() {
  if (!activePage) return;
  if (await activePage.locator(".ts-modal--save").count()) await activePage.locator(".ts-modal--save").getByRole("button", { name: "Cancel", exact: true }).click();
  if (await activePage.locator(".ts-modal--import").count()) await activePage.locator(".ts-modal--import").getByRole("button", { name: "Cancel", exact: true }).click();
  const close = activePage.getByRole("button", { name: "Close project", exact: true });
  if (await close.count()) {
    if (!await close.isVisible()) await activePage.locator('.ts-command-overflow > summary[aria-label="More document commands"]').click();
    await close.click();
    const without = activePage.getByRole("button", { name: "Close without saving", exact: true });
    if (await without.count()) await without.click();
  }
}
async function finishCase() {
  await home().catch(() => {});
  if (activeContext) await activeContext.close().catch(() => {});
  activeContext = undefined;
  activePage = undefined;
}
async function importFile(file, types = []) {
  const input = activePage.locator('input[type="file"][accept*=".csv"]');
  await input.setInputFiles(path.join(prep, "fixtures", file));
  await activePage.locator(".ts-modal--import").waitFor();
  for (let i = 0; i < types.length; i++) await activePage.locator(".ts-import-column select").nth(i).selectOption(types[i]);
  await activePage.getByRole("button", { name: "Import candidate", exact: true }).click();
  await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
}
async function readView() {
  return activePage.evaluate(() => ({
    cells: [...document.querySelectorAll('table[aria-label="Table"] tbody tr')].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)),
    witness: (() => { const element = document.querySelector("[data-work-occurrence]"); return element && { occurrence: element.getAttribute("data-work-occurrence"), revision: element.getAttribute("data-work-revision") }; })(),
    currentness: document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness"),
    save: document.querySelector('[data-testid="save-status"]')?.textContent,
    body: document.body.innerText,
  }));
}
async function snapshot() { return activePage.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()); }
async function counts() { return activePage.evaluate(() => window.__tachikoAcceptance.workMethodCounts()); }
async function editDate(value) {
  const before = await counts();
  await activePage.locator('table[aria-label="Table"] tbody tr:first-child td:nth-of-type(5)').dblclick();
  const editor = activePage.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill(value);
  await editor.press("Enter");
  await activePage.waitForFunction((wanted) => document.querySelector('table[aria-label="Table"] tbody tr:first-child td:nth-of-type(5)')?.textContent === wanted, value);
  assert.equal((await counts()).editDate ?? 0, (before.editDate ?? 0) + 1, "Date edit must reach real producer editDate exactly once");
}
async function visibleSourceLedger() {
  await activePage.getByRole("tab", { name: "Import & export", exact: true }).click();
  const ledger = activePage.getByRole("region", { name: "Source fidelity ledger", exact: true });
  await ledger.waitFor();
  const text = await ledger.innerText();
  await activePage.getByRole("tab", { name: "Table", exact: true }).click();
  return text;
}
async function saveCopy(name) {
  await activePage.getByRole("button", { name: "Save a copy", exact: true }).click();
  await activePage.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
  await activePage.getByRole("button", { name: "Create copy", exact: true }).click();
  await activePage.waitForFunction(() => {
    const save = document.querySelector('[data-testid="save-status"]')?.textContent?.trim();
    return save === "Save failed" || (save === "Saved on this device" && !document.querySelector(".ts-modal--save"));
  });
  const save = (await readView()).save?.trim() ?? "";
  assert.equal(save, "Saved on this device", "Save a copy must succeed and close the current Save dialog");
  assert.doesNotMatch(save, /pending|failed/i);
}
async function openSaved(name) {
  await home();
  await activePage.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
  await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
}
async function savedRecord(name) {
  return activePage.evaluate(async (copyName) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("tachiko-sheet-local-copies"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const records = [];
      for (const store of ["copies", "opaque-copies"]) {
        const row = await new Promise((resolve, reject) => { const request = db.transaction(store, "readonly").objectStore(store).get(copyName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        if (row) records.push({ store, row });
      }
      if (records.length !== 1) throw Error(`expected exactly one saved record, observed ${records.length}`);
      const { store, row } = records[0];
      const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const encode = async (value) => {
        if (value === undefined) return { $type: "undefined" };
        if (value === null || typeof value !== "object") return value;
        if (value instanceof ArrayBuffer) return { $type: "ArrayBuffer", base64: btoa(String.fromCharCode(...new Uint8Array(value))) };
        if (ArrayBuffer.isView(value)) return { $type: value.constructor.name, base64: btoa(String.fromCharCode(...new Uint8Array(value.buffer, value.byteOffset, value.byteLength))) };
        if (value instanceof Blob) return { $type: "Blob", mimeType: value.type, base64: btoa(String.fromCharCode(...new Uint8Array(await value.arrayBuffer()))) };
        if (value instanceof Date) return { $type: "Date", iso: value.toISOString() };
        if (Array.isArray(value)) return Promise.all(value.map(encode));
        return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async (key) => [key, await encode(value[key])])));
      };
      return { store, envelope: await encode(row), kind: row.kind, name: row.name, savedAt: row.savedAt, revision: row.revision, bytes: row.bytes, coreHash: row.bytes ? await hash(row.bytes) : null, source: row.importedSource ? { name: row.importedSource.name, format: row.importedSource.format, sha256: await hash(row.importedSource.bytes), metadata: row.importedSource.metadata, ledger: row.importedSource.ledger } : null, presentation: row.presentation ?? null };
    } finally { db.close(); }
  }, name);
}
function normalizeFreshImportIds(value) {
  if (Array.isArray(value)) return value.map(normalizeFreshImportIds);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["schema_id", "field_id", "entity_id"].includes(key)).map(([key, item]) => [key, normalizeFreshImportIds(item)]));
  return value;
}
function assertMetadataToCoreReferences(metadata, inventory) {
  const sheets = metadata.sheets;
  assert.deepEqual(inventory.map((table) => table.collectionId), sheets.map((sheet) => sheet.schema_id), "source schema IDs remain bound to producer collection IDs");
  assert.deepEqual(inventory.map((table) => table.columns.map((column) => column.id)), sheets.map((sheet) => sheet.columns.map((column) => column.field_id)), "source field IDs remain bound to producer field IDs");
  assert.deepEqual(inventory.map((table) => table.rows.map((row) => row.id)), sheets.map((sheet) => sheet.rows.map((row) => row.entity_id)), "source entity IDs remain bound to producer row IDs");
}
async function inspectSavedDateRecord(name, expectedFirstDate) {
  const record = await savedRecord(name);
  assert.equal(record.kind, "opaque");
  assert.equal(record.source?.name, "date-only.csv");
  assert.equal(record.source?.format, "csv");
  assert.equal(record.source?.sha256, fixturePins["date-only.csv"]);
  const fixedSource = JSON.parse(await readFile(path.join(prep, "fixtures/date-only-private.json"), "utf8"));
  assert.deepEqual(normalizeFreshImportIds(record.source.metadata), normalizeFreshImportIds(fixedSource.metadata));
  assert.deepEqual(record.source.ledger, fixedSource.ledger);
  const core = await inspectSavedCore(name, record.source.metadata);
  assert.deepEqual(core.inventory.map((table) => table.columns.map((column) => column.type)), [["text", "text", "number", "number", "date"]]);
  assertMetadataToCoreReferences(record.source.metadata, core.inventory);
  assert.deepEqual(core.inventory.map((table) => table.rows.map((row) => row.fields.map((field) => field.value))), [[["PEN", "Stationery", 4, 200, expectedFirstDate], ["NOTE", "Paper", 5, 200, "2026-09-27"]]]);
  assert.deepEqual(core.inventory[0].rows.map((row) => row.fields.map((field) => field.kind)), [["text", "text", "number", "number", "date"], ["text", "text", "number", "number", "date"]]);
  return { record: { ...record, bytes: undefined }, core };
}
async function inspectSavedCore(name, metadata) {
  // Independent real-producer inspection/query uses a separate observation client.
  return activePage.evaluate(async ({ name: copyName, sourceMetadata }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("tachiko-sheet-local-copies"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const row = await new Promise((resolve, reject) => { const request = db.transaction("opaque-copies", "readonly").objectStore("opaque-copies").get(copyName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close();
    const kit = await import("/core-kit/experimental-client.js");
    const client = kit.createExperimentalDesignerClient();
    try {
      await client.inspectImportedProject(row.bytes.slice(0), sourceMetadata);
      await client.openProject(row.bytes.slice(0));
      const inventory = [];
      for (const collection of (await client.bootstrap()).collections) {
        const table = await client.queryTable(collection.key);
        inventory.push({ collectionId: table.collection.id, key: collection.key, columns: table.columns.map((column) => ({ id: column.id, key: column.key, type: column.field_type })), rows: table.rows.map((item) => ({ id: item.id, key: item.key, fields: item.fields.map((field) => ({ entity: field.target.entity, field: field.target.field, kind: field.stored.kind, value: field.stored.value })) })) });
      }
      return { inventory };
    } finally { client.close(); }
  }, { name, sourceMetadata: metadata });
}
function fixedCoreOracle(file, firstDate = "2026-09-26") {
  if (file === "date-only.csv") return [{ key: "sheet_1", types: ["text", "text", "number", "number", "date"], rows: [["PEN", "Stationery", 4, 200, firstDate], ["NOTE", "Paper", 5, 200, "2026-09-27"]] }];
  const dates = file.includes("empty") ? [] : [["2026-09-26"]];
  return [
    { key: "sheet_1", types: ["text", "number"], rows: [["PEN", 4], ["NOTE", 5]] },
    { key: "sheet_2", types: ["text", "text", "number"], rows: [["PEN", "Stationery", 200], ["NOTE", "Paper", 200]] },
    { key: "sheet_3", types: ["date"], rows: dates },
  ];
}
function assertFixedCoreInventory(file, inventory, metadata, firstDate) {
  const fixed = fixedCoreOracle(file, firstDate);
  assert.equal(inventory.length, fixed.length, "complete fixed collection inventory");
  assert.deepEqual(inventory.map((table) => table.key), fixed.map((table) => table.key));
  assert.deepEqual(inventory.map((table) => table.columns.map((column) => column.type)), fixed.map((table) => table.types), "complete literal type inventory including empty Date schema");
  assert.deepEqual(inventory.map((table) => table.rows.map((row) => row.fields.map((field) => field.value))), fixed.map((table) => table.rows), "complete literal rows across every collection");
  assert.deepEqual(inventory.map((table) => table.rows.map((row) => row.fields.map((field) => field.kind))), fixed.map((table, index) => table.rows.map((row) => row.map((_, columnIndex) => fixed[index].types[columnIndex]))), "stored scalar kinds match every fixed literal schema");
  for (let index = 0; index < inventory.length; index++) {
    const table = inventory[index];
    const expected = fixed[index];
    assert.deepEqual(table.columns.map((column) => column.key), expected.types.map((_, column) => `column_${column + 1}`), "complete column-key inventory");
    assert.deepEqual(table.rows.map((row) => row.key), expected.rows.map((_, row) => `${expected.key}_row_${row + 1}`), "complete row-key inventory");
    for (const row of table.rows) assert.deepEqual(row.fields.map((field) => ({ entity: field.entity, field: field.field })), table.columns.map((column) => ({ entity: row.id, field: column.id })), "each stored field retains its exact row and column identity");
  }
  assertMetadataToCoreReferences(metadata, inventory);
}
async function assertReopenedCore(name, saved, file, expectedInventory, firstDate) {
  assert.equal((await snapshot()).opaqueBytesHash, saved.coreHash, "reopened resident export is byte-identical to the inspected saved core");
  const reopenedRecord = await savedRecord(name);
  assert.deepEqual(reopenedRecord.envelope, saved.envelope, "complete immutable saved record remains identical after reopen");
  const inspected = await inspectSavedCore(name, reopenedRecord.source.metadata);
  assert.deepEqual(inspected.inventory, expectedInventory, "reopened resident core retains every exact collection, field, row ID, type and value");
  assertFixedCoreInventory(file, inspected.inventory, reopenedRecord.source.metadata, firstDate);
  return inspected;
}
async function summaryBinding(unrelatedDate = false) {
  await activePage.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await activePage.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await activePage.locator('[aria-label="Cross-table summary binding"] select').first().waitFor();
  const values = unrelatedDate
    ? ["sheet_1", "column_1", "column_2", "sheet_2", "column_1", "column_2", "column_3"]
    : ["sheet_1", "column_1", "column_3", "sheet_1", "column_1", "column_2", "column_4"];
  const selects = activePage.locator('[aria-label="Cross-table summary binding"] select');
  for (let index = 0; index < values.length; index++) await selects.nth(index).selectOption(values[index]);
}
async function createSummary() {
  await activePage.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await activePage.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") !== "pending" && !document.body.innerText.includes("An operation is in progress"));
}
async function assertSummaryRows(expected) {
  const table = activePage.getByRole("table", { name: "Cross-table groups", exact: true });
  await table.waitFor();
  const rows = await table.locator("tbody tr").evaluateAll((elements) => elements.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())));
  assert.deepEqual(rows, expected, "literal category/value result rows from the current rendered table");
}
async function assertNoSummaryDefinitionsRendered() {
  const tab = activePage.getByRole("tab", { name: "Cross-table summary", exact: true });
  assert.equal(await tab.getAttribute("aria-selected"), "true", "definition inventory is counted while Summary is rendered");
  const result = activePage.getByRole("region", { name: "Cross-table summary result", exact: true });
  assert.match(await result.innerText(), /No current cross-table result is available/i);
  assert.equal(await result.locator(".ts-preview").count(), 0, "rendered Summary has zero existing or missing definition cards");
}
async function launchExampleThenClose() {
  await activePage.getByRole("button", { name: "Open release plan example", exact: true }).click();
  await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const close = activePage.getByRole("button", { name: "Close project", exact: true });
  if (!await close.isVisible()) await activePage.locator('.ts-command-overflow > summary[aria-label="More document commands"]').click();
  await close.click();
  const discard = activePage.getByRole("button", { name: "Close without saving", exact: true });
  if (await discard.count()) await discard.click();
  await waitForColdHome(activePage);
}
async function runCase(id, fn) {
  const startedAt = new Date().toISOString();
  try {
    await start();
    const evidence = await fn();
    results.push({ id, result: "PASS", startedAt, evidence });
  } catch (error) {
    // Assertion failures after known controls/actions are candidate behavior; locator/setup/transport errors are blocked.
    const behavioral = error.code === "ERR_ASSERTION";
    results.push({ id, result: behavioral ? "BEHAVIORAL_RED" : "BLOCKED", startedAt, message: error.message, stack: error.stack, observed: activePage ? await readView().catch(() => null) : null });
  } finally { await finishCase(); }
}

try {
  await runCase(expectedCases[0], async () => {
    await importFile("date-only.csv", ["text", "text", "number", "number", "date"]);
    const sourceBefore = await visibleSourceLedger();
    await editDate("2026-09-28");
    const before = await readView();
    assert.deepEqual(before.cells, [["PEN", "Stationery", "4", "200", "2026-09-28"], ["NOTE", "Paper", "5", "200", "2026-09-27"]]);
    const beforeSaveRuntime = await snapshot();
    const name = `${prefix}-Date`;
    await saveCopy(name);
    const savedEvidence = await inspectSavedDateRecord(name, "2026-09-28");
    assert.equal(savedEvidence.record.coreHash, beforeSaveRuntime.opaqueBytesHash, "normal Date Save preserves the exact same-work core bytes and IDs before reopen");
    assert.equal(savedEvidence.record.source.sha256, fixturePins["date-only.csv"]);
    await home();
    await activePage.reload({ waitUntil: "domcontentloaded" });
    await waitForColdHome(activePage);
    await activePage.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    const after = await readView();
    assert.deepEqual(after.cells, before.cells);
    assert.notEqual(after.witness.occurrence, before.witness.occurrence);
    assert.equal(after.currentness, "current");
    assert.match(after.save ?? "", /Saved/);
    const reopenedRecord = await savedRecord(name);
    assert.deepEqual({ ...reopenedRecord, bytes: undefined }, savedEvidence.record, "the same saved record, IDs, source metadata, ledger and bytes remain unchanged after reopen");
    const reopenedCore = await assertReopenedCore(name, savedEvidence.record, "date-only.csv", savedEvidence.core.inventory, "2026-09-28");
    await activePage.getByRole("tab", { name: "Import & export", exact: true }).click();
    assert.match((await readView()).body, /original source remains available/i);
    assert.equal(await visibleSourceLedger(), sourceBefore, "the visible source ledger survives Save and fresh reopen unchanged");
    await activePage.getByRole("tab", { name: "Table", exact: true }).click();
    await editDate("2026-09-29");
    return { before, beforeSaveRuntime, after, saved: savedEvidence.record, inspected: savedEvidence.core, reopenedCore };
  });

  for (const [index, id, file, types, unrelated] of [
    [1, expectedCases[1], "date-only.csv", ["text", "text", "number", "number", "date"], false],
    [2, expectedCases[2], "unrelated-date.xlsx", ["text", "number", "text", "text", "number", "date"], true],
    [3, expectedCases[3], "unrelated-date-empty.xlsx", ["text", "number", "text", "text", "number", "date"], true],
  ]) await runCase(id, async () => {
    await importFile(file, types);
    const sourceBefore = await visibleSourceLedger();
    const before = await readView();
    const runtimeBefore = await snapshot();
    await summaryBinding(unrelated);
    const countBefore = await counts();
    await createSummary();
    await assertNoSummaryDefinitionsRendered();
    const countAfter = await counts();
    const refusal = await activePage.getByRole("alert").allTextContents();
    const sourceAfterRefusal = await visibleSourceLedger();
    assert.equal(sourceAfterRefusal, sourceBefore, "visible source fidelity ledger is unchanged by refusal");
    assert.equal(countAfter.createKeyedGroupedSum ?? 0, countBefore.createKeyedGroupedSum ?? 0, "Date refusal occurs before producer Create dispatch");
    await activePage.getByRole("tab", { name: "Table", exact: true }).click();
    const after = await readView();
    assert.deepEqual(after.cells, before.cells);
    assert.deepEqual(after.witness, before.witness);
    assert.equal(after.currentness, before.currentness);
    assert.deepEqual(await snapshot(), runtimeBefore, "whole runtime snapshot remains unchanged");
    assert.match(refusal.join(" "), /date/i);
    assert.match(refusal.join(" "), /unsupported|cannot|not supported|save|support/i);
    const copyName = `${prefix}-${id}`;
    await saveCopy(copyName);
    const saved = await savedRecord(copyName);
    assert.equal(saved.kind, "opaque");
    assert.equal(saved.coreHash, runtimeBefore.opaqueBytesHash);
    assert.equal(saved.source?.name, file);
    assert.equal(saved.source?.format, file === "date-only.csv" ? "csv" : "xlsx", "fixed source format is retained");
    assert.equal(saved.source?.sha256, fixturePins[file]);
    const fixedXlsx = xlsxFixed.find((item) => item.name === file);
    const fixedCsv = file === "date-only.csv" ? JSON.parse(await readFile(path.join(prep, "fixtures/date-only-private.json"), "utf8")) : undefined;
    const fixedSource = fixedXlsx ?? fixedCsv;
    assert.deepEqual(normalizeFreshImportIds(saved.source.metadata), normalizeFreshImportIds(fixedSource.metadata), "complete fixed metadata (only fresh import IDs normalized across imports)");
    assert.deepEqual(saved.source.ledger, fixedSource.ledger, "complete fixed source preservation ledger");
    const inspectedBeforeReopen = await inspectSavedCore(copyName, saved.source.metadata);
    assertFixedCoreInventory(file, inspectedBeforeReopen.inventory, saved.source.metadata);
    await home();
    await activePage.reload({ waitUntil: "domcontentloaded" });
    await waitForColdHome(activePage);
    await activePage.getByRole("button", { name: `Open saved ${copyName}`, exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    const reopened = await readView();
    assert.deepEqual(reopened.cells, before.cells);
    assert.notEqual(reopened.witness.occurrence, before.witness.occurrence);
    assert.equal(reopened.currentness, "current");
    const inspectedAfterReopen = await assertReopenedCore(copyName, saved, file, inspectedBeforeReopen.inventory);
    assert.equal(await visibleSourceLedger(), sourceBefore, "visible source fidelity ledger survives saved-copy reopen");
    assert.deepEqual(inspectedAfterReopen.inventory, inspectedBeforeReopen.inventory);
    return { before, after, countBefore, countAfter, refusal, reopened, savedCore: inspectedBeforeReopen, reopenedCore: inspectedAfterReopen };
  });

  await runCase(expectedCases[4], async () => {
    await importFile("date-only.csv", ["text", "text", "number", "number", "text"]);
    const before = await readView();
    const canonicalName = `${prefix}-canonical`;
    await saveCopy(canonicalName);
    const canonical = await savedRecord(canonicalName);
    assert.equal(canonical.kind, "canonical");
    await openSaved(canonicalName);
    assert.deepEqual((await readView()).cells, before.cells);
    await summaryBinding(false);
    await createSummary();
    await assertSummaryRows([["Paper", "1000"], ["Stationery", "800"]]);
    await activePage.getByRole("button", { name: "Create bar report", exact: true }).click();
    const fields = [activePage.getByLabel("Title", { exact: true }), activePage.getByLabel("Category label", { exact: true }), activePage.getByLabel("Value label", { exact: true })];
    const boundary = ["A".repeat(119) + "😀", "界".repeat(79) + "😀", "V".repeat(79) + "😀"];
    for (let i = 0; i < fields.length; i++) await fields[i].fill(boundary[i]);
    await activePage.locator('canvas[data-report-ready="true"]').waitFor();
    const appliedPixels = await activePage.locator("canvas").first().evaluate((canvas) => canvas.toDataURL());
    const invalidNames = ["#report-title-error", "#report-category-label-error", "#report-value-label-error"];
    const controls = [];
    for (let i = 0; i < fields.length; i++) {
      await fields[i].fill(`${boundary[i]}x`);
      await activePage.locator(invalidNames[i]).filter({ hasText: "has not been applied" }).waitFor();
      assert.equal(await activePage.locator("canvas").first().evaluate((canvas) => canvas.toDataURL()), appliedPixels, "over-limit draft cannot alter applied report pixels");
      await activePage.getByRole("button", { name: "Save a copy", exact: true }).click();
      await activePage.getByRole("textbox", { name: "Copy name", exact: true }).fill(`${prefix}-invalid-${i}`);
      assert.equal(await activePage.getByRole("button", { name: "Create copy", exact: true }).isDisabled(), true, "over-limit report draft blocks Save");
      await activePage.locator(".ts-modal--save").getByRole("button", { name: "Cancel", exact: true }).click();
      await fields[i].fill(boundary[i]);
      controls.push({ field: i, invalidDraftBlocked: true, unchangedPixels: true });
    }
    const legend = activePage.getByRole("checkbox");
    if (await legend.isChecked()) await legend.uncheck();
    const copyName = `${prefix}-complete`;
    await saveCopy(copyName);
    const saved = await savedRecord(copyName);
    assert.equal(saved.kind, "opaque");
    assert.equal(saved.source.sha256, canonical.source.sha256);
    assert.deepEqual(saved.source.metadata, canonical.source.metadata, "same saved work retains exact metadata identities");
    assert.deepEqual(saved.source.ledger, canonical.source.ledger);
    assert.equal(saved.presentation?.snapshotDigest, saved.coreHash);
    assert.equal(saved.presentation?.snapshotRevision, saved.revision);
    assert.equal(saved.presentation?.report.legendVisible, false);
    assert.equal(saved.presentation?.report.type, "bar");
    await activePage.getByRole("tab", { name: "Table", exact: true }).click();
    const savedView = await readView();
    await activePage.reload({ waitUntil: "domcontentloaded" });
    await waitForColdHome(activePage);
    await activePage.getByRole("button", { name: `Open saved ${copyName}`, exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    const after = await readView();
    assert.deepEqual(after.cells, savedView.cells);
    assert.notEqual(after.witness.occurrence, savedView.witness.occurrence);
    await activePage.getByRole("tab", { name: "Report", exact: true }).click();
    assert.match(await activePage.locator("body").innerText(), /This bar report renders/, "applied bar report type survives saved-copy reopen");
    const report = { labels: await Promise.all(fields.map((field) => field.inputValue())), legend: await activePage.getByRole("checkbox").isChecked(), text: await activePage.getByLabel("Current report data", { exact: true }).innerText() };
    assert.deepEqual(report.labels, boundary);
    assert.equal(report.legend, false);
    assert.match(report.text, /Paper\s+1000/);
    assert.match(report.text, /Stationery\s+800/);
    await activePage.getByRole("button", { name: "Save a copy", exact: true }).click();
    await activePage.getByRole("textbox", { name: "Copy name", exact: true }).fill(canonicalName);
    await activePage.getByRole("button", { name: "Create copy", exact: true }).click();
    await activePage.getByTestId("save-status").filter({ hasText: "Save failed" }).waitFor();
    assert.deepEqual(await savedRecord(canonicalName), canonical, "duplicate name leaves original saved record byte/field-identical");
    assert.deepEqual(await savedRecord(copyName), saved, "duplicate name leaves newer record byte/field-identical");
    return { canonical: { ...canonical, bytes: undefined }, saved: { ...saved, bytes: undefined }, savedView, after, report, controls };
  });

  for (const [caseIndex, file, size] of [[5, "rows-64.csv", 64], [6, "fields-16.csv", 16]]) await runCase(expectedCases[caseIndex], async () => {
    await importFile(file);
    const before = await readView();
    assert.deepEqual(before.cells, file.startsWith("rows") ? Array.from({ length: size }, (_, index) => [`row${index}`]) : [Array(size).fill("x")]);
    const name = `${prefix}-${expectedCases[caseIndex]}`;
    await saveCopy(name);
    await home();
    await activePage.reload({ waitUntil: "domcontentloaded" });
    await waitForColdHome(activePage);
    await activePage.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    const after = await readView();
    assert.deepEqual(after.cells, before.cells);
    assert.notEqual(after.witness.occurrence, before.witness.occurrence);
    return { before, after };
  });

  for (const [caseIndex, file] of [[7, "rows-65.csv"], [8, "fields-17.csv"]]) await runCase(expectedCases[caseIndex], async () => {
    await launchExampleThenClose();
    const before = await counts();
    await activePage.locator('input[type="file"][accept*=".csv"]').setInputFiles(path.join(prep, "fixtures", file));
    await activePage.getByRole("alert").filter({ hasText: "CSV exceeds" }).waitFor();
    assert.equal(await activePage.locator(".ts-modal--import").count(), 0, "over-profile input is rejected before review/import dispatch");
    assert.equal((await counts()).importSpreadsheet ?? 0, before.importSpreadsheet ?? 0, "oversize CSV never reaches producer import");
    assert.equal(await activePage.getByTestId("project-ready").count(), 0, "rejected input does not publish a workbook");
    return { before, after: await counts(), publication: false };
  });

  await runCase(expectedCases[9], async () => {
    await importFile("date-only.csv", ["text", "text", "number", "number", "text"]);
    await summaryBinding(false);
    await createSummary();
    await activePage.getByRole("button", { name: "Create bar report", exact: true }).click();
    await activePage.getByLabel("Title", { exact: true }).fill("Prior authored report");
    const name = `${prefix}-prior`;
    await saveCopy(name);
    const saved = await savedRecord(name);
    const runtimeBefore = await snapshot();
    await summaryBinding(false);
    const before = await counts();
    await activePage.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
    await createSummary();
    const after = await counts();
    assert.equal(after.createKeyedGroupedSum ?? 0, before.createKeyedGroupedSum ?? 0, "faulted all-collection read prevents producer Create");
    await activePage.getByRole("button", { name: "Refresh", exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    assert.deepEqual(await snapshot(), runtimeBefore, "whole runtime snapshot survives read-fault recovery");
    await activePage.getByRole("tab", { name: "Report", exact: true }).click();
    assert.equal(await activePage.getByLabel("Title", { exact: true }).inputValue(), "Prior authored report");
    assert.deepEqual(await savedRecord(name), saved, "prior authored saved report/source copy remains unchanged");
    return { before, after, saved: { ...saved, bytes: undefined } };
  });

  await runCase(expectedCases[10], async () => {
    const metadata = JSON.parse(await readFile(path.join(prep, "fixtures/date-only-private.json"), "utf8"));
    const bytes = await readFile(path.join(prep, "fixtures/date-only-private.bin"));
    const source = await readFile(path.join(prep, "fixtures/date-only.csv"));
    assert.equal(sha256(bytes), fixturePins["date-only-private.bin"]);
    assert.equal(sha256(source), fixturePins["date-only.csv"]);
    const name = `${prefix}-old-reader`;
    await activePage.evaluate(async ({ name, metadata, bytes, source }) => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open("tachiko-sheet-local-copies"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const tx = db.transaction("opaque-copies", "readwrite");
      tx.objectStore("opaque-copies").add({ kind: "opaque", formatVersion: 2, name, savedAt: "2026-09-26T00:00:00.000Z", revision: metadata.revision, bytes: new Uint8Array(bytes).buffer, importedSource: { name: "date-only.csv", format: "csv", bytes: new Uint8Array(source).buffer, metadata: metadata.metadata, ledger: metadata.ledger } });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      db.close();
    }, { name, metadata, bytes: [...bytes], source: [...source] });
    await activePage.reload({ waitUntil: "domcontentloaded" });
    await waitForColdHome(activePage);
    await activePage.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
    await activePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    const reopened = await readView();
    assert.deepEqual(reopened.cells, [["PEN", "Stationery", "4", "200", "2026-09-26"], ["NOTE", "Paper", "5", "200", "2026-09-27"]]);
    assert.match(reopened.save ?? "", /Saved/);
    assert.equal((await savedRecord(name)).coreHash, metadata.coreSha256);
    const inspected = await inspectSavedDateRecord(name, "2026-09-26");
    await activePage.getByRole("tab", { name: "Table", exact: true }).click();
    await editDate("2026-09-29");
    await activePage.getByRole("tab", { name: "Import & export", exact: true }).click();
    assert.match((await readView()).body, /original source remains available/i);
    return { reopened, inspected: inspected.core, readerOnlyFixtureSetup: true };
  });

  const actualCases = results.map(({ id }) => id);
  assert.deepEqual(actualCases, expectedCases, "receipt rejects missing, duplicated, unknown, reordered or skipped required case IDs");
  assert.equal(results.filter((item) => item.result === "PASS").length + results.filter((item) => item.result === "BEHAVIORAL_RED").length, expectedCases.length);
  assert.deepEqual(diagnostics.pageErrors, [], "no unobserved browser page errors");
  const status = results.some((item) => item.result === "BLOCKED") ? "BLOCKED" : results.some((item) => item.result === "BEHAVIORAL_RED") ? "BEHAVIORAL_RED" : "PASS";
  const versionProbe = await chromium.launch(launchOptions);
  const browserVersion = versionProbe.version();
  await versionProbe.close();
  const receipt = { status, boundary: "current Home entry, existing #118 real-core packet adapted mechanically; close/reload/Home reopen only, not full browser-process restart", base: "375d25ea12262bec32e2303b3c63662f0b69322f", dirtyTree: true, sourceAttribution, fixturePins, environment: { ...environment, browserVersion }, diagnostics, results };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status, cases: results.map(({ id, result }) => ({ id, result })), receipt: receiptPath }, null, 2));
  assert.equal(status, "PASS", "candidate mode requires all eleven fixed cases to pass; setup errors and behavioral failures are distinct non-PASS results");
} catch (error) {
  if (error.code !== "ERR_ASSERTION" && !results.some((item) => item.result === "BLOCKED")) {
    results.push({ id: "SEED_EXECUTION", result: "BLOCKED", message: error.message, stack: error.stack });
  }
  const receipt = { status: results.some((item) => item.result === "BLOCKED") ? "BLOCKED" : "BEHAVIORAL_RED", boundary: "candidate acceptance seed; no implementation/Ready result", base: "375d25ea12262bec32e2303b3c63662f0b69322f", dirtyTree: true, sourceAttribution, fixturePins, environment, diagnostics, results, error: { name: error.name, message: error.message, stack: error.stack } };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  throw error;
} finally {
  await finishCase();
  await rm(profileRoot, { recursive: true, force: true });
}

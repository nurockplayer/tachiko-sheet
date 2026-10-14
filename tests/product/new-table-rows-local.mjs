// #184: normal UI over a production-style build and unchanged real Worker/WASM.
// The observer below only copies real public replies; it never supplies results.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome, openReleasePlanExample, homeImportInput } from "./home-entry.mjs";
import { runNewTableRootCauseCases } from "./new-table-root-cause-cases.mjs";
import { runNewTableRound4Cases } from "./new-table-round4-cases.mjs";
import { runNewTableRepairCases } from "./new-table-repair-cases.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet184-"));
const profile = path.join(work, "profile");
const evidence = process.env.TABLE_ROWS_OUT ?? path.join(work, "evidence");
await mkdir(evidence, { recursive: true });
const processes = [], checks = [], screenshots = [];
let context, pid;
const expected = [
  { item: "Tea", amount: 4.5, paid: true },
  { item: "Train", amount: 12, paid: false },
  { item: "Lunch", amount: 8.25, paid: true },
];
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const dialog = page => page.getByRole("dialog", { name: "New table", exact: true });
const entry = page => page.locator('.ts-entry-row');
async function start() {
  assert.equal(context, undefined, "restart requires full process termination");
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const info = await cdp.send("SystemInfo.getProcessInfo"); await cdp.detach();
  pid = info.processInfo.find(row => row.type === "browser")?.id;
  assert.ok(Number.isInteger(pid) && pid > 0, "BLOCKED: no owned browser PID");
  processes.push({ pid, profile });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__rowEvidence = { workers: [] };
    const originalFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      if (window.__rowEvidence.deletePublished && window.__rowEvidence.holdDeleteFrames) {
        (window.__rowEvidence.deleteFrames ??= []).push(callback);
        return -window.__rowEvidence.deleteFrames.length;
      }
      return originalFrame(callback);
    };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.record = { requests: [], replies: [], tables: [] };
        window.__rowEvidence.liveWorker ??= this;
        window.__rowEvidence.workers.push(this.record);
        this.addEventListener("message", event => {
          const evidence = window.__rowEvidence;
          const pendingRequest = this.record.requests.find(request => request.id === event.data.id);
          if (evidence.holdNextMutationReply && evidence.holdNextMutationReply === pendingRequest?.request?.type) {
            evidence.holdNextMutationReply = null;
            (evidence.heldReplies ??= []).push(event.data);
            event.stopImmediatePropagation();
          }
          this.record.replies.push(structuredClone(event.data));
          if (evidence.loseNextMutationReply === pendingRequest?.request?.type && event.data.response?.type === "published") {
            evidence.loseNextMutationReply = null;
            this.dispatchEvent(new ErrorEvent("error", { message: "Controlled lost mutation acknowledgement" }));
          }
          if (event.data.response?.type === "table") this.record.tables.push(structuredClone(event.data.response.payload));
          const request = this.record.requests.find(request => request.id === event.data.id);
          if (window.__rowEvidence.loseNextCreateReply && request?.request?.type === "new_table" && (event.data.response?.type === "opened" || event.data.status === "error")) {
            window.__rowEvidence.loseNextCreateReply = false;
            this.dispatchEvent(new ErrorEvent("error", { message: "Controlled lost creation acknowledgement" }));
          }
          if (window.__rowEvidence.holdDeleteFrames && request?.request?.type === "remove_table_rows" && event.data.response?.type === "published") {
            window.__rowEvidence.deletePublished = true;
          }
          const createIndex = this.record.requests.findLastIndex(request => request.request?.type === "new_table");
          const afterCreate = this.record.requests.slice(createIndex + 1);
          const fault = window.__rowEvidence.failCreationObservation;
          if (createIndex >= 0 && event.data.status === "ok" &&
            ((fault === "table" && request?.request?.type === "query_table") ||
             (fault === "discovery" && request?.request?.type === "bootstrap" && afterCreate.filter(request => request.request?.type === "bootstrap").length === 2))) {
            window.__rowEvidence.failCreationObservation = null;
            // Creation really succeeded. Lose only the subsequent observation
            // reply, without fabricating core data or replaying creation.
            this.dispatchEvent(new ErrorEvent("error", { message: `Controlled lost creation ${fault} observation` }));
          }
          if (window.__rowEvidence.loseNextInsertReply && request?.request?.type === "insert_row" && event.data.response?.type === "published") {
            window.__rowEvidence.loseNextInsertReply = false;
            // Core really published. Lose the client acknowledgement, never
            // fabricate a refusal/success or replay the command.
            this.dispatchEvent(new ErrorEvent("error", { message: "Controlled lost insert reply" }));
          }
        });
      }
      postMessage(message, ...args) {
        this.record.requests.push(structuredClone(message));
        if (window.__rowEvidence.loseNextClose && message.kind === "close_project") {
          window.__rowEvidence.loseNextClose = false;
          queueMicrotask(() => this.dispatchEvent(new ErrorEvent("error", { message: "Controlled Close dispatch loss; resident untouched" })));
          return;
        }
        return super.postMessage(message, ...args);
      }
    };
  });
  const page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  processes.at(-1).coldHome = true;
  return page;
}
function exists(processId) { try { process.kill(processId, 0); return true; } catch (cause) { if (cause.code === "ESRCH") return false; throw cause; } }
async function terminate() {
  if (!context) return;
  const owned = pid;
  let timer;
  try { await Promise.race([context.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("BLOCKED: browser close timed out")), 10000); })]); }
  finally { clearTimeout(timer); }
  const deadline = Date.now() + 5000;
  while (exists(owned) && Date.now() < deadline) await delay(50);
  assert.equal(exists(owned), false, "full browser process has terminated");
  processes.at(-1).exitObserved = true;
  context = pid = undefined;
}
async function capture(page, label) {
  if (!process.env.TABLE_ROWS_SCREENSHOTS) return;
  for (const width of [1400, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(evidence, `${label}-${width}.png`), fullPage: true });
    screenshots.push(`${label}-${width}.png`);
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
}
async function projection(page) {
  return page.evaluate(() => window.__rowEvidence.workers[0].tables.at(-1));
}
function values(table) {
  const cols = new Map(table.columns.map(col => [col.id, col.key]));
  return table.rows.map(row => Object.fromEntries(row.fields.map(field => [cols.get(field.target.field), field.stored?.value])));
}
async function fillRow(page, { item, amount, paid }) {
  await entry(page).getByLabel('New row item (Text)', { exact: true }).fill(item);
  await entry(page).getByLabel('New row amount (Number)', { exact: true }).fill(String(amount));
  await entry(page).getByLabel('New row paid (Yes/No)', { exact: true }).selectOption(String(paid));
}
async function add(page, row) {
  await fillRow(page, row); const previous = (await projection(page)).rows.length;
  await entry(page).getByRole("button", { name: "Add", exact: true }).click(); await ready(page);
  assert.equal((await projection(page)).rows.length, previous + 1);
  assert.equal(await entry(page).getByLabel('New row amount (Number)', { exact: true }).inputValue(), "");
}
async function closeWithoutSave(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await close.count()) await close.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}
// Independent fixed-value oracle: no UI draft or implementation helper supplies
// expected values. Read the actual reopened public projection and open the saved
// bytes through a second public client, comparing all scalar values and IDs.
async function independentOracle(page, reopened) {
  assert.deepEqual(values(reopened).sort((a, b) => a.item.localeCompare(b.item)), [...expected].sort((a, b) => a.item.localeCompare(b.item)));
  assert.deepEqual(reopened.columns.map(col => [col.key, col.field_type]), [["item", "text"], ["amount", "number"], ["paid", "boolean"]]);
  assert.equal(reopened.native_table_profile, true);
  const separate = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("tachiko-sheet-local-copies", 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const record = await new Promise((resolve, reject) => { const r = db.transaction("copies", "readonly").objectStore("copies").get("Expenses copy"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    const kit = await import("/core-kit/experimental-client.js"); const client = kit.createExperimentalDesignerClient();
    try {
      await kit.openCanonicalTreeFromEntries(client, record.files);
      const bootstrap = await client.bootstrap(); return await client.queryTable(bootstrap.default_collection);
    } finally { client.close(); }
  });
  assert.deepEqual(separate.columns, reopened.columns);
  assert.deepEqual(separate.rows, reopened.rows, "independent saved-byte admission agrees with every reopened core field and ID");
  return { rows: reopened.rows, columns: reopened.columns };
}
try {
  let page = await start();
  if (process.env.TABLE_ROWS_ROOT_CASE) await runNewTableRootCauseCases({ page, ready, projection, checks });
  if (process.env.TABLE_ROWS_REPAIR_CASE) await runNewTableRepairCases({ page, ready, projection, checks });
  if (process.env.TABLE_ROWS_ROUND4_CASE) await runNewTableRound4Cases({ page, ready, projection, checks, capture: label => capture(page, label) });
  let oracle;
  if (!process.env.TABLE_ROWS_REPAIR_CASE && !process.env.TABLE_ROWS_ROOT_CASE && !process.env.TABLE_ROWS_ROUND4_CASE) {
  await page.getByRole("button", { name: "New table", exact: true }).waitFor();
  const homeEntry = page.getByRole("region", { name: "Other ways to start", exact: true });
  assert.equal(await homeEntry.locator(".ts-home-other-row").first().locator("strong").textContent(), "New table");
  await homeEntry.getByRole("button", { name: "New table…", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === "New table…");
  await capture(page, "home");
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "New table must not overflow the narrow Home header");
  await page.getByRole("button", { name: "New table", exact: true }).hover(); await page.mouse.down();
  assert.equal(await page.locator(".ts-home-new-symbol").isVisible(), true, "New table keeps its symbol while the shared pressed contour is painted");
  await page.mouse.move(0, 100); await page.mouse.up();
  await page.getByRole("button", { name: "Appearance", exact: true }).focus(); await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "Open sales example", exact: true }).evaluate(element => element === document.activeElement), true, "New table preserves Appearance-to-Sales keyboard order");
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.getByRole("button", { name: "New table", exact: true }).click();
  let d = dialog(page); await d.waitFor();
  assert.equal(await d.getByLabel("Column 1 type", { exact: true }).inputValue(), "text");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByRole("button", { name: "Remove column 2", exact: true }).click();
  await d.getByRole("button", { name: "Create table", exact: true }).click();
  await d.getByRole("alert").waitFor(); assert.equal(await page.getByTestId("project-ready").count(), 0);
  await d.getByLabel("Table name", { exact: true }).fill("Expenses");
  await d.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByLabel("Column 2 name", { exact: true }).fill("Item");
  await d.getByRole("button", { name: "Create table", exact: true }).click();
  await d.getByRole("alert").filter({ hasText: /duplicate|unique|distinct/i }).waitFor();
  await d.getByLabel("Column 2 name", { exact: true }).fill("Amount"); await d.getByLabel("Column 2 type", { exact: true }).selectOption("number");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByLabel("Column 3 name", { exact: true }).fill("Paid"); await d.getByLabel("Column 3 type", { exact: true }).selectOption("boolean");
  await capture(page, "dialog");
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await d.waitFor({ state: "detached" }); await ready(page);
  assert.equal((await projection(page)).rows.length, 0);
  assert.equal(await entry(page).getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  await page.getByText("Nothing is saved until you choose Save a copy.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  checks.push("new-default-column-add-remove-empty-and-duplicate-core-refusals-unsaved-close");

  await add(page, { ...expected[0], amount: 3 }); await add(page, expected[1]); await add(page, expected[2]);
  let table = await projection(page); const tea = table.rows.find(row => row.fields.some(field => field.stored?.value === "Tea")); const amount = table.columns.find(col => col.key === "amount");
  const cell = page.getByTestId(`cell:${tea.id}:${amount.id}`);
  await cell.dblclick(); await page.getByRole("textbox", { name: "Edit cell", exact: true }).fill("4.5"); await page.getByRole("textbox", { name: "Edit cell", exact: true }).press("Enter"); await ready(page);
  table = await projection(page); assert.deepEqual(values(table), expected);
  const train = table.rows.find(row => row.fields.some(field => field.stored?.value === "Train")); const item = table.columns.find(col => col.key === "item");
  await page.getByTestId(`cell:${train.id}:${item.id}`).dblclick();
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).inputValue(), "Train", "deleting from an unchanged editor must not leave a hidden editor locking Undo");
  await page.getByRole("button", { name: "Delete row", exact: true }).click(); await ready(page); assert.equal((await projection(page)).rows.length, 2);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page); assert.deepEqual((await projection(page)).rows, table.rows);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page); assert.equal((await projection(page)).rows.length, 2);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page); assert.deepEqual((await projection(page)).rows, table.rows);
  await capture(page, "table");
  checks.push("three-inserts-edit-delete-undo-redo-undo-exact-identity-restoration");

  for (const raw of ["abc", ""]) {
    const before = await projection(page);
    await fillRow(page, { item: "Refused draft", amount: raw, paid: false });
    await entry(page).getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /not a finite Number/ }).waitFor(); await ready(page);
    assert.equal(await entry(page).getByLabel('New row amount (Number)', { exact: true }).inputValue(), raw);
    assert.equal(await entry(page).getByLabel('New row item (Text)', { exact: true }).inputValue(), "Refused draft");
    assert.equal(await entry(page).getByLabel('New row amount (Number)', { exact: true }).getAttribute("aria-invalid"), "true");
    assert.deepEqual(await projection(page), before, "refused row publishes nothing; empty Number never becomes zero");
    const receipt = await page.evaluate(() => { const w = window.__rowEvidence.workers[0]; const request = w.requests.filter(message => message.request?.type === "insert_row").at(-1); return { request: request.request, reply: w.replies.find(reply => reply.id === request.id) }; });
    assert.equal(receipt.reply.status, "error"); assert.equal(receipt.reply.error.code, "invalid_number");
    assert.equal(receipt.reply.error.current_revision, before.revision); assert.equal(receipt.request.initializers.length, 3); assert.equal(receipt.request.initializers[1].input.input, raw);
    if (raw === "abc") await capture(page, "refusal");
  }
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const copyDialog = page.getByRole("dialog", { name: "Save a copy", exact: true });
  assert.equal(await copyDialog.getByRole("button", { name: "Create copy", exact: true }).isDisabled(), true);
  await copyDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await entry(page).getByRole("button", { name: "Clear", exact: true }).click();
  // Last-field Enter during composition cannot publish a row.
  await fillRow(page, { item: "IME draft", amount: 9, paid: true });
  const last = entry(page).getByLabel('New row paid (Yes/No)', { exact: true });
  await last.dispatchEvent("compositionstart"); await last.dispatchEvent("keydown", { key: "Enter", keyCode: 13, isComposing: true });
  await last.dispatchEvent("compositionend");
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  const beforeRepeat = await page.evaluate(() => window.__rowEvidence.workers[0].requests.filter(message => message.request?.type === "insert_row").length);
  await last.dispatchEvent("keydown", { key: "Enter", keyCode: 13, repeat: true }); await ready(page);
  assert.equal(await page.evaluate(() => window.__rowEvidence.workers[0].requests.filter(message => message.request?.type === "insert_row").length), beforeRepeat, "held Enter cannot insert repeated rows");
  assert.deepEqual(values(await projection(page)), expected);
  await entry(page).getByRole("button", { name: "Clear", exact: true }).click();
  checks.push("invalid-and-empty-number-core-refusal-kept-draft-no-publication-save-guard-ime-enter");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const copy = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await copy.getByRole("textbox", { name: "Copy name", exact: true }).fill("Expenses copy"); await copy.getByRole("button", { name: "Create copy", exact: true }).click(); await copy.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const savedRows = (await projection(page)).rows;
  await terminate(); page = await start();
  await page.getByRole("button", { name: "Open saved Expenses copy", exact: true }).click(); await ready(page);
  const reopened = await projection(page); assert.deepEqual(reopened.rows, savedRows);
  oracle = await independentOracle(page, reopened);
  checks.push("save-full-process-exit-same-profile-home-reopen-fixed-value-independent-core-oracle");
  // The reopened native flag must still expose the actual row actions.
  await entry(page).getByRole("button", { name: "Add", exact: true }).waitFor();
  // Download/Open .ro preserves this authored table through the normal UI too.
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Download work file (.ro)", exact: true }).click();
  const downloadDialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await downloadDialog.waitFor(); const downloadPending = page.waitForEvent("download");
  await downloadDialog.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPending; assert.equal(await download.failure(), null);
  const workFile = path.join(work, "expenses.ro"); await download.saveAs(workFile);
  await downloadDialog.waitFor({ state: "detached" }); await closeWithoutSave(page);
  await page.getByTestId("open-work-file").setInputFiles(workFile); await ready(page);
  assert.deepEqual((await projection(page)).rows, savedRows);
  assert.equal((await projection(page)).native_table_profile, true);
  checks.push("normal-download-open-ro-preserves-authored-rows-and-native-row-profile");
  await closeWithoutSave(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  assert.equal(await page.getByLabel("Open work file", { exact: true }).evaluate(element => element === document.activeElement), true, "New table preserves saved-copy-to-work-file keyboard order");
  const csv = path.join(work, "import.csv"); await writeFile(csv, "Item,Amount\nTea,2\n");
  await (await homeImportInput(page)).setInputFiles(csv);
  const importDialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await importDialog.getByRole("button", { name: "Import candidate", exact: true }).click(); await ready(page);
  assert.equal(await entry(page).count(), 0); await page.getByText("Adding and deleting rows is available only in native tables. This table does not support it.", { exact: true }).waitFor();
  await closeWithoutSave(page); await openReleasePlanExample(page); assert.equal(await entry(page).count(), 0); await closeWithoutSave(page);
  await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready(page);
  const salesBefore = await projection(page);
  assert.equal(await page.locator('.ts-grid tbody tr').count(), salesBefore.rows.length, "Sales data rows exclude the Add row draft");
  assert.equal(await page.locator('.ts-grid tfoot .ts-entry-row').count(), 1);
  assert.equal(await page.getByRole("grid", { name: "Table", exact: true }).getByRole("row").count(), salesBefore.rows.length + 1, "accessible grid rows contain only the header and actual data");
  assert.equal(salesBefore.native_table_profile, true, "the current Sales example is a native table accepted by core");
  for (const column of salesBefore.columns) {
    await entry(page).locator(`[data-entry-field="${column.id}"]`).fill(column.field_type === "number" ? "6" : column.key === "category" ? "ROW-PROBE" : "ROW-PROBE-CODE");
  }
  await entry(page).getByRole("button", { name: "Add", exact: true }).click(); await ready(page);
  const salesAdded = await projection(page); assert.equal(salesAdded.rows.length, salesBefore.rows.length + 1);
  const inserted = salesAdded.rows.find(row => !salesBefore.rows.some(old => old.id === row.id));
  await page.getByTestId(`cell:${inserted.id}:${salesBefore.columns[0].id}`).focus();
  await page.getByRole("button", { name: "Delete row", exact: true }).click(); await ready(page);
  assert.deepEqual((await projection(page)).rows, salesBefore.rows);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page); assert.deepEqual((await projection(page)).rows, salesAdded.rows);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page); assert.deepEqual((await projection(page)).rows, salesBefore.rows);
  checks.push("import-release-actions-unavailable-sales-native-insert-delete-undo-redo-supported");
  await closeWithoutSave(page);
  // Date has no synthesized today value; blank Date is a real core refusal.
  await page.getByRole("button", { name: "New table", exact: true }).click();
  d = dialog(page); await d.getByLabel("Table name", { exact: true }).fill("Dates");
  await d.getByLabel("Column 1 name", { exact: true }).fill("When"); await d.getByLabel("Column 1 type", { exact: true }).selectOption("date");
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await ready(page);
  const dateInput = entry(page).getByLabel("New row when (Date)", { exact: true }); assert.equal(await dateInput.inputValue(), "");
  const blankDateView = await projection(page);
  await entry(page).getByRole("button", { name: "Add", exact: true }).click(); await page.getByRole("alert").waitFor(); await ready(page);
  assert.deepEqual(await projection(page), blankDateView); assert.equal(await dateInput.getAttribute("aria-invalid"), "true");
  await dateInput.fill("2026-10-14"); await dateInput.press("Enter"); await ready(page);
  assert.deepEqual(values(await projection(page)), [{ when: "2026-10-14" }]);
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const dateCopy = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await dateCopy.getByRole("textbox", { name: "Copy name", exact: true }).fill("Dates copy"); await dateCopy.getByRole("button", { name: "Create copy", exact: true }).click(); await dateCopy.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await closeWithoutSave(page); await page.getByRole("button", { name: "Open saved Dates copy", exact: true }).click(); await ready(page);
  assert.deepEqual(values(await projection(page)), [{ when: "2026-10-14" }]);
  checks.push("date-no-today-default-empty-refusal-explicit-last-field-enter-opaque-save-reopen");
  await entry(page).getByLabel("New row when (Date)", { exact: true }).fill("2026-10-15");
  await page.evaluate(() => { window.__rowEvidence.loseNextInsertReply = true; });
  await entry(page).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.match(await page.getByTestId("operation-outcome").textContent(), /Outcome needs review/);
  await page.locator(".ts-home").getByRole("button", { name: "Refresh", exact: true }).click(); await ready(page);
  assert.deepEqual(values(await projection(page)).sort((a, b) => a.when.localeCompare(b.when)), [{ when: "2026-10-14" }, { when: "2026-10-15" }], "the lost reply's row was published exactly once");
  const retained = entry(page).getByLabel("New row when (Date)", { exact: true });
  assert.equal(await retained.inputValue(), "2026-10-15");
  assert.equal(await entry(page).getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  const count = await page.evaluate(() => window.__rowEvidence.workers[0].requests.filter(message => message.request?.type === "insert_row").length);
  await retained.fill("2026-10-16"); await retained.press("Enter");
  assert.equal(await entry(page).getByRole("button", { name: "Add", exact: true }).isDisabled(), true, "editing a retained uncertain draft cannot unlock replay");
  assert.equal(await page.evaluate(() => window.__rowEvidence.workers[0].requests.filter(message => message.request?.type === "insert_row").length), count);
  await entry(page).getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await entry(page).getByRole("button", { name: "Add", exact: true }).isEnabled(), true);
  checks.push("unknown-insert-refresh-once-keeps-draft-edit-cannot-unlock-replay-explicit-clear");
  await closeWithoutSave(page);
  }
  if (!process.env.TABLE_ROWS_REPAIR_CASE && !process.env.TABLE_ROWS_ROOT_CASE && !process.env.TABLE_ROWS_ROUND4_CASE) {
    await runNewTableRound4Cases({ page, ready, projection, checks, capture: label => capture(page, label) });
    await runNewTableRepairCases({ page, ready, projection, checks });
    await runNewTableRootCauseCases({ page, ready, projection, checks });
  }
  await terminate();
  const result = { status: "PASS", dist: path.resolve(dist), checks, processes, screenshots, oracle };
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, oracle: oracle ? "all rows, values and stable IDs verified" : "not exercised in focused repair run", evidence }));
} catch (cause) {
  console.error(cause);
  await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ status: "FAIL", error: String(cause), checks, processes }, null, 2));
  process.exitCode = 1;
} finally { await terminate(); }

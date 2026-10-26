// #212: ordinary grid events with the real pinned Worker/WASM. Observations
// below copy public transport traffic; they never supply semantic results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";
import { j4CanaryText } from "../fixtures/j4-catalog-sales.mjs";
import { assertPendingDialogFocus, tabToDialogAction } from "./pending-dialog-focus.mjs";
import { assertCompactColumnHeaders, assertManyColumnHeaders } from "./compact-column-headers.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet212-"));
const evidence = process.env.COLUMNS_OUT ?? "/tmp/sheet212-checks";
const screens = process.env.COLUMNS_SCREENS ?? path.join(evidence, "screens");
await mkdir(screens, { recursive: true });
const checks = [], processes = [], screenshots = [];
const profile = path.join(work, "profile");
let context, pid, page;
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const entry = () => page.locator('.ts-entry-row');
const projection = () => page.evaluate(() => window.__columnEvidence.records.flatMap(record => record.tables).at(-1));
const commands = () => page.evaluate(() => window.__columnEvidence.records.flatMap(record => record.requests).filter(message => ["add_column", "rename_column", "remove_column"].includes(message.request?.type)).map(message => message.request));
const values = table => table.rows.map(row => table.columns.map(column => row.fields.find(field => field.target.field === column.id)?.stored?.value));
const cell = (table, r, c) => page.getByTestId(`cell:${table.rows[r].fields[0]?.target.entity ?? table.rows[r].id}:${table.columns[c].id}`);
async function start() {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const info = await cdp.send("SystemInfo.getProcessInfo"); await cdp.detach();
  pid = info.processInfo.find(row => row.type === "browser")?.id;
  assert.ok(Number.isInteger(pid) && pid > 0); processes.push({ pid, profile });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__columnEvidence = { records: [], hostWrites: 0 };
    for (const method of ["put", "add", "delete", "clear"]) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) { window.__columnEvidence.hostWrites++; return original.apply(this, args); };
    }
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.record = { requests: [], replies: [], tables: [] };
        window.__columnEvidence.records.push(this.record);
        window.__columnEvidence.worker = this;
        this.addEventListener("message", event => {
          this.record.replies.push(structuredClone(event.data));
          if (event.data.response?.type === "table") this.record.tables.push(structuredClone(event.data.response.payload));
          const request = this.record.requests.find(request => request.id === event.data.id);
          if (window.__columnEvidence.holdExport && request?.kind === "export_portable_ro") {
            window.__columnEvidence.holdExport = false; window.__columnEvidence.heldExport = event.data; event.stopImmediatePropagation(); return;
          }
          if (["add_column", "rename_column", "remove_column"].includes(request?.request?.type) && event.data.response?.type === "published") {
            if (window.__columnEvidence.loseReply) {
              window.__columnEvidence.loseReply = false;
              event.stopImmediatePropagation();
              this.dispatchEvent(new ErrorEvent("error", { message: "Controlled column acknowledgement loss" }));
            } else if (window.__columnEvidence.holdReply) {
              window.__columnEvidence.holdReply = false;
              event.stopImmediatePropagation();
              window.__columnEvidence.held = event.data;
            }
          }
        });
      }
      postMessage(message, ...args) {
        if (window.__columnEvidence.stale && message.request?.type === "add_column") {
          window.__columnEvidence.stale = false; message = structuredClone(message); message.request.expected_revision = "stale-column-test";
        }
        this.record.requests.push(structuredClone(message)); return super.postMessage(message, ...args);
      }
    };
  });
  page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
}
function exists(id) { try { process.kill(id, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }
async function stop() {
  if (!context) return;
  await context.close();
  const deadline = Date.now() + 5000;
  while (exists(pid) && Date.now() < deadline) await delay(50);
  assert.equal(exists(pid), false, "owned browser process exited before restart");
  processes.at(-1).exitObserved = true; context = pid = undefined;
}
async function capture(label, reveal) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (reveal) await reveal.scrollIntoViewIfNeeded();
    const file = path.join(screens, `${label}-${width}x900.png`);
    await page.screenshot({ path: file, fullPage: true }); if (!screenshots.includes(file)) screenshots.push(file);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
// The same DOM events are generated by native Cmd/Ctrl shortcuts and Edit menu.
// Synthetic DataTransfer provides deterministic headless clipboard contents.
async function paste(target, text) {
  await target.evaluate((node, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await ready();
}
async function copy(target) {
  return target.evaluate(node => {
    const data = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
}
async function close() {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await dialog.count()) await dialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}
const dialog = name => page.getByRole("dialog", { name, exact: true });
async function cancel(name) { await dialog(name).getByRole("button", { name: "Cancel", exact: true }).click(); }
async function assertFocused(target, message) {
  await page.waitForFunction(node => node === document.activeElement, await target.elementHandle());
  assert.equal(await target.evaluate(n => n === document.activeElement), true, message);
}
const columnActions = name => page.getByRole("button", { name: `Column actions for ${name}`, exact: true });
async function chooseColumnAction(name, action) {
  if (await page.locator(".ts-column-toolbar").count()) {
    const index = (await page.locator(".ts-col-head").allTextContents()).indexOf(name);
    assert.ok(index >= 0);
    await page.locator(".ts-grid tbody tr.ts-row").first().locator(".ts-cell").nth(index).focus();
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await page.getByRole("button", { name: `${action} “${name}”…`, exact: true }).click();
    return;
  }
  await page.getByRole("columnheader", { name, exact: true }).hover();
  await columnActions(name).click();
  await page.getByRole("button", { name: `${action}…`, exact: true }).click();
}
async function add(name, type = "text", fill) {
  if (await page.locator(".ts-column-toolbar").count()) {
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await page.getByRole("button", { name: "Add column…", exact: true }).click();
  } else await page.getByRole("button", { name: "+ column", exact: true }).click();
  const d = dialog("Add column");
  await d.getByLabel("Column name", { exact: true }).fill(name);
  await d.getByLabel("Column type", { exact: true }).selectOption(type);
  if (type === "text" || type === "number") await d.getByLabel("Required", { exact: true }).check();
  if (fill !== undefined) {
    const input = d.getByLabel(/^Fill all/);
    if (type === "boolean") await input.selectOption(fill); else await input.fill(fill);
  }
  return d;
}
async function submit(name) { await dialog(name).getByRole("button", { name, exact: true }).click(); await ready(); }
async function history(direction) { await page.getByRole("button", { name: direction, exact: true }).click(); await ready(); }
async function saveCopy(name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const d = dialog("Save a copy"); await d.getByLabel("Copy name", { exact: true }).fill(name);
  await d.getByRole("button", { name: "Create copy", exact: true }).click();
  await d.waitFor({ state: "detached" }); await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
}
try {
  await start();
  await page.getByRole("button", { name: "New table", exact: true }).click();
  let d = dialog("New table"); await d.getByLabel("Table name", { exact: true }).fill("Columns");
  await d.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  // Empty tables need no initializer or implicit default.
  d = await add("Empty date", "date"); assert.equal(await d.getByLabel(/^Fill all/).count(), 0);
  await submit("Add column"); await history("Undo");
  for (const text of ["Tea", "Train", "Lunch"]) {
    const first = entry().locator('[data-entry-field]').first(); await first.focus(); await paste(first, text); await first.press("Enter"); await ready();
  }
  let baseline = await projection(); assert.equal(baseline.rows.length, 3);
  d = await add("Amount", "number"); assert.equal(await d.getByLabel(/^Fill all/).inputValue(), "");
  await submit("Add column"); await d.getByRole("alert").filter({ hasText: "Choose a fill value" }).waitFor();
  assert.deepEqual(await projection(), baseline); // no silent 0
  await d.getByLabel(/^Fill all/).fill("12.5"); await capture("add-dialog");
  await submit("Add column"); await d.waitFor({ state: "detached" });
  let table = await projection(); const added = table.columns.find(col => !baseline.columns.some(old => old.id === col.id));
  assert.ok(added); assert.deepEqual(values(table), [["Tea", 12.5], ["Train", 12.5], ["Lunch", 12.5]]);
  const addCommand = (await commands()).at(-1);
  assert.deepEqual(addCommand.initializers.map(i => i.entity), baseline.rows.map(r => r.fields[0].target.entity));
  await history("Undo"); assert.deepEqual((await projection()).rows, baseline.rows); assert.deepEqual((await projection()).columns, baseline.columns);
  await history("Redo"); assert.deepEqual((await projection()).rows, table.rows); assert.deepEqual((await projection()).columns, table.columns);
  checks.push("1 Number fill covers every stable row; one Undo/Redo restores exact identities and values; empty-table Date has no fill");

  baseline = await projection();
  const undoDisabled = await page.getByRole("button", { name: "Undo", exact: true }).getAttribute("disabled");
  for (const fill of ["NaN", "1,300"]) {
    d = await add("Refused", "number", fill); await submit("Add column");
    await d.getByRole("alert").filter({ hasText: "Enter a number" }).waitFor();
    assert.deepEqual(await projection(), baseline);
    await capture("fill-refusal"); await cancel("Add column"); assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).getAttribute("disabled"), undoDisabled);
  }
  d = await add("Stale", "text", "raw"); await page.evaluate(() => { window.__columnEvidence.stale = true; });
  await submit("Add column"); await d.getByRole("alert").waitFor(); assert.deepEqual(await projection(), baseline); await cancel("Add column");
  await history("Undo"); assert.deepEqual((await projection()).columns.length, 1); await history("Redo");
  assert.deepEqual((await projection()).rows, baseline.rows);
  checks.push("2 invalid raw fill and real stale-revision refusal leave all rows, schema, revision and history unchanged");

  await chooseColumnAction("Amount", "Remove"); await capture("remove-confirmation");
  await submit("Remove column"); await dialog("Remove column").waitFor({ state: "detached" });
  assert.deepEqual((await projection()).columns, baseline.columns.slice(0, 1));
  await history("Undo"); assert.deepEqual((await projection()).columns, baseline.columns); assert.deepEqual((await projection()).rows, baseline.rows);
  await chooseColumnAction("Amount", "Remove"); await submit("Remove column");
  await chooseColumnAction("Item", "Remove"); await submit("Remove column");
  await dialog("Remove column").getByRole("alert").filter({ hasText: "Keep at least one" }).waitFor();
  assert.equal((await projection()).columns.length, 1); await cancel("Remove column");
  await history("Undo"); assert.deepEqual((await projection()).rows, baseline.rows);
  checks.push("4 unreferenced removal and Undo restore exact field identity, order and values; last-column removal refused by Work");

  // Schema-changed grid coordinates and the tfoot row use current stable IDs.
  table = await projection(); await cell(table, 0, 1).focus(); await paste(cell(table, 0, 1), "9");
  assert.equal(values(await projection())[0][1], 9); assert.equal(await copy(cell(await projection(), 0, 1)), "9");
  const draftFirst = entry().locator('[data-entry-field]').first(); await draftFirst.focus(); await paste(draftFirst, "Bus\t4");
  await draftFirst.press("Enter"); await ready(); assert.deepEqual(values(await projection()).at(-1), ["Bus", 4]);
  assert.equal(await page.locator('table[aria-label="Table"] tbody tr').count(), 4);
  // An unfinished new row blocks all column controls.
  await paste(draftFirst, "Draft\t2"); assert.equal(await page.getByRole("button", { name: "+ column", exact: true }).isDisabled(), true);
  await page.locator('.ts-entry-actions').getByRole("button", { name: "Discard", exact: true }).click();
  checks.push("5 copy/paste and draft-row Enter retain correct coordinates after add/remove/Undo; unfinished row blocks schema operations");

  // All four types, no selected No/today, and raw invalid Date reaches Work.
  for (const [type, fill] of [["boolean", "no"], ["date", "2026-10-19"], ["text", ""]]) {
    d = await add(`Added ${type}`, type); assert.equal(await d.getByLabel(/^Fill all/).inputValue(), "");
    if (type === "boolean") await d.getByLabel(/^Fill all/).selectOption(fill); else await d.getByLabel(/^Fill all/).fill(fill);
    await submit("Add column"); await d.waitFor({ state: "detached" });
    assert.ok(values(await projection()).every(row => row.at(-1) === (type === "boolean" ? false : fill))); await history("Undo");
  }
  d = await add("Bad date", "date", "2026-02-30"); const beforeDate = await projection(); await submit("Add column");
  await d.getByRole("alert").filter({ hasText: "YYYY-MM-DD" }).waitFor(); assert.deepEqual(await projection(), beforeDate); await cancel("Add column");
  checks.push("typed Boolean/Date/Text fills and authoritative invalid Date refusal");

  await close(); await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready();
  await page.getByTestId("results-pane").waitFor(); table = await projection();
  assert.ok(table.native_table_profile, "Sales Catalog qualifies as native");
  const salesBefore = table;
  const price = table.columns.find(col => col.key === "price"); assert.ok(price);
  const resultTable = () => page.getByRole("table", { name: "Sales by product values", exact: true });
  const resultsBefore = await resultTable().innerText();
  const labels = table.columns.map(c => c.display_name);
  assert.deepEqual(await page.locator('.ts-col-head').allTextContents(), labels);
  assert.deepEqual(await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents(), ["Row", ...labels], "frozen header readback excludes every disclosure/action label");
  await page.mouse.move(0, 0);
  for (const column of table.columns) assert.equal(await columnActions(column.display_name).evaluate(n => getComputedStyle(n).opacity), column.id === price.id ? "1" : "0", "only the focused column is revealed at rest");
  const categoryHeader = page.getByRole("columnheader", { name: "category", exact: true });
  const beforeHover = await categoryHeader.locator('.ts-col-head').boundingBox();
  await categoryHeader.hover(); assert.equal(await columnActions("category").evaluate(n => getComputedStyle(n).opacity), "1");
  assert.deepEqual(await categoryHeader.locator('.ts-col-head').boundingBox(), beforeHover, "revealing the button never shifts its label");
  await page.mouse.move(0, 0); await capture("headers-rest");
  for (const name of labels) assert.equal(await columnActions(name).evaluate(n => getComputedStyle(n).opacity), name === "price" ? "1" : "0");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator(".ts-column-toolbar > summary").waitFor();
  assert.equal(await page.locator(".ts-column-header summary, .ts-column-header button").count(), 0, "compact header actions move to one Column disclosure below the grid");
  const compactGrid = await page.locator('.ts-grid-scroll').evaluate(n => ({ width: n.clientWidth, content: n.scrollWidth }));
  assert.ok(compactGrid.content <= compactGrid.width + 1, "compact Sales headers retain the qualified grid width");
  const compactColumn = await page.getByRole("button", { name: "Column", exact: true }).boundingBox();
  assert.ok(compactColumn && compactColumn.x >= 0 && compactColumn.x + compactColumn.width <= 390, "Column stays reachable outside the horizontal grid scrollport");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".ts-column-header summary").first().waitFor();
  const header = page.locator('.ts-col-head').filter({ hasText: /^price$/ });
  await header.focus(); await header.press("F2"); await dialog("Rename column").waitFor(); await page.keyboard.press("Escape");
  await dialog("Rename column").waitFor({ state: "detached" });
  await assertFocused(header, "F2 cancel returns to the header label");
  await header.dblclick(); await dialog("Rename column").waitFor(); await cancel("Rename column");
  const actions = columnActions("price"), disclosure = actions.locator('..');
  await actions.focus(); await actions.press("Enter");
  assert.equal(await disclosure.getAttribute("open"), "");
  await page.keyboard.press("Tab"); assert.equal(await page.getByRole("button", { name: "Rename…", exact: true }).evaluate(n => n === document.activeElement), true);
  await page.keyboard.press("Tab"); assert.equal(await page.getByRole("button", { name: "Remove…", exact: true }).evaluate(n => n === document.activeElement), true);
  await page.keyboard.press("Escape"); assert.equal(await disclosure.getAttribute("open"), null);
  await assertFocused(actions, "Escape returns to the disclosure button");
  await actions.press("Space"); assert.equal(await disclosure.getAttribute("open"), "");
  const desktopMenuScreenshot = path.join(screens, "column-menu-open-1440x900.png");
  await page.screenshot({ path: desktopMenuScreenshot }); screenshots.push(desktopMenuScreenshot);
  await actions.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  d = dialog("Rename column"); await d.waitFor(); await page.keyboard.press("Escape"); await d.waitFor({ state: "detached" });
  await assertFocused(actions, "Rename dialog cancel returns to the closed disclosure");
  assert.equal(await disclosure.getAttribute("open"), null);
  await actions.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await dialog("Remove column").waitFor(); await cancel("Remove column"); await dialog("Remove column").waitFor({ state: "detached" });
  await assertFocused(actions, "Remove dialog cancel returns to the closed disclosure");
  await actions.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "+ column", exact: true }).evaluate(n => n === document.activeElement), true, "Tab exits the disclosure without a trap");
  assert.equal(await disclosure.getAttribute("open"), null, "leaving the disclosure closes it");
  assert.deepEqual(await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents(), ["Row", ...labels]);
  checks.push("column disclosure: stable clean header text; hover/focused-column/compact discovery; Enter/Space open; Tab reaches Rename/Remove, Sort/Filter and exits; Escape and dialog cancellation return focus");
  const compactHeaders = await assertCompactColumnHeaders(page, screens);
  await writeFile(path.join(evidence, "compact-headers.json"), JSON.stringify(compactHeaders, null, 2));
  checks.push("218: labels-only compact headers; viewport-contained Column menu targets the focused column at 320/375/390 across all profiles/densities and forced colors; desktop hover/focus actions unchanged");
  await chooseColumnAction("price", "Rename");
  d = dialog("Rename column"); await d.getByLabel("Column name", { exact: true }).fill("Unit price"); await capture("rename");
  // Composition must not submit/cancel prematurely.
  const nameInput = d.getByLabel("Column name", { exact: true }); await nameInput.dispatchEvent("compositionstart");
  await nameInput.press("Enter"); await d.waitFor(); await nameInput.dispatchEvent("compositionend"); await page.evaluate(() => new Promise(requestAnimationFrame));
  await nameInput.press("Enter"); await ready(); await d.waitFor({ state: "detached" });
  table = await projection(); const renamed = table.columns.find(col => col.id === price.id);
  assert.equal(renamed.display_name, "Unit price"); assert.equal(renamed.key, price.key); assert.deepEqual(table.rows, salesBefore.rows);
  assert.equal(await resultTable().innerText(), resultsBefore);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const groups = page.getByLabel("Cross-table groups", { exact: true }); await groups.waitFor(); assert.match(await groups.innerText(), /800/);
  await page.getByRole("tab", { name: "Report", exact: true }).click(); await page.getByLabel("Current report data", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Sales by product");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).locator("canvas").count(), 1);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  // Summary binding removal is refused by the real Work engine.
  const beforeRef = await projection(); await chooseColumnAction("Unit price", "Remove"); await submit("Remove column");
  await dialog("Remove column").getByRole("alert").filter({ hasText: "used by a formula or cross-table summary" }).waitFor();
  assert.deepEqual(await projection(), beforeRef); await capture("referenced-refusal"); await cancel("Remove column");
  await saveCopy("Renamed Sales"); const saved = await projection(); await stop(); await start();
  await page.getByRole("button", { name: "Open saved Renamed Sales", exact: true }).click(); await ready();
  await page.locator("#ts-active-table").selectOption("catalog"); await ready();
  assert.deepEqual((await projection()).columns, saved.columns); assert.deepEqual((await projection()).rows, saved.rows);
  assert.equal(await resultTable().innerText(), resultsBefore);
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  // #225 makes native CSV/XLSX available; native-export-local proves the downloaded contents.
  assert.equal(await page.getByRole("button", { name: "Prepare CSV", exact: true }).isEnabled(), true);
  checks.push("3 Sales price rename retains field/key, Sales by product, Cross-table summary and chart; Save a copy → process exit → restart → reopen retains exact schema/results; native CSV/XLSX preparation available (#225)");
  checks.push("4 real saved-summary binding removal refusal leaves schema, rows and revision unchanged");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  // Hold a real schema acknowledgement: all keyboard paths stay in the dialog,
  // then a newer focus destination wins over the completion's old trigger.
  d = await add("Pending", "text", "kept");
  const beforePreflight = (await commands()).length;
  const beforeWrites = await page.evaluate(() => window.__columnEvidence.hostWrites);
  await page.evaluate(() => { window.__columnEvidence.holdExport = true; window.__columnEvidence.holdReply = true; });
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await page.waitForFunction(() => !!window.__columnEvidence.heldExport);
  assert.equal((await commands()).length, beforePreflight, "no column command is sent before portable export succeeds");
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true, "the operation lock covers preflight");
  await d.getByLabel("Column name", { exact: true }).press("Enter");
  assert.equal((await commands()).length, beforePreflight, "a second submit cannot slip into preflight");
  assert.equal(await page.evaluate(() => window.__columnEvidence.hostWrites), beforeWrites, "preflight writes no local copy");
  await page.evaluate(() => { const e = window.__columnEvidence, data = e.heldExport; e.heldExport = null; e.worker.dispatchEvent(new MessageEvent("message", { data })); });
  await page.waitForFunction(() => !!window.__columnEvidence.held);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
    assert.equal(await d.evaluate(n => n.contains(document.activeElement)), true);
  }
  await page.keyboard.press("Escape"); await d.waitFor();
  const appearance = page.getByRole("button", { name: "Appearance", exact: true }); await appearance.focus();
  await page.evaluate(() => { const e = window.__columnEvidence, data = e.held; e.held = null; e.worker.dispatchEvent(new MessageEvent("message", { data })); });
  await ready(); await d.waitFor({ state: "detached" });
  assert.equal(await appearance.evaluate(n => n === document.activeElement), true);
  checks.push("pending schema dialog keeps Tab inside and defers Escape; newer toolbar focus survives completion");

  const beforeRemoval = await projection();
  await chooseColumnAction("Pending", "Remove");
  d = dialog("Remove column");
  await assertFocused(d.getByRole("button", { name: "Cancel", exact: true }), "removal initially focuses Cancel");
  await page.keyboard.press("Shift+Tab"); assert.equal(await d.evaluate(n => n.contains(document.activeElement)), true, "initial reverse Tab stays inside");
  await page.evaluate(() => { window.__columnEvidence.holdReply = true; });
  const removeAction = d.getByRole("button", { name: "Remove column", exact: true });
  await tabToDialogAction(page, d, removeAction); await page.keyboard.press("Enter");
  await page.waitForFunction(() => !!window.__columnEvidence.held);
  const removalCount = (await commands()).length;
  await assertPendingDialogFocus(page, d, "column-remove");
  assert.equal((await commands()).length, removalCount, "pending removal activation never dispatches another command");
  assert.equal(await d.evaluate(n => n === document.activeElement), true, "empty pending tab order remains on the modal root");
  await page.evaluate(() => { const e = window.__columnEvidence, data = e.held; e.held = null; e.worker.dispatchEvent(new MessageEvent("message", { data })); });
  await ready(); await d.waitFor({ state: "detached" });
  await assertFocused(columnActions(beforeRemoval.columns[0].display_name), "held removal returns to a surviving header disclosure");
  await history("Undo"); assert.deepEqual((await projection()).columns, beforeRemoval.columns); assert.deepEqual((await projection()).rows, beforeRemoval.rows);
  checks.push("held removal: initial Cancel; repeated pending Tab/Shift+Tab stay on root with no enabled descendants; one dispatch; completion returns to surviving header; Undo restores exact state");

  table = await projection(); await chooseColumnAction("Pending", "Rename");
  d = dialog("Rename column"); await d.getByLabel("Column name", { exact: true }).fill("Uncertain");
  await page.evaluate(() => { window.__columnEvidence.loseReply = true; });
  await d.getByRole("button", { name: "Rename column", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  const unknownCount = (await commands()).length;
  await page.locator('.ts-home').getByRole("button", { name: "Refresh", exact: true }).click(); await ready();
  assert.equal((await commands()).length, unknownCount); assert.ok((await projection()).columns.some(c => c.display_name === "Uncertain"));
  checks.push("unknown rename is dispatched once; Refresh observes the real publication without retry");

  await close();
  const capacityFolder = path.join(work, "native-capacity"); await mkdir(path.join(capacityFolder, "entities"), { recursive: true });
  const schema = JSON.parse(j4CanaryText["schemas.json"])[0]; schema.key = "capacity";
  const manifest = JSON.parse(j4CanaryText["manifest.json"]); manifest.document.title = "Native capacity 129";
  await writeFile(path.join(capacityFolder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(capacityFolder, "schemas.json"), JSON.stringify([schema], null, 2) + "\n");
  const shards = Object.fromEntries([..."0123456789abcdef"].map(key => [key, ""]));
  for (let i = 0; i < 129; i++) {
    const id = `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    shards[createHash("sha256").update(id).digest("hex")[0]] += JSON.stringify({ id, key: `r${i}`, schema: schema.id,
      fields: { [schema.fields[0].id]: { kind: "text", value: `p${i}` }, [schema.fields[1].id]: { kind: "number", value: i } } }) + "\n";
  }
  for (const [shard, text] of Object.entries(shards)) await writeFile(path.join(capacityFolder, "entities", `${shard}.jsonl`), text);
  await page.getByTestId("open-project").setInputFiles(capacityFolder); await ready();
  table = await projection(); assert.equal(table.native_table_profile, true); assert.equal(table.rows.length, 129);
  const writersBeforeCapacity = await page.evaluate(() => window.__tachikoAcceptance.exportWriterDispatchCounts());
  await saveCopy("Capacity before columns");
  // Work's capacity-capable v3 writer (Work #580) saves this 129-entity
  // collection itself; no legacy writer is ever dispatched.
  const writersAfterCapacity = await page.evaluate(() => window.__tachikoAcceptance.exportWriterDispatchCounts());
  assert.deepEqual({
    v3Opaque: writersAfterCapacity.v3Opaque - writersBeforeCapacity.v3Opaque,
    legacyOpaque: writersAfterCapacity.legacyOpaque - writersBeforeCapacity.legacyOpaque,
  }, { v3Opaque: 1, legacyOpaque: 0 }, "a capacity copy is written by Work's v3 writer alone");
  checks.push("capacity Save a copy: Work's v3 writer saves the 129-entity collection with no legacy writer");
  const capacityBefore = await projection(), countBefore = (await commands()).length;
  const writesBefore = await page.evaluate(() => window.__columnEvidence.hostWrites);
  const refusal = "Column changes aren't available for this work yet, because it couldn't then be saved. Nothing was changed.";
  for (const width of [1440, 320]) for (const kind of ["Add", "Rename", "Remove"]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
    await page.locator(width === 320 ? ".ts-column-toolbar > summary" : ".ts-column-header summary").first().waitFor();
    if (kind === "Add") d = await add("Blocked", "text", "unchanged");
    else {
      await chooseColumnAction(table.columns[0].display_name, kind); d = dialog(`${kind} column`);
      if (kind === "Rename") await d.getByLabel("Column name", { exact: true }).fill("Blocked");
    }
    await submit(`${kind} column`); await d.getByRole("alert").filter({ hasText: refusal }).waitFor();
    assert.equal(await d.getByRole("alert").innerText(), refusal);
    assert.deepEqual(await projection(), capacityBefore, "preflight refusal changes no schema, values or revision");
    assert.equal((await commands()).length, countBefore, "preflight failure dispatches no column mutation");
    assert.equal(await page.evaluate(() => window.__columnEvidence.hostWrites), writesBefore, "refusal creates or updates no copy");
    assert.equal(await d.evaluate(n => n.contains(document.activeElement)), true);
    await cancel(`${kind} column`);
    if (width === 320) await assertFocused(page.locator(".ts-column-toolbar > summary"), "portable-preflight refusal cancellation returns to Column");
    await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".ts-column-header summary").first().waitFor();
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await ready();
  assert.deepEqual(await projection(), capacityBefore, "a fresh authoritative read confirms every refusal left the work unchanged");
  assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true, "preflights create no history entry");
  // A real scalar edit makes the following bound Save perform a durable write.
  await cell(table, 0, 1).dblclick(); const capacityEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await capacityEditor.fill("777"); await capacityEditor.press("Enter"); await ready();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await saveCopy("Capacity after refused columns"); const savedCapacity = await projection();
  await stop(); await start(); await page.getByRole("button", { name: "Open saved Capacity after refused columns", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).columns, savedCapacity.columns); assert.deepEqual((await projection()).rows, savedCapacity.rows);
  assert.equal(values(await projection())[0][1], 777);
  checks.push("129-row native capacity: all three column actions refuse portable preflight through desktop headers and compact Column menu with exact copy, no dispatch/publication/host write/flag change; scalar edit, bound Save and Save a copy still succeed; full restart/reopen retains exact state");

  const manyHeaders = await assertManyColumnHeaders(page, screens);
  await writeFile(path.join(evidence, "many-column-headers.json"), JSON.stringify(manyHeaders, null, 2));
  checks.push("218 root-cause design: real 20-column native table with long first name; focused middle rename, last removal and add at 320/375/390; focus returns to Column; draft guard; labels-only headers across all profiles/densities and forced colors");

  await stop();
  const result = { status: "PASS", checks, processes, screenshots, dist: path.resolve(dist) };
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, evidence }));
} catch (error) {
  console.error(error);
  if (page && context) { console.error(JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), alerts: [...document.querySelectorAll('[role="alert"]')].map(n => n.textContent) })))); await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true }); }
  await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ status: "FAIL", error: String(error), checks, processes }, null, 2)); process.exitCode = 1;
} finally { await stop(); }

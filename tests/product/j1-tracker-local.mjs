// J1 product acceptance: author, constrain, sort/filter, edit, save and reopen a tracker.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet-j1-"));
const evidence = process.env.J1_OUT ?? path.join(work, "evidence");
await mkdir(evidence, { recursive: true });
const checks = [], processes = [];
const profile = path.join(work, "profile");
let context, pid, page;
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const entry = () => page.locator(".ts-entry-row");
const projection = () => page.evaluate(() => window.__j1Evidence.records.flatMap(record => record.tables).at(-1));
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
    window.__j1Evidence = { records: [], hostWrites: 0 };
    for (const method of ["put", "add", "delete", "clear"]) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) { window.__j1Evidence.hostWrites++; return original.apply(this, args); };
    }
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.record = { requests: [], replies: [], tables: [] };
        window.__j1Evidence.records.push(this.record);
        window.__j1Evidence.worker = this;
        this.addEventListener("message", event => {
          this.record.replies.push(structuredClone(event.data));
          // Tables above 1,000 rows arrive as unfiltered windows; assemble them.
          if (event.data.response?.type === "table") this.record.tables.push(structuredClone(event.data.response.payload));
          if (event.data.response?.type === "table_window") {
            const w = structuredClone(event.data.response.payload);
            if (w.start === 0 || !this.__windowTable || this.__windowTable.revision !== w.revision) this.__windowTable = { ...(w.tracker_profile ? { tracker_profile: true } : {}), ...(w.native_table_profile ? { native_table_profile: true } : {}), revision: w.revision, collection: w.collection, columns: w.columns, rows: [] };
            this.__windowTable.rows.push(...w.rows);
            if (this.__windowTable.rows.length >= w.total_rows) { const assembled = this.__windowTable; this.__windowTable = null; this.record.tables.push(assembled); }
          }
        });
      }
      postMessage(message, ...args) {
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
const dialog = name => page.getByRole("dialog", { name, exact: true });
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
async function chooseImmediateColumnAction(name, action) {
  if (await page.locator(".ts-column-toolbar").count()) {
    const index = (await page.locator(".ts-col-head").allTextContents()).indexOf(name);
    assert.ok(index >= 0);
    await page.locator(".ts-grid tbody tr.ts-row").first().locator(".ts-cell").nth(index).focus();
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await page.getByRole("button", { name: `${action} “${name}”`, exact: true }).click();
    return;
  }
  await page.getByRole("columnheader", { name, exact: true }).hover();
  await columnActions(name).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}
async function submit(name) { await dialog(name).getByRole("button", { name, exact: true }).click(); await ready(); }
async function history(direction) { await page.getByRole("button", { name: direction, exact: true }).click(); await ready(); }
async function saveCopy(name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const d = dialog("Save a copy"); await d.getByLabel("Copy name", { exact: true }).fill(name);
  await d.getByRole("button", { name: "Create copy", exact: true }).click();
  await d.waitFor({ state: "detached" }); await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
}
const rowByName = name => page.locator(".ts-grid tbody tr.ts-row").filter({ hasText: name }).first();
// Synthetic DataTransfer gives deterministic headless clipboard contents (as columns-local does).
async function paste(target, text) {
  await target.evaluate((node, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await ready();
}
async function addEntryRow(row) {
  const fields = entry().locator("[data-entry-field]");
  assert.equal(await fields.count(), row.length);
  // Entry fields are grid cells; a TSV paste into the first fills the draft row (as columns-local does).
  const first = fields.first(); await first.focus(); await paste(first, row.map(String).join("\t"));
  await first.press("Enter"); await ready();
}
async function editDisplayed(name, columnName, value) {
  const table = await projection();
  const rowIndex = table.rows.findIndex(row => row.fields.find(field => field.target.field === table.columns[0].id)?.stored?.value === name);
  const colIndex = table.columns.findIndex(column => column.display_name === columnName);
  assert.ok(rowIndex >= 0 && colIndex >= 0);
  const row = rowByName(name);
  await row.locator(".ts-cell").nth(colIndex).dblclick();
  return page.getByLabel("Edit cell", { exact: true });
}

try {
  await start();

  // 1. Create.
  await page.getByRole("button", { name: "New table", exact: true }).click();
  let d = dialog("New table");
  await d.getByLabel("Table name", { exact: true }).fill("Tracker");
  await d.getByLabel("Column 1 name", { exact: true }).fill("Name");
  await d.getByLabel("Column 1 type", { exact: true }).selectOption("text");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByLabel("Column 2 name", { exact: true }).fill("Status");
  await d.getByLabel("Column 2 type", { exact: true }).selectOption("text");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByLabel("Column 3 name", { exact: true }).fill("Priority");
  await d.getByLabel("Column 3 type", { exact: true }).selectOption("number");
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  checks.push("1 Created Tracker with Name and Status text columns and Priority number column.");

  // 2. Rows.
  const expectedRows = [["試算", "Doing", 1], ["驗收", "Todo", 2], ["入庫", "Todo", 3]];
  for (const row of expectedRows) await addEntryRow(row);
  let table = await projection();
  assert.deepEqual(values(table), expectedRows);
  const originalIds = new Map(table.rows.map((row, i) => [expectedRows[i][0], row.fields[0].target.entity]));
  checks.push("2 Added three rows through the entry row; projected text and numeric values match exactly.");

  // 3. Rules.
  await chooseColumnAction("Status", "Rule");
  d = dialog("Column rule");
  await d.getByLabel("Allowed values", { exact: true }).fill("Todo\nDoing\nDone");
  await d.getByRole("button", { name: "Save rule", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).columns.find(c => c.display_name === "Status").constraint,
    { kind: "text_literal_set", values: ["Doing", "Done", "Todo"] });
  await chooseColumnAction("Priority", "Rule");
  d = dialog("Column rule");
  await d.getByLabel("Lowest value", { exact: true }).fill("1");
  await d.getByLabel("Highest value", { exact: true }).fill("5");
  await d.getByRole("button", { name: "Save rule", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).columns.find(c => c.display_name === "Priority").constraint,
    { kind: "number_inclusive_range", min: 1, max: 5 });
  await page.getByText("Rule updated for Priority. Undo restores it.", { exact: true }).waitFor();
  checks.push("3 Saved exact text-set and inclusive-number-range rules; Priority update status is visible.");

  // 4. Undo/Redo of a rule.
  await history("Undo");
  assert.equal((await projection()).columns.find(c => c.display_name === "Priority").constraint ?? null, null);
  await history("Redo");
  assert.deepEqual((await projection()).columns.find(c => c.display_name === "Priority").constraint,
    { kind: "number_inclusive_range", min: 1, max: 5 });
  checks.push("4 Undo removes the Priority constraint and Redo restores it.");

  // 5. Sort and filter.
  // Rows were entered in ascending Priority, so a descending sort must visibly reorder them.
  await chooseImmediateColumnAction("Priority", "Sort Z → A"); await ready();
  const displayedNames = () => page.locator(".ts-grid tbody tr.ts-row").evaluateAll(rows => rows.map(row => row.querySelector(".ts-cell")?.textContent?.trim()));
  assert.deepEqual(await displayedNames(), ["入庫", "驗收", "試算"]);
  await chooseColumnAction("Status", "Filter");
  await page.getByLabel("Filter Status", { exact: true }).fill("Todo");
  await page.getByLabel("Filter Status", { exact: true }).press("Enter"); await ready();
  assert.deepEqual(await displayedNames(), ["入庫", "驗收"]);
  checks.push("5 Priority descending sort reverses the entered order; with the Status Todo filter, the display is 入庫 then 驗收.");

  // 6. Edit under sort/filter.
  let editor = await editDisplayed("入庫", "Priority", "");
  await editor.fill("5"); await editor.press("Enter"); await ready();
  table = await projection();
  assert.deepEqual(values(table), [["試算", "Doing", 1], ["驗收", "Todo", 2], ["入庫", "Todo", 5]]);
  assert.equal(table.rows.find(row => row.fields.find(field => field.target.field === table.columns[0].id)?.stored?.value === "入庫").fields[0].target.entity,
    originalIds.get("入庫"));
  checks.push("6 Edited 入庫 Priority under the active sort/filter; only its value changed and its entity id is stable.");

  // 7. Refusals keep values and the draft.
  editor = await editDisplayed("入庫", "Priority", "");
  assert.equal(await editor.getAttribute("placeholder"), "1–5");
  const beforeInvalidNumber = await projection();
  await editor.fill("6"); await editor.press("Enter");
  await page.getByRole("alert").waitFor();
  // The refusal names the column and its rule, never Work's internal ids.
  await page.getByText("Priority must be between 1 and 5.", { exact: true }).first().waitFor();
  assert.equal(await editor.inputValue(), "6");
  assert.deepEqual(await projection(), beforeInvalidNumber);
  // Work refused it: the projection, including its revision, is unchanged.
  await editor.press("Escape"); await editor.waitFor({ state: "detached" });
  assert.equal(values(await projection()).find(row => row[0] === "入庫")[2], 5);

  editor = await editDisplayed("驗收", "Status", "");
  assert.equal(await editor.getAttribute("placeholder"), "Doing / Done / Todo");
  // The editor lists the allowed values; arrows highlight, Enter picks without committing.
  const options = page.getByRole("listbox", { name: "Status allowed values" });
  assert.deepEqual(await options.getByRole("option").allTextContents(), ["Doing", "Done", "Todo"]);
  await editor.press("ArrowDown"); await editor.press("ArrowDown"); await editor.press("Enter");
  assert.equal(await editor.inputValue(), "Done");
  await options.waitFor({ state: "detached" });
  // ArrowDown reopens it; a real click (visible, unobstructed) picks and keeps the editor focused.
  await editor.press("ArrowDown");
  await options.getByRole("option", { name: "Todo", exact: true }).click();
  assert.equal(await editor.inputValue(), "Todo");
  assert.equal(await editor.evaluate(node => node === document.activeElement), true);
  const beforeInvalidStatus = await projection();
  await editor.fill("Blocked"); await editor.press("Enter");
  await page.getByRole("alert").waitFor();
  await page.getByText("Status must be one of Doing, Done or Todo.", { exact: true }).first().waitFor();
  assert.equal(await editor.inputValue(), "Blocked");
  assert.deepEqual(await projection(), beforeInvalidStatus);
  await editor.press("Escape"); await editor.waitFor({ state: "detached" });
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByLabel("Find in table").fill("驗收");
  await page.getByLabel("Find in table").press("Enter");
  assert.equal(await page.getByTestId("find-bar").locator(".ts-find-status").textContent(), "1 of 1");
  assert.equal(await rowByName("驗收").locator('[aria-selected="true"]').count(), 1);
  await page.getByLabel("Find in table").press("Escape"); await page.getByTestId("find-bar").waitFor({ state: "detached" });
  // An open cell editor keeps Ctrl/Cmd+F; Find does not take its focus.
  editor = await editDisplayed("驗收", "Status", "");
  await editor.press("ControlOrMeta+f");
  assert.equal(await page.getByTestId("find-bar").count(), 0);
  // The first Escape closes the allowed-values list, the second leaves the editor.
  await editor.press("Escape"); await editor.press("Escape"); await editor.waitFor({ state: "detached" });
  checks.push("7 Invalid Priority 6 and Status Blocked remain as drafts with alerts, leave Work's projection and revision unchanged, and Escape preserves published values; both rule placeholders match and Status lists its allowed values; Enter or a click picks one without committing.");
  checks.push("7b Find locates 驗收, Escape closes the bar, and an open cell editor keeps Ctrl/Cmd+F.");

  // 8. Remove-rule cancel is safe.
  const statusConstraint = (await projection()).columns.find(c => c.display_name === "Status").constraint;
  await chooseColumnAction("Status", "Rule");
  await dialog("Column rule").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await projection()).columns.find(c => c.display_name === "Status").constraint, statusConstraint);
  checks.push("8 Canceling the Status rule dialog keeps its constraint; focus-return check skipped because the desktop menu trigger target is ambiguous.");

  // 9. Save, full restart and reopen.
  const beforeSave = await projection();
  await saveCopy("J1 tracker");
  await stop(); await start();
  await page.getByRole("button", { name: "Open saved J1 tracker", exact: true }).click(); await ready();
  const reopened = await projection();
  assert.deepEqual(reopened.columns, beforeSave.columns);
  assert.deepEqual(reopened.rows, beforeSave.rows);
  checks.push("9 Saved J1 tracker, fully restarted the browser, reopened the copy, and matched columns, constraints, and rows exactly.");

  // 10. Append after reopen.
  const existingRows = (await projection()).rows;
  await addEntryRow(["出貨", "Done", 4]);
  table = await projection();
  assert.equal(table.rows.length, existingRows.length + 1);
  for (const row of existingRows) assert.deepEqual(table.rows.find(candidate => candidate.id === row.id), row);
  assert.ok(values(table).some(row => row[0] === "出貨" && row[1] === "Done" && row[2] === 4));
  checks.push("10 Appended 出貨 / Done / 4 after reopen; the row appears and all prior row identities and contents are unchanged.");

  console.log(JSON.stringify({ status: "PASS", checks }));
} catch (error) {
  console.error(error);
  if (page && context) {
    console.error(JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), alerts: [...document.querySelectorAll('[role="alert"]')].map(n => n.textContent) }))));
    await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true });
  }
  await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ status: "FAIL", error: String(error), checks, processes }, null, 2)); process.exitCode = 1;
} finally { await stop(); }

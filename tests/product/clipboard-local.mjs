// #210 / #217: ordinary grid events with the real pinned Worker/WASM. Observations
// below copy public transport traffic; they never supply semantic results.
import assert from "node:assert/strict";
import { runImportedClipboardCases } from "./clipboard-imported-cases.mjs";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome, homeImportInput, openReleasePlanExample } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet210-"));
const evidence = process.env.CLIPBOARD_OUT ?? work;
const screens = path.join(evidence, "screens");
await mkdir(screens, { recursive: true });
const checks = [], processes = [], screenshots = [];
const commandKey = process.platform === "darwin" ? "Meta" : "Control";
const profile = path.join(work, "profile");
let context, pid, page;
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const status = () => page.locator('.ts-clipboard-status');
const entry = () => page.locator('.ts-entry-row');
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
const projection = () => page.evaluate(() => window.__clipboardEvidence.records.flatMap(record => record.tables).at(-1));
const commands = () => page.evaluate(() => window.__clipboardEvidence.records.flatMap(record => record.requests).filter(message => ["paste_cells", "edit_cells"].includes(message.request?.type)).map(message => message.request));
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
    window.__clipboardEvidence = { records: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.record = { requests: [], replies: [], tables: [] };
        window.__clipboardEvidence.records.push(this.record);
        window.__clipboardEvidence.worker = this;
        this.addEventListener("message", event => {
          this.record.replies.push(structuredClone(event.data));
          // Tables above 1,000 rows arrive as unfiltered windows (Work A-03); assemble them.
          if (event.data.response?.type === "table") this.record.tables.push(structuredClone(event.data.response.payload));
          if (event.data.response?.type === "table_window") {
            const w = structuredClone(event.data.response.payload);
            if (w.start === 0 || !this.__windowTable || this.__windowTable.revision !== w.revision) this.__windowTable = { ...(w.tracker_profile ? { tracker_profile: true } : {}), ...(w.native_table_profile ? { native_table_profile: true } : {}), revision: w.revision, collection: w.collection, columns: w.columns, rows: [] };
            this.__windowTable.rows.push(...w.rows);
            if (this.__windowTable.rows.length >= w.total_rows) { const assembled = this.__windowTable; this.__windowTable = null; this.record.tables.push(assembled); }
          }
          const request = this.record.requests.find(request => request.id === event.data.id);
          if (["paste_cells", "edit_cells"].includes(request?.request?.type) && event.data.response?.type === "published") {
            if (window.__clipboardEvidence.loseReply) {
              window.__clipboardEvidence.loseReply = false;
              event.stopImmediatePropagation();
              this.dispatchEvent(new ErrorEvent("error", { message: "Controlled clipboard acknowledgement loss" }));
            } else if (window.__clipboardEvidence.holdReply) {
              window.__clipboardEvidence.holdReply = false;
              event.stopImmediatePropagation();
              window.__clipboardEvidence.held = event.data;
            }
          }
        });
      }
      postMessage(message, ...args) { this.record.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
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
async function capture(label) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const file = path.join(screens, `${label}-${width}x900.png`);
    await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
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
async function select(table, rows, cols) {
  await cell(table, 0, 0).click();
  for (let c = 1; c < cols; c++) await page.keyboard.press("Shift+ArrowRight");
  for (let r = 1; r < rows; r++) await page.keyboard.press("Shift+ArrowDown");
}
async function unchangedPaste(text, message, polite = false) {
  const before = await projection(), beforeRequests = (await commands()).length;
  const history = await page.getByRole("button", { name: "Undo", exact: true }).getAttribute("disabled");
  await cell(before, 0, 0).click(); await paste(cell(before, 0, 0), text);
  const refusal = status().filter({ hasText: message });
  await refusal.waitFor();
  assert.equal(await refusal.getAttribute("role"), polite ? "status" : "alert", "paste refusal is announced");
  assert.equal(await refusal.getAttribute("aria-live"), polite ? "polite" : "assertive");
  if (!polite) assert.match(await refusal.getAttribute("class"), /ts-dialog-error/);
  assert.deepEqual(await projection(), before, "whole refusal leaves revision and every value unchanged");
  assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).getAttribute("disabled"), history);
  return (await commands()).length - beforeRequests;
}
try {
  await start();
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const d = page.getByRole("dialog", { name: "New table", exact: true });
  await d.getByLabel("Table name", { exact: true }).fill("Clipboard expenses");
  for (const [index, name, type] of [[1, "Item", "text"], [2, "Amount", "number"], [3, "Paid", "boolean"]]) {
    if (index > 1) await d.getByRole("button", { name: "Add column", exact: true }).click();
    await d.getByLabel(`Column ${index} name`, { exact: true }).fill(name);
    await d.getByLabel(`Column ${index} type`, { exact: true }).selectOption(type);
    if (type === "text" || type === "number") await d.getByLabel(`Column ${index} Required`, { exact: true }).check();
  }
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draftFirst = () => entry().locator('[data-entry-field]').first();
  for (const text of ['"Tea\tleaf\nfresh"\t4.5\tTRUE', 'Train\t12\tFALSE']) {
    const before = await projection();
    await draftFirst().focus(); await paste(draftFirst(), text);
    await status().filter({ hasText: "Pasted into the new row" }).waitFor();
    assert.deepEqual(await projection(), before, "draft paste publishes nothing");
    await draftFirst().press("Enter"); await ready();
  }
  let table = await projection();
  assert.deepEqual(values(table), [["Tea\tleaf\nfresh", 4.5, true], ["Train", 12, false]]);
  assert.equal(await page.locator('table[aria-label="Table"] tbody tr').count(), 2);
  checks.push("5 single-row draft paste fills without publication; Enter adds exactly one row");

  await select(table, 2, 3);
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 6);
  const expectedCopy = '"Tea\tleaf\nfresh"\t4.5\ttrue\nTrain\t12\tfalse';
  assert.equal(await copy(cell(table, 1, 2)), expectedCopy);
  assert.equal(await status().filter({ hasText: "Copied 2 rows." }).getAttribute("role"), "status", "copy remains polite");
  await capture("selection");
  await page.keyboard.press("Escape"); assert.equal(await page.locator('.ts-cell--range-selected').count(), 0);
  await cell(table, 0, 0).click(); await cell(table, 1, 2).click({ modifiers: ["Shift"] });
  assert.equal(await copy(cell(table, 1, 2)), expectedCopy, "Shift-click creates the same rectangle");
  await cell(table, 1, 2).click(); assert.equal(await page.locator('.ts-cell--range-selected').count(), 0);
  checks.push("1 exact quoted 2x3 TSV; Shift-arrows, Shift-click, Escape and plain-click selection");

  // Exercise native shortcut delivery too, using browser-managed clipboard permission.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: LOCAL_ORIGIN });
  await select(table, 2, 3); await page.keyboard.press(`${commandKey}+c`);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expectedCopy);
  await context.clearPermissions();
  const clipboardCdp = await context.newCDPSession(page);
  await clipboardCdp.send("Browser.setPermission", { permission: { name: "clipboard-read" }, setting: "denied", origin: LOCAL_ORIGIN });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText().then(() => false, () => true)), true, "denied async Clipboard API access");
  await clipboardCdp.detach();
  // DOM event copy does not need the asynchronous Clipboard API permission.
  assert.equal(await copy(cell(table, 1, 2)), expectedCopy);
  checks.push("native Cmd/Ctrl+C clipboard; event/menu copy independent of Clipboard API permission");

  const baseline = table;
  const pasted = [["Coffee", 6.5, true], ["Bus", 3, false], ["Lunch", 8.25, true]];
  const external = "Coffee\t6.5\tTrUe\r\nBus\t3\tFALSE\r\nLunch\t8.25\tTRUE\r\n";
  const requestCount = (await commands()).length;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: LOCAL_ORIGIN });
  await page.evaluate(text => navigator.clipboard.writeText(text), external);
  await page.keyboard.press(`${commandKey}+v`); await ready();
  await status().filter({ hasText: "Updated 3 rows" }).waitFor();
  assert.equal(await status().filter({ hasText: "Updated 3 rows" }).getAttribute("role"), "status", "success remains polite");
  table = await projection(); assert.deepEqual(values(table), pasted);
  assert.equal((await commands()).length, requestCount + 1, "one paste dispatch");
  assert.equal((await commands()).at(-1).start_entity, baseline.rows[0].fields[0].target.entity, "selection top-left, despite focus at bottom-right");
  assert.equal(await page.locator('table[aria-label="Table"] tbody tr').count(), 3);
  await capture("paste");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, baseline.rows, "one Undo restores exact original rows and IDs");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, table.rows, "one Redo restores pasted rows and IDs");
  checks.push("2 native Cmd/Ctrl+V overwrites two rows and appends one in one command; exact one Undo/Redo");

  assert.equal(await unchangedPaste("bad\tabc\ttrue", /needs a number/), 1);
  const numberRefusal = status().filter({ hasText: /needs a number/ });
  await cell(table, 0, 1).click(); await page.keyboard.press("ArrowDown");
  await numberRefusal.waitFor(); // focus-only navigation must not dismiss it
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme });
    const paint = await numberRefusal.evaluate(node => {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      return { color: style.color, background: style.backgroundColor, border: style.borderTopStyle, width: bounds.width, height: bounds.height };
    });
    assert.ok(paint.width > 0 && paint.height > 0, "refusal remains visible in forced colors");
    assert.notEqual(paint.color, paint.background, "forced colors keeps readable error text");
    assert.equal(paint.border, "solid", "forced colors retains the notice border");
  }
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  await capture("refusal");
  await copy(cell(table, 1, 1));
  assert.equal(await page.locator('.ts-clipboard-status[role="alert"]:visible').count(), 0, "next clipboard action clears refusal");
  await unchangedPaste("bad\tabc\ttrue", /needs a number/);
  await cell(table, 0, 0).press("F2");
  assert.equal(await page.locator('.ts-clipboard-status[role="alert"]:visible').count(), 0, "starting an edit clears refusal");
  await page.getByTestId("cell-editor").press("Escape");
  for (const text of ["bad\t1,300\ttrue", "bad\t$5\ttrue"]) await unchangedPaste(text, /needs a number/);
  assert.equal(await unchangedPaste("bad\t\ttrue", /This Number column needs a value in every row/, true), 0);
  checks.push("3 invalid Number, locale and currency refused by Work; blank required Number refused locally; no revision/history change");
  for (const [text, message] of [["a\tb\nc", /different widths/], ["a\tb\tc\td", /too wide/], ['"unclosed', /unfinished quote/], ['"x"tail', /malformed quotes/], [Array(129).fill("a\t1\ttrue").join("\n"), /128-row/]]) {
    assert.equal(await unchangedPaste(text, message), 0, "structural refusal never dispatches");
  }
  // Refusals must not add even an invisible history entry.
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, baseline.rows);
  assert.equal(await page.locator('.ts-clipboard-status[role="alert"]:visible').count(), 0, "changed grid revision clears refusal");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, table.rows);
  assert.equal(await page.locator('table[aria-label="Table"] td[aria-invalid="true"]').count(), 0, "type-only refusal never invents a cell attribution");
  checks.push("4 ragged, too-wide, malformed and oversized blocks refused before publication; exact history preserved across every refusal");

  // Several whole rows pasted into the new row append to the table in one
  // publication; Undo removes them together.
  await draftFirst().focus(); await paste(draftFirst(), "a\t1\ttrue\nb\t2\tfalse");
  await status().filter({ hasText: "Added 2 rows" }).waitFor(); await ready();
  const appended = values(await projection());
  assert.equal(appended.length, pasted.length + 2, "both pasted rows were appended");
  assert.deepEqual(appended.slice(0, pasted.length), pasted, "existing rows are unchanged");
  assert.deepEqual(appended.slice(pasted.length), [["a", 1, true], ["b", 2, false]], "appended rows hold the pasted typed values in order");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual(values(await projection()), pasted);
  // Under a filter that excludes them, rows added by paste stay visible.
  await chooseColumnAction("Item", "Filter");
  await page.getByLabel("Filter Item", { exact: true }).fill("Coffee");
  await page.getByLabel("Filter Item", { exact: true }).press("Enter"); await ready();
  const visibleItems = () => page.locator(".ts-grid tbody tr.ts-row").evaluateAll(rows => rows.map(row => row.querySelector(".ts-cell")?.textContent?.trim()));
  assert.deepEqual(await visibleItems(), ["Coffee"], "filter shows only Coffee");
  await draftFirst().focus(); await paste(draftFirst(), "Tea\t2\ttrue\nWater\t1\tfalse");
  await status().filter({ hasText: "Added 2 rows" }).waitFor(); await ready();
  assert.deepEqual(await visibleItems(), ["Coffee", "Tea", "Water"], "pasted rows stay visible under the filter");
  await page.getByRole("button", { name: "Clear filter", exact: true }).click(); await ready();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual(values(await projection()), pasted);
  // Existing draft blocks published-grid paste; discard remains ordinary UI.
  await paste(draftFirst(), "draft\t1\ttrue");
  assert.equal(await unchangedPaste("x\t2\tfalse", /Add or discard/), 0);
  await page.locator('.ts-entry-actions').getByRole("button", { name: "Discard", exact: true }).click();
  // Editor paste is native text input. Our grid must not consume its event.
  table = await projection(); await cell(table, 0, 0).dblclick();
  const editor = page.getByTestId("cell-editor");
  const editorEvent = await editor.evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "typed text");
    return node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(editorEvent, true, "grid leaves editor paste default intact");
  await editor.fill("pending input");
  assert.equal(await unchangedPaste("x\t2\tfalse", /Finish the current edit/), 0);
  await editor.press("Escape");
  await cell(table, 0, 0).focus(); await cell(table, 0, 0).dispatchEvent("compositionstart");
  const imeRequests = (await commands()).length;
  await paste(cell(table, 0, 0), "x\t2\tfalse");
  await cell(table, 0, 0).dispatchEvent("compositionend");
  assert.equal((await commands()).length, imeRequests);
  assert.deepEqual(values(await projection()), pasted);
  checks.push("draft multi-row append and undo; pending row/cell guards; editor native paste; IME paste never publishes");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const save = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await save.getByRole("textbox", { name: "Copy name", exact: true }).fill("Clipboard saved");
  await save.getByRole("button", { name: "Create copy", exact: true }).click(); await save.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const saved = await projection(); await stop(); await start();
  await page.getByRole("button", { name: "Open saved Clipboard saved", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, saved.rows); assert.deepEqual(values(await projection()), pasted);
  checks.push("7 Save a copy; full browser process exit; same-profile restart and Home reopen preserve exact values and IDs");

  // A real publication is held only to verify that completion cannot steal focus.
  table = await projection(); await cell(table, 0, 0).focus();
  await page.evaluate(() => { window.__clipboardEvidence.holdReply = true; });
  await cell(table, 0, 0).evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "Later\t9\ttrue");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => !!window.__clipboardEvidence.held);
  const appearance = page.getByRole("button", { name: "Appearance", exact: true }); await appearance.focus();
  await page.evaluate(() => { const evidence = window.__clipboardEvidence; const held = evidence.held; evidence.held = null; evidence.worker.dispatchEvent(new MessageEvent("message", { data: held })); });
  await ready();
  assert.equal(await appearance.evaluate(node => node === document.activeElement), true);
  checks.push("pending paste completion preserves newer toolbar focus");

  table = await projection(); await cell(table, 0, 0).focus();
  await page.evaluate(() => { window.__clipboardEvidence.loseReply = true; });
  await cell(table, 0, 0).evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "Unknown\t10\tfalse");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  const unknownCount = (await commands()).length;
  await page.locator('.ts-home').getByRole("button", { name: "Refresh", exact: true }).click(); await ready();
  assert.equal((await commands()).length, unknownCount, "refresh observes; it never replays paste");
  assert.equal(values(await projection())[0][0], "Unknown", "lost acknowledgement followed one actual publication");
  checks.push("unknown paste outcome: one real publication, Refresh observes without retry");

  await close();
  const csv = new URL("../../acceptance/j3-interop/fixtures/messy.csv", import.meta.url).pathname;
  await (await homeImportInput(page)).setInputFiles(csv);
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  table = await projection(); assert.equal(table.native_table_profile, true, "imported optional Text/Number is structurally native");
  const importedBaseline = table;
  assert.deepEqual(values(table), [[" PEN ", 3, 200], ["NOTE", 2, 500], [" PEN ", 3, 200]]);
  await select(table, 2, 3);
  assert.equal(await copy(cell(table, 1, 2)), " PEN \t3\t200\nNOTE\t2\t500", "imported copy remains exact");
  const importedCount = (await commands()).length;
  const importedPublicationsBefore = await page.evaluate(() => window.__clipboardEvidence.records.reduce((sum, record) => sum + record.replies.filter(reply =>
    reply.response?.type === "published" && record.requests.find(request => request.id === reply.id)?.request?.type === "edit_cells").length, 0));
  await paste(cell(table, 1, 2), "Coffee\t6.5\t20\nBus\t3\t40");
  const importedSuccess = status().filter({ hasText: "Updated 2 rows. Save to keep these changes." });
  await importedSuccess.waitFor();
  assert.equal(await importedSuccess.getAttribute("role"), "status");
  table = await projection();
  const importedPasted = [["Coffee", 6.5, 20], ["Bus", 3, 40], [" PEN ", 3, 200]];
  assert.deepEqual(values(table), importedPasted);
  assert.equal((await commands()).length, importedCount + 1);
  const importedCommand = (await commands()).at(-1);
  assert.equal(importedCommand.type, "edit_cells");
  assert.equal(importedCommand.edits.length, 6);
  assert.deepEqual(importedCommand.edits[0], { target: importedBaseline.rows[0].fields.find(field => field.target.field === table.columns[0].id).target, input: { kind: "text", value: "Coffee" } });
  assert.deepEqual(importedCommand.edits[1].input, { kind: "number", input: "6.5" });
  assert.equal(await page.evaluate(() => window.__clipboardEvidence.records.reduce((sum, record) => sum + record.replies.filter(reply =>
    reply.response?.type === "published" && record.requests.find(request => request.id === reply.id)?.request?.type === "edit_cells").length, 0)), importedPublicationsBefore + 1, "one imported publication receipt");
  assert.equal(await cell(table, 1, 2).evaluate(node => node === document.activeElement), true, "paste preserves focused cell");
  await capture("imported-paste");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, importedBaseline.rows, "one Undo restores every original value and identity");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, table.rows);
  checks.push("217.1 imported 2x3 at selection top-left: one edit_cells, one publication, one Undo/Redo and preserved focus");

  for (const text of ["bad\tabc\t1\nother\t2\t3", "bad\t1,300\t2", "bad\t$5\t2"]) {
    assert.equal(await unchangedPaste(text, /needs a number/), 1);
  }
  // #229: structurally native imported optional Number now clears explicitly.
  const beforeClearPaste = await projection(), beforeClearRequests = (await commands()).length;
  await cell(beforeClearPaste, 0, 0).click(); await paste(cell(beforeClearPaste, 0, 0), "bad\t\t2");
  await status().filter({ hasText: "Updated 1 row" }).waitFor(); await ready();
  assert.equal((await commands()).length, beforeClearRequests + 1);
  assert.deepEqual((await commands()).at(-1).edits[1], { target: { entity: beforeClearPaste.rows[0].id, field: beforeClearPaste.columns[1].id }, input: { kind: "clear" } });
  const afterClearPaste = await projection();
  assert.ok(afterClearPaste.rows[0].blank_fields.includes(beforeClearPaste.columns[1].id));
  assert.equal(afterClearPaste.rows[0].fields.some(field => field.target.field === beforeClearPaste.columns[1].id), false);
  assert.deepEqual(afterClearPaste.rows.slice(1), beforeClearPaste.rows.slice(1));
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, beforeClearPaste.rows, "one Undo restores optional Number presence and all other pasted inputs");
  checks.push("229 imported native optional Number empty paste sends clear and one Undo restores presence and all values");
  await capture("imported-refusal");
  assert.equal(await unchangedPaste("雪".repeat(23_000), /too large/), 1, "UTF-8 request byte limit refuses in Work without truncation");
  assert.deepEqual((await commands()).at(-1).edits[0].input, { kind: "text", value: "雪".repeat(23_000) });
  for (const [text, message] of [["a\tb\nc", /different widths/], ["a\tb\tc\td", /too wide/]]) {
    assert.equal(await unchangedPaste(text, message), 0);
  }
  // Anchor the overflow at the actual final row; do not rely on a size-only check.
  await cell(table, 2, 0).click();
  const appendCount = (await commands()).length, beforeAppend = await projection();
  await paste(cell(table, 2, 0), "a\t1\nb\t3");
  await status().filter({ hasText: "To append rows, paste from the first column and include every column. Nothing was pasted." }).waitFor();
  assert.equal((await commands()).length, appendCount);
  assert.deepEqual(await projection(), beforeAppend);
  // Structural native classification also admits a complete appended row.
  await paste(cell(table, 2, 0), "a\t1\t2\nb\t3\t4");
  await status().filter({ hasText: "Updated 2 rows" }).waitFor();
  assert.equal((await commands()).at(-1).type, "paste_cells");
  assert.deepEqual(values(await projection()), [...importedPasted.slice(0, 2), ["a", 1, 2], ["b", 3, 4]]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, table.rows, "one Undo removes the append and restores its overwritten row");
  // Every refusal must leave the original single-paste history unit on top.
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, importedBaseline.rows);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, table.rows);
  assert.equal(await page.locator('td[aria-invalid="true"]').count(), 0, "type-only error never invents a target");
  checks.push("217.2–3 invalid Number and oversized UTF-8 request refused whole; ragged/wide/partial append never dispatch; structural native full append is one Undo; history unchanged");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const importedSave = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await importedSave.getByRole("textbox", { name: "Copy name", exact: true }).fill("Imported clipboard saved");
  await importedSave.getByRole("button", { name: "Create copy", exact: true }).click();
  await importedSave.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const importedSaved = await projection();
  await stop(); await start();
  await page.getByRole("button", { name: "Open saved Imported clipboard saved", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, importedSaved.rows);
  assert.deepEqual(values(await projection()), importedPasted);
  const expectedExport = [["item", "quantity", "price"], ...importedPasted.map(row => row.map(String))];
  for (const format of ["csv", "xlsx"]) {
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    const downloaded = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const destination = path.join(evidence, `imported-pasted.${format}`);
    await (await downloaded).saveAs(destination);
    await consent.waitFor({ state: "detached" });
    execFileSync("python3", ["-I", new URL("./clipboard-export-oracle.py", import.meta.url).pathname, destination, JSON.stringify(expectedExport)], { stdio: "inherit" });
  }
  checks.push("217.4 Save a copy → full process exit → same-profile restart/reopen preserves values/identities; supported CSV and typed XLSX exports match every cell");
  await close(); await openReleasePlanExample(page); await ready();
  table = await projection();
  const calculated = table.rows.flatMap((row, r) => table.columns.flatMap((column, c) => {
    const field = row.fields.find(field => field.target.field === column.id);
    return field?.calculated?.status === "value" ? [{ r, c, value: String(field.calculated.value) }] : [];
  }))[0];
  assert.ok(calculated, "real example contains a calculated result");
  const calculatedCell = cell(table, calculated.r, calculated.c); await calculatedCell.click();
  assert.equal(await copy(calculatedCell), calculated.value, "copy transfers calculated value, no formula");
  checks.push("calculated result copy is the displayed value with no formula transfer");
  await close();
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dates = page.getByRole("dialog", { name: "New table", exact: true });
  await dates.getByLabel("Table name", { exact: true }).fill("Clipboard dates");
  await dates.getByLabel("Column 1 name", { exact: true }).fill("When");
  await dates.getByLabel("Column 1 type", { exact: true }).selectOption("date");
  await dates.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  await draftFirst().focus(); await paste(draftFirst(), "2026-10-19"); await draftFirst().press("Enter"); await ready();
  assert.equal(await unchangedPaste("10/19/2026", /year first/), 1);
  assert.equal((await commands()).at(-1).edits[0].input.value, "10/19/2026", "raw Date string reached Work unchanged");
  const dateTable = await projection();
  await paste(cell(dateTable, 0, 0), "2026-10-20"); await status().filter({ hasText: "Updated 1 row" }).waitFor();
  assert.deepEqual(values(await projection()), [["2026-10-20"]]);
  const missingData = await cell(await projection(), 0, 0).evaluate(node => node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true })));
  assert.equal(missingData, false); await status().filter({ hasText: "no plain text" }).waitFor();
  checks.push("raw Date refusal with YYYY-MM-DD guidance; valid Date paste; missing clipboard data plain refusal");
  await runImportedClipboardCases({ page, work, ready, close, projection, commands, values, cell, paste, status, unchangedPaste, checks });
  await stop();
  const result = { status: "PASS", checks, processes, screenshots, dist: path.resolve(dist) };
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, evidence }));
} catch (error) {
  console.error(error);
  if (page && context) {
    console.error(JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), messages: [...document.querySelectorAll('[role="alert"], .ts-clipboard-status')].map(node => node.textContent) }))));
    await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true });
  }
  await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ status: "FAIL", error: String(error), checks, processes }, null, 2)); process.exitCode = 1;
} finally { await stop(); }

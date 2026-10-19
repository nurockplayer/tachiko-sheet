// #219: ordinary production UI and real Worker/WASM. The transport observer
// records requests and can hold one real reply; it never manufactures a result.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome, openFolder } from "./home-entry.mjs";
import { j4CanaryText } from "../fixtures/j4-catalog-sales.mjs";
import { fillDraftCell } from "./grid-row-entry-driver.mjs";

const dist = process.env.WORK_DIST ?? "dist";
const out = process.env.WORKBOOK_TABS_OUT ?? "/tmp/sheet219-checks";
const work = await mkdtemp(path.join(tmpdir(), "sheet219-"));
const profile = path.join(work, "profile");
await mkdir(path.join(out, "screens"), { recursive: true });
// The real producer admits at most four XLSX sheets. Long supported names
// exercise overflow at narrow widths; collision names use a separate import.
const names = Array.from({ length: 4 }, (_, i) => "地域別受注明細".repeat(5).slice(0, 28) + (i + 1));
const fixture = path.join(work, "many-tables.xlsx");
// Expand an existing valid XLSX template, replacing only its workbook/sheets.
async function makeWorkbook(file, names) {
  const expanded = path.join(work, path.basename(file) + "-expanded");
  execFileSync("unzip", ["-q", "acceptance/j3-interop/fixtures/messy.xlsx", "-d", expanded]);
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  await writeFile(path.join(expanded, "xl/workbook.xml"), `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="r${i + 1}"/>`).join("")}</sheets></workbook>`);
  await writeFile(path.join(expanded, "xl/_rels/workbook.xml.rels"), `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="r${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  await writeFile(path.join(expanded, "[Content_Types].xml"), `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  for (let i = 0; i < names.length; i++) await writeFile(path.join(expanded, `xl/worksheets/sheet${i + 1}.xml`), `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>item</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>record-${i + 1}</t></is></c></row></sheetData></worksheet>`);
  execFileSync("zip", ["-Xqr", file, "."], { cwd: expanded });
}
await makeWorkbook(fixture, names);
const collisionFixture = path.join(work, "mode-names.xlsx");
await makeWorkbook(collisionFixture, ["Table", "Report"]);
// Canonical multi-table fixture with actual projected notes, opened normally.
const notesFolder = path.join(work, "notes.roproj");
const noteId = "10000000-0000-4000-8000-000000000103";
for (const [name, text] of Object.entries(j4CanaryText)) {
  let value = text;
  if (name === "schemas.json") {
    const schemas = JSON.parse(text);
    schemas.find(s => s.key === "sales").fields.push({ id: noteId, key: "notes", field_type: { type: "text" }, required: true });
    value = JSON.stringify(schemas, null, 2) + "\n";
  } else if (name.startsWith("entities/") && text.trim()) {
    value = text.trim().split("\n").map(line => {
      const row = JSON.parse(line);
      if (row.schema.startsWith("10000000")) row.fields[noteId] = { kind: "text", value: "Keep this note" };
      return JSON.stringify(row);
    }).join("\n") + "\n";
  }
  await mkdir(path.dirname(path.join(notesFolder, name)), { recursive: true });
  await writeFile(path.join(notesFolder, name), value);
}
let context, page;
const checks = [], processes = [];
const button = name => page.getByRole("button", { name, exact: true });
const mode = name => page.getByRole("tab", { name, exact: true });
const tabs = () => page.getByRole("tablist", { name: "Tables", exact: true }).getByRole("tab");
const picker = () => page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
const cells = () => page.getByRole("grid", { name: "Table", exact: true }).locator("tbody tr.ts-row td");
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
async function selected(index) {
  await ready();
  await page.waitForFunction(index => document.querySelectorAll('[aria-label="Tables"] [role="tab"]')[index]?.getAttribute("aria-selected") === "true", index);
  assert.equal(await picker().inputValue(), await picker().locator("option").nth(index).getAttribute("value"));
  assert.equal(await page.locator('[aria-label="Tables"] [role="tab"][tabindex="0"]').count(), 1);
}
async function capture(label) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(out, "screens", `${label}-${width}x${height}.png`), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no page-wide horizontal overflow");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function start() {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const info = await cdp.send("SystemInfo.getProcessInfo"); await cdp.detach();
  processes.push({ pid: info.processInfo.find(p => p.type === "browser").id });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    const e = window.__tabsEvidence = { requests: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args); e.worker = this;
        this.addEventListener("message", event => {
          const request = e.requests.find(r => r.id === event.data.id);
          if (e.hold && request?.request?.type === "edit_scalar" && event.data.response?.type === "published") {
            e.hold = false; e.held = event.data; event.stopImmediatePropagation();
          }
        });
      }
      postMessage(data, ...args) { e.requests.push(structuredClone(data)); return super.postMessage(data, ...args); }
    };
  });
  page = context.pages()[0]; page.setDefaultTimeout(10000);
  page.on("pageerror", error => { throw error; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
}
async function stop() {
  await context.close(); context = undefined;
  const pid = processes.at(-1).pid;
  assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH", "owned process exited before restart");
  processes.at(-1).exitObserved = true;
}
async function close() {
  await page.setViewportSize({ width: 1440, height: 900 });
  await button("Close project").click();
  const d = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await d.count()) await d.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}
async function canceledKey(target, key, extra = {}) {
  return target.evaluate((element, { key, extra }) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
    element.dispatchEvent(event); return event.defaultPrevented;
  }, { key, extra });
}
try {
  await start();
  await button("Open sales example").click(); await ready();
  assert.equal(await tabs().count(), 2);
  const labels = await picker().locator("option").allTextContents();
  assert.deepEqual(await tabs().allTextContents(), labels, "tab order follows workbook/select order");
  await capture("few-tables");
  await tabs().nth(1).click(); await selected(1);
  await tabs().nth(1).press("ArrowLeft"); await selected(0);
  await page.waitForFunction(() => document.querySelector('[aria-label="Tables"] [role="tab"]') === document.activeElement);
  await tabs().nth(0).press("ArrowLeft"); await selected(1);
  await tabs().nth(1).press("ArrowRight"); await selected(0);
  await picker().selectOption(await picker().locator("option").nth(1).getAttribute("value")); await selected(1);
  for (const [key, index] of [["PageUp", 0], ["PageDown", 1]]) {
    await cells().first().focus(); await page.keyboard.press(`Control+${key}`); await selected(index);
  }
  // Browser/OS shortcut ownership: key remains uncanceled outside the workspace,
  // in native editors, with other modifiers, and while composing.
  assert.equal(await canceledKey(mode("Table"), "PageDown"), false);
  await cells().first().dblclick();
  let editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("draft kept");
  assert.equal(await canceledKey(editor, "PageDown"), false);
  await tabs().nth(0).click(); await selected(1);
  await page.getByRole("alert").filter({ hasText: "unfinished input before switching tables" }).waitFor();
  assert.equal(await editor.inputValue(), "draft kept");
  await editor.press("Escape");
  assert.equal(await canceledKey(cells().first(), "PageDown", { isComposing: true }), false);
  assert.equal(await canceledKey(cells().first(), "PageDown", { metaKey: true }), false);
  await cells().first().dispatchEvent("compositionstart");
  await tabs().nth(0).click(); await selected(1);
  await page.getByRole("alert").filter({ hasText: "Finish composing" }).waitFor();
  await cells().first().dispatchEvent("compositionend");
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await tabs().nth(0).click(); await selected(0);
  checks.push("click, roving arrows, select sync, Ctrl+PageUp/Down, editor/IME/browser ownership and cell draft refusal");
  // The Sales example has two real native tables, so a new-row draft can
  // attempt an actual cross-table switch without inventing a workbook shape.
  const rowDraftCell = page.locator(".ts-entry-row td").first();
  await fillDraftCell(page, rowDraftCell, "new-row draft kept");
  await tabs().nth(1).click(); await selected(0);
  await page.getByRole("alert").filter({ hasText: "Add or discard the new row first." }).waitFor();
  assert.equal(await rowDraftCell.textContent(), "new-row draft kept");
  await page.locator(".ts-entry-actions").getByRole("button", { name: "Discard", exact: true }).click();
  checks.push("new-row draft refuses actual cross-table navigation and retains typed input");
  await mode("Report").click();
  const reportTitle = page.locator("#report-title");
  const committedTitle = await reportTitle.inputValue();
  await reportTitle.fill("X".repeat(121));
  await tabs().nth(1).click(); await selected(0);
  await page.getByRole("alert").filter({ hasText: "Apply or cancel the current draft" }).waitFor();
  assert.equal(await reportTitle.inputValue(), "X".repeat(121));
  await reportTitle.fill(committedTitle); await mode("Table").click();
  checks.push("invalid report text draft refuses table navigation without dropping input");
  // Hold a real scalar acknowledgement and attempt table switching while busy.
  await cells().first().dblclick(); editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("pending edit"); await page.evaluate(() => { window.__tabsEvidence.hold = true; });
  await editor.press("Enter"); await page.waitForFunction(() => Boolean(window.__tabsEvidence.held));
  await tabs().nth(1).click();
  assert.equal(await tabs().nth(0).getAttribute("aria-selected"), "true");
  await page.getByRole("alert").filter({ hasText: "operation is in progress" }).waitFor();
  await page.evaluate(() => { const e = window.__tabsEvidence; const data = e.held; e.held = null; e.worker.dispatchEvent(new MessageEvent("message", { data })); });
  await ready(); await tabs().nth(1).click(); await selected(1);
  checks.push("pending real Worker acknowledgement refuses switching");
  await close();
  await openFolder(page, notesFolder); await ready();
  const salesIndex = (await picker().locator("option").evaluateAll(options => options.map(o => o.value))).indexOf("sales");
  await tabs().nth(salesIndex).click(); await selected(salesIndex);
  await mode("Brief").click();
  const notes = page.getByTestId("notes-input"); await notes.fill("retained notes draft");
  await tabs().nth(1 - salesIndex).click(); await selected(salesIndex);
  await page.getByRole("alert").filter({ hasText: "Apply or cancel the current draft" }).waitFor();
  assert.equal(await notes.inputValue(), "retained notes draft");
  await picker().selectOption(await picker().locator("option").nth(1 - salesIndex).getAttribute("value"));
  await selected(salesIndex);
  assert.equal(await notes.inputValue(), "retained notes draft", "the select uses the same draft guard");
  await notes.fill("Keep this note"); await tabs().nth(1 - salesIndex).click(); await selected(1 - salesIndex);
  checks.push("notes field retains editor and blocks switching until draft cleared");
  await close();
  await (await homeImportInput(page)).setInputFiles(collisionFixture);
  let preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.waitFor(); await preview.getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  assert.deepEqual(await tabs().allTextContents(), ["Table", "Report"]);
  for (const name of ["Table", "Report"]) {
    assert.equal(await mode(name).count(), 1, `frozen driver's exact ${name} query resolves uniquely`);
    assert.equal(await page.getByRole("tab", { name: `${name} (table ${name === "Table" ? 1 : 2} of 2)`, exact: true }).count(), 1);
  }
  await tabs().nth(1).click(); await selected(1);
  assert.equal(await cells().first().textContent(), "record-2");
  await close();
  await (await homeImportInput(page)).setInputFiles(fixture);
  preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.waitFor(); await preview.getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  assert.equal(await tabs().count(), names.length);
  assert.deepEqual(await tabs().allTextContents(), names);
  for (const name of ["Table", "Cross-table summary", "Report", "Brief", "Import & export"]) {
    assert.equal(await mode(name).count(), 1, `frozen driver's exact ${name} query stays unique`);
    await mode(name).click(); assert.equal(await mode(name).getAttribute("aria-selected"), "true");
    const panel = page.locator(`#${await mode(name).getAttribute("aria-controls")}`); await panel.waitFor();
    assert.equal(await panel.getAttribute("aria-labelledby"), await mode(name).getAttribute("id"));
  }
  await mode("Table").click();
  // Use the jump select so browser click-to-focus cannot supply the scroll.
  await picker().selectOption(await picker().locator("option").last().getAttribute("value")); await selected(names.length - 1);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(width => {
      const strip = document.querySelector('[aria-label="Tables"]');
      const active = strip.querySelector('[aria-selected="true"]').getBoundingClientRect();
      const port = strip.getBoundingClientRect();
      const overflow = strip.scrollWidth > strip.clientWidth;
      // Font metrics may let four sheets fit on a wide desktop. Whenever
      // they overflow, the select must reveal the last tab without a click.
      return (width !== 390 || overflow) && (!overflow || strip.scrollLeft > 0) &&
        active.left >= port.left - 1 && active.right <= port.right + 1;
    }, width);
  }
  await capture("many-tables");
  // Long names truncate at a readable width; the full name stays available.
  const widths = await tabs().evaluateAll(nodes => nodes.map(node => ({
    width: node.getBoundingClientRect().width, em: parseFloat(getComputedStyle(node).fontSize),
    title: node.title, text: node.textContent, ellipsis: getComputedStyle(node).textOverflow,
  })));
  for (const tab of widths) {
    assert.ok(tab.width <= tab.em * 14 + 1, `table tab stays at most 14em wide: ${JSON.stringify(tab)}`);
    assert.equal(tab.title, tab.text, "a truncated table tab keeps its full name as a tooltip");
    assert.equal(tab.ellipsis, "ellipsis");
  }
  await tabs().last().focus(); await page.keyboard.press("Home"); await selected(0);
  await page.waitForFunction(() => document.querySelector('[aria-label="Tables"] [role="tab"]') === document.activeElement);
  await page.keyboard.press("End"); await selected(names.length - 1);
  await mode("Brief").click();
  await page.getByRole("heading", { name: "Linked facts", exact: true }).waitFor();
  assert.equal(await page.getByText("record-4", { exact: true }).count(), 1);
  assert.equal(await page.getByTestId("notes-input").count(), 0);
  assert.equal(await button("Apply notes").count(), 0);
  await page.getByText("This work has no notes column. Brief shows the linked facts for the selected row.", { exact: true }).waitFor();
  await capture("brief-without-notes");
  checks.push("4-sheet real XLSX import, distinct Table/Report names, truthful mode panels, overflow and Brief without notes");
  await mode("Table").click(); await button("Save a copy").click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("workbook-tabs-reopen");
  await button("Create copy").click(); await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await stop(); await start();
  await button("Open saved workbook-tabs-reopen").click(); await ready();
  assert.deepEqual(await tabs().allTextContents(), names);
  await tabs().last().click(); await selected(3);
  assert.equal(await cells().first().textContent(), "record-4");
  await tabs().first().click(); await selected(0);
  assert.equal(await cells().first().textContent(), "record-1");
  checks.push("Save a copy, full process exit/restart, reopen restores every table and names");
  await close();
  await button("New table").click();
  const newTable = page.getByRole("dialog", { name: "New table", exact: true });
  await newTable.getByRole("textbox", { name: "Table name", exact: true }).fill("Draft row check");
  await newTable.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  await mode("Brief").click();
  await page.getByRole("tabpanel", { name: "Brief", exact: true }).waitFor();
  await page.getByText("Add a row in Table to see its linked facts here.", { exact: true }).waitFor();
  await mode("Table").click();
  const draftCell = page.locator(".ts-entry-row td").first();
  await fillDraftCell(page, draftCell, "retained row");
  await tabs().first().click();
  assert.equal(await draftCell.textContent(), "retained row");
  assert.equal(await picker().isDisabled(), true);
  assert.equal(await canceledKey(draftCell, "PageDown"), false, "one table does not capture browser shortcut");
  assert.equal(await page.locator(".ts-table-row-actions").count(), 1, "row-actions bar remains intact");
  checks.push("native new-row draft retained; single-table shortcut left to browser; row-actions bar intact");
  await stop();
  await writeFile(path.join(out, "workbook-tabs.json"), JSON.stringify({ status: "PASS", dist, checks, processes }, null, 2));
  console.log(JSON.stringify({ status: "PASS", checks, out }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await writeFile(path.join(out, "failure.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: path.join(out, "failure.png") });
  }
  throw error;
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}

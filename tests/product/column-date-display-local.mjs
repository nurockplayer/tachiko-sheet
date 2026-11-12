// Real XLSX date formats through import, editing, history and local save.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const work = await mkdtemp(path.join(tmpdir(), "sheet-date-display-"));
const expanded = path.join(work, "xlsx");
const fixture = path.join(work, "dates.xlsx");
const formats = ["yyyy-mm-dd", "m/d/yyyy", "d/m/yyyy", "yyyy/m/d", 'yyyy"年"m"月"d"日"', "mmm d, yyyy", "d mmm yyyy"];
const expected = ["2026-11-07", "11/7/2026", "7/11/2026", "2026/11/7", "2026年11月7日", "Nov 7, 2026", "7 Nov 2026"];
let context;
try {
  await mkdir(expanded);
  execFileSync("python3", ["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", "acceptance/j3-interop/fixtures/messy.xlsx", expanded]);
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  await writeFile(path.join(expanded, "xl/workbook.xml"), `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Dates" sheetId="1" r:id="r1"/><sheet name="Other" sheetId="2" r:id="r2"/></sheets></workbook>`);
  await writeFile(path.join(expanded, "xl/_rels/workbook.xml.rels"), `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  await writeFile(path.join(expanded, "[Content_Types].xml"), `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1, 2].map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  const xml = s => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  await writeFile(path.join(expanded, "xl/styles.xml"), `<styleSheet xmlns="${main}"><numFmts count="7">${formats.map((f, i) => `<numFmt numFmtId="${164+i}" formatCode="${xml(f)}"/>`).join("")}</numFmts><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf/>${formats.map((_, i) => `<xf numFmtId="${164+i}" applyNumberFormat="1"/>`).join("")}</cellXfs></styleSheet>`);
  const headers = [...formats.map((_, i) => `Date${i+1}`), "Note"];
  const header = headers.map((h, i) => `<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${h}</t></is></c>`).join("");
  const row = (n, date, note) => `<row r="${n}">${formats.map((_, i) => `<c r="${String.fromCharCode(65+i)}${n}" s="${i+1}" t="d"><v>${date}</v></c>`).join("")}<c r="H${n}" t="inlineStr"><is><t>${note}</t></is></c></row>`;
  await writeFile(path.join(expanded, "xl/worksheets/sheet1.xml"), `<worksheet xmlns="${main}"><sheetData><row r="1">${header}</row>${row(2, "2026-11-07", "later")}${row(3, "2026-01-02", "earlier")}</sheetData></worksheet>`);
  await writeFile(path.join(expanded, "xl/worksheets/sheet2.xml"), `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Other</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>value</t></is></c></row></sheetData></worksheet>`);
  execFileSync("python3", ["-c", "import os,sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); [(z.write(os.path.join(root,f),os.path.relpath(os.path.join(root,f),sys.argv[2]))) for root,dirs,files in os.walk(sys.argv[2]) for f in files]; z.close()", fixture, expanded]);
  context = await chromium.launchPersistentContext(path.join(work, "profile"), { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, process.env.WORK_DIST ?? "dist-acceptance");
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.setViewportSize({ width: 1600, height: 900 }); await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(fixture);
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true }); await preview.waitFor();
  const types = preview.locator(".ts-import-column select");
  for (let i = 0; i < 7; i++) await types.nth(i).selectOption("date");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const rows = () => grid.locator("tbody tr.ts-row");
  const values = () => rows().first().locator(".ts-cell").allTextContents();
  const check = async () => assert.deepEqual((await values()).slice(0, 7).map(s => s.trim()), expected);
  await ready(); await check();
  // Change an imported Date column through every choice, then clear it.
  const chooseDate = async label => {
    await grid.getByRole("columnheader", { name: "Date1", exact: true }).hover();
    await page.getByRole("button", { name: "Column actions for Date1", exact: true }).click();
    await page.getByRole("button", { name: "Date format…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Date format", exact: true });
    await dialog.getByRole("radio", { name: label, exact: true }).check();
    await dialog.getByRole("button", { name: "Save format", exact: true }).click();
    await dialog.waitFor({ state: "hidden" }); await ready();
    assert.equal((await values())[0].trim(), label);
  };
  for (const label of ["2026/11/7", "2026年11月7日", "11/7/2026", "7/11/2026", "Nov 7, 2026", "7 Nov 2026", "2026-11-07"]) await chooseDate(label);
  for (const label of ["7 Nov 2026", "Nov 7, 2026"]) {
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
    assert.equal((await values())[0].trim(), label);
  }
  for (const label of ["7 Nov 2026", "2026-11-07"]) {
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
    assert.equal((await values())[0].trim(), label);
  }
  await chooseDate("2026/11/7"); expected[0] = "2026/11/7";
  await check();
  await rows().first().locator(".ts-cell").nth(7).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("changed"); await editor.press("Enter"); await ready(); await check();
  const tabs = page.getByRole("tablist", { name: "Tables", exact: true }).getByRole("tab");
  assert.equal(await tabs.count(), 2);
  await tabs.nth(1).click(); await ready();
  await tabs.nth(0).click(); await ready(); await check();
  for (const name of ["Undo", "Redo"]) { await page.getByRole("button", { name, exact: true }).click(); await ready(); await check(); }
  await rows().first().locator(".ts-cell").nth(1).dblclick(); assert.equal(await editor.inputValue(), "2026-11-07");
  await editor.fill("2026-11-07"); await editor.press("Enter"); await ready(); await check();
  await grid.getByRole("columnheader", { name: "Date2", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Date2", exact: true }).click();
  await page.getByRole("button", { name: "Sort A → Z", exact: true }).click(); await ready();
  assert.equal((await values())[7].trim(), "earlier");
  // Record what Find and the filter picker expose for Work's display text.
  await page.keyboard.press("ControlOrMeta+F");
  await page.getByLabel("Find in table").fill("2026/11/7");
  console.log("Date Find:", await page.locator(".ts-find-status").textContent());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await grid.getByRole("columnheader", { name: "Date1", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Date1", exact: true }).click();
  await page.getByRole("button", { name: "Filter…", exact: true }).click();
  await page.getByLabel("Filter type for Date1").selectOption("values");
  console.log("Date filter values:", (await page.locator(".ts-filter-values").textContent()).trim());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Date formats");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  try { await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor(); } catch (error) { console.log("Save diagnostics:", await page.locator("[role=alert]").allTextContents(), await page.getByTestId("save-status").allTextContents()); throw error; }
  await page.getByRole("button", { name: "Close project", exact: true }).click(); await waitForColdHome(page);
  await page.getByRole("button", { name: "Open saved Date formats", exact: true }).click(); await ready();
  const all = await rows().locator(".ts-cell").allTextContents();
  assert.ok(expected.every(value => all.some(text => text.trim() === value)));
  // Download and import the saved workbook to check the format survives XLSX.
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
  const downloadDialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  const downloaded = page.waitForEvent("download");
  await downloadDialog.getByRole("button", { name: "Download", exact: true }).click();
  const exported = path.join(work, "exported.xlsx"); await (await downloaded).saveAs(exported);
  await page.getByRole("button", { name: "Close project", exact: true }).click(); await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(exported);
  const reimport = page.getByRole("dialog", { name: "Review import preview", exact: true }); await reimport.waitFor();
  await reimport.getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  assert.ok((await rows().locator(".ts-cell").allTextContents()).some(text => text.trim() === "2026/11/7"));
  // A newly created Date column follows the same display path as an import.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const newTable = page.getByRole("dialog", { name: "New table", exact: true });
  await newTable.getByLabel("Table name", { exact: true }).fill("New dates");
  await newTable.getByLabel("Column 1 name", { exact: true }).fill("Date1");
  await newTable.getByLabel("Column 1 type", { exact: true }).selectOption("date");
  await newTable.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  await draft.focus();
  await draft.evaluate(node => { const data = new DataTransfer(); data.setData("text/plain", "2026-11-07"); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  await draft.press("Enter"); await ready();
  for (const label of ["2026/11/7", "2026年11月7日", "11/7/2026", "7/11/2026", "Nov 7, 2026", "7 Nov 2026", "2026-11-07"]) await chooseDate(label);
  console.log("PASS: new Date column displays all seven formats");
  console.log("PASS: XLSX date display, editing, tabs, history, sorting and save/reopen");
} finally { if (context) await context.close(); await rm(work, { recursive: true, force: true }); }

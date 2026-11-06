// Work #663 (re-pin 71032325): a new row added to a table with a calculated
// column calculates by itself, and that value survives Save a copy, reopen,
// CSV and XLSX export. Normal UI, real pinned Worker/WASM, production bytes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet663-"));
const evidence = process.env.CALCULATED_ROW_OUT ?? path.join(work, "evidence");
await mkdir(evidence, { recursive: true });
const checks = [], downloads = [];
let context, page;
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const entry = () => page.locator(".ts-entry-row");
const dialog = name => page.getByRole("dialog", { name, exact: true });
const projection = () => page.evaluate(() => window.__calculatedRow.workers[0].tables.at(-1));
const cell = (table, r, c) => page.getByTestId(`cell:${table.rows[r].fields[0]?.target.entity ?? table.rows[r].id}:${table.columns[c].id}`);
const values = table => table.rows.map(row => table.columns.map(column => row.fields.find(field => field.target.field === column.id)?.stored?.value));

async function openAddColumn() {
  await page.getByRole("button", { name: "+ column", exact: true }).click();
  return dialog("Add column");
}

async function add(name, type, fill) {
  const d = await openAddColumn();
  await d.getByLabel("Column name", { exact: true }).fill(name);
  await d.getByLabel("Column type", { exact: true }).selectOption(type);
  await d.getByLabel("Required", { exact: true }).check();
  if (fill !== undefined) await d.getByLabel(/^Fill all/).fill(fill);
  await d.getByRole("button", { name: "Add column", exact: true }).click(); await ready();
  await d.waitFor({ state: "detached" });
  return d;
}

async function pageState() {
  return page.evaluate(() => ({
    nativeTableProfile: window.__calculatedRow.workers[0]?.tables.at(-1)?.native_table_profile ?? null,
    entryRows: document.querySelectorAll(".ts-entry-row").length,
    addRowButtons: [...document.querySelectorAll("button")].filter(node => node.textContent.trim() === "Add row").length,
    hints: [...document.querySelectorAll(".ts-hint")].map(node => node.textContent.trim()).filter(Boolean),
    alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent.trim()),
  }));
}

async function saveCopy(name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const d = dialog("Save a copy");
  await d.getByLabel("Copy name", { exact: true }).fill(name);
  await d.getByRole("button", { name: "Create copy", exact: true }).click();
  await d.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
}

async function closeProject() {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = dialog("Unsaved work");
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}

const parse = file => JSON.parse(execFileSync("python3", ["-I", "-c", String.raw`
import json, sys, csv, zipfile, xml.etree.ElementTree as E
p = sys.argv[1]
if p.endswith(".csv"):
    with open(p, encoding="utf-8-sig", newline="") as f:
        out = {"rows": list(csv.reader(f))}
else:
    n = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(p) as z:
        sheet = E.fromstring(z.read("xl/worksheets/sheet1.xml"))
    formulas = []
    for cell in sheet.findall(".//s:c", n):
        formula = cell.findtext("s:f", namespaces=n)
        if formula is not None:
            formulas.append({"r": cell.get("r"), "formula": formula, "value": cell.findtext("s:v", default="", namespaces=n)})
    out = {"formulas": formulas}
print(json.dumps(out, ensure_ascii=False))
`, file], { encoding: "utf8" }));

async function prepare(format) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const trigger = page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true });
  const count = downloads.length;
  await trigger.click();
  const consent = dialog("Confirm download");
  if (!(await consent.waitFor({ timeout: 5000 }).then(() => true).catch(() => false))) {
    const refusal = await page.getByRole("region", { name: "Download spreadsheet", exact: true }).getByRole("alert").textContent().catch(() => "");
    throw new Error(`Prepare ${format.toUpperCase()} offered no download: ${refusal.trim() || (await pageState()).alerts.join(" | ")}`);
  }
  const downloaded = page.waitForEvent("download");
  await consent.getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(work, `download-${count}.${format}`);
  await (await downloaded).saveAs(file);
  await consent.waitFor({ state: "detached" });
  return { file, ...parse(file) };
}

try {
  context = await chromium.launchPersistentContext(path.join(work, "profile"), { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__calculatedRow = { workers: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        const worker = { tables: [] };
        window.__calculatedRow.workers.push(worker);
        this.addEventListener("message", event => {
          if (event.data.response?.type === "table") worker.tables.push(structuredClone(event.data.response.payload));
          if (event.data.response?.type === "table_window") {
            const windowTable = structuredClone(event.data.response.payload);
            if (windowTable.start === 0 || !worker.windowTable || worker.windowTable.revision !== windowTable.revision) {
              worker.windowTable = { ...(windowTable.native_table_profile ? { native_table_profile: true } : {}), revision: windowTable.revision, collection: windowTable.collection, columns: windowTable.columns, rows: [] };
            }
            worker.windowTable.rows.push(...windowTable.rows);
            if (worker.windowTable.rows.length >= windowTable.total_rows) { worker.tables.push(worker.windowTable); worker.windowTable = null; }
          }
        });
      }
    };
  });
  page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(10000);
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);

  // 1. A native table, rows with an Amount, then an optional Number column
  //    that holds the formula [.amount] * 2 in every row.
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const setup = dialog("New table");
  await setup.getByLabel("Table name", { exact: true }).fill("Calculated");
  await setup.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await setup.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  for (const text of ["Tea", "Train", "Lunch"]) {
    await fillDraftCell(page, entry().getByLabel("New row Item (Text)", { exact: true }), text);
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  }
  await add("Amount", "number", "12.5");
  let d = await openAddColumn();
  await d.getByLabel("Column name", { exact: true }).fill("Double");
  await d.getByLabel("Column type", { exact: true }).selectOption("number");
  await d.getByLabel("Required", { exact: true }).uncheck();
  await d.getByRole("button", { name: "Add column", exact: true }).click(); await ready();
  await d.waitFor({ state: "detached" });
  let table = await projection();
  const amountAt = table.columns.findIndex(column => column.display_name === "Amount");
  const doubleAt = table.columns.findIndex(column => column.display_name === "Double");
  assert.equal(amountAt, 1); assert.equal(doubleAt, 2, "the added calculated column lands last");
  assert.ok(values(table).every(row => row[doubleAt] === undefined), "the optional Double column starts blank");
  const amountKey = table.columns[amountAt].key;
  assert.equal(amountKey, "amount");
  const doubled = values(table).map(row => String(row[amountAt] * 2));
  const doubleText = async snapshot => Promise.all(snapshot.rows.map((_, r) => cell(snapshot, r, doubleAt).textContent().then(text => text.trim())));
  await cell(table, 0, doubleAt).click();
  const formulaBar = page.getByTestId("formula-bar-input");
  await formulaBar.fill(`[.${amountKey}] * 2`); await formulaBar.press("Enter"); await ready();
  await page.waitForFunction(`document.querySelector('[data-testid="cell:${table.rows[0].fields[0]?.target.entity ?? table.rows[0].id}:${table.columns[doubleAt].id}"]')?.textContent.trim() === "${doubled[0]}"`);
  await cell(table, 0, doubleAt).click(); await cell(table, table.rows.length - 1, doubleAt).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+d"); await ready();
  assert.deepEqual(await doubleText(table), doubled, "the formula calculates in every existing row after fill down");
  checks.push("1 calculated column: [.amount] * 2 entered in the first Double cell and filled down with Ctrl+D shows Amount × 2 in every row");

  // 2. A row is added through the visible entry row, as a user would.
  const state = await pageState();
  assert.ok(state.entryRows === 1 && state.addRowButtons === 1,
    `2 add a row: after the formula the entry row is missing (nativeTableProfile=${state.nativeTableProfile}, entryRows=${state.entryRows}, addRowButtons=${state.addRowButtons}, hints=${JSON.stringify(state.hints)}, alerts=${JSON.stringify(state.alerts)})`);
  const before = await projection();
  await fillDraftCell(page, entry().getByLabel("New row Item (Text)", { exact: true }), "Bus");
  await fillDraftCell(page, entry().getByLabel("New row Amount (Number)", { exact: true }), "21");
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  table = await projection();
  assert.equal(table.rows.length, before.rows.length + 1, "Add row publishes the new row");
  const newRow = table.rows.at(-1);
  const newEntity = newRow.fields[0]?.target.entity ?? newRow.id;
  const newValues = values(table).at(-1);
  assert.equal(newValues[0], "Bus"); assert.equal(newValues[amountAt], 21);
  // 3. The new row's calculated cell shows Amount × 2 without typing a formula there.
  const calcCell = page.getByTestId(`cell:${newEntity}:${table.columns[doubleAt].id}`);
  let shown = "";
  try {
    await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.textContent.trim() === "42", `cell:${newEntity}:${table.columns[doubleAt].id}`, { timeout: 5000 });
    shown = "42";
  } catch { shown = (await calcCell.textContent() ?? "").trim(); }
  assert.equal(shown, "42", `3 new row calculates: cell showed ${JSON.stringify(shown)} instead of 42 (amount 21, projected field ${JSON.stringify(newRow.fields.find(field => field.target.field === table.columns[doubleAt].id) ?? null)}, page ${JSON.stringify(await pageState())})`);
  checks.push("2-3 add a row through the entry row; its calculated cell shows 21 × 2 = 42 without a typed formula");

  // 4. Save a copy, close, reopen that copy: every row matches.
  const savedTable = await projection();
  await saveCopy("Calculated rows");
  await closeProject();
  await page.getByRole("button", { name: "Open saved Calculated rows", exact: true }).click(); await ready();
  const reopened = await projection();
  const reopenedValues = values(reopened);
  assert.deepEqual(reopenedValues, values(savedTable), "reopen restores every row's stored values");
  const reopenedNew = reopened.rows.at(-1);
  const reopenedEntity = reopenedNew.fields[0]?.target.entity ?? reopenedNew.id;
  const reopenedDoubleAt = reopened.columns.findIndex(column => column.display_name === "Double");
  assert.equal((await page.getByTestId(`cell:${reopenedEntity}:${reopened.columns[reopenedDoubleAt].id}`).textContent()).trim(), "42", "the reopened calculated cell still shows 42");
  checks.push("4 Save a copy, close, reopen: all rows including the new row's Amount 21 and calculated 42 match");

  // 5. CSV carries the value; XLSX carries the formula with its cached value.
  const csv = await prepare("csv");
  assert.deepEqual(csv.rows[0], ["Item", "Amount", "Double"]);
  assert.deepEqual(csv.rows.at(-1), ["Bus", "21", "42"], "the new row's calculated value is in the CSV");
  const xlsx = await prepare("xlsx");
  const lastRow = csv.rows.length;
  const newFormula = xlsx.formulas.find(formula => formula.r === `C${lastRow}`);
  assert.ok(newFormula, `the new row's Double cell is an XLSX formula (formulas: ${JSON.stringify(xlsx.formulas)})`);
  assert.equal(newFormula.formula, `(B${lastRow}*2)`, "the exported formula refers to the same row's Amount");
  assert.equal(newFormula.value, "42", "the exported formula keeps its calculated value");
  checks.push("5 CSV includes the new row's 42; its XLSX cell is a formula (B5*2) with cached value 42");
  await writeFile(path.join(evidence, "result.json"), JSON.stringify({ status: "PASS", checks }, null, 2));
  console.log(JSON.stringify({ status: "PASS", checks, dist: path.resolve(dist) }));
} catch (error) {
  console.error(error);
  if (page) console.error(JSON.stringify({ status: "FAIL", error: String(error), page: await pageState().catch(() => null), checks }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}

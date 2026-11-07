// #305: one named case per Excel-feel habit. This harness only reports what the
// product does today; it never changes product code and never softens a check.
// Every case drives real input through Chromium on Linux, so Ctrl shortcuts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("HARNESS: WORK_DIST must name a built product."); process.exit(1); }
const invoice = fileURLToPath(new URL("../fixtures/excel/invoice.xlsx", import.meta.url));
const CASE_TIMEOUT_MS = 25_000;
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}) };

class SetupFailure extends Error {}

let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (cause) {
  console.error("HARNESS: Chromium did not launch:", firstLine(cause));
  process.exit(1);
}

function firstLine(cause) {
  const lines = String((cause && cause.message) || cause).split("\n").map((line) => line.trim()).filter(Boolean);
  const waited = lines.find((line) => line.startsWith("- waiting for"));
  const head = lines[0] ?? "";
  const text = waited ? `${head}; ${waited.replace(/^-\s*/, "")}` : `${head}${lines[1] ? ` (${lines[1]})` : ""}`;
  return text.slice(0, 300);
}

function evidence() {
  window.__habits = { tables: [] };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (event) => {
        if (event.data && event.data.response && event.data.response.type === "table") window.__habits.tables.push(structuredClone(event.data.response.payload));
      });
    }
  };
}

const ready = (page) => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = (page) => page.evaluate(() => window.__habits.tables.at(-1));
const activeId = (page) => page.evaluate(() => document.activeElement?.dataset?.testid ?? null);
const executeCount = (page) => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const selectedCount = (page) => page.locator(".ts-cell--range-selected").count();

function rowEntity(row) {
  const field = row.fields.find((candidate) => candidate && candidate.target && candidate.target.entity);
  assert.ok(field, "a projected row carries an entity");
  return field.target.entity;
}

function cellIdFor(table, row, column) {
  return `cell:${rowEntity(table.rows[row])}:${table.columns[column].id}`;
}

function fieldAt(table, row, column) {
  return table.rows[row].fields.find((candidate) => candidate && candidate.target && candidate.target.field === table.columns[column].id);
}

async function cellText(page, table, row, column) {
  return (await page.getByTestId(cellIdFor(table, row, column)).textContent()).trim();
}

async function settle(page) {
  await page.waitForTimeout(150);
  await ready(page);
}

async function waitForCellText(page, id, text) {
  await page.waitForFunction(({ id, text }) => Array.from(document.querySelectorAll("[data-testid]"))
    .find((node) => node.dataset.testid === id)?.textContent?.trim() === text, { id, text });
}

async function home(page) {
  try {
    await page.goto(LOCAL_ORIGIN);
    await waitForColdHome(page);
  } catch (cause) {
    throw new SetupFailure(`the Home page did not load: ${firstLine(cause)}`);
  }
}

async function example(page) {
  await home(page);
  await openReleasePlanExample(page);
  await ready(page);
}

async function newTable(page, name, columns) {
  await home(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.waitFor();
  await dialog.getByLabel("Table name", { exact: true }).fill(name);
  for (let index = 0; index < columns.length; index += 1) {
    if (index > 0) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
    await dialog.getByLabel(`Column ${index + 1} name`, { exact: true }).fill(columns[index].name);
    if (columns[index].type) await dialog.getByLabel(`Column ${index + 1} type`, { exact: true }).selectOption(columns[index].type);
  }
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await ready(page);
}

// Real keyboard entry through the draft row; Enter on any filled column publishes.
async function addRow(page, values, expectedRows) {
  const cells = page.locator(".ts-entry-row td[data-entry-field]");
  const count = await cells.count();
  assert.ok(values.length > 0 && values.length <= count, "the entry row has a cell for every value");
  for (let index = 0; index < values.length; index += 1) {
    await cells.nth(index).dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    if (values[index] !== "") await page.keyboard.type(String(values[index]));
    await page.keyboard.press(index === values.length - 1 ? "Enter" : "Tab");
  }
  await page.waitForFunction((rows) => window.__habits.tables.at(-1)?.rows.length === rows, expectedRows);
  await ready(page);
}

async function replaceCell(page, id, text) {
  await page.getByTestId(id).dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.waitFor();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await settle(page);
}

async function dragCells(page, from, to) {
  const start = await page.getByTestId(from).boundingBox();
  const end = await page.getByTestId(to).boundingBox();
  assert.ok(start && end, "both drag cells are visible");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

async function columnAction(page, column, action) {
  await page.getByRole("columnheader", { name: column, exact: true }).hover();
  await page.getByRole("button", { name: `Column actions for ${column}`, exact: true }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
  await settle(page);
}

async function filterValues(page, column, values) {
  await columnAction(page, column, "Filter…");
  await page.getByLabel(`Filter type for ${column}`).selectOption("values");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  for (const value of values) await page.getByLabel(value, { exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await settle(page);
}

async function saveCopy(page, name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByLabel("Copy name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByLabel("Copy name", { exact: true }).waitFor({ state: "detached" });
  await ready(page);
}

async function duplicate(page, name) {
  await page.getByRole("button", { name: "Duplicate table…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Duplicate table", exact: true });
  await dialog.waitFor();
  await dialog.getByLabel("Table name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await ready(page);
}

async function filledColumn(page, table, column, rows) {
  const later = await projection(page);
  return Array.from({ length: rows }, (_, index) => fieldAt(later, index, column)?.stored?.value);
}

function sheetXml(file) {
  return execFileSync("python3", ["-I", "-c", String.raw`
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    print("\n".join(archive.read(name).decode("utf-8", "replace") for name in archive.namelist() if name.endswith(".xml")))
`, file], { encoding: "utf8", maxBuffer: 8 << 20 });
}

const cases = [
  { id: "01", name: "First launch", tier: "A", manual: "needs a clean OS install" },
  { id: "02", name: "New workbook", tier: "A", run: async (page) => {
    await home(page);
    await page.keyboard.press("Control+n");
    const opened = await page.getByRole("grid", { name: "Table", exact: true }).waitFor({ timeout: 2000 }).then(() => true, () => false);
    assert.ok(opened, "Ctrl+N opened no blank workbook; Home still shows only the start screen");
    await page.locator(".ts-entry-row td[data-entry-field]").first().click();
    await page.keyboard.type("Hello");
    await page.keyboard.press("Enter");
    await settle(page);
  } },
  { id: "03", name: "Blank-cell typing", tier: "A", run: async () => {
    // The draft row belongs to a table, and case 04 covers it. Replace this with
    // the real gesture when a blank workbook has cells outside a table (Work #668).
    assert.fail("there is no cell outside a table to type in");
  } },
  // The first case to open the app pays for the kit's cold start, which has passed 4 s under load.
  { id: "04", name: "Add data below table", tier: "A", waitMs: 15_000, run: async (page) => {
    await newTable(page, "Below", [{ name: "Item" }, { name: "Qty", type: "number" }]);
    await addRow(page, ["one", "1"], 1);
    await addRow(page, ["two", "2"], 2);
    const after = await projection(page);
    assert.equal(after.rows.length, 2, "typing under the last record added no semantic record");
    assert.equal(await cellText(page, after, 1, 0), "two", "the new record is not on the correct displayed row");
  } },
  { id: "05", name: "Add data beside table", tier: "A", run: async (page) => {
    await example(page);
    const before = await projection(page);
    const ids = before.columns.map((column) => column.id);
    const last = page.getByTestId(cellIdFor(before, 0, before.columns.length - 1));
    const box = await last.boundingBox();
    await page.mouse.click(box.x + box.width + 40, box.y + box.height / 2);
    await page.keyboard.type("Extra");
    await page.keyboard.press("Enter");
    await settle(page);
    const after = await projection(page);
    assert.equal(after.columns.length, before.columns.length + 1, "typing to the right of the last column created no field");
    assert.deepEqual(after.columns.slice(0, ids.length).map((column) => column.id), ids, "existing field ids changed");
  } },
  { id: "06", name: "Mixed values", tier: "A", run: async (page) => {
    await newTable(page, "Mixed", [{ name: "Value", type: "number" }]);
    await addRow(page, ["123"], 1);
    const cell = page.locator(".ts-entry-row td[data-entry-field]").first();
    await cell.dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("N/A");
    await page.keyboard.press("Enter");
    await settle(page);
    const after = await projection(page);
    assert.equal(after.rows.length, 2, "a Number column refused N/A; an Excel worksheet column accepts mixed values");
    assert.equal(String(fieldAt(after, 1, 0)?.stored?.value), "N/A", "N/A did not survive as typed");
  } },
  { id: "07", name: "Type to replace", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    await page.getByTestId(id).click();
    await page.keyboard.type("X");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), "X", "typing appended to the old contents instead of replacing them");
    await page.keyboard.press("Enter");
    await waitForCellText(page, id, "X");
  } },
  { id: "08", name: "Edit existing cell", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    const original = await cellText(page, table, 0, 0);
    await page.getByTestId(id).press("F2");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), original, "F2 did not enter the existing value for editing");
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Z");
    await page.keyboard.press("Enter");
    await waitForCellText(page, id, `${original.slice(0, -1)}Z`);
  } },
  { id: "09", name: "Enter navigation", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row) => cellIdFor(table, row, 1);
    await page.getByTestId(id(0)).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Enter");
    const down = await page.waitForFunction((id) => document.activeElement?.dataset.testid === id, id(1), { timeout: 2500 }).then(() => true, () => false);
    assert.ok(down, "Enter did not leave the active cell one row down");
    await page.getByTestId(id(1)).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Shift+Enter");
    const up = await page.waitForFunction((id) => document.activeElement?.dataset.testid === id, id(0), { timeout: 2500 }).then(() => true, () => false);
    assert.ok(up, "Shift+Enter did not leave the active cell one row up");
  } },
  { id: "10", name: "Tab navigation", tier: "A", run: async (page) => {
    await newTable(page, "Tab row", [{ name: "One" }, { name: "Two" }, { name: "Three" }]);
    const cells = page.locator(".ts-entry-row td[data-entry-field]");
    const second = await cells.nth(1).getAttribute("data-entry-field");
    await cells.nth(0).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("a");
    await page.keyboard.press("Tab");
    const moved = await page.waitForFunction((field) => document.activeElement?.dataset.entryField === field, second, { timeout: 2500 }).then(() => true, () => false);
    assert.ok(moved, "Tab did not move focus right to the next cell");
    await cells.nth(1).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("b");
    await page.keyboard.press("Tab");
    await cells.nth(2).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("c");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__habits.tables.at(-1)?.rows.length === 1);
    const table = await projection(page);
    assert.deepEqual([0, 1, 2].map((column) => fieldAt(table, 0, column)?.stored?.value), ["a", "b", "c"]);
  } },
  { id: "11", name: "Cancel editing", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 4);
    await page.getByTestId(id).click();
    const bar = page.getByTestId("formula-bar-input");
    await bar.waitFor();
    const original = await bar.inputValue();
    assert.ok(original.includes("impact"), "the formula bar does not show the stored formula");
    await bar.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("[.impact]+99");
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await bar.inputValue(), original, "Escape did not restore the uncommitted formula");
    await waitForCellText(page, id, "10");
  } },
  { id: "12", name: "Clear contents", tier: "A", note: "No cell formatting exists yet; content clearing and Undo are what a browser can check.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    const original = await cellText(page, table, 0, 0);
    await page.getByTestId(id).click();
    await page.keyboard.press("Delete");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 0, 0), "", "Delete did not clear the cell contents");
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id, original);
  } },
  { id: "13", name: "Rectangular copy/paste", tier: "A", note: "Tachiko side only; the Excel side of the round trip is MANUAL.", run: async (page) => {
    await newTable(page, "Block", ["A", "B", "C", "D", "E", "F", "G", "H"].map((name) => ({ name })));
    for (let row = 0; row < 3; row += 1) await addRow(page, [`a${row + 1}`, "b", "c", "d"], row + 1);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await dragCells(page, id(0, 0), id(2, 3));
    await page.keyboard.press("Control+c");
    await settle(page);
    const copied = await clipboard(page);
    assert.deepEqual(copied.split(/\r?\n/).map((line) => line.split("\t").length), [4, 4, 4], "the copied block is not three rows of four columns");
    await page.getByTestId(id(0, 4)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    const after = await projection(page);
    assert.equal(await cellText(page, after, 0, 4), "a1", "the pasted block did not start at the destination cell");
    assert.equal(await cellText(page, after, 2, 7), "d", "the pasted block did not keep its rectangle");
  } },
  { id: "14", name: "Cut/paste", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const area = (row) => cellIdFor(table, row, 1);
    const source = (row) => cellIdFor(table, row, 6);
    const original = await cellText(page, table, 0, 1);
    await dragCells(page, area(0), area(1));
    await page.keyboard.press("Control+x");
    await page.locator(".ts-clipboard-status").filter({ hasText: "Cut 2 cells" }).waitFor();
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 0, 1), "", "the cut source was not cleared");
    await page.getByTestId(source(0)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 0, 6), original, "the cut value did not arrive at the destination");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 0, 1), original, "one Undo did not restore the cut source; the cut and the paste are two transactions");
    await page.getByTestId(cellIdFor(table, 0, 4)).click();
    await page.keyboard.press("Control+x");
    await settle(page);
    const copied = (await clipboard(page)).trim();
    assert.ok(copied.startsWith("="), `cutting a formula cell put ${JSON.stringify(copied.slice(0, 30))} on the clipboard, not the formula`);
  } },
  { id: "15", name: "Undo/redo", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    const original = await cellText(page, table, 0, 0);
    await replaceCell(page, id, "Zed");
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id, original);
    await page.keyboard.press("Control+y");
    await waitForCellText(page, id, "Zed");
    const order = () => page.locator("tbody tr.ts-row").evaluateAll((rows) => rows.map((row) => row.querySelector("td")?.textContent?.trim() ?? ""));
    const before = await order();
    await columnAction(page, "title", "Sort Z → A");
    assert.notDeepEqual(await order(), before, "sorting did not change the visible order");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await order(), before, "Undo did not restore the pre-sort order; sorting is view state with no history entry");
  } },
  { id: "16", name: "Mouse selection", tier: "A", note: "The fixture table has three records, so the drag is B2:D4 instead of B2:D8.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await dragCells(page, id(0, 1), id(2, 3));
    const selected = await selectedCount(page);
    assert.equal(selected, 9, `the drag selected ${selected} cells instead of the exact 3x3 rectangle`);
    const active = await activeId(page);
    assert.equal(active, id(0, 1), `the active cell after the drag is ${JSON.stringify(active)}, not the drag anchor ${JSON.stringify(id(0, 1))}`);
  } },
  { id: "17", name: "Keyboard selection", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const start = cellIdFor(table, 0, 1);
    await page.getByTestId(start).click();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const selected = await selectedCount(page);
    assert.equal(selected, 6, `Shift+arrows selected ${selected} cells instead of B2:D3`);
    assert.equal(await page.getByTestId(start).getAttribute("aria-selected"), "true", "the anchor cell is not selected");
  } },
  { id: "18", name: "Ordinary formulas", tier: "A", run: async (page) => {
    await newTable(page, "Formula", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    await addRow(page, ["2", "3"], 1);
    await addRow(page, ["3", "3"], 2);
    const table = await projection(page);
    const total = cellIdFor(table, 0, 2);
    const before = await executeCount(page);
    await page.getByTestId(total).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total, "6");
    assert.equal(await executeCount(page), before + 1, "Enter did not publish exactly one history transaction");
  } },
  { id: "19", name: "Point-and-click formula references", tier: "A", run: async (page) => {
    await newTable(page, "Refs", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    await addRow(page, ["2", "3"], 1);
    const table = await projection(page);
    const id = (column) => cellIdFor(table, 0, column);
    await page.getByTestId(id(2)).dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.type("=");
    await page.getByTestId(id(0)).click();
    await page.keyboard.type("+");
    await page.getByTestId(id(1)).click();
    assert.equal(await editor.inputValue(), "=A2+B2", "clicking cells while typing did not insert A1 references");
    const highlighted = await page.locator(".ts-cell--reference").count();
    assert.ok(highlighted > 0, "the referenced cells receive no visual highlighting while the formula is edited");
  } },
  { id: "20", name: "Recalculation", tier: "A", run: async (page) => {
    await newTable(page, "Recalc", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    await addRow(page, ["2", "3"], 1);
    const table = await projection(page);
    const total = cellIdFor(table, 0, 2);
    await page.getByTestId(total).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total, "6");
    await replaceCell(page, cellIdFor(table, 0, 1), "4");
    await waitForCellText(page, total, "8");
  } },
  { id: "21", name: "Copied formula references", tier: "A", run: async (page) => {
    await newTable(page, "Copy down", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 2), "3"], row + 1);
    const table = await projection(page);
    const total = (row) => cellIdFor(table, row, 2);
    await page.getByTestId(total(0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total(0), "6");
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(total(1)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 2), "9", "the copied formula pasted as its value, not the row-shifted formula");
  } },
  { id: "22", name: "Fill handle", tier: "A", run: async (page) => {
    await newTable(page, "Fill", [{ name: "Value", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 1)], row + 1);
    const table = await projection(page);
    const box = await page.getByTestId(cellIdFor(table, 0, 0)).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3.5, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 2, 0), "1", "dragging the lower-right corner filled nothing; there is no fill handle");
  } },
  { id: "23", name: "Row operations", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 1, 0)).click();
    await page.getByRole("button", { name: "Delete row", exact: true }).click();
    await settle(page);
    assert.equal((await projection(page)).rows.length, 2, "Delete row did not remove the record");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual((await projection(page)).rows, table.rows, "Undo did not restore the deleted record with its identity");
    await page.getByTestId(cellIdFor(table, 1, 0)).click();
    await page.keyboard.press("Control+=");
    await settle(page);
    assert.equal((await projection(page)).rows.length, 4, "Ctrl+= inserted no record between existing records");
  } },
  { id: "24", name: "Workbook sheets", tier: "A", run: async (page) => {
    await example(page);
    await duplicate(page, "Habits 24");
    const tabs = page.locator(".ts-table-tab");
    assert.equal(await tabs.count(), 2, "duplicating a table did not give a second tab");
    await tabs.nth(0).click();
    await settle(page);
    await page.keyboard.press("Shift+F11");
    await settle(page);
    assert.equal(await tabs.count(), 3, "Shift+F11 added no worksheet tab; tabs cannot be renamed or deleted either");
  } },
  { id: "25", name: "Save and reopen", tier: "A", note: "Values and formulas compared; cell styles do not exist yet.", run: async () => {
    // A real browser restart on one profile: a reload could keep session state alive.
    const profile = await mkdtemp(path.join(tmpdir(), "habits-25-"));
    let context;
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { ...launchOptions, viewport: { width: 1440, height: 900 } });
      await installDistRoutes(context, dist);
      await context.addInitScript(evidence);
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(4000);
      return page;
    };
    try {
      const page = await open();
      await example(page);
      const table = await projection(page);
      await replaceCell(page, cellIdFor(table, 0, 0), "持久保存");
      await saveCopy(page, "habits-25");
      await context.close();
      const reopened = await open();
      await home(reopened);
      await reopened.getByRole("button", { name: "Open saved habits-25", exact: true }).click();
      await ready(reopened);
      const after = await projection(reopened);
      assert.equal(fieldAt(after, 0, 0)?.stored?.value, "持久保存", "the edit did not survive save, restart and reopen");
      assert.ok(fieldAt(after, 0, 4)?.formula, "the formula did not survive restart and reopen");
    } finally {
      await context?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  } },
  { id: "26", name: "Open an XLSX", tier: "A", note: "Opened through Home, Choose file; Ctrl+O is not a page shortcut in a browser.", run: async (page) => {
    await home(page);
    await (await homeImportInput(page)).setInputFiles(invoice);
    const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await dialog.waitFor();
    const selects = dialog.locator(".ts-import-column select");
    for (const [index, type] of ["text", "number", "number", "number"].entries()) await selects.nth(index).selectOption(type);
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await ready(page);
    const grid = page.getByRole("grid", { name: "Table", exact: true });
    assert.deepEqual(await grid.locator("thead th").allTextContents(), ["Row", "Item", "Qty", "Unit price", "Amount"]);
    assert.equal(await grid.locator("tbody tr.ts-row").count(), 5, "the workbook's sheet structure did not arrive");
    const amount = () => grid.locator("tbody tr.ts-row").first().locator("td").nth(3).textContent();
    assert.equal((await amount()).trim(), "$35.00", "the imported calculation is not displayed");
    await grid.locator("tbody tr.ts-row").first().locator("td").nth(1).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("20");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal((await amount()).trim(), "$70.00", "editing Qty did not recalculate the imported formula");
  } },
  { id: "27", name: "File interchange", tier: "A", note: "Tachiko side only; opening the download in actual Excel is MANUAL.", run: async (page) => {
    await example(page);
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    await consent.waitFor();
    const download = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const work = await mkdtemp(path.join(tmpdir(), "habits-27-"));
    try {
      const file = path.join(work, "export.xlsx");
      await (await download).saveAs(file);
      await consent.waitFor({ state: "detached" });
      const bytes = await readFile(file);
      assert.equal(bytes.subarray(0, 2).toString(), "PK", "the download is not an XLSX package");
      assert.ok(bytes.length > 1000, "the XLSX package is empty");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } },
  { id: "28", name: "Direct formatting", tier: "A", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+b");
    await settle(page);
    const weight = await page.getByTestId(id).evaluate((node) => Number(getComputedStyle(node).fontWeight));
    assert.ok(weight >= 600, `Ctrl+B left the cell at font-weight ${weight}; there is no cell formatting`);
  } },
  { id: "29", name: "Number display", tier: "A", run: async (page) => {
    await newTable(page, "Percent", [{ name: "Name" }, { name: "Rate", type: "number" }]);
    await addRow(page, ["Fee", "0.15"], 1);
    await columnAction(page, "Rate", "Number format…");
    const dialog = page.getByRole("dialog", { name: "Number format", exact: true });
    await dialog.waitFor();
    await dialog.getByLabel("Format", { exact: true }).selectOption("percent");
    await dialog.getByLabel("Decimal places", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "Save format", exact: true }).click();
    await settle(page);
    let table = await projection(page);
    const id = cellIdFor(table, 0, 1);
    assert.equal(await cellText(page, table, 0, 1), "15%", "0.15 does not display as 15%");
    assert.equal(fieldAt(table, 0, 1)?.stored?.value, 0.15, "formatting changed the numeric value");
    await saveCopy(page, "habits-29");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-29", exact: true }).click();
    await ready(page);
    table = await projection(page);
    assert.equal(await cellText(page, table, 0, 1), "15%", "the number display did not survive reopen");
    assert.equal(fieldAt(table, 0, 1)?.stored?.value, 0.15, "the numeric value changed after reopen");
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    await consent.waitFor();
    const download = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const work = await mkdtemp(path.join(tmpdir(), "habits-29-"));
    try {
      const file = path.join(work, "export.xlsx");
      await (await download).saveAs(file);
      await consent.waitFor({ state: "detached" });
      const xml = sheetXml(file);
      assert.ok(xml.includes("0.15"), "the exported workbook does not store the numeric value 0.15");
      assert.ok(xml.includes("%"), "the exported workbook carries no percentage display");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } },
  { id: "30", name: "Sort/filter", tier: "A", note: "Cell styles do not exist yet, so only values, formulas and identity are compared.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const values = (rows) => Object.fromEntries(rows.map((row) => [rowEntity(row), fieldAt({ rows: [row], columns: table.columns }, 0, 4)?.calculated?.value]));
    const before = values(table.rows);
    await columnAction(page, "title", "Sort Z → A");
    const sorted = await projection(page);
    assert.deepEqual(values(sorted.rows), before, "sorting changed record identity or a calculated value");
    await filterValues(page, "area", ["發版"]);
    await page.waitForFunction(() => document.querySelectorAll("tbody tr.ts-row").length === 1);
    assert.equal((await projection(page)).rows.length, 3, "filtering deleted nonmatching records");
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await settle(page);
  } },
  { id: "31", name: "Find/replace", tier: "A", run: async (page) => {
    await newTable(page, "Replace", [{ name: "Item" }, { name: "Amount", type: "number" }]);
    for (const [index, [item, amount]] of [["Red apple", "1"], ["red pear", "2"], ["Red plum", "3"]].entries()) await addRow(page, [item, amount], index + 1);
    const titles = async () => { const table = await projection(page); return table.rows.map((_, row) => fieldAt(table, row, 0)?.stored?.value); };
    await page.keyboard.press("Control+f");
    await page.getByLabel("Find in table").fill("Red");
    await page.getByRole("button", { name: "Replace…" }).click();
    await page.getByLabel("Replace with").fill("Green");
    await page.getByRole("button", { name: "Preview replace" }).click();
    await page.getByRole("button", { name: "Replace 2 cells", exact: true }).click();
    await page.locator(".ts-clipboard-status").filter({ hasText: "Replaced 2 cells" }).waitFor();
    await settle(page);
    assert.deepEqual(await titles(), ["Green apple", "red pear", "Green plum"], "replace did not change exactly the matching cells");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await settle(page);
    assert.deepEqual(await titles(), ["Red apple", "red pear", "Red plum"], "Undo did not restore the replaced batch");
  } },
  { id: "32", name: "CSV data exchange", tier: "A", run: async (page) => {
    const work = await mkdtemp(path.join(tmpdir(), "habits-32-"));
    try {
      const csv = path.join(work, "people.csv");
      await writeFile(csv, 'id,name,note,date\n00123,"Yamada, Taro",日本,2026-04-01\n00456,,,2026-04-02\n');
      await home(page);
      await (await homeImportInput(page)).setInputFiles(csv);
      const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
      await dialog.waitFor();
      const selects = dialog.locator(".ts-import-column select");
      for (const [index, type] of ["text", "text", "text", "date"].entries()) await selects.nth(index).selectOption(type);
      await dialog.getByRole("button", { name: "Import file", exact: true }).click();
      await ready(page);
      const grid = page.getByRole("grid", { name: "Table", exact: true });
      const first = grid.locator("tbody tr.ts-row").first();
      assert.equal((await first.locator("td").nth(0).textContent()).trim(), "00123", "the leading-zero id was coerced");
      assert.equal((await first.locator("td").nth(1).textContent()).trim(), "Yamada, Taro", "a quoted delimiter did not survive import");
      assert.equal((await first.locator("td").nth(2).textContent()).trim(), "日本", "Japanese text did not survive import");
      assert.equal((await first.locator("td").nth(3).textContent()).trim(), "2026-04-01", "the date did not survive import");
      await page.getByRole("tab", { name: "Import & export", exact: true }).click();
      await page.getByRole("button", { name: "Prepare CSV", exact: true }).click();
      const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
      await consent.waitFor();
      const download = page.waitForEvent("download");
      await consent.getByRole("button", { name: "Download", exact: true }).click();
      const file = path.join(work, "export.csv");
      await (await download).saveAs(file);
      const text = await readFile(file, "utf8");
      assert.ok(text.includes("00123"), "the exported CSV lost the leading-zero id");
      assert.ok(text.includes('"Yamada, Taro"'), "the exported CSV lost the quoted delimiter");
      assert.ok(text.includes("日本"), "the exported CSV lost the Japanese text");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } },
  { id: "33", name: "Navigation by data edge", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row) => cellIdFor(table, row, 1);
    const last = id(table.rows.length - 1);
    await page.getByTestId(id(0)).click();
    await page.keyboard.press("Control+ArrowDown");
    assert.equal(await activeId(page), last, "Ctrl+Down did not reach the last record");
    await page.keyboard.press("Control+ArrowUp");
    assert.equal(await activeId(page), id(0), "Ctrl+Up did not return to the first record");
    await filterValues(page, "area", ["發版", "資料"]);
    await page.getByText("Showing 2 of 3 rows", { exact: true }).waitFor();
    await page.getByTestId(id(0)).click();
    await page.keyboard.press("Control+ArrowDown");
    const displayed = await page.locator(`tbody tr.ts-row td[data-testid$=":${table.columns[1].id}"]`).evaluateAll((nodes) => nodes.map((node) => node.dataset.testid));
    assert.equal(displayed.length, 2, "the filter left two rows on screen");
    const landed = await activeId(page);
    assert.equal(landed, displayed.at(-1), `Ctrl+Down landed on ${JSON.stringify(landed)}, not the last displayed record ${JSON.stringify(displayed.at(-1))}`);
  } },
  { id: "34", name: "Extend selection to edge", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const start = cellIdFor(table, 0, 1);
    await page.getByTestId(start).click();
    await page.keyboard.press("Control+Shift+ArrowRight");
    assert.equal(await selectedCount(page), table.columns.length - 1, "Ctrl+Shift+Right did not select through the last field");
    await page.getByTestId(start).click();
    await page.keyboard.press("Control+Shift+ArrowDown");
    assert.equal(await selectedCount(page), table.rows.length, "Ctrl+Shift+Down did not select through the last record");
  } },
  { id: "35", name: "Home/End/Page", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await page.getByTestId(id(0, 1)).click();
    await page.keyboard.press("End");
    assert.equal(await activeId(page), id(0, table.columns.length - 1), "End did not reach the row's last cell");
    await page.keyboard.press("Home");
    assert.equal(await activeId(page), id(0, 0), "Home did not reach the row's first cell");
    await page.keyboard.press("Control+End");
    assert.equal(await activeId(page), id(table.rows.length - 1, table.columns.length - 1), "Ctrl+End did not reach the table's last cell");
    await page.keyboard.press("Control+Home");
    assert.equal(await activeId(page), id(0, 0), "Ctrl+Home did not reach the table's first cell");
    await page.keyboard.press("PageDown");
    assert.notEqual(await activeId(page), id(0, 0), "PageDown left the active cell unchanged");
  } },
  { id: "36", name: "Whole row/column selection", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await page.getByTestId(id(1, 1)).click();
    await page.keyboard.press("Shift+Space");
    assert.equal(await selectedCount(page), table.columns.length, "Shift+Space did not select the displayed row");
    assert.equal((await projection(page)).rows.length, table.rows.length, "selecting a row deleted records");
    await page.getByTestId(id(1, 1)).click();
    await page.keyboard.press("Control+Space");
    assert.equal(await selectedCount(page), table.rows.length, "Ctrl+Space did not select the displayed column");
  } },
  { id: "37", name: "Select current region", tier: "B", note: "The table is the only supported region; a second Ctrl+A keeps it selected.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const all = table.rows.length * table.columns.length;
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+a");
    assert.equal(await selectedCount(page), all, "Ctrl+A did not select the table data");
    await page.keyboard.press("Control+a");
    assert.equal(await selectedCount(page), all, "a second Ctrl+A lost the table region");
  } },
  { id: "38", name: "Fill selection with one entry", tier: "B", run: async (page) => {
    await newTable(page, "One entry", [{ name: "Value" }]);
    for (let row = 0; row < 3; row += 1) await addRow(page, [String(row + 1)], row + 1);
    const table = await projection(page);
    const id = (row) => cellIdFor(table, row, 0);
    await page.getByTestId(id(0)).click();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.type("fill");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+Enter");
    await settle(page);
    if (await page.getByTestId("cell-editor").count()) await page.keyboard.press("Escape");
    await settle(page);
    const after = await projection(page);
    const values = after.rows.map((_, row) => fieldAt(after, row, 0)?.stored?.value);
    assert.deepEqual(values, ["fill", "fill", "fill"], `Ctrl+Enter did not fill the whole selection with one entry: ${JSON.stringify(values)}`);
    await newTable(page, "Refused entry", [{ name: "Amount", type: "number" }]);
    for (let row = 0; row < 2; row += 1) await addRow(page, [String(row + 1)], row + 1);
    const numbers = await projection(page);
    await page.getByTestId(cellIdFor(numbers, 0, 0)).click();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.type("abc");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+Enter");
    await settle(page);
    assert.equal(await page.getByTestId("cell-editor").inputValue(), "abc", "a refused Ctrl+Enter discarded what was typed");
    assert.deepEqual(await filledColumn(page, numbers, 0, 2).then((cells) => cells.map(String)), ["1", "2"], "a refused Ctrl+Enter changed cells");
  } },
  { id: "39", name: "Fill down by keyboard", tier: "B", run: async (page) => {
    await newTable(page, "Fill down", [{ name: "Value", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 1)], row + 1);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Control+d");
    await settle(page);
    const filled = await filledColumn(page, table, 0, 4);
    assert.deepEqual(filled.map(String), ["1", "1", "1", "4"], `Ctrl+D did not fill the selected range from its top cell: ${JSON.stringify(filled)}`);
  } },
  { id: "40", name: "Paste Special", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(cellIdFor(table, 0, 1)).click();
    await page.keyboard.press("Control+Alt+v");
    await settle(page);
    assert.ok(await page.getByRole("dialog").count() + await page.getByRole("menu").count() > 0, "Ctrl+Alt+V opened no Paste Special choices");
  } },
  { id: "41", name: "Change reference mode", tier: "B", run: async (page) => {
    await newTable(page, "Cycle", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    await addRow(page, ["2", "3"], 1);
    const table = await projection(page);
    const id = (column) => cellIdFor(table, 0, column);
    await page.getByTestId(id(2)).dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.type("=");
    await page.getByTestId(id(0)).click();
    assert.equal(await editor.inputValue(), "=A2", "the clicked reference did not arrive as A2");
    await page.keyboard.press("F4");
    assert.equal(await editor.inputValue(), "=$A$2", "F4 did not cycle A2 to $A$2");
  } },
  { id: "42", name: "Formula bar and address", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 4);
    await page.getByTestId(id).click();
    const bar = page.getByTestId("formula-bar-input");
    await bar.waitFor();
    assert.ok((await bar.inputValue()).includes("impact"), "the bar does not show the underlying formula");
    await bar.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("[.impact]+1");
    await page.keyboard.press("Enter");
    await waitForCellText(page, id, "6");
    await page.getByTestId(id).click();
    await settle(page);
    const label = (await page.getByTestId("formula-bar-cell").textContent()).trim();
    assert.match(label, /^[A-Z]{1,3}\d+$/, `the selected cell's address shows ${JSON.stringify(label)}, not an A1 address`);
  } },
  { id: "43", name: "Resize and AutoFit", tier: "B", run: async (page) => {
    await example(page);
    const grip = page.getByRole("separator", { name: "Resize title", exact: true });
    const start = Number(await grip.getAttribute("aria-valuenow"));
    await page.getByRole("columnheader", { name: "title", exact: true }).hover();
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const narrow = Number(await grip.getAttribute("aria-valuenow"));
    assert.ok(narrow < start, "dragging the column boundary did not resize the column");
    await grip.dblclick();
    await settle(page);
    const fitted = Number(await grip.getAttribute("aria-valuenow"));
    assert.ok(fitted > narrow, "double-clicking the boundary did not AutoFit the column");
    const clipped = await page.locator("tbody tr.ts-row td:first-of-type").evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length);
    assert.equal(clipped, 0, "AutoFit left clipped text");
    await saveCopy(page, "habits-43");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-43", exact: true }).click();
    await ready(page);
    const reopened = Number(await page.getByRole("separator", { name: "Resize title", exact: true }).getAttribute("aria-valuenow"));
    assert.equal(reopened, fitted, `the column width reset on reopen (${reopened} instead of ${fitted}); widths are view state only`);
  } },
  { id: "44", name: "Context menus", tier: "B", waitMs: 10_000, run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    const menu = page.getByRole("menu", { name: "Cell actions", exact: true });
    const item = (name) => page.getByRole("menuitem", { name, exact: true });
    const focused = (locator) => locator.evaluate((node) => node === document.activeElement);
    const rowOrder = () => page.locator("tbody tr.ts-row").evaluateAll((rows) => rows.map((row) => row.querySelector("td")?.textContent?.trim() ?? ""));
    await page.getByTestId(cellIdFor(table, 0, 0)).click({ button: "right" });
    await settle(page);
    assert.ok(await page.getByRole("menu").count() > 0, "right-click on a cell opened no context menu; Shift+F10 has none either");

    // Excel's cell menu, focused on its first command; Escape gives the cell back.
    for (const label of ["Cut", "Copy", "Paste", "Clear contents", "Fill down", "Delete row", "Sort A → Z", "Sort Z → A", "Filter…"]) {
      assert.equal(await item(label).count(), 1, `the cell menu has no ${label} item`);
    }
    assert.ok(await focused(item("Cut")), "the cell menu did not focus Cut on open");
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0, "Escape did not close the cell menu");
    assert.equal(await activeId(page), id(0, 0), "Escape did not return focus to the cell the menu was for");

    // Shift+F10 opens at the focused cell; arrows skip separators and disabled rows.
    await page.getByTestId(id(0, 1)).click();
    await page.keyboard.press("Shift+F10");
    assert.equal(await menu.count(), 1, "Shift+F10 on a focused cell opened no cell menu");
    assert.ok(await focused(item("Cut")), "Shift+F10's menu did not focus Cut");
    await page.keyboard.press("ArrowDown");
    assert.ok(await focused(item("Copy")), "ArrowDown did not move the menu focus to Copy");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    assert.ok(await focused(item("Clear contents")), "ArrowDown did not skip the separator above Clear contents");
    await page.keyboard.press("ArrowDown");
    assert.ok(await focused(item("Delete row")), "ArrowDown did not skip the disabled Fill down row");
    await page.keyboard.press("ArrowUp");
    assert.ok(await focused(item("Clear contents")), "ArrowUp did not skip the disabled Fill down row");
    await page.keyboard.press("Escape");

    // A press inside a range keeps it; one outside moves the menu's cell.
    await dragCells(page, id(0, 1), id(1, 2));
    assert.equal(await selectedCount(page), 4, "the 2x2 drag did not select four cells");
    await page.getByTestId(id(1, 2)).click({ button: "right" });
    assert.equal(await selectedCount(page), 4, "right-clicking inside the selection cleared it");
    await page.keyboard.press("Escape");
    assert.equal(await activeId(page), id(0, 1), "closing the menu moved the active cell off the selection's anchor");
    await page.getByTestId(id(0, 5)).click({ button: "right" });
    assert.equal(await selectedCount(page), 0, "right-clicking outside the selection did not move it to that cell");
    await page.keyboard.press("Escape");
    assert.equal(await activeId(page), id(0, 5), "closing the menu did not leave focus on the cell it opened on");

    // Copy and Paste run the grid's own clipboard work.
    const areas = [await cellText(page, table, 0, 1), await cellText(page, table, 1, 1)];
    await dragCells(page, id(0, 1), id(1, 1));
    await page.getByTestId(id(0, 1)).click({ button: "right" });
    await item("Copy").click();
    await settle(page);
    assert.equal((await clipboard(page)).trim(), areas.join("\n"), "Copy from the cell menu did not put the selected cells on the clipboard");
    const source = await cellText(page, await projection(page), 0, 6);
    await page.getByTestId(id(0, 6)).click({ button: "right" });
    await item("Paste").click();
    await waitForCellText(page, id(0, 6), areas[0]);
    assert.equal(await cellText(page, await projection(page), 1, 6), areas[1], "Paste from the cell menu did not write the second row");
    await settle(page);
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id(0, 6), source);

    // Cut clears the cell it copies; one Undo restores it.
    await page.getByTestId(id(0, 6)).click({ button: "right" });
    await item("Cut").click();
    await waitForCellText(page, id(0, 6), "");
    assert.equal((await clipboard(page)).trim(), source, "Cut from the cell menu did not put the cell on the clipboard");
    await settle(page);
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id(0, 6), source);

    // Clear contents, and one Undo restores it.
    const original = await cellText(page, await projection(page), 0, 0);
    await page.getByTestId(id(0, 0)).click({ button: "right" });
    await item("Clear contents").click();
    await waitForCellText(page, id(0, 0), "");
    await settle(page);
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id(0, 0), original);

    // A two-row selection deletes both rows; Undo restores them.
    await dragCells(page, id(0, 1), id(1, 1));
    await page.getByTestId(id(0, 1)).click({ button: "right" });
    assert.equal(await item("Delete 2 rows").count(), 1, "the menu did not name the two-row delete");
    await item("Delete 2 rows").click();
    await page.waitForFunction(() => document.querySelectorAll("tbody tr.ts-row").length === 1);
    await settle(page);
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr.ts-row").length === 3);

    // The cell editor keeps the browser's own menu.
    await page.locator("tbody tr.ts-row td").first().dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await editor.click({ button: "right" });
    assert.equal(await menu.count(), 0, "a right-click in the cell editor opened the cell menu");
    await page.keyboard.press("Escape");
    await settle(page);

    // Sort both ways; the two orders must be each other's reverse.
    await page.locator("tbody tr.ts-row td").first().click({ button: "right" });
    await item("Sort A → Z").click();
    await settle(page);
    const ascending = await rowOrder();
    await page.locator("tbody tr.ts-row td").first().click({ button: "right" });
    await item("Sort Z → A").click();
    await settle(page);
    assert.deepEqual(await rowOrder(), [...ascending].reverse(), "the two menu sorts did not reverse the visible order");

    // Filter… opens that column's filter editor.
    await page.locator("tbody tr.ts-row td").first().click({ button: "right" });
    await item("Filter…").click();
    await page.getByLabel("Filter type for title").waitFor();
    await page.keyboard.press("Escape");

    // In the compact layout the same item opens the toolbar's filter editor.
    await page.setViewportSize({ width: 650, height: 900 });
    await settle(page);
    await page.locator("tbody tr.ts-row td").first().click({ button: "right" });
    await item("Filter…").click();
    await page.getByLabel("Filter type for title").waitFor();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);

    // A press moves focus inside the menu: Enter acts on that item, not the first one.
    const before = await cellText(page, await projection(page), 0, 1);
    await page.getByTestId(id(0, 1)).click({ button: "right" });
    // Playwright waits forever for an aria-disabled target unless forced; the press is still a real one.
    await item("Fill down").click({ force: true });
    assert.ok(await focused(item("Fill down")), "pressing the disabled Fill down did not focus it");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(await menu.count(), 1, "Enter on the disabled item closed the menu");
    assert.equal(await cellText(page, await projection(page), 0, 1), before, "Enter on the disabled item ran another command");
    await page.keyboard.press("Escape");
  } },
  { id: "45", name: "Multiline editing", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 7)).press("F2");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Line one");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("Line two");
    await page.keyboard.press("Enter");
    await settle(page);
    const value = String(fieldAt(await projection(page), 0, 7)?.stored?.value);
    assert.ok(value.includes("\n"), `Alt+Enter inserted no line break (stored ${JSON.stringify(value)})`);
  } },
  { id: "46", name: "Sheet navigation", tier: "B", run: async (page) => {
    await example(page);
    await duplicate(page, "Second");
    await duplicate(page, "Third");
    const tabs = page.locator(".ts-table-tab");
    assert.equal(await tabs.count(), 3, "three tables did not give three tabs");
    const active = () => page.locator(".ts-table-tab[aria-selected='true']").getAttribute("title");
    const first = await active();
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+PageDown");
    await settle(page);
    const second = await active();
    assert.notEqual(second, first, "Ctrl+PageDown did not switch tables");
    assert.equal(await page.locator("tbody tr.ts-row").count(), 3, "switching changed the visible records");
    await page.keyboard.press("Control+PageUp");
    await settle(page);
    assert.equal(await active(), first, "Ctrl+PageUp did not return to the previous table");
  } },
  { id: "47", name: "Format Cells", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+1");
    await settle(page);
    assert.ok(await page.getByRole("dialog").count() > 0, "Ctrl+1 opened no Format Cells dialog");
  } },
  { id: "48", name: "Table creation", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const tabs = await page.locator(".ts-table-tab").count();
    await dragCells(page, cellIdFor(table, 0, 0), cellIdFor(table, table.rows.length - 1, table.columns.length - 1));
    await page.keyboard.press("Control+t");
    await settle(page);
    assert.equal(await page.locator(".ts-table-tab").count(), tabs + 1, "Ctrl+T created no table from the selected region");
  } },
  { id: "49", name: "Show formulas", tier: "C", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 4);
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+`");
    await settle(page);
    const shown = (await page.getByTestId(id).textContent()).trim();
    assert.ok(shown.startsWith("="), `Ctrl+grave left the result ${JSON.stringify(shown)} instead of showing the formula`);
  } },
  { id: "50", name: "Enter current date", tier: "C", run: async (page) => {
    await newTable(page, "Today", [{ name: "When", type: "date" }, { name: "Note" }]);
    await addRow(page, ["2020-01-01", "seed"], 1);
    await page.clock.setFixedTime(new Date("2026-04-15T12:00:00+09:00"));
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+;");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), "2026-04-15", "Ctrl+; did not enter the current date in a Date cell");
    await editor.press("Enter");
    await settle(page);
    assert.equal(fieldAt(await projection(page), 0, 0)?.stored?.value, "2026-04-15", "the current date was not stored");
  } },
  { id: "51", name: "Move/copy worksheet tab", tier: "C", run: async (page) => {
    await example(page);
    await duplicate(page, "Copy");
    const tabs = page.locator(".ts-table-tab");
    const order = () => tabs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
    const before = await order();
    const first = await tabs.nth(0).boundingBox();
    const second = await tabs.nth(1).boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width + 20, second.y + second.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.notDeepEqual(await order(), before, "dragging a table tab did not reorder it; Ctrl+drag copies none either");
  } },
  { id: "52", name: "Hide rows or columns", tier: "C", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await page.getByTestId(id(1, 1)).click();
    await page.keyboard.press("Control+9");
    await settle(page);
    const hidden = await page.getByTestId(id(1, 0)).evaluate((node) => {
      const row = node.closest("tr");
      const style = getComputedStyle(row);
      return row.hidden || style.display === "none" || style.visibility === "hidden";
    });
    assert.ok(hidden, "Ctrl+9 did not hide the selected row");
    await page.keyboard.press("Control+0");
    await settle(page);
    const columnHidden = await page.getByTestId(id(0, 1)).evaluate((node) => {
      const style = getComputedStyle(node);
      return style.display === "none" || style.visibility === "hidden";
    });
    assert.ok(columnHidden, "Ctrl+0 did not hide the selected column");
  } },
];

function withTimeout(promise, ms) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the case did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

const results = [];
let harnessBroke = false;
const expectedIds = cases.map((_, index) => String(index + 1).padStart(2, "0"));
if (cases.length !== 52 || cases.some((testCase, index) => testCase.id !== expectedIds[index] || !testCase.name)) {
  console.error(`HARNESS: the case list is not 52 ids 01-52 (got ${cases.length}).`);
  await browser.close();
  process.exit(1);
}

// Formula cases read Work's request count, which only an acceptance build exposes.
{
  const context = await browser.newContext();
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  await home(page);
  const instrumented = await page.evaluate(() => Boolean(window.__tachikoAcceptance));
  await context.close();
  if (!instrumented) {
    console.error("HARNESS: WORK_DIST is not an acceptance build (pnpm build:acceptance).");
    await browser.close();
    process.exit(1);
  }
}

// HABITS_ONLY=33,39 runs just those cases while working on them.
const only = process.env.HABITS_ONLY?.split(",");
for (const testCase of cases) {
  if (only && !only.includes(testCase.id)) continue;
  if (testCase.manual) {
    const result = { id: testCase.id, name: testCase.name, tier: testCase.tier, outcome: "MANUAL", note: testCase.manual };
    results.push(result);
    console.log(JSON.stringify(result));
    continue;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await installDistRoutes(context, dist);
  await context.addInitScript(evidence);
  const page = await context.newPage();
  page.setDefaultTimeout(testCase.waitMs ?? 4000);
  let outcome = "PASS";
  let error;
  try {
    await withTimeout(testCase.run(page), CASE_TIMEOUT_MS);
  } catch (cause) {
    outcome = "GAP";
    const line = cause?.stack?.match(/excel-habits-local\.mjs:(\d+)/)?.[1];
    error = `${firstLine(cause)}${line ? ` (line ${line})` : ""}`;
    if (cause instanceof SetupFailure) harnessBroke = true;
  } finally {
    await context.close().catch(() => {});
  }
  const result = { id: testCase.id, name: testCase.name, tier: testCase.tier, outcome, ...(error ? { error } : {}), ...(testCase.note ? { note: testCase.note } : {}) };
  results.push(result);
  console.log(JSON.stringify(result));
}

await browser.close();

const summary = { PASS: 0, GAP: 0, MANUAL: 0 };
for (const result of results) summary[result.outcome] += 1;
console.log(JSON.stringify({ summary, platform: "chromium-linux, Ctrl shortcuts" }));
process.exitCode = harnessBroke ? 1 : 0;

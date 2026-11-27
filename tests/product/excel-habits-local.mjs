import { standaloneImportedRoReopen } from "./imported-ro-journey.mjs";
// #305: one named case per Excel-feel habit. This harness only reports what the
// product does today; it never changes product code and never softens a check.
// Every case drives real input through Chromium on Linux, so Ctrl shortcuts.
import { installPublishedTablePatcher } from "./published-table-patcher.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { WORK_FIELD_CELL } from "./windowed-table-collector.mjs";
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
        if (event.data.response?.type === "table") window.__habits.tables.push(window.__trackObservedTable(window.__habits, structuredClone(event.data.response.payload)));
        if (event.data.response?.type === "table_window") {
          const part = event.data.response.payload;
          if (part.start === 0) this.habitsWindow = { ...part, rows: [] };
          const table = this.habitsWindow;
          if (table && part.revision === table.revision && part.start === table.rows.length) {
            table.rows.push(...structuredClone(part.rows));
            if (table.rows.length === part.total_rows) {
              window.__habits.tables.push(window.__trackObservedTable(window.__habits, table, true));
              this.habitsWindow = null;
            }
          }
        }
        if (event.data.response?.type === "published") {
          const table = window.__trackPublished(window.__habits, event.data.response.payload);
          if (table) window.__habits.tables.push(table);
        }
      });
    }
  };
}

const ready = (page) => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = (page) => page.evaluate(() => window.__readObservedTable(window.__habits));
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
  await page.waitForFunction((rows) => !window.__habits.stale && window.__readObservedTable(window.__habits)?.rows.length === rows, expectedRows);
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

// The handle's square is a pseudo-element in the corner of the handle's cell.
async function fillHandleBox(page) {
  const cell = await page.getByTestId("fill-handle").locator("xpath=ancestor::td").boundingBox();
  return { x: cell.x + cell.width - 7, y: cell.y + cell.height - 7, width: 7, height: 7 };
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
  await page.getByRole("button", { name: "Duplicate sheet…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Duplicate sheet", exact: true });
  await dialog.waitFor();
  await dialog.getByLabel("Sheet name", { exact: true }).fill(name);
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
    await example(page);
    await saveCopy(page, "before-new-workbook");
    const before = await projection(page);
    await page.keyboard.press("Control+n");
    await page.getByTestId("worksheet:A1").waitFor();
    await ready(page);
    assert.equal(await page.getByRole("dialog").count(), 0, "New workbook required a wizard");
    assert.equal((await projection(page)).rows.length, 0, "the new workbook is not blank");
    assert.notEqual((await projection(page)).collection.id, before.collection.id, "New kept the old worksheet");
    assert.equal(await activeId(page), "worksheet:A1", "the blank worksheet has no active cell");
    const nameBox = page.getByRole("textbox", { name: "Name Box", exact: true });
    await page.getByTestId("worksheet:D5").click();
    assert.equal(await nameBox.inputValue(), "D5", "the blank worksheet Name Box added a header row");
    await page.evaluate(() => navigator.clipboard.writeText("Orange\t4\nPear\t5"));
    await page.keyboard.press("Control+v");
    const pasted = [["D5", "Orange"], ["E5", "4"], ["D6", "Pear"], ["E6", "5"]];
    for (const [address, value] of pasted) await waitForCellText(page, `worksheet:${address}`, value);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    for (const [address] of pasted) await waitForCellText(page, `worksheet:${address}`, "");
    assert.equal((await projection(page)).rows.length, 0, "one Undo did not remove the paste's allocations");
    await nameBox.fill("A1");
    await nameBox.press("Enter");
    assert.equal(await activeId(page), "worksheet:A1", "the Name Box could not navigate to the first data row");
    await page.keyboard.type("Hello");
    await page.keyboard.press("Enter");
    await waitForCellText(page, "worksheet:A1", "Hello");
    assert.equal(fieldAt(await projection(page), 0, 0)?.stored?.value, "Hello", "Hello was not stored by Work");
    await page.locator('[data-testid="worksheet:A2"]:focus').waitFor();
    await page.keyboard.type("World");
    await page.keyboard.press("Enter");
    await waitForCellText(page, "worksheet:A2", "World");
    assert.equal(fieldAt(await projection(page), 1, 0)?.stored?.value, "World", "Enter did not move typing to A2 after allocation");
  } },
  { id: "03", name: "Blank-cell typing", tier: "A", run: async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "habits-03-"));
    let context;
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { ...launchOptions, viewport: { width: 1440, height: 900 } });
      await installDistRoutes(context, dist);
      await installPublishedTablePatcher(context);
      await context.addInitScript(evidence);
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(4000);
      return page;
    };
    try {
      const page = await open();
      await home(page);
      await page.keyboard.press("Control+n");
      await page.getByTestId("worksheet:B4").click();
      assert.equal(await page.getByRole("textbox", { name: "Name Box", exact: true }).inputValue(), "B4");
      await page.keyboard.type("Apple");
      await page.keyboard.press("Enter");
      await settle(page);
      const refusal = (await page.locator('[role="alert"]').allTextContents()).join("; ");
      assert.equal((await page.getByTestId("worksheet:B4").textContent()).trim(), "Apple", refusal || "typing in B4 stored no value");
      await waitForCellText(page, "worksheet:B4", "Apple");
      assert.equal(fieldAt(await projection(page), 3, 1)?.stored?.value, "Apple", "Work stored Apple at the wrong position");
      await saveCopy(page, "habits-03");
      await context.close();
      const reopened = await open();
      await home(reopened);
      await reopened.getByRole("button", { name: "Open saved habits-03", exact: true }).click();
      await ready(reopened);
      await waitForCellText(reopened, "worksheet:B4", "Apple");
      assert.equal(fieldAt(await projection(reopened), 3, 1)?.stored?.value, "Apple", "B4 did not survive save, browser restart and reopen");
      assert.equal(await reopened.getByTestId("worksheet:A1").textContent(), "", "writing B4 populated A1");

      for (const [format, file, types] of [
        ["csv", { name: "geometry.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Value\nAlpha,1\nBeta,2\n") }, ["text", "number"]],
        ["xlsx", invoice, ["text", "number", "number", "number"]],
      ]) {
        await reopened.getByRole("button", { name: "Close project", exact: true }).click();
        await home(reopened);
        await (await homeImportInput(reopened)).setInputFiles(file);
        const dialog = reopened.getByRole("dialog", { name: "Review import preview", exact: true });
        await dialog.waitFor();
        for (const [index, type] of types.entries()) await dialog.locator(".ts-import-column select").nth(index).selectOption(type);
        await dialog.getByRole("button", { name: "Import file", exact: true }).click();
        await ready(reopened);
        const cell = reopened.getByRole("grid", { name: "Table", exact: true }).locator("tbody tr.ts-row").first().locator("td").nth(1);
        await cell.click();
        assert.equal(await reopened.getByRole("textbox", { name: "Name Box", exact: true }).inputValue(), "B2",
          `${format} imports lost their header-inclusive addresses`);
      }
    } finally {
      await context?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
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
    assert.equal(fieldAt(after, 0, ids.length)?.stored?.value, "Extra", "Work did not store the text beside the table");
  } },
  { id: "06", name: "Mixed values", tier: "A", run: async (page) => {
    await newTable(page, "Typed", [{ name: "Value", type: "number" }]);
    await addRow(page, ["123"], 1);
    const cell = page.locator(".ts-entry-row td[data-entry-field]").first();
    await cell.dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.type("N/A");
    await page.keyboard.press("Enter");
    await page.getByRole("alert").filter({ hasText: "Value needs a number." }).waitFor();
    assert.equal((await projection(page)).rows.length, 1, "the Number column accepted N/A");
    await cell.dblclick();
    assert.equal(await editor.inputValue(), "N/A", "the rejected draft was lost");
    await editor.fill("456");
    await editor.press("Enter");
    await page.waitForFunction(() => !window.__habits.stale && window.__readObservedTable(window.__habits)?.rows.length === 2);
    assert.equal(fieldAt(await projection(page), 1, 0)?.stored?.value, 456, "the corrected number was not stored");

    await home(page);
    await page.keyboard.press("Control+n");
    const inputs = ["12", "N/A", "3.5", "TRUE", "2026-01-05"];
    const expected = [
      { kind: "number", value: 12 },
      { kind: "text", value: "N/A" },
      { kind: "number", value: 3.5 },
      { kind: "boolean", value: true },
      { kind: "date", value: "2026-01-05" },
    ];
    for (const [index, input] of inputs.entries()) {
      if (index === inputs.length - 1) await saveCopy(page, "habits-06");
      const worksheetCell = page.getByTestId(`worksheet:A${index + 1}`);
      await worksheetCell.click();
      await page.keyboard.type(input);
      await page.keyboard.press("Enter");
      await worksheetCell.filter({ hasText: index === 3 ? "true" : input }).waitFor();
    }
    const assertMixedColumn = async () => {
      const table = await projection(page);
      assert.equal(table.columns[0].field_type, "auto");
      assert.deepEqual(expected.map((_, row) => fieldAt(table, row, 0)?.stored), expected);
    };
    await assertMixedColumn();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
    await home(page);
    await page.getByRole("button", { name: "Open saved habits-06", exact: true }).click();
    await ready(page);
    await page.getByTestId("worksheet:A5").filter({ hasText: "2026-01-05" }).waitFor();
    await assertMixedColumn();
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
    await page.waitForFunction(() => !window.__habits.stale && window.__readObservedTable(window.__habits)?.rows.length === 1);
    const table = await projection(page);
    assert.deepEqual([0, 1, 2].map((column) => fieldAt(table, 0, column)?.stored?.value), ["a", "b", "c"]);
    for (const [column, text] of ["a", "b", "c"].entries()) await waitForCellText(page, cellIdFor(table, 0, column), text);
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
    assert.equal(await page.locator(".ts-cell--copied").count(), 12, "copy did not outline all twelve cells");
    const copied = await clipboard(page);
    assert.deepEqual(copied.split(/\r?\n/).map((line) => line.split("\t").length), [4, 4, 4], "the copied block is not three rows of four columns");
    await page.getByTestId(id(0, 4)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    const after = await projection(page);
    assert.equal(await cellText(page, after, 0, 4), "a1", "the pasted block did not start at the destination cell");
    assert.equal(await cellText(page, after, 2, 7), "d", "the pasted block did not keep its rectangle");
    assert.equal(await page.locator(".ts-cell--copied").count(), 12, "paste cleared the copied outline");
    await dragCells(page, id(0, 4), id(2, 7));
    assert.equal(await page.locator(".ts-cell--range-selected").count(), 12, "destination range was not selected");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".ts-cell--copied").count(), 0, "Escape did not clear the copied outline");
    assert.equal(await page.locator(".ts-cell--range-selected").count(), 12, "first Escape cleared the range selection");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".ts-cell--range-selected").count(), 0, "second Escape did not clear the range selection");
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
    const sorted = await order();
    assert.notDeepEqual(sorted, before, "sorting did not change the visible order");
    await replaceCell(page, id, "Zebra");
    await waitForCellText(page, id, "Zebra");
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id, "Zed");
    assert.deepEqual(await order(), sorted, "Undo of the later edit changed the sort");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await order(), before, "Undo did not restore the pre-sort order");
    await page.keyboard.press("Control+z");
    await waitForCellText(page, id, original);
    await page.keyboard.press("Control+y");
    await waitForCellText(page, id, "Zed");
    await page.keyboard.press("Control+y");
    await settle(page);
    assert.deepEqual(await order(), sorted, "Redo did not reapply the sort");
    await page.keyboard.press("Control+y");
    await waitForCellText(page, id, "Zebra");

    const sortedAfterEdit = await order();
    await page.getByRole("button", { name: "Clear sort", exact: true }).click();
    await settle(page);
    const unsortedAfterEdit = await order();
    assert.notDeepEqual(unsortedAfterEdit, sortedAfterEdit, "Clear sort did not restore storage order");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await order(), sortedAfterEdit, "Undo did not restore the cleared sort");

    await filterValues(page, "area", ["發版"]);
    const filtered = await order();
    assert.equal(filtered.length, 1);
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await order(), filtered, "Undo did not restore the cleared filter");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await order(), sortedAfterEdit, "Undo did not remove the applied filter");
    await page.keyboard.press("Control+y");
    await settle(page);
    assert.deepEqual(await order(), filtered, "Redo did not reapply the filter");
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
  { id: "18", name: "Ordinary formulas", tier: "A", waitMs: 20_000, budgetMs: 90_000, run: async (page) => {
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

    await page.getByTestId(total).click();
    await page.keyboard.press("Control+c");
    for (const blank of ["C5", "D2"]) {
      await page.getByTestId(`table-space:${blank}`).click();
      await page.keyboard.press("Control+v");
      await page.getByText("Pasting a formula requires an existing cell. Nothing was pasted.", { exact: true }).waitFor();
    }
    const after = await projection(page);
    assert.equal(after.rows.length, 2, "pasting a formula into a blank row allocated records");
    assert.equal(after.columns.length, 3, "pasting a formula beside the table allocated a field");

    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("button", { name: "Close without saving", exact: true }).click();
    await waitForColdHome(page);
    await (await homeImportInput(page)).setInputFiles({
      name: "large-formulas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Item,Amount,Result\nfirst,2,0\n" + "middle,0,0\n".repeat(9_998) + "last,5,0\n"),
    });
    const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await ready(page);
    const large = await projection(page);
    assert.equal(large.rows.length, 10_000);
    for (const [row, formula, result] of [[0, "=SUM(B2:B10001)", "7"], [1, "=1+2", "3"]]) {
      const target = cellIdFor(large, row, 2);
      await replaceCell(page, target, formula);
      await waitForCellText(page, target, result);
    }
  } },
  { id: "19", name: "Point-and-click formula references", tier: "A", budgetMs: 60_000, waitMs: 10_000, run: async (page) => {
    await newTable(page, "Refs", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    await addRow(page, ["2", "3"], 1);
    const table = await projection(page);
    const id = (column) => cellIdFor(table, 0, column);
    // The cells the open formula outlines, by test id.
    const outlined = () => page.locator(".ts-cell--formula-ref").evaluateAll((cells) => cells.map((cell) => cell.dataset.testid));
    await page.getByTestId(id(2)).dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.type("=");
    await page.getByTestId(id(0)).click();
    await page.keyboard.type("+");
    await page.getByTestId(id(1)).click();
    assert.equal(await editor.inputValue(), "=A2+B2", "clicking cells while typing did not insert A1 references");
    assert.deepEqual((await outlined()).sort(), [id(0), id(1)].sort(),
      "=A2+B2 does not outline exactly A2 and B2 (not the Total cell being edited)");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    assert.equal(await editor.inputValue(), "=A2+", "Backspace did not remove the B2 reference");
    assert.deepEqual(await outlined(), [id(0)], "=A2+ does not outline just A2");
    await page.keyboard.type('"B2"');
    assert.deepEqual(await outlined(), [id(0)], "a quoted \"B2\" is text, not a reference");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".ts-cell--formula-ref"), null, { timeout: 10_000 });
    assert.deepEqual(await outlined(), [], "Escape did not clear the formula's outlines");

    // Text that looks like a formula where no formula can live outlines nothing:
    // a text column, and the new row's draft.
    await newTable(page, "Not formulas", [{ name: "Label", type: "text" }, { name: "Amount", type: "number" }]);
    await addRow(page, ["one", "1"], 1);
    const plain = await projection(page);
    await page.getByTestId(cellIdFor(plain, 0, 0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("=B2");
    assert.deepEqual(await outlined(), [], "=B2 in a text column outlined a cell reference");
    await page.keyboard.press("Escape");
    const draftCells = page.locator(".ts-entry-row td[data-entry-field]");
    await draftCells.nth(1).dblclick();
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.type("=B2");
    assert.deepEqual(await outlined(), [], "=B2 in the new row's number cell outlined a cell reference");
    await page.keyboard.press("Escape");
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
  { id: "21", name: "Copied formula references", tier: "A", budgetMs: 90_000, waitMs: 10_000, note: "Relative references only. Absolute ones are case 21a.", run: async (page) => {
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

    // The formula can be pasted again; one Undo removes one paste.
    await page.getByTestId(total(2)).click();
    await page.keyboard.press("Control+v");
    await waitForCellText(page, total(2), "12");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 2, 2), "", "one Undo did not restore the third row's previous text");
    assert.equal(await cellText(page, await projection(page), 1, 2), "9", "one Undo removed more than the last paste");

    // A drag-selected block of that column gets the formula in every row.
    await dragCells(page, total(2), total(3));
    await page.keyboard.press("Control+v");
    await waitForCellText(page, total(2), "12");
    await waitForCellText(page, total(3), "15");

    // Another column pastes the value, as today, and gives the cell no formula.
    const price = (row) => cellIdFor(table, row, 1);
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(price(3)).click();
    await page.keyboard.press("Control+v");
    await waitForCellText(page, price(3), "6");
    assert.equal(fieldAt(await projection(page), 3, 1)?.formula ?? null, null, "a value pasted into Price gained a formula");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 3, 1), "3", "one Undo did not restore Price row 4");

    // Copying a value instead forgets the formula: an ordinary paste on a formula cell is refused.
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(total(1)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 2), "9", "a value paste changed the copied formula's result");

    // A changed source formula makes the same clipboard text an ordinary paste.
    // A formula cell is edited in the formula bar, not in the inline editor.
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    const bar = page.getByTestId("formula-bar-input");
    await bar.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2+B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total(0), "5");
    await page.getByTestId(total(1)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 2), "9", "a changed source formula still pasted its old shift");

    // The cell menu's Paste shifts the formula too.
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(total(2)).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
    await waitForCellText(page, total(2), "7");

    // The same text copied from elsewhere is that text, not the formula.
    await newTable(page, "Copy provenance", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    for (let row = 0; row < 2; row += 1) await addRow(page, [String(row + 2), "3"], row + 1);
    const plain = await projection(page);
    const plainTotal = (row) => cellIdFor(plain, row, 2);
    await page.getByTestId(plainTotal(0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, plainTotal(0), "6");
    const pasteTotalTwo = async () => {
      await page.getByTestId(plainTotal(1)).click();
      await page.keyboard.press("Control+v");
      await waitForCellText(page, plainTotal(1), "6");
      await settle(page);
      await page.keyboard.press("Control+z");
      await waitForCellText(page, plainTotal(1), "");
    };
    await page.getByTestId(plainTotal(0)).click();
    await page.keyboard.press("Control+c");
    await settle(page);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "habit-text-source";
      input.value = "6";
      document.body.append(input);
      input.select();
    });
    await page.keyboard.press("Control+c");
    await page.evaluate(() => document.getElementById("habit-text-source").remove());
    await pasteTotalTwo();
    await page.getByTestId(plainTotal(0)).click();
    await page.keyboard.press("Control+c");
    await settle(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await pasteTotalTwo();
  } },
  { id: "21a", name: "Absolute references copy", tier: "A", waitMs: 10_000, budgetMs: 60_000, run: async (page) => {
    await newTable(page, "Copy absolute", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    for (let row = 0; row < 3; row += 1) await addRow(page, [String(row + 2), "3"], row + 1);
    const table = await projection(page);
    const total = (row) => cellIdFor(table, row, 2);
    await page.getByTestId(total(0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=$A$2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total(0), "6");
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(total(1)).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 2), "6", "the absolute reference moved when copied");
    // A value pasted by mistake would also show 6; a formula follows its own row's Price.
    await replaceCell(page, cellIdFor(table, 1, 1), "5");
    await waitForCellText(page, total(1), "10");
  } },
  { id: "22", name: "Fill handle", tier: "A", budgetMs: 60_000, waitMs: 10_000, run: async (page) => {
    const assertFillSelection = async (table, rows, columns, stage, activeColumn = Array.isArray(columns) ? columns[0] : columns) => {
      const selected = await page.locator(".ts-cell--range-selected").evaluateAll(nodes => nodes.map(node => node.dataset.testid));
      const expected = rows.flatMap(row => (Array.isArray(columns) ? columns : [columns]).map(column => cellIdFor(table, row, column)));
      console.log(`Fill selection ${stage}: actual=${JSON.stringify(selected.sort())}; expected=${JSON.stringify(expected.sort())}`);
      assert.deepEqual(selected, expected, `fill selection did not cover exactly the source and filled cells after ${stage}`);
      assert.equal(await activeId(page), cellIdFor(table, rows[0], activeColumn), "fill moved the active cell off the source");
    };
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
    await assertFillSelection(table, [0, 1, 2, 3], 0, "drag");

    // Values copy down; one Undo restores the whole fill.
    const values = async () => {
      const latest = await projection(page);
      return Promise.all([0, 1, 2, 3].map(async (row) => await cellText(page, latest, row, 0)));
    };
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "Undo did not restore the values the corner drag replaced");
    await assertFillSelection(table, [0, 1, 2, 3], 0, "drag Undo");
    await page.keyboard.press("Control+Shift+z");
    await settle(page);
    assert.deepEqual(await values(), ["1", "1", "1", "1"], "Redo did not restore the corner fill");
    await assertFillSelection(table, [0, 1, 2, 3], 0, "drag Redo");
    await page.keyboard.press("Control+z");
    await settle(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    const handleBox = await fillHandleBox(page);
    const thirdRow = await page.getByTestId(cellIdFor(table, 2, 0)).boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(thirdRow.x + thirdRow.width / 2, thirdRow.y + thirdRow.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(await values(), ["1", "1", "1", "4"], "dragging the handle to the third row did not fill 1,1,1,4");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "one Undo did not restore 1,2,3,4");

    // Overshooting past the last row fills to the last row.
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    const overshootHandle = await fillHandleBox(page);
    const lastRow = await page.getByTestId(cellIdFor(table, 3, 0)).boundingBox();
    await page.mouse.move(overshootHandle.x + overshootHandle.width / 2, overshootHandle.y + overshootHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastRow.x + lastRow.width / 2, lastRow.y + lastRow.height * 1.5, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(await values(), ["1", "1", "1", "1"], "dragging past the last row did not fill to the last row");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);

    // Escape during the drag cancels it: the release fills nothing.
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    const escapeHandle = await fillHandleBox(page);
    await page.mouse.move(escapeHandle.x + escapeHandle.width / 2, escapeHandle.y + escapeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastRow.x + lastRow.width / 2, lastRow.y + lastRow.height / 2, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "releasing after Escape still filled");

    // Losing the window during the drag cancels it: a later release fills nothing.
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    const blurHandle = await fillHandleBox(page);
    await page.mouse.move(blurHandle.x + blurHandle.width / 2, blurHandle.y + blurHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastRow.x + lastRow.width / 2, lastRow.y + lastRow.height / 2, { steps: 8 });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "releasing after the window lost focus still filled");

    // A short viewport leaves rows below it: holding outside must reveal them.
    const grid = page.locator(".ts-grid-scroll");
    const viewport = await grid.evaluate((node) => {
      const header = node.querySelector("thead").getBoundingClientRect().height;
      const rowHeight = node.querySelector("tr.ts-row").getBoundingClientRect().height;
      node.style.minHeight = "0";
      node.style.maxHeight = `${header + rowHeight * 1.5}px`;
      node.scrollTop = 0;
      const bounds = node.getBoundingClientRect();
      return { bottom: bounds.top + node.clientHeight, rowHeight };
    });
    const beginEdgeDrag = async () => {
      await grid.evaluate(node => { node.scrollTop = 0; });
      await page.getByTestId(cellIdFor(table, 0, 0)).click();
      const handle = await fillHandleBox(page);
      const x = handle.x + handle.width / 2;
      await page.mouse.move(x, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, viewport.bottom + 8, { steps: 8 });
      await page.waitForFunction((height) => document.querySelector(".ts-grid-scroll").scrollTop >= height, viewport.rowHeight);
      return x;
    };
    const x = await beginEdgeDrag();
    await page.waitForFunction(() => {
      const node = document.querySelector(".ts-grid-scroll");
      return node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
    });
    const preview = await page.locator(".ts-cell--fill-preview").evaluateAll(nodes => nodes.map(node => node.dataset.testid));
    assert.ok(preview.includes(cellIdFor(table, 2, 0)), "the preview did not reach beyond the first viewport");
    await page.mouse.up();
    await settle(page);
    assert.deepEqual(await values(), [0, 1, 2, 3].map(row => row === 0 || preview.includes(cellIdFor(table, row, 0)) ? "1" : String(row + 1)), "release did not fill exactly the preview");
    const filledRows = [0, 1, 2, 3].filter(row => row === 0 || preview.includes(cellIdFor(table, row, 0)));
    await assertFillSelection(table, filledRows, 0, "auto-scrolled drag");
    const released = await grid.evaluate(node => node.scrollTop);
    await page.waitForTimeout(250);
    assert.equal(await grid.evaluate(node => node.scrollTop), released, "release left auto-scroll running");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "Undo did not restore the auto-scrolled fill");
    await assertFillSelection(table, filledRows, 0, "auto-scrolled drag Undo");

    await beginEdgeDrag();
    await page.mouse.move(x, viewport.bottom - 4);
    const stopped = await grid.evaluate(node => node.scrollTop);
    await page.waitForTimeout(250);
    assert.equal(await grid.evaluate(node => node.scrollTop), stopped, "moving back inside did not stop scrolling");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "Escape still filled on release");

    for (const event of ["blur", "pointercancel"]) {
      await beginEdgeDrag();
      await page.evaluate(type => window.dispatchEvent(new Event(type)), event);
      const cancelled = await grid.evaluate(node => node.scrollTop);
      await page.waitForTimeout(250);
      assert.equal(await grid.evaluate(node => node.scrollTop), cancelled, `${event} left auto-scroll running`);
      assert.equal(await page.locator(".ts-cell--fill-preview").count(), 0, `${event} left the preview active`);
      await page.mouse.up();
      await settle(page);
      assert.deepEqual(await values(), ["1", "2", "3", "4"], `${event} still filled on release`);
    }
    await grid.evaluate(node => { node.style.minHeight = ""; node.style.maxHeight = ""; node.scrollTop = 0; });

    // A right-press on the handle opens the cell menu and starts no drag.
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    const rightHandle = await fillHandleBox(page);
    await page.mouse.click(rightHandle.x + rightHandle.width / 2, rightHandle.y + rightHandle.height / 2, { button: "right" });
    await page.getByRole("menu", { name: "Cell actions" }).waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(await values(), ["1", "2", "3", "4"], "a right-press on the fill handle changed cells");

    // A formula copies with its rows shifted, so each target recalculates.
    await newTable(page, "Fill formula", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 2), "3"], row + 1);
    const formulaTable = await projection(page);
    const total = (row) => cellIdFor(formulaTable, row, 2);
    await page.getByTestId(total(0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total(0), "6");
    await page.getByTestId(total(0)).click();
    const formulaHandle = await fillHandleBox(page);
    const formulaTarget = await page.getByTestId(total(2)).boundingBox();
    await page.mouse.move(formulaHandle.x + formulaHandle.width / 2, formulaHandle.y + formulaHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(formulaTarget.x + formulaTarget.width / 2, formulaTarget.y + formulaTarget.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 2), "9", "the dragged formula did not shift to row 3 (9)");
    assert.equal(await cellText(page, await projection(page), 2, 2), "12", "the dragged formula did not shift to row 4 (12)");

    // Double-click fills to the adjacent column's last filled row.
    await newTable(page, "Fill double", [{ name: "Left", type: "number" }, { name: "Right", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 1)], row + 1);
    const doubleTable = await projection(page);
    await replaceCell(page, cellIdFor(doubleTable, 0, 1), "9");
    const snapshot = async () => {
      const latest = await projection(page);
      const cells = [];
      for (let row = 0; row < 4; row += 1) for (let column = 0; column < 2; column += 1) cells.push(await cellText(page, latest, row, column));
      return cells;
    };
    // Pressing the handle without moving fills nothing and says nothing.
    await page.getByTestId(cellIdFor(doubleTable, 0, 1)).click();
    const pressBox = await fillHandleBox(page);
    const beforePress = await snapshot();
    await page.mouse.click(pressBox.x + pressBox.width / 2, pressBox.y + pressBox.height / 2);
    await settle(page);
    assert.deepEqual(await snapshot(), beforePress, "pressing the fill handle without moving changed cells");
    assert.equal((await page.locator(".ts-clipboard-status").first().textContent()).trim(), "", "pressing the fill handle without moving announced a message");

    await page.getByTestId(cellIdFor(doubleTable, 0, 1)).click();
    const doubleHandle = await fillHandleBox(page);
    await page.mouse.dblclick(doubleHandle.x + doubleHandle.width / 2, doubleHandle.y + doubleHandle.height / 2);
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 3, 1), "9", "double-clicking the fill handle did not fill to the adjacent column's last row");
    await assertFillSelection(doubleTable, [0, 1, 2, 3], 1, "double-click");

    // A selection of several rows is refused with a message and changes nothing.
    await page.getByTestId(cellIdFor(doubleTable, 0, 0)).click();
    await page.getByTestId(cellIdFor(doubleTable, 1, 0)).click({ modifiers: ["Shift"] });
    const beforeRangeDrag = await snapshot();
    const rangeHandle = await fillHandleBox(page);
    const rangeTarget = await page.getByTestId(cellIdFor(doubleTable, 3, 0)).boundingBox();
    await page.mouse.move(rangeHandle.x + rangeHandle.width / 2, rangeHandle.y + rangeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(rangeTarget.x + rangeTarget.width / 2, rangeTarget.y + rangeTarget.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.match((await page.locator(".ts-clipboard-status").first().textContent()).trim(), /^Fill from one row\./, "dragging a multi-row selection's handle announced nothing");
    assert.deepEqual(await snapshot(), beforeRangeDrag, "dragging a multi-row selection's handle changed cells");
    await assertFillSelection(doubleTable, [0, 1], 0, "refused multi-row fill");

    // The existing ways to fill still work.
    await dragCells(page, cellIdFor(doubleTable, 0, 0), cellIdFor(doubleTable, 1, 0));
    assert.equal(await selectedCount(page), 2, "a plain drag across cells no longer selects a range");
    await settle(page);
    await page.keyboard.press("Control+d");
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 0), "1", "Ctrl+D no longer fills down after the fill handle was added");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    // Undo publishes a new revision, which drops the range; select it again.
    await dragCells(page, cellIdFor(doubleTable, 0, 0), cellIdFor(doubleTable, 1, 0));
    assert.equal(await selectedCount(page), 2, "the range did not come back after Undo");
    await page.getByTestId(cellIdFor(doubleTable, 0, 0)).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Fill down", exact: true }).click();
    await settle(page);
    assert.equal(await cellText(page, await projection(page), 1, 0), "1", "the cell menu's Fill down no longer fills");

    // A right-to-left source keeps both columns selected and B1 active, including history.
    await page.getByTestId(cellIdFor(doubleTable, 0, 1)).click();
    await page.getByTestId(cellIdFor(doubleTable, 0, 0)).click({ modifiers: ["Shift"] });
    const rightToLeftActive = await activeId(page);
    assert.equal(rightToLeftActive, cellIdFor(doubleTable, 0, 1), "right-to-left source did not keep B1 active");
    const beforeRightToLeft = await snapshot();
    const rightToLeftHandle = await fillHandleBox(page);
    const rightToLeftTarget = await page.getByTestId(cellIdFor(doubleTable, 3, 1)).boundingBox();
    await page.mouse.move(rightToLeftHandle.x + rightToLeftHandle.width / 2, rightToLeftHandle.y + rightToLeftHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(rightToLeftTarget.x + rightToLeftTarget.width / 2, rightToLeftTarget.y + rightToLeftTarget.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const rightToLeftValues = ["1", "9", "1", "9", "1", "9", "1", "9"];
    assert.deepEqual(await snapshot(), rightToLeftValues, "right-to-left source did not fill both columns");
    await assertFillSelection(doubleTable, [0, 1, 2, 3], [0, 1], "right-to-left drag", 1);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual(await snapshot(), beforeRightToLeft, "Undo did not restore the right-to-left fill's values");
    await assertFillSelection(doubleTable, [0, 1, 2, 3], [0, 1], "right-to-left drag Undo", 1);
    await page.keyboard.press("Control+Shift+z");
    await settle(page);
    assert.deepEqual(await snapshot(), rightToLeftValues, "Redo did not restore the right-to-left fill");
    await assertFillSelection(doubleTable, [0, 1, 2, 3], [0, 1], "right-to-left drag Redo", 1);

    // #338: pointer drags in both axes, real Work formula copies and atomic Undo.
    await newTable(page, "Fill directions", ["A", "B", "C", "D"].map(name => ({ name, type: "number" })));
    for (let row = 0; row < 3; row += 1) await addRow(page, [String(row + 2), "3", "4", "9"], row + 1);
    const directions = await projection(page);
    const id = (row, column) => cellIdFor(directions, row, column);
    const directionValues = async () => {
      const latest = await projection(page);
      return Promise.all([0, 1, 2].flatMap(row => [0, 1, 2, 3].map(column => cellText(page, latest, row, column))));
    };
    const dragHandleTo = async (row, column, table = directions) => {
      const handle = await fillHandleBox(page);
      const target = await page.getByTestId(cellIdFor(table, row, column)).boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
      await page.mouse.up();
      await settle(page);
    };
    const checkDirectionSelection = async (rows, columns, activeRow, activeColumn) => {
      const selected = await page.locator(".ts-cell--range-selected").evaluateAll(nodes => nodes.map(node => node.dataset.testid));
      assert.deepEqual(selected.sort(), rows.flatMap(row => columns.map(column => id(row, column))).sort());
      assert.equal(await activeId(page), id(activeRow, activeColumn));
    };
    await page.getByTestId(id(0, 1)).click();
    let before = await directionValues();
    // Horizontal displacement wins even with vertical motion into another row.
    await dragHandleTo(1, 3);
    assert.deepEqual((await directionValues()).slice(0, 4), ["2", "3", "3", "3"]);
    await checkDirectionSelection([0], [1, 2, 3], 0, 1);
    await page.keyboard.press("Control+z"); await settle(page);
    assert.deepEqual(await directionValues(), before, "one Undo did not restore the right fill");
    await checkDirectionSelection([0], [1, 2, 3], 0, 1);

    await page.getByTestId(id(0, 3)).click();
    before = await directionValues();
    await dragHandleTo(0, 1);
    assert.deepEqual((await directionValues()).slice(0, 4), ["2", "9", "9", "9"], "left value fill did not copy the source");
    await checkDirectionSelection([0], [1, 2, 3], 0, 3);
    await page.keyboard.press("Control+z"); await settle(page);
    assert.deepEqual(await directionValues(), before, "one Undo did not restore the left value fill");
    await checkDirectionSelection([0], [1, 2, 3], 0, 3);

    await replaceCell(page, id(0, 3), "=C2*2");

    await replaceCell(page, id(2, 3), "=A4*2");
    await page.getByTestId(id(2, 3)).click();
    before = await directionValues();
    await dragHandleTo(0, 3);
    const up = await directionValues();
    assert.deepEqual([up[3], up[7], up[11]], ["4", "6", "8"], "up fill did not shift relative rows");
    await checkDirectionSelection([0, 1, 2], [3], 2, 3);
    await page.keyboard.press("Control+z"); await settle(page);
    assert.deepEqual(await directionValues(), before, "one Undo did not restore the up fill");
    await checkDirectionSelection([0, 1, 2], [3], 2, 3);

    await page.getByTestId(id(0, 0)).click();
    await page.getByTestId(id(1, 0)).click({ modifiers: ["Shift"] });
    before = await directionValues();
    await dragHandleTo(1, 2);
    assert.deepEqual((await directionValues()).slice(0, 8), ["2", "2", "2", "4", "3", "3", "3", "9"], "column source fill did not copy values and recalculate D2 (=C2*2)");
    await checkDirectionSelection([0, 1], [0, 1, 2], 0, 0);
    await page.keyboard.press("Control+z"); await settle(page);
    assert.deepEqual(await directionValues(), before);

    await page.getByTestId(id(2, 0)).click();
    await page.getByTestId(id(2, 1)).click({ modifiers: ["Shift"] });
    before = await directionValues();
    await dragHandleTo(0, 1);
    assert.deepEqual((await directionValues()).slice(0, 8), ["4", "3", "4", "8", "4", "3", "4", "9"]);
    await checkDirectionSelection([0, 1, 2], [0, 1], 2, 0);
    await page.keyboard.press("Control+z"); await settle(page);
    assert.deepEqual(await directionValues(), before);

    await newTable(page, "Fill refusal", [{ name: "Text", type: "text" }, { name: "Number", type: "number" }]);
    await addRow(page, ["not a number", "7"], 1);
    const refusal = await projection(page);
    await page.getByTestId(cellIdFor(refusal, 0, 0)).click();
    const refusedHandle = await fillHandleBox(page);
    const refusedTarget = await page.getByTestId(cellIdFor(refusal, 0, 1)).boundingBox();
    const selectedBefore = await selectedCount(page);
    await page.mouse.move(refusedHandle.x + 3, refusedHandle.y + 3);
    await page.mouse.down();
    await page.mouse.move(refusedTarget.x + refusedTarget.width / 2, refusedTarget.y + refusedTarget.height / 2, { steps: 8 });
    await page.mouse.up(); await settle(page);
    assert.equal(await cellText(page, await projection(page), 0, 0), "not a number");
    assert.equal(await cellText(page, await projection(page), 0, 1), "7");
    assert.equal(await selectedCount(page), selectedBefore, "refused fill changed selection");
    assert.equal(await activeId(page), cellIdFor(refusal, 0, 0));
    assert.match(await page.locator(".ts-clipboard-status").first().textContent(), /number/i);

    await newTable(page, "Fill anchors", ["A", "B", "C", "D"].map(name => ({ name, type: "number" })));
    await addRow(page, ["10", "20"], 1);
    await addRow(page, ["1", "1", "1", "1"], 2);
    const anchors = await projection(page);
    const c3 = cellIdFor(anchors, 1, 2), d3 = cellIdFor(anchors, 1, 3);
    await replaceCell(page, c3, "=A2+$A$2");
    await page.getByTestId(c3).click();
    await dragHandleTo(1, 3, anchors);
    await waitForCellText(page, d3, "30");
    await page.getByTestId(c3).click();
    const bar = page.getByTestId("formula-bar-input");
    await bar.fill("=1");
    await bar.press("Enter");
    await waitForCellText(page, c3, "1");
    await page.getByTestId(d3).click();
    await dragHandleTo(1, 2, anchors);
    await waitForCellText(page, c3, "20");

    await saveCopy(page, "sideways-fill");
    await home(page);
    await page.getByRole("button", { name: "Open saved sideways-fill", exact: true }).click();
    await waitForCellText(page, c3, "20");
    await waitForCellText(page, d3, "30");
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    const download = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const xml = sheetXml(await (await download).path());
    // Work keeps references to other rows bound to their row identity.
    const sheet = "&apos;Fill anchors&apos;!";
    const leftFormula = xml.match(/<c\b[^>]*\br="C3"[^>]*>\s*<f>([^<]+)<\/f>/)?.[1];
    const rightFormula = xml.match(/<c\b[^>]*\br="D3"[^>]*>\s*<f>([^<]+)<\/f>/)?.[1];
    assert.equal(leftFormula, `(${sheet}A$2+${sheet}$A$2)`);
    assert.equal(rightFormula, `(${sheet}B$2+${sheet}$A$2)`);
  } },
  { id: "23", name: "Row operations", tier: "A", budgetMs: 45_000, run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 1, 0)).click();
    await page.getByRole("button", { name: "Delete row", exact: true }).click();
    await settle(page);
    assert.equal((await projection(page)).rows.length, 2, "Delete row did not remove the record");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual((await projection(page)).rows, table.rows, "Undo did not restore the deleted record with its identity");
    await newTable(page, "Row operations", [{ name: "Input", type: "number" }, { name: "Result", type: "number" }]);
    for (const [index, value] of ["10", "20", "30", "40"].entries()) await addRow(page, [value], index + 1);
    const original = await projection(page);
    const ids = original.rows.map(rowEntity);
    const formula = cellIdFor(original, 3, 1);
    await replaceCell(page, formula, "=A3*2");
    await waitForCellText(page, formula, "40");
    const headers = page.locator("tbody tr.ts-row > th.ts-row-head");
    const projectedIds = rows => rows.map(row => row.fields.find(field => field?.target?.entity)?.target.entity ?? row.id);
    const currentIds = async () => projectedIds((await projection(page)).rows);
    const undo = async () => { await page.keyboard.press("Control+z"); await settle(page); };

    await page.getByTestId(cellIdFor(original, 1, 0)).click();
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("Control+=");
    await settle(page);
    const inserted = await projection(page);
    assert.equal(inserted.rows.length, 5, "Ctrl+= inserted no record between existing records");
    const blank = projectedIds(inserted.rows)[1];
    const withBlank = [ids[0], blank, ...ids.slice(1)];
    assert.ok(!ids.includes(blank), "inserted row has a fresh identity");
    assert.deepEqual(await currentIds(), withBlank, "existing rows kept their identities and order");
    for (const column of inserted.columns) {
      assert.equal((await page.getByTestId(`cell:${blank}:${column.id}`).textContent()).trim(), "");
    }
    await waitForCellText(page, formula, "40");
    await undo();
    assert.deepEqual(await currentIds(), ids, "one Undo removes the inserted row");

    await headers.nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Insert row", exact: true }).click();
    await settle(page);
    const viaMenu = await currentIds();
    assert.deepEqual(viaMenu.filter((_, index) => index !== 1), ids, "row menu inserts above the clicked row");
    await undo();
    assert.deepEqual(await currentIds(), ids);

    await headers.nth(1).click();
    await page.keyboard.press("Control+Shift+Equal");
    await settle(page);
    const shifted = await currentIds();
    assert.deepEqual(shifted.filter((_, index) => index !== 1), ids, "Ctrl+Shift+= inserts above");

    await headers.nth(0).click();
    await headers.nth(1).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Control+=");
    await page.getByText("Insert one row at a time for now", { exact: true }).waitFor();
    assert.deepEqual(await currentIds(), shifted, "multi-row insert did not publish");
    await headers.nth(1).click({ button: "right" });
    const insertItem = page.getByRole("menuitem", { name: "Insert row", exact: true });
    assert.equal(await insertItem.getAttribute("aria-disabled"), "true");
    assert.equal(await insertItem.getAttribute("aria-description"), "Insert one row at a time for now");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+-");
    await settle(page);
    assert.deepEqual(await currentIds(), ids.slice(1), "Ctrl+- deletes both selected rows");
    await undo();
    assert.deepEqual(await currentIds(), shifted, "one Undo restores both deleted row identities");

    await headers.nth(3).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
    await settle(page);
    const finalIds = [ids[0], shifted[1], ids[1], ids[3]];
    assert.deepEqual(await currentIds(), finalIds);
    await saveCopy(page, "habit-23-rows");
    await home(page);
    await page.getByRole("button", { name: "Open saved habit-23-rows", exact: true }).click();
    await waitForCellText(page, formula, "40");
    const reopened = await projection(page);
    assert.deepEqual(projectedIds(reopened.rows), finalIds, "save and reopen preserve the structural edits");
    await replaceCell(page, cellIdFor(reopened, 2, 0), "25");
    await waitForCellText(page, formula, "50");
  } },
  { id: "24", name: "Workbook sheets", tier: "A", note: "Native and imported add/rename/delete; standalone .ro names/order and XLSX re-import are exercised by the same journey as workbook-tabs step 8.", budgetMs: 120_000, run: async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "habits-24-"));
    let context;
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { ...launchOptions, viewport: { width: 1440, height: 900 } });
      await installDistRoutes(context, dist);
      await installPublishedTablePatcher(context);
      await context.addInitScript(evidence);
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(4000);
      return page;
    };
    try {
      const page = await open();
      await newTable(page, "Habits 24", [{ name: "A" }]);
      const tabs = page.locator(".ts-table-tab");
      const namedTab = name => tabs.filter({ hasText: new RegExp(`^${name}$`) });
      const tabNames = () => tabs.allTextContents();
      await page.getByRole("button", { name: "Add sheet", exact: true }).click();
      await settle(page);
      assert.equal(await tabs.count(), 2, "+ did not add a worksheet tab");
      assert.equal(await namedTab("Sheet 2").getAttribute("aria-selected"), "true", "+ did not select Sheet 2");
      await page.waitForFunction(() => document.activeElement === document.querySelector('.ts-entry-row [data-entry-field]'));
      assert.deepEqual((await projection(page)).columns.map(({ display_name, field_type, required }) => ({ display_name, field_type, required })),
        [{ display_name: "A", field_type: "text", required: false }], "the new sheet did not use the default starter column");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await settle(page);
      assert.equal(await tabs.count(), 1, "one Undo did not remove the added sheet");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await settle(page);
      assert.equal(await tabs.count(), 2, "Redo did not restore the added sheet");
      await namedTab("Habits 24").click();
      await settle(page);
      await page.keyboard.press("Shift+F11");
      await settle(page);
      assert.equal(await tabs.count(), 3, "Shift+F11 did not add a worksheet tab");
      assert.equal(await namedTab("Sheet 3").getAttribute("aria-selected"), "true", "Shift+F11 did not select Sheet 3");
      await page.waitForFunction(() => document.activeElement === document.querySelector('.ts-entry-row [data-entry-field]'));
      // Settle the asynchronous collection switch before opening its rename dialog.
      await namedTab("Sheet 2").click();
      await settle(page);
      await namedTab("Sheet 2").dblclick();
      const rename = page.getByRole("dialog", { name: "Rename sheet", exact: true });
      await rename.getByLabel("Sheet name", { exact: true }).fill("Notes");
      await rename.getByRole("button", { name: "Rename", exact: true }).click();
      await rename.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await namedTab("Notes").count(), 1, "double-click rename did not change the tab name");
      await namedTab("Notes").click();
      await settle(page);
      assert.equal(await namedTab("Notes").getAttribute("aria-selected"), "true", "switching did not select Notes");
      await namedTab("Sheet 3").click();
      await settle(page);
      await namedTab("Sheet 3").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete sheet…", exact: true }).click();
      const deletion = page.getByRole("dialog", { name: "Delete sheet", exact: true });
      await deletion.getByRole("button", { name: "Delete sheet", exact: true }).click();
      await deletion.waitFor({ state: "detached" });
      await settle(page);
      assert.equal(await tabs.count(), 2, "Delete sheet did not remove the tab");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await settle(page);
      assert.equal(await namedTab("Sheet 3").count(), 1, "Undo did not restore the deleted sheet and name");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await settle(page);
      assert.equal(await tabs.count(), 2, "Redo did not delete the sheet again");
      const expectedNames = await tabNames();
      assert.deepEqual([...expectedNames].sort(), ["Habits 24", "Notes"], "the surviving tab names changed");
      await saveCopy(page, "habits-24");
      await context.close();
      const reopened = await open();
      await home(reopened);
      await reopened.getByRole("button", { name: "Open saved habits-24", exact: true }).click();
      await ready(reopened);
      assert.deepEqual(await reopened.locator(".ts-table-tab").allTextContents(), expectedNames,
        "worksheet names or Work's order changed after save, browser restart and reopen");
      await reopened.getByRole("button", { name: "Close project", exact: true }).click();
      await (await homeImportInput(reopened)).setInputFiles(invoice);
      const preview = reopened.getByRole("dialog", { name: "Review import preview", exact: true });
      await preview.waitFor();
      await preview.getByRole("button", { name: "Import file", exact: true }).click();
      await ready(reopened);
      const importedTabs = reopened.locator(".ts-table-tab");
      const original = await importedTabs.first().textContent();
      await reopened.getByRole("button", { name: "Add sheet", exact: true }).click(); await settle(reopened);
      await reopened.getByRole("button", { name: "Add sheet", exact: true }).click(); await settle(reopened);
      await importedTabs.first().click({ button: "right" });
      await reopened.getByRole("menuitem", { name: "Rename sheet…", exact: true }).click();
      const importedRename = reopened.getByRole("dialog", { name: "Rename sheet", exact: true });
      await importedRename.getByLabel("Sheet name").fill("Imported renamed");
      await importedRename.getByRole("button", { name: "Rename", exact: true }).click(); await settle(reopened);
      await importedTabs.nth(1).click({ button: "right" });
      await reopened.getByRole("menuitem", { name: "Delete sheet…", exact: true }).click();
      await reopened.getByRole("dialog", { name: "Delete sheet", exact: true }).getByRole("button", { name: "Delete sheet", exact: true }).click(); await settle(reopened);
      const importedNames = await importedTabs.allTextContents();
      assert.equal(importedNames.length, 2);
      assert.equal(importedNames[0], "Imported renamed");
      assert.ok(!importedNames.includes(original));
      await standaloneImportedRoReopen(reopened, async () => { await context.close(); const next = await open(); await home(next); return next; }, profile, importedNames);
    } finally {
      await context?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  } },
  { id: "25", name: "Save and reopen", tier: "A", note: "Values and formulas compared; cell styles do not exist yet.", run: async () => {
    // A real browser restart on one profile: a reload could keep session state alive.
    const profile = await mkdtemp(path.join(tmpdir(), "habits-25-"));
    let context;
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { ...launchOptions, viewport: { width: 1440, height: 900 } });
      await installDistRoutes(context, dist);
      await installPublishedTablePatcher(context);
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
      await waitForCellText(page, cellIdFor(table, 0, 0), "持久保存");
      await saveCopy(page, "habits-25");
      await context.close();
      const reopened = await open();
      await home(reopened);
      await reopened.getByRole("button", { name: "Open saved habits-25", exact: true }).click();
      await ready(reopened);
      const after = await projection(reopened);
      assert.equal(fieldAt(after, 0, 0)?.stored?.value, "持久保存", "the edit did not survive save, restart and reopen");
      await waitForCellText(reopened, cellIdFor(after, 0, 0), "持久保存");
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
  { id: "28", name: "Direct formatting", tier: "A", budgetMs: 60_000, waitMs: 10_000, note: "Bold, italic, fill and borders use Work presentation styles; checked through save and XLSX export.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+b");
    await settle(page);
    const weight = await page.getByTestId(id).evaluate((node) => Number(getComputedStyle(node).fontWeight));
    assert.ok(weight >= 600, `Ctrl+B left the cell at font-weight ${weight}`);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.ok(await page.getByTestId(id).evaluate(node => Number(getComputedStyle(node).fontWeight)) < 600, "Undo did not remove bold");
    await page.keyboard.press("Control+y");
    await settle(page);
    assert.ok(await page.getByTestId(id).evaluate(node => Number(getComputedStyle(node).fontWeight)) >= 600, "Redo did not restore bold");
    await page.keyboard.press("Control+i");
    await settle(page);
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).fontStyle), "italic");
    await page.getByLabel("Fill colour").fill("#ffff00");
    await settle(page);
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 255, 0)");
    await page.getByRole("button", { name: "All borders" }).click();
    await settle(page);
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).borderTopStyle), "solid");
    assert.deepEqual(fieldAt(await projection(page), 0, 0)?.stored, fieldAt(table, 0, 0)?.stored, "formatting changed the cell value or formula");
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.notEqual(await page.getByTestId(id).evaluate(node => getComputedStyle(node).borderTopColor), "rgb(0, 0, 0)", "Undo did not remove the border");
    await page.keyboard.press("Control+y");
    await settle(page);
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).borderTopColor), "rgb(0, 0, 0)", "Redo did not restore the border");
    if (process.env.HABITS_SHOTS) {
      await mkdir(process.env.HABITS_SHOTS, { recursive: true });
      await page.getByTestId(cellIdFor(table, 0, 1)).click();
      await page.screenshot({ path: path.join(process.env.HABITS_SHOTS, "habit28-applied.png"), fullPage: true });
    }
    await saveCopy(page, "habits-28");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-28", exact: true }).click();
    await ready(page);
    assert.ok(await page.getByTestId(id).evaluate(node => Number(getComputedStyle(node).fontWeight)) >= 600, "bold did not survive reopen");
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).fontStyle), "italic", "italic did not survive reopen");
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 255, 0)", "fill did not survive reopen");
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).borderTopColor), "rgb(0, 0, 0)", "border did not survive reopen");
    if (process.env.HABITS_SHOTS) {
      await page.getByTestId(cellIdFor(table, 0, 1)).click();
      await page.screenshot({ path: path.join(process.env.HABITS_SHOTS, "habit28-reopened.png"), fullPage: true });
    }
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    await consent.waitFor();
    const download = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const work = await mkdtemp(path.join(tmpdir(), "habits-28-"));
    try {
      const file = path.join(work, "export.xlsx");
      await (await download).saveAs(file);
      const xml = sheetXml(file);
      assert.match(xml, /<b\s*\/>/, "XLSX lacks bold");
      assert.match(xml, /<i\s*\/>/, "XLSX lacks italic");
      assert.match(xml, /FFFF00/i, "XLSX lacks yellow fill");
      assert.match(xml, /<top[^>]*style=/, "XLSX lacks a top border");
    } finally { await rm(work, { recursive: true, force: true }); }
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    await page.getByTestId(id).click();
    await page.keyboard.press("Control+b");
    await settle(page);
    assert.ok(await page.getByTestId(id).evaluate(node => Number(getComputedStyle(node).fontWeight)) < 600, "Ctrl+B did not remove bold");
    await page.keyboard.press("Control+i");
    await settle(page);
    assert.equal(await page.getByTestId(id).evaluate(node => getComputedStyle(node).fontStyle), "normal");

    await home(page);
    await page.keyboard.press("Control+n");
    const first = page.getByTestId("worksheet:A1");
    await first.click();
    await page.evaluate(() => navigator.clipboard.writeText(Array(26).fill("1").join("\t")));
    await page.keyboard.press("Control+v");
    await waitForCellText(page, "worksheet:Z1", "1");
    await first.click();
    await page.evaluate(() => navigator.clipboard.writeText(Array(2000).fill("2").join("\n")));
    await page.keyboard.press("Control+v");
    await waitForCellText(page, "worksheet:A1", "2");

    const nameBox = page.getByRole("textbox", { name: "Name Box", exact: true });
    await nameBox.fill("A1:Z2000");
    await nameBox.press("Enter");
    const styleCount = () => page.evaluate(() => {
      const rows = window.__readObservedTable(window.__habits).rows;
      return rows.reduce((counts, row) => {
        for (const style of row.styles ?? []) {
          if (style.bold) counts.bold++;
          if (style.fill?.toLowerCase() === "ffff00") counts.fill++;
        }
        return counts;
      }, { bold: 0, fill: 0 });
    });
    await page.keyboard.press("Control+b");
    await settle(page);
    assert.deepEqual(await styleCount(), { bold: 52_000, fill: 0 });
    await page.getByLabel("Fill colour").fill("#ffff00");
    await settle(page);
    assert.deepEqual(await styleCount(), { bold: 52_000, fill: 52_000 });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await settle(page);
    assert.deepEqual(await styleCount(), { bold: 52_000, fill: 0 }, "one Undo did not clear the entire range fill");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await settle(page);
    assert.deepEqual(await styleCount(), { bold: 0, fill: 0 }, "one Undo did not clear the entire range bold");
    for (let step = 0; step < 2; step += 1) {
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await settle(page);
    }
    await saveCopy(page, "large-range-format");
    await home(page);
    await page.getByRole("button", { name: "Open saved large-range-format", exact: true }).click();
    await ready(page);
    assert.deepEqual(await styleCount(), { bold: 52_000, fill: 52_000 }, "the full range formatting did not survive reopen");
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

    const title = cellIdFor(table, 0, 0);
    const rows = page.locator("tbody tr.ts-row");
    await replaceCell(page, title, "Apple");
    await waitForCellText(page, title, "Apple");
    await filterValues(page, "title", ["Apple"]);
    await replaceCell(page, title, "Banana");
    await waitForCellText(page, title, "Banana");
    assert.equal(await rows.count(), 1);
    for (let replay = 0; replay < 2; replay++) {
      await page.keyboard.press("Control+z");
      await waitForCellText(page, title, "Apple");
      await page.keyboard.press("Control+z");
      await settle(page);
      assert.equal(await rows.count(), 3, "Undo did not remove the Apple filter");
      await page.keyboard.press("Control+y");
      await settle(page);
      assert.equal(await rows.count(), 1, "Redo did not reapply the Apple filter");
      await page.keyboard.press("Control+y");
      await waitForCellText(page, title, "Banana");
      assert.equal(await rows.count(), 1, "Redo changed the visible rows after editing under the filter");
    }
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
  { id: "36", name: "Whole row/column selection", tier: "B", budgetMs: 45_000, run: async (page) => {
    await newTable(page, "Header selection", [{ name: "First" }, { name: "Second" }, { name: "Third" }]);
    for (let row = 0; row < 3; row += 1) await addRow(page, [`a${row}`, `b${row}`, `c${row}`], row + 1);
    const table = await projection(page);
    const id = (row, column) => cellIdFor(table, row, column);
    await page.getByTestId(id(1, 1)).click();
    await page.keyboard.press("Shift+Space");
    assert.equal(await selectedCount(page), table.columns.length, "Shift+Space did not select the displayed row");
    assert.equal((await projection(page)).rows.length, table.rows.length, "selecting a row deleted records");
    await page.getByTestId(id(1, 1)).click();
    await page.keyboard.press("Control+Space");
    assert.equal(await selectedCount(page), table.rows.length, "Ctrl+Space did not select the displayed column");
    const headers = page.locator("th.ts-column-header");
    const rowHeads = page.locator("tbody tr.ts-row > th.ts-row-head");
    await headers.nth(1).locator(".ts-col-head").click();
    assert.equal(await selectedCount(page), table.rows.length, "header click did not select the column");
    assert.equal(await activeId(page), id(0, 1), "column selection did not focus its first cell");
    await page.keyboard.press("Control+c");
    assert.equal((await clipboard(page)).trimEnd().split("\n").length, table.rows.length, "copy did not include the whole column");
    await headers.nth(2).locator(".ts-col-head").click({ modifiers: ["Shift"] });
    assert.equal(await selectedCount(page), 2 * table.rows.length, "Shift+click did not extend the column selection");
    await rowHeads.nth(1).click();
    assert.equal(await selectedCount(page), table.columns.length, "row number did not select the row");
    assert.equal(await activeId(page), id(1, 0), "row selection did not focus its first cell");
    await rowHeads.nth(2).click({ modifiers: ["Shift"] });
    assert.equal(await selectedCount(page), 2 * table.columns.length, "Shift+click did not extend the row selection");
    await headers.nth(1).hover();
    await headers.nth(1).locator("summary").click();
    assert.equal(await selectedCount(page), 2 * table.columns.length, "column menu changed selection");
    await headers.nth(1).locator("summary").click();
    await headers.nth(1).hover();
    const resize = headers.nth(1).locator(".ts-col-resize");
    const box = await resize.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2);
    await page.mouse.up();
    assert.equal(await selectedCount(page), 2 * table.columns.length, "resize changed selection");
    await page.getByTestId(id(0, 0)).dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.fill("uncommitted draft");
    const before = await selectedCount(page);
    await headers.nth(1).locator(".ts-col-head").click();
    assert.equal(await editor.inputValue(), "uncommitted draft", "header click changed the draft");
    assert.equal(await selectedCount(page), before, "header click changed selection during editing");
    await page.keyboard.press("Escape");
    await headers.nth(1).locator(".ts-col-head").dblclick();
    await page.getByRole("dialog", { name: /rename/i }).waitFor();
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
    for (const row of [0, 1, 2]) await waitForCellText(page, id(row), "fill");
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
    for (const [row, text] of ["1", "1", "1", "4"].entries()) await waitForCellText(page, cellIdFor(table, row, 0), text);
  } },
  { id: "40", name: "Paste Special", tier: "B", budgetMs: 60_000, waitMs: 10_000, note: "Values and formulas only: no formats exist to paste yet.", run: async (page) => {
    await example(page);
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(cellIdFor(table, 0, 1)).click();
    await page.keyboard.press("Control+Alt+v");
    await settle(page);
    assert.ok(await page.getByRole("dialog").count() + await page.getByRole("menu").count() > 0, "Ctrl+Alt+V opened no Paste Special choices");
    await page.keyboard.press("Escape");
    await settle(page);

    // A copied formula pastes as its value or as itself, as chosen.
    await newTable(page, "Paste special", [{ name: "Qty", type: "number" }, { name: "Price", type: "number" }, { name: "Total", type: "number" }]);
    for (let row = 0; row < 4; row += 1) await addRow(page, [String(row + 2), "3"], row + 1);
    const sums = await projection(page);
    const total = (row) => cellIdFor(sums, row, 2);
    await page.getByTestId(total(0)).press("F2");
    await page.getByTestId("cell-editor").waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("=A2*B2");
    await page.keyboard.press("Enter");
    await waitForCellText(page, total(0), "6");
    await page.getByTestId(total(0)).click();
    await page.keyboard.press("Control+c");
    await settle(page);
    const choice = (name) => page.getByRole("menuitem", { name, exact: true });
    const isFormula = async (row) => fieldAt(await projection(page), row, 2)?.formula != null;

    await page.getByTestId(total(1)).click();
    await page.keyboard.press("Control+Alt+v");
    await choice("Paste values").click();
    await waitForCellText(page, total(1), "6");
    assert.equal(await isFormula(1), false, "Paste values pasted the formula");

    await page.getByTestId(total(2)).click();
    await page.keyboard.press("Control+Alt+v");
    await choice("Paste").click();
    await waitForCellText(page, total(2), "12");
    assert.equal(await isFormula(2), true, "Paste Special's Paste did not paste the formula");

    await page.getByTestId(total(3)).click();
    await page.keyboard.press("Control+Shift+v");
    await waitForCellText(page, total(3), "6");
    assert.equal(await isFormula(3), false, "Ctrl+Shift+V pasted the formula");
    await settle(page);
    await page.keyboard.press("Control+z");
    await waitForCellText(page, total(3), "");

    await page.getByTestId(total(3)).click({ button: "right" });
    await choice("Paste values").click();
    await waitForCellText(page, total(3), "6");
    assert.equal(await isFormula(3), false, "the cell menu's Paste values pasted the formula");
    await settle(page);

    // A slow clipboard read pastes nothing if the active cell moved meanwhile, with no range selected.
    const qty = (row) => cellIdFor(sums, row, 0);
    await page.evaluate(() => { navigator.clipboard.readText = () => new Promise((resolve) => setTimeout(() => resolve("99"), 1000)); });
    await page.getByTestId(qty(0)).click();
    await page.keyboard.press("Control+Shift+v");
    await page.keyboard.press("ArrowDown");
    await page.locator(".ts-clipboard-status").filter({ hasText: "Nothing was pasted." }).waitFor();
    await settle(page);
    assert.equal(await page.getByTestId(qty(0)).innerText(), "2", "a late paste wrote over the cell the person had left");
    assert.equal(await page.getByTestId(qty(1)).innerText(), "3", "a late paste wrote to a cell it wasn't asked for");

    // Refused access: Paste values says so, and doesn't send people to Ctrl+V, which would paste the formula.
    await page.evaluate(() => { navigator.clipboard.readText = () => Promise.reject(new Error("refused")); });
    await page.keyboard.press("Control+Shift+v");
    await page.locator(".ts-clipboard-status").filter({ hasText: "Paste values isn't available" }).waitFor();
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
    for (const next of ["=$A$2", "=A$2", "=$A2", "=A2"]) {
      await page.keyboard.press("F4");
      assert.equal(await editor.inputValue(), next, `F4 did not cycle the cell editor to ${next}`);
    }
    await page.keyboard.press("Escape");
    const bar = page.getByTestId("formula-bar-input");
    await bar.fill("=SUM(A1:B2)");
    await bar.press("End");
    await bar.press("ArrowLeft");
    await bar.press("F4");
    assert.equal(await bar.inputValue(), "=SUM($A$1:$B$2)", "F4 did not cycle the formula bar's range");
  } },
  { id: "42", name: "Formula bar and address", tier: "B", budgetMs: 60_000, waitMs: 10_000, run: async (page) => {
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

    // The Name Box shows the focused cell's address; the old label stays as its tooltip.
    const nameBox = page.getByTestId("name-box");
    assert.equal(await nameBox.inputValue(), "E2",
      `the Name Box shows ${JSON.stringify(await nameBox.inputValue())}, not the selected cell's address`);
    assert.match(await nameBox.getAttribute("title"), /priority/i, "the Name Box lost the column and row names on hover");

    // Typing an address and pressing Enter goes there and drops any selection.
    const goTo = async (text) => {
      await nameBox.click();
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      await settle(page);
    };
    await goTo("C3");
    assert.equal(await activeId(page), cellIdFor(table, 1, 2), "C3 and Enter did not land on C3");
    await goTo("B2:C3");
    assert.equal(await selectedCount(page), 4, "B2:C3 and Enter did not select four cells");
    assert.equal(await activeId(page), cellIdFor(table, 0, 1), "the range's active cell is not its first address");
    await goTo("C3");
    assert.equal(await activeId(page), cellIdFor(table, 1, 2), "C3 and Enter did not land on C3 after a range");
    assert.equal(await selectedCount(page), 0, "going to one cell left the previous range selected");

    // Anything else is announced, and the typed text stays in the focused box.
    await goTo("Z99");
    await page.waitForFunction(() => document.querySelector("p.ts-clipboard-status")?.textContent?.includes("isn't a cell in this table"));
    assert.equal((await page.locator("p.ts-clipboard-status").textContent()).trim(), "“Z99” isn't a cell in this table.",
      "an address outside the grid was not announced with the typed text");
    assert.ok(await nameBox.evaluate((node) => node === document.activeElement), "a refused address moved focus off the Name Box");
    assert.equal(await nameBox.inputValue(), "Z99", "a refused address lost the typed text");

    // Escape drops the typed text and gives the cell its focus back.
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await activeId(page), cellIdFor(table, 1, 2), "Escape did not return focus to the cell");
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
  { id: "44", name: "Context menus", tier: "B", waitMs: 10_000, budgetMs: 60_000, run: async (page) => {
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
    for (const label of ["Cut", "Copy", "Paste", "Paste values", "Clear contents", "Fill down", "Delete row", "Sort A → Z", "Sort Z → A", "Filter…"]) {
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
    assert.ok(await focused(item("Paste values")), "ArrowDown did not reach Paste values");
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

    // A slow clipboard read pastes nothing if the selection moved meanwhile.
    const beforePaste = [await cellText(page, await projection(page), 0, 1), await cellText(page, await projection(page), 1, 1)];
    await page.evaluate(() => { navigator.clipboard.readText = () => new Promise((resolve) => setTimeout(() => resolve("LATE"), 1500)); });
    await page.getByTestId(id(0, 1)).click({ button: "right" });
    await item("Paste").click();
    await dragCells(page, id(0, 1), id(1, 1));
    await page.locator(".ts-clipboard-status").filter({ hasText: "Nothing was pasted." }).waitFor();
    const afterPaste = await projection(page);
    assert.deepEqual([await cellText(page, afterPaste, 0, 1), await cellText(page, afterPaste, 1, 1)], beforePaste, "a late paste wrote over the new selection");

    // A press moves focus inside the menu: Enter acts on that item, not the first one.
    const before = await cellText(page, await projection(page), 0, 1);
    await page.getByTestId(id(0, 1)).click();
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
  { id: "45", name: "Multiline editing", tier: "B", budgetMs: 60_000, waitMs: 10_000, run: async (page) => {
    await example(page);
    const table = await projection(page);
    const before = String(fieldAt(table, 0, 7)?.stored?.value);
    await page.getByTestId(cellIdFor(table, 0, 7)).press("F2");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Line one");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("Line two");
    await page.keyboard.press("Enter");
    await settle(page);
    const stored = async () => String(fieldAt(await projection(page), 0, 7)?.stored?.value);
    const target = cellIdFor(table, 0, 7);
    const value = String(fieldAt(await projection(page), 0, 7)?.stored?.value);
    assert.ok(value.includes("\n"), `Alt+Enter inserted no line break (stored ${JSON.stringify(value)})`);
    assert.equal(value, "Line one\nLine two", `the stored value is not the two typed lines (${JSON.stringify(value)})`);
    await waitForCellText(page, target, "Line one\nLine two");

    // The break is part of the editor's own Undo.
    await page.getByTestId(cellIdFor(table, 1, 7)).press("F2");
    await editor.waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("one");
    await page.keyboard.press("Alt+Enter");
    assert.ok((await editor.inputValue()).includes("\n"), "Alt+Enter inserted no line break");
    await page.keyboard.press("Control+z");
    assert.ok(!(await editor.inputValue()).includes("\n"), "Ctrl+Z in the editor left the line break");
    await page.keyboard.press("Escape");
    await settle(page);

    // Re-opening and committing a value that did not change publishes nothing.
    await page.getByTestId(target).press("F2");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), "Line one\nLine two", "F2 lost the stored line break");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(await stored(), "Line one\nLine two", "committing an unchanged value changed it");
    await waitForCellText(page, target, "Line one\nLine two");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.equal(await stored(), before, "the unchanged F2 then Enter added a history entry");
    await waitForCellText(page, target, before);
    await page.keyboard.press("Control+y");
    await settle(page);
    assert.equal(await stored(), "Line one\nLine two", "Redo did not restore the accepted edit");
    await waitForCellText(page, target, "Line one\nLine two");

    await page.getByTestId(target).press("F2");
    await editor.waitFor();
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await editor.count(), 0, "Escape left the editor open");
    assert.equal(await stored(), "Line one\nLine two", "Escape published the value");
    await waitForCellText(page, target, "Line one\nLine two");

    // The editor grows over the rows below instead of being clipped by its cell.
    await page.getByTestId(target).press("F2");
    await editor.waitFor();
    const cellBox = await page.getByTestId(target).boundingBox();
    const editorBox = await editor.boundingBox();
    assert.ok(editorBox && cellBox && editorBox.height > cellBox.height + 4,
      `the two-line editor did not grow (cell ${cellBox?.height}, editor ${editorBox?.height})`);
    const hit = await page.evaluate(({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      const area = document.querySelector('[data-testid="cell-editor"]');
      return Boolean(node && area && (node === area || area.contains(node)));
    }, { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height - 2 });
    assert.ok(hit, "the grown editor is clipped by its cell");
    await page.keyboard.press("Escape");
    await settle(page);

    // A row keeps its height: the cell shows one line, as Excel does without Wrap Text.
    const editedRow = await page.getByTestId(target).boundingBox();
    const neighbourRow = await page.getByTestId(cellIdFor(table, 1, 7)).boundingBox();
    assert.equal(editedRow.height, neighbourRow.height, "the two-line value changed the row height");

    // The line break survives the clipboard.
    const pasted = cellIdFor(table, 1, 7);
    const replaced = String(fieldAt(table, 1, 7)?.stored?.value ?? "");
    await page.getByTestId(target).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId(pasted).click();
    await page.keyboard.press("Control+v");
    await settle(page);
    assert.equal(String(fieldAt(await projection(page), 1, 7)?.stored?.value), "Line one\nLine two", "the pasted value lost its line break");
    await waitForCellText(page, pasted, "Line one\nLine two");
    await settle(page);
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.equal(String(fieldAt(await projection(page), 1, 7)?.stored?.value ?? ""), replaced, "Undo did not restore the pasted cell");
    await waitForCellText(page, pasted, replaced);

    // Alt+Enter in an editor that is not the multiline one does nothing at all.
    const numberCell = cellIdFor(table, 0, 2);
    const numberValue = String(fieldAt(table, 0, 2)?.stored?.value);
    await page.getByTestId(numberCell).press("F2");
    await editor.waitFor();
    await page.keyboard.press("Alt+Enter");
    assert.equal(await editor.count(), 1, "Alt+Enter closed the number editor");
    assert.equal(await editor.inputValue(), numberValue, "Alt+Enter changed the number editor");
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(String(fieldAt(await projection(page), 0, 2)?.stored?.value), numberValue, "Alt+Enter committed the number editor");

    // Plain Enter commits and never adds a line break.
    const lastNotes = cellIdFor(table, 2, 7);
    await page.getByTestId(lastNotes).press("F2");
    await editor.waitFor();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("plain text");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(String(fieldAt(await projection(page), 2, 7)?.stored?.value), "plain text", "plain Enter did not commit one line");
    await waitForCellText(page, lastNotes, "plain text");
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
    // P2: shortcut help keeps the focused cell and the editor draft intact.
    const cell = page.getByTestId(cellIdFor(table, 0, 0));
    await cell.click();
    const before = await executeCount(page);
    const undo = await page.getByRole("button", { name: "Undo", exact: true }).first().isDisabled();
    await page.keyboard.press("Control+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Close" }).evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await dialog.getByRole("region", { name: "Shortcuts" }).evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(id => document.activeElement?.dataset.testid === id,
      await cell.getAttribute("data-testid"));
    assert.equal(await executeCount(page), before, "help changed data");
    assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).first().isDisabled(), undo, "help changed undo availability");
    await cell.press("F2");
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    const draft = await editor.inputValue();
    await page.keyboard.press("Control+/");
    assert.equal(await dialog.count(), 0, "help opened while editing");
    assert.equal(await editor.inputValue(), draft, "help changed the draft");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).filter({ visible: true }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByLabel("More document commands").click();
    await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).filter({ visible: true }).click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
  } },
  { id: "47", name: "Format Cells", tier: "B", run: async (page) => {
    await example(page);
    const table = await projection(page);
    const cell = (row, col) => page.getByTestId(cellIdFor(table, row, col));
    const dialog = page.getByRole("dialog", { name: "Format Cells", exact: true });
    const gridFocused = () => cell(0, 0).evaluate(node => node === document.activeElement);
    const isBold = locator => locator.evaluate(node => Number(getComputedStyle(node).fontWeight) >= 600);
    await cell(0, 0).click();
    await page.keyboard.press("Control+1");
    await settle(page);
    assert.equal(await dialog.count(), 1, "Ctrl+1 opened no Format Cells dialog");
    assert.ok(await dialog.getByRole("button", { name: "Apply number format" }).isDisabled(), "A cell selection enabled column number formatting");
    assert.ok(await dialog.getByRole("combobox", { name: "Bold", exact: true }).evaluate(node => node === document.activeElement), "The dialog did not focus its first control");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await dialog.count(), 0, "Escape did not dismiss the dialog");
    assert.ok(await gridFocused(), "Escape did not restore grid focus");
    assert.equal(await isBold(cell(0, 0)), false, "Escape applied a draft style");

    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Meta+1");
    await dialog.waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "detached" });
    await settle(page);
    assert.ok(await gridFocused(), "Apply did not restore grid focus");
    const assertStyles = async applied => {
      for (const row of [0, 1]) {
        assert.equal(await isBold(cell(row, 0)), applied, `Unexpected bold state in row ${row + 1}`);
        assert.equal(await cell(row, 0).evaluate(node => getComputedStyle(node).fontStyle), applied ? "italic" : "normal");
      }
      assert.equal(await isBold(cell(2, 0)), false, "Formatting changed a cell outside the selection");
    };
    await assertStyles(true);
    await page.keyboard.press("Control+z");
    await settle(page);
    await assertStyles(false);
    await page.keyboard.press("Control+y");
    await settle(page);
    await assertStyles(true);

    const numberColumn = table.columns.findIndex(column => column.field_type === "number");
    assert.ok(numberColumn >= 0, "The example has no number column");
    await cell(0, numberColumn).click();
    await page.keyboard.press("Control+Space");
    await page.keyboard.press("Control+1");
    await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption("percent");
    await dialog.getByRole("button", { name: "Apply number format" }).press("Enter");
    await dialog.waitFor({ state: "detached" });
    await settle(page);
    assert.equal((await projection(page)).columns[numberColumn].number_format?.kind.type, "percent");
    await page.keyboard.press("Control+z");
    await settle(page);
    assert.deepEqual((await projection(page)).columns[numberColumn].number_format, table.columns[numberColumn].number_format);
    await page.keyboard.press("Control+y");
    await settle(page);

    await saveCopy(page, "habits-47");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-47", exact: true }).click();
    await ready(page);
    await assertStyles(true);
    assert.equal((await projection(page)).columns[numberColumn].number_format?.kind.type, "percent", "Number format did not survive reopen");
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
    await page.keyboard.press("Control+`");
    await settle(page);
    const back = (await page.getByTestId(id).textContent()).trim();
    assert.ok(!back.startsWith("="), `a second Ctrl+grave left the formula ${JSON.stringify(back)} instead of the result`);
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
    await waitForCellText(page, id, "2026-04-15");
  } },
  { id: "51", name: "Move/copy worksheet tab", tier: "C", run: async (page) => {
    await example(page);
    const original = await projection(page);
    await duplicate(page, "Second");
    await saveCopy(page, "habits-51");
    const tabs = page.locator(".ts-table-tab");
    const order = () => tabs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
    const tab = (name) => page.locator(".ts-table-tab").and(page.getByTitle(name, { exact: true }));
    const history = async (name) => {
      await page.getByRole("button", { name, exact: true }).click();
      await settle(page);
    };
    const drag = async (source, target, offset, modifier) => {
      const from = await source.boundingBox();
      const to = await target.boundingBox();
      if (modifier) await page.keyboard.down(modifier);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + offset(to.width), to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      if (modifier) await page.keyboard.up(modifier);
      await settle(page);
    };
    const before = await order();
    const [first, second] = before;
    await drag(tab(first), tab(second), width => width + 20);
    assert.deepEqual(await order(), [second, first], "drag did not move the first tab after the second");
    await history("Undo");
    assert.deepEqual(await order(), before, "one Undo did not restore the original order");
    await history("Redo");
    assert.deepEqual(await order(), [second, first], "Redo did not restore the moved order");

    const copy = `${first} (2)`;
    await drag(tab(first), tab(second), width => width / 4, "Control");
    assert.deepEqual(await order(), [copy, second, first], "Ctrl+drag did not copy to the drop position");
    const copied = await projection(page);
    assert.notEqual(copied.collection.id, original.collection.id, "the copy reused the source identity");
    assert.notEqual(rowEntity(copied.rows[0]), rowEntity(original.rows[0]), "the copy reused a source row identity");
    await history("Undo");
    assert.deepEqual(await order(), [second, first], "one Undo did not remove the copy and restore order");
    await history("Redo");
    assert.deepEqual(await order(), [copy, second, first], "Redo did not restore the copy in position");

    await tab(first).press("Shift+F10");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.deepEqual(await order(), [copy, first, second], "keyboard Move left did not reorder the sheet");
    await tab(first).click();
    await settle(page);
    await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move right", exact: true }).click();
    await settle(page);
    assert.deepEqual(await order(), [copy, second, first], "the Sheet actions button did not offer a working Move right");
    await tab(first).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await settle(page);
    assert.deepEqual(await order(), [copy, second, first, `${first} (3)`], "the context-menu copy did not use the next free name");
    await history("Undo");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-51", exact: true }).click();
    await ready(page);
    assert.deepEqual(await order(), [copy, second, first], "the saved tab order changed on reopen");
    await tab(copy).click();
    await settle(page);
    const reopened = await projection(page);
    assert.equal(reopened.collection.id, copied.collection.id, "the saved copy changed identity");
    assert.equal(fieldAt(reopened, 0, 0)?.stored?.value, fieldAt(original, 0, 0)?.stored?.value, "the saved copy lost its data");
    assert.ok(fieldAt(reopened, 0, 4)?.formula, "the saved copy lost its formula");
    await waitForCellText(page, cellIdFor(reopened, 0, 4), "10");
    await replaceCell(page, cellIdFor(reopened, 0, 2), "6");
    assert.notEqual(await cellText(page, reopened, 0, 4), "10", "the copy's formula did not recalculate from its own inputs");
    await tab(first).click();
    await settle(page);
    const source = await projection(page);
    assert.equal(source.collection.id, original.collection.id, "reordering changed the source identity");
    await waitForCellText(page, cellIdFor(source, 0, 4), "10");
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
  { id: "53", name: "Chart from totals", tier: "B", budgetMs: 60_000, waitMs: 10_000, note: "Bar, line and pie of a column's totals. Not stored with the work, and not a chart placed on the sheet.", run: async (page) => {
    await newTable(page, "Spending", [{ name: "Category" }, { name: "Amount", type: "number" }]);
    const rows = [["Food", "30"], ["Rent", "50"], ["Food", "20"], ["Travel", "100"]];
    for (let row = 0; row < rows.length; row += 1) await addRow(page, rows[row], row + 1);
    await page.getByRole("grid", { name: "Table", exact: true }).getByRole("columnheader", { name: "Category", exact: true }).hover();
    await page.getByRole("button", { name: "Column actions for Category", exact: true }).click();
    await page.getByRole("button", { name: "Totals by this column…", exact: true }).click();
    const panel = page.getByTestId("group-totals");
    await panel.locator("table tbody tr").nth(2).waitFor();
    for (const type of ["Bar", "Line", "Pie"]) {
      await panel.getByLabel("Chart", { exact: true }).selectOption({ label: type });
      await panel.getByRole("img", { name: `${type} chart of Amount by Category`, exact: true }).waitFor();
      const marks = await panel.locator("[data-chart-mark]").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.chartMark)));
      assert.deepEqual(marks, [50, 50, 100], `the ${type} chart draws values other than Work's totals`);
    }
    assert.ok((await panel.getByRole("listitem").filter({ hasText: "Travel" }).innerText()).includes("50%"), "the pie's legend doesn't give Travel's share");
  } },

  { id: "N1", name: "Command discoverability", tier: "A", manualAfterRun: true, note: "A new Excel user's 30-second discovery test and native menu labels need a human; browser command reachability checked.", run: async (page) => {
    await home(page);
    const missing = [];
    const reachable = async (label, control) => {
      if (!await control.isVisible() || !await control.isEnabled()) missing.push(label);
    };
    await reachable("New", page.getByRole("button", { name: "New table", exact: true }));
    await openReleasePlanExample(page);
    await ready(page);
    await reachable("Save", page.getByRole("button", { name: "Save", exact: true }));
    const table = await projection(page);
    await page.getByTestId(cellIdFor(table, 0, 0)).click();
    await reachable("Bold", page.getByRole("button", { name: "Bold", exact: true }));
    const column = table.columns[0].display_name;
    await page.getByRole("columnheader", { name: column, exact: true }).hover();
    await page.getByRole("button", { name: `Column actions for ${column}`, exact: true }).click();
    await reachable("Sort", page.getByRole("button", { name: "Sort A → Z", exact: true }));
    await reachable("Filter", page.getByRole("button", { name: "Filter…", exact: true }));
    assert.deepEqual(missing, [], `commands not reachable from visible chrome: ${missing.join(", ")}`);
  } },
  { id: "N2", name: "Grid chrome", tier: "A", run: async (page) => {
    await newTable(page, "Grid chrome", [{ name: "One" }, { name: "Two" }, { name: "Three", type: "number" }]);
    // Inspect the new sheet before any grid click, focus or selection.
    const missing = await page.getByRole("grid", { name: "Table", exact: true }).evaluate((grid) => {
      const missing = [];
      const visible = (node) => node && node.checkVisibility() && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      const ink = (color) => color !== "transparent" && !/rgba\([^)]*, 0\)$/.test(color);
      for (const letter of ["A", "B", "C"]) {
        const heading = grid.querySelector(`.ts-column-heading[data-column-letter="${letter}"]`);
        const style = heading && getComputedStyle(heading, "::before");
        if (!visible(heading) || ![`"${letter}"`, "attr(data-column-letter)"].includes(style.content) || style.display === "none" || !ink(style.color)) missing.push(`column ${letter}`);
      }
      const rowHeads = [...grid.querySelectorAll("th[scope='row'], .ts-gutter-head")].filter(visible);
      for (const number of ["1", "2", "3"]) {
        if (!rowHeads.some((node) => node.textContent.trim() === number || ([`"${number}"`, "attr(data-row-number)"].includes(getComputedStyle(node, "::before").content) && node.dataset.rowNumber === number))) missing.push(`row ${number}`);
      }
      const cell = grid.querySelector("td");
      const style = cell && getComputedStyle(cell);
      if (!visible(cell) || !["Right", "Bottom"].every((edge) => parseFloat(style[`border${edge}Width`]) > 0 && style[`border${edge}Style`] !== "none" && ink(style[`border${edge}Color`]))) missing.push("gridlines");
      const active = grid.querySelector(".ts-cell--focused");
      const outline = active && getComputedStyle(active);
      if (!visible(active) || parseFloat(outline.outlineWidth) === 0 || outline.outlineStyle === "none" || !ink(outline.outlineColor)) missing.push("active-cell outline without interaction");
      return missing;
    });
    assert.deepEqual(missing, [], `new sheet does not show ${missing.join(", ")} at once`);

    const before = await projection(page);
    assert.equal(before.rows.length, 0, "opening the grid materialized blank rows");
    const blank = page.getByTestId("table-space:B4");
    await blank.click();
    await page.keyboard.type("Apple");
    await page.keyboard.press("Escape");
    assert.equal((await projection(page)).rows.length, 0, "cancelling a blank cell edit materialized rows");

    // Match the packaged named-table snapshot while preserving adjacent grid entry.
    const values = ["Tea", "飲食", "4.5"];
    await addRow(page, values, 1);
    const readCells = (selector) => page.locator(selector).evaluateAll((cells) => cells.map((cell) => cell.textContent.trim()));
    assert.deepEqual(await readCells("tbody tr.ts-row td"), [...values, ""]);
    assert.deepEqual(await readCells(`tbody tr.ts-row ${WORK_FIELD_CELL}`), values);
    assert.equal((await projection(page)).columns.length, 3, "the adjacent blank materialized a Work column");

    await blank.click();
    await page.keyboard.type("Apple");
    await page.keyboard.press("Enter");
    await settle(page);
    const after = await projection(page);
    assert.equal(after.rows.length, 3, "typing in row 4 did not extend the table to that row");
    assert.equal(fieldAt(after, 2, 1)?.stored?.value, "Apple", "Work did not store the value in B4");
    const savedCell = cellIdFor(after, 2, 1);
    await saveCopy(page, "habits-N2");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-N2", exact: true }).click();
    await ready(page);
    assert.equal(await page.getByTestId(savedCell).textContent(), "Apple", "B4 changed after Save and reopen");
    assert.equal((await projection(page)).rows.length, 3, "reopen materialized additional blank rows");
    assert.equal(await page.getByTestId("table-space:B6").textContent(), "", "the reopened grid did not show blank rows below the data");

    await page.getByTestId(savedCell).click();
    await page.keyboard.press("Control+c");
    await page.getByTestId("table-space:B6").click();
    await page.keyboard.press("Control+v");
    await page.waitForFunction(() => !window.__habits.stale && window.__readObservedTable(window.__habits)?.rows.length === 5);
    assert.equal(fieldAt(await projection(page), 4, 1)?.stored?.value, "Apple", "pasting below the table did not store the copied value in B6");

    await page.getByTestId("table-space:D4").click();
    await page.keyboard.press("Control+v");
    await page.waitForFunction(() => !window.__habits.stale && window.__readObservedTable(window.__habits)?.columns.length === 4);
    assert.equal(fieldAt(await projection(page), 2, 3)?.stored?.value, "Apple", "pasting beside the table did not store the copied value in D4");

    await filterValues(page, "Two", ["Apple"]);
    assert.equal(await page.locator("tbody tr.ts-row").count(), 2, "the filter did not hide rows");
    assert.match(await page.getByTestId("row-view-status").textContent(), /Clear the filter to edit blank grid rows\./);
    assert.equal(await page.locator('[data-unallocated-entity^="table-space-row:"]').count(), 0, "the filtered view still offered blank rows for editing");
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await page.getByTestId("table-space:B8").waitFor();
    assert.equal((await projection(page)).rows.length, 5, "filtering changed the stored row count");
  } },
  { id: "N3", name: "Status bar statistics", tier: "A", run: async (page) => {
    await newTable(page, "Statistics", [{ name: "Amount", type: "number" }]);
    for (const [index, value] of ["10", "20", "30"].entries()) await addRow(page, [value], index + 1);
    const table = await projection(page);
    await dragCells(page, cellIdFor(table, 0, 0), cellIdFor(table, 2, 0));
    const statistics = page.getByTestId("selection-statistics");
    await statistics.waitFor();
    assert.ok(await statistics.isVisible(), "selecting 10, 20, 30 shows no status bar statistics");
    for (const [key, expected] of [["count", "3"], ["sum", "60"], ["average", "20"]]) {
      const value = statistics.getByTestId(`selection-${key}`);
      await value.waitFor();
      assert.equal((await value.textContent()).trim(), expected, `selection ${key} is not ${expected} for 10, 20, 30`);
    }
  } },
  { id: "N4", name: "Saved state", tier: "A", run: async (page) => {
    await example(page);
    const title = page.locator(".ts-document-identity h1");
    const named = async () => {
      assert.ok(await title.isVisible() && (await title.textContent()).trim(), "the document name is not visible");
    };
    await named();
    const table = await projection(page);
    const id = cellIdFor(table, 0, 0);
    await replaceCell(page, id, "Unsaved edit");
    const status = page.getByTestId("save-status");
    assert.ok(await status.isVisible(), "the Saved/Unsaved state is not visible after editing");
    assert.match(await status.textContent(), /unsaved|not saved/i, "editing does not show Unsaved");
    await named();
    await saveCopy(page, "habits-N4");
    await status.filter({ hasText: "Saved on this device" }).waitFor();
    await named();
    await replaceCell(page, id, "Failed save edit");
    assert.match(await status.textContent(), /unsaved|not saved/i, "editing saved work still shows Saved");
    // Fail the actual device write, without changing canonical state or save logic.
    await page.evaluate(() => {
      const status = document.querySelector('[data-testid="save-status"]');
      window.__habits.saveLabels = [status.textContent];
      new MutationObserver(() => window.__habits.saveLabels.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        if (this.name === "tachiko-sheet-local-copies" && mode === "readwrite") throw new DOMException("Habits N4 save failure", "QuotaExceededError");
        return transaction.call(this, stores, mode, options);
      };
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await status.filter({ hasText: "Save failed" }).waitFor();
    assert.ok(await status.isVisible(), "the failed-save state is not visible");
    assert.ok((await page.evaluate(() => window.__habits.saveLabels)).every((label) => !/^Saved\b/i.test(label.trim())), "the failed save showed Saved");
    await named();
  } },
  { id: "N16", name: "In-cell formula errors", tier: "A", run: async (page) => {
    await home(page);
    await page.keyboard.press("Control+n");
    await ready(page);
    const cell = (address) => page.getByTestId(`worksheet:${address}`);
    const text = async (address) => (await cell(address).textContent()).trim();
    await replaceCell(page, "worksheet:A1", "=1/0");
    assert.equal(await text("A1"), "#DIV/0!", "a blank worksheet accepts a division-by-zero formula");
    await cell("A1").click();
    await page.evaluate(() => navigator.clipboard.writeText("division\t1\t0\t0\nreference\t2\t0\t0\nlookup\t3\t0\t0"));
    await page.keyboard.press("Control+v");
    await waitForCellText(page, "worksheet:D1", "0");
    const table = await projection(page);
    assert.deepEqual(table.columns.map(column => column.field_type), ["auto", "auto", "auto", "auto"]);
    const missing = [];
    const checkError = async (address, expected, label) => {
      const actual = await text(address);
      if (actual === expected) return;
      const refusal = await page.locator(".ts-error").allTextContents();
      missing.push(`${label} shows ${JSON.stringify(actual)}, expected ${expected}${refusal.length ? ` (${refusal.join(" ")})` : ""}`);
    };
    const formulas = [["=1/0", "#DIV/0!"], ["=Z999999", "#REF!"], ['=VLOOKUP("missing",A1:B3,2,FALSE)', "#N/A"]];
    for (const [row, [formula, expected]] of formulas.entries()) {
      await replaceCell(page, `worksheet:C${row + 1}`, formula);
      await checkError(`C${row + 1}`, expected, formula);
      await page.keyboard.press("Escape");
      const label = `Still editable ${row}`;
      await replaceCell(page, `worksheet:A${row + 1}`, label);
      assert.equal(await text(`A${row + 1}`), label, `other cells stopped working after ${formula}`);
      assert.equal(fieldAt(await projection(page), row, 0)?.stored?.value, label, `editing after ${formula} was not committed`);
    }
    await replaceCell(page, "worksheet:D1", "=C1+1");
    await checkError("D1", "#DIV/0!", "=C1+1");
    await page.keyboard.press("Escape");
    const checkDivision = async (stage) => {
      await checkError("C1", "#DIV/0!", `C1 ${stage}`);
      await cell("C1").click();
      const source = await page.getByTestId("formula-bar-input").inputValue();
      if (!/^=?\(?1\s*\/\s*0\)?$/.test(source)) missing.push(`C1 formula bar ${stage} shows ${JSON.stringify(source)}`);
    };
    await checkDivision("before Save");
    await saveCopy(page, "habits-N16");
    await page.reload();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "Open saved habits-N16", exact: true }).click();
    await ready(page);
    await checkDivision("after reopen");
    await checkError("D1", "#DIV/0!", "D1 after reopen");

    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    await settle(page);
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    if (await consent.isVisible()) {
      const download = page.waitForEvent("download");
      await consent.getByRole("button", { name: "Download", exact: true }).click();
      assert.match(sheetXml(await (await download).path()), /<c\b[^>]*\br="C1"[^>]*>\s*<f>\(?1\s*\/\s*0\)?<\/f>/);
    } else {
      missing.push("XLSX export did not prepare a workbook containing the failing formula");
    }
    for (const gap of missing) console.error(`N16: ${gap}`);
    assert.deepEqual(missing, [], missing.join("; "));
  } },
  { id: "N24", name: "Save semantics", tier: "A", manualAfterRun: true, note: "Native desktop verification must compare the opened XLSX and directory after Save for original-file update, stray copies and wrong-file overwrites; Chromium cannot write back an uploaded file.", run: async (page) => {
    await home(page);
    await (await homeImportInput(page)).setInputFiles(invoice);
    const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await dialog.waitFor();
    for (const [index, type] of ["text", "number", "number", "number"].entries()) await dialog.locator(".ts-import-column select").nth(index).selectOption(type);
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await ready(page);
    const table = await projection(page);
    await replaceCell(page, cellIdFor(table, 0, 0), "Edited XLSX");
    const save = page.getByRole("button", { name: "Save", exact: true });
    const target = await save.getAttribute("title") ?? "";
    await page.keyboard.press("Control+s");
    await settle(page);
    assert.ok(!await page.getByRole("dialog", { name: "Save a copy", exact: true }).isVisible(), "Save on an opened XLSX asks for a new copy; it does not update the original file");
    assert.doesNotMatch(target, /file you opened from is not changed/i, "Save explicitly leaves the opened XLSX unchanged");
    assert.ok(target.includes("invoice.xlsx"), `Save does not identify the opened XLSX target: ${target}`);
    assert.ok(await page.getByRole("button", { name: "Save a copy", exact: true }).isVisible(), "Save a Copy is not a separate command");
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
const baseIds = Array.from({ length: 52 }, (_, index) => String(index + 1).padStart(2, "0"));
const expectedIds = [...baseIds.slice(0, 21), "21a", ...baseIds.slice(21), "53", "N1", "N2", "N3", "N4", "N16", "N24"];
if (cases.length !== expectedIds.length || cases.some((testCase, index) => testCase.id !== expectedIds[index] || !testCase.name)) {
  console.error(`HARNESS: the case list is not 01-52 plus 21a, 53, N1-N4, N16 and N24 (got ${cases.length}).`);
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

// HABITS_ONLY=33,N3 runs just those cases while working on them.
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
  await installPublishedTablePatcher(context);
  await context.addInitScript(evidence);
  const page = await context.newPage();
  page.setDefaultTimeout(testCase.waitMs ?? 4000);
  let outcome = "PASS";
  let error;
  try {
    await withTimeout(testCase.run(page), testCase.budgetMs ?? CASE_TIMEOUT_MS);
    if (testCase.manualAfterRun) outcome = "MANUAL";
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

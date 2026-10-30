// Everyday workflow acceptance (dogfood 2026-10-30): a bank statement CSV
// imports with Date and Number suggestions, stays an editable native table
// even with a blank date, totals only the rows a filter shows, and a
// duplicate keeps the imported column names. Built product, normal UI only.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";
import { fillDraftCell } from "./grid-row-entry-driver.mjs";
import { observeTableProjections, observedTable } from "./table-projection-observer.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const work = await mkdtemp(path.join(tmpdir(), "tachiko-bank-statement-"));
const csv = path.join(work, "october-bank.csv");
// Money keeps its trailing zeros; one row has no date yet.
await writeFile(csv, [
  "Date,Description,Amount",
  "2026-10-01,Salary,3200.00",
  "2026-10-03,Coffee,-4.50",
  "2026-10-05,Groceries,-85.40",
  "2026-10-07,Coffee,-3.80",
  "2026-10-09,Rent,-1200",
  ",Refund pending,12.30",
].join("\n") + "\n");

// The column menu is a toolbar on narrow layouts and a header menu otherwise.
async function chooseColumnAction(page, name, action) {
  if (await page.locator(".ts-column-toolbar").count()) {
    const index = (await page.locator(".ts-col-head").allTextContents()).indexOf(name);
    assert.ok(index >= 0);
    await page.locator(".ts-grid tbody tr.ts-row").first().locator(".ts-cell").nth(index).focus();
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await page.getByRole("button", { name: `${action} “${name}”…`, exact: true }).click();
    return;
  }
  await page.getByRole("columnheader", { name, exact: true }).hover();
  await page.getByRole("button", { name: `Column actions for ${name}`, exact: true }).click();
  await page.getByRole("button", { name: `${action}…`, exact: true }).click();
}

const checks = [];
let context;
try {
  context = await chromium.launchPersistentContext(path.join(work, "profile"), launchOptions);
  await installDistRoutes(context, dist);
  await observeTableProjections(context);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const headers = () => grid.locator(".ts-col-head").allTextContents();
  const shownRows = () => grid.locator("tbody tr.ts-row").evaluateAll(rows => rows.map(row => [...row.querySelectorAll(".ts-cell")].map(cell => cell.textContent?.trim() ?? "")));

  // 1. Import: Date and Number are suggested, and the table stays native.
  await (await homeImportInput(page)).setInputFiles(csv);
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.waitFor();
  const types = preview.locator("select");
  assert.deepEqual(await types.evaluateAll(selects => selects.map(select => select.value)), ["date", "text", "number"], "Date and Number are suggested");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await ready();
  let table = await observedTable(page);
  assert.equal(table.native_table_profile, true, "an import with a blank date stays a native table");
  assert.deepEqual(await headers(), ["Date", "Description", "Amount"]);
  assert.deepEqual((await shownRows()).at(-1), ["", "Refund pending", "12.3"], "the blank date stays blank");
  checks.push("bank CSV suggests Date/Text/Number; an optional blank Date keeps the table native");

  // 2. The blank date can be filled, and a new row can be added.
  await grid.locator("tbody tr.ts-row").last().locator(".ts-cell").first().dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("2026-10-11"); await editor.press("Enter"); await ready();
  assert.equal((await shownRows()).at(-1)[0], "2026-10-11");
  const entry = page.locator(".ts-entry-row");
  await fillDraftCell(page, entry.getByLabel("New row Description (Text)", { exact: true }), "Train");
  const amount = entry.getByLabel("New row Amount (Number)", { exact: true });
  await fillDraftCell(page, amount, "-12.60");
  await amount.press("Enter"); await ready();
  assert.deepEqual((await shownRows()).at(-1), ["", "Train", "-12.6"], "a row without a date is added");
  checks.push("a blank Date cell is filled in place; a row is added without a date");

  // 3. The footer totals what the filter shows; Work does the arithmetic.
  table = await observedTable(page);
  const amountId = table.columns.find(column => column.field_type === "number").id;
  const total = () => page.getByTestId(`total:${amountId}`).textContent();
  assert.equal(await total(), "1906", "3200 - 4.5 - 85.4 - 3.8 - 1200 + 12.3 - 12.6");
  assert.equal(await page.getByTestId("totals-scope").textContent(), "Σ");
  await chooseColumnAction(page, "Description", "Filter");
  await page.getByLabel("Filter Description", { exact: true }).fill("Coffee");
  await page.getByLabel("Filter Description", { exact: true }).press("Enter"); await ready();
  assert.equal((await shownRows()).length, 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="totals-scope"]')?.textContent === "Σ▽");
  assert.equal(await total(), "-8.3", "the footer totals the two Coffee rows");
  assert.equal(await page.getByTestId("totals-scope").getAttribute("title"), "Totals for the 2 rows shown. Clear the filter to total every row.");
  assert.equal(await grid.locator("tfoot tr.ts-totals-row").getAttribute("aria-label"), "Column totals for the rows shown");
  await page.getByRole("button", { name: "Clear filter", exact: true }).click(); await ready();
  await page.waitForFunction(() => document.querySelector('[data-testid="totals-scope"]')?.textContent === "Σ");
  assert.equal(await total(), "1906");
  checks.push("a filter totals only the shown rows (Σ▽, -8.3); clearing it restores the whole-table total");

  // 4. Duplicate keeps the imported column names.
  await page.getByRole("button", { name: "Duplicate table…", exact: true }).click();
  const duplicate = page.getByRole("dialog", { name: "Duplicate table", exact: true });
  await duplicate.getByLabel("Table name", { exact: true }).fill("October copy");
  await duplicate.getByRole("button", { name: "Duplicate", exact: true }).click();
  await duplicate.waitFor({ state: "detached" }); await ready();
  assert.equal(await page.locator("#ts-active-table option:checked").textContent(), "October copy");
  assert.deepEqual(await headers(), ["Date", "Description", "Amount"], "the copy keeps the imported column names");
  assert.equal((await observedTable(page)).native_table_profile, true, "the copy is native too");
  assert.equal((await shownRows()).length, 7);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual(await page.locator("#ts-active-table option").allTextContents(), ["october-bank"], "one Undo removes the copy");
  checks.push("Duplicate table keeps imported column names, stays native, and one Undo removes it");

  console.log(JSON.stringify({ status: "PASS", checks }));
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}

// Everyday workflow acceptance (dogfood 2026-10-30): a bank statement CSV
// imports with Date and Number suggestions, stays an editable native table
// even with a blank date, totals only the rows a filter shows, and a
// duplicate keeps the imported column names. A year of transactions (over
// Work's 64-row typed limit until Work #610) keeps Date and Yes/No columns
// through edit, Save a copy, reopen and download. Built product, normal UI only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
// 300 rows: every 25th date and every 30th Cleared value is still blank.
const YEAR_ROWS = 300;
const yearCsv = path.join(work, "year-bank.csv");
await writeFile(yearCsv, ["Date,Description,Amount,Cleared", ...Array.from({ length: YEAR_ROWS }, (_, row) => {
  const date = row % 25 === 0 ? "" : new Date(Date.UTC(2026, 0, 1 + row)).toISOString().slice(0, 10);
  const cleared = row % 30 === 0 ? "" : String(row % 2 === 0);
  return `${date},Item ${row},${row % 3 === 0 ? 1000 : -row}.25,${cleared}`;
})].join("\n") + "\n");

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

// The grouped-totals entry follows each menu's own label pattern.
async function openGroupTotals(page, name) {
  if (await page.locator(".ts-column-toolbar").count()) {
    const index = (await page.locator(".ts-col-head").allTextContents()).indexOf(name);
    assert.ok(index >= 0);
    await page.locator(".ts-grid tbody tr.ts-row").first().locator(".ts-cell").nth(index).focus();
    await page.getByRole("button", { name: "Column", exact: true }).click();
    await page.getByRole("button", { name: `Totals by “${name}”…`, exact: true }).click();
    return;
  }
  await page.getByRole("columnheader", { name, exact: true }).hover();
  await page.getByRole("button", { name: `Column actions for ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Totals by this column…", exact: true }).click();
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

  // 5. A year of transactions (300 rows) keeps Date and Yes/No columns.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await unsaved.or(page.getByRole("heading", { name: "Tachiko Sheet", exact: true })).first().waitFor();
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(yearCsv);
  await preview.waitFor();
  assert.deepEqual(await types.evaluateAll(selects => selects.map(select => select.value)), ["date", "text", "number", "text"], "Date is suggested above 64 rows");
  await types.nth(3).selectOption("boolean");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await ready();
  const fieldTypes = async () => (await observedTable(page)).columns.map(column => column.field_type);
  table = await observedTable(page);
  assert.deepEqual(table.columns.map(column => column.field_type), ["date", "text", "number", "boolean"]);
  assert.equal(table.rows.length, YEAR_ROWS);
  assert.equal((await shownRows())[0][0], "", "row 0 has no date yet");
  await grid.locator("tbody tr.ts-row").first().locator(".ts-cell").first().dblclick();
  await editor.fill("2026-12-31"); await editor.press("Enter"); await ready();
  assert.equal((await shownRows())[0][0], "2026-12-31");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Year statement");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await unsaved.or(page.getByRole("heading", { name: "Tachiko Sheet", exact: true })).first().waitFor();
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
  await page.getByRole("button", { name: "Open saved Year statement", exact: true }).click();
  await ready();
  assert.deepEqual(await fieldTypes(), ["date", "text", "number", "boolean"], "types survive reopen");
  assert.equal((await shownRows())[0][0], "2026-12-31", "the edit survives reopen");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const downloads = {};
  for (const format of ["csv", "xlsx"]) {
    await page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true }).click();
    const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
    await consent.waitFor();
    const downloaded = page.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const file = path.join(work, `year-export.${format}`);
    await (await downloaded).saveAs(file);
    await consent.waitFor({ state: "detached" });
    downloads[format] = await readFile(file);
  }
  const lines = downloads.csv.toString("utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, YEAR_ROWS + 1);
  assert.equal(lines[0], "Date,Description,Amount,Cleared");
  // Work's CSV writes a blank position as "" (distinct from a missing column).
  assert.equal(lines[1], '2026-12-31,Item 0,1000.25,""');
  assert.match(lines[2], /^2026-01-02,Item 1,-1\.25,false$/);
  // The XLSX keeps real dates (date-formatted t="d" cells) and Yes/No cells.
  const xlsx = JSON.parse(execFileSync("python3", ["-I", "-c", `
import json, re, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
sheet = z.read("xl/worksheets/sheet1.xml").decode()
styles = z.read("xl/styles.xml").decode()
cell = lambda ref: (re.search(r'<c r="' + ref + r'"[^>]*?(?:/>|>.*?</c>)', sheet) or [None])[0]
codes = dict(re.findall(r'<numFmt numFmtId="(\\d+)" formatCode="([^"]*)"', styles))
xfs = re.findall(r'<xf [^>]*?numFmtId="(\\d+)"', re.search(r'<cellXfs[^>]*>(.*?)</cellXfs>', styles, re.S).group(1))
def format_of(ref):
    style = re.search(r' s="(\\d+)"', cell(ref) or "")
    return codes.get(xfs[int(style.group(1))]) if style else None
print(json.dumps({"rows": sheet.count("<row "), "a2": cell("A2"), "a3": cell("A3"), "d3": cell("D3"), "d4": cell("D4"), "a2Format": format_of("A2"), "a3Format": format_of("A3")}))
`, path.join(work, "year-export.xlsx")], { encoding: "utf8" }));
  assert.equal(xlsx.rows, YEAR_ROWS + 1, "header and every row");
  assert.equal(xlsx.a2Format, "yyyy-mm-dd", "the edited date cell uses the yyyy-mm-dd format");
  assert.equal(xlsx.a3Format, "yyyy-mm-dd", "an imported date cell uses the yyyy-mm-dd format");
  assert.match(xlsx.a2, /t="d"><v>2026-12-31<\/v>/, "the edited date is a date cell");
  assert.match(xlsx.a3, /t="d"><v>2026-01-02<\/v>/);
  assert.match(xlsx.d3, /t="b"><v>0<\/v>/, "Cleared false is a Yes/No cell");
  assert.match(xlsx.d4, /t="b"><v>1<\/v>/);
  checks.push("a 300-row statement imports with Date and Yes/No columns, edits, saves, reopens and downloads as CSV/XLSX");

  // 6. Totals by a column: Sheet asks, Work groups and sums, the panel shows its answer.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: LOCAL_ORIGIN });
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await unsaved.or(page.getByRole("heading", { name: "Tachiko Sheet", exact: true })).first().waitFor();
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);

  const SPENDING_ROWS = 120;
  const spending = Array.from({ length: SPENDING_ROWS }, (_, i) => ({
    date: `2026-${String(1 + (i % 3)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
    category: i % 10 === 9 ? "" : ["Food", "Rent", "Transport", "food"][i % 4],
    text: `-${i}.50`,
    amount: -(i + 0.5),
  }));
  const spendingCsv = path.join(work, "spending.csv");
  await writeFile(spendingCsv, ["Date,Category,Amount", ...spending.map(row => `${row.date},${row.category},${row.text}`)].join("\n") + "\n");
  await (await homeImportInput(page)).setInputFiles(spendingCsv);
  await preview.waitFor();
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await ready();

  const sumFor = rows => rows.reduce((sum, row) => sum + row.amount, 0);
  const CATEGORY_ORDER = ["Food", "Rent", "Transport", "food", ""];
  const groupSummary = rows => CATEGORY_ORDER
    .map(category => [category === "" ? "(blank)" : category, rows.filter(row => row.category === category)])
    .filter(([, group]) => group.length > 0)
    .map(([label, group]) => [label, String(group.length), String(sumFor(group))]);
  const panel = page.getByTestId("group-totals");
  const groupTable = name => page.locator(`table[aria-label="Totals by ${name}"]`);
  const groupRows = async name => groupTable(name).locator("tbody tr").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("td, th")].map(cell => cell.textContent?.trim() ?? "")));
  const waitForGroupRows = (expected, name = "Category") => page.waitForFunction(({ expected, name }) => {
    const table = document.querySelector(`table[aria-label="Totals by ${name}"]`);
    if (!table || table.closest('[aria-busy="true"]')) return false;
    const rows = [...table.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td, th")].map(cell => cell.textContent?.trim() ?? ""));
    return JSON.stringify(rows) === JSON.stringify(expected);
  }, { expected, name });

  table = await observedTable(page);
  const amountColumn = table.columns.find(column => column.field_type === "number").id;
  await openGroupTotals(page, "Category");
  await panel.waitFor();
  assert.equal(await panel.getByRole("heading", { name: "Totals by Category", exact: true }).count(), 1);
  const allGroups = groupSummary(spending);
  await waitForGroupRows(allGroups);
  assert.deepEqual(await groupRows("Category"), allGroups, "Work's groups arrive in String order with the blank group last");
  const footerTotal = await page.getByTestId(`total:${amountColumn}`).textContent();
  const grandCells = await groupTable("Category").locator("tfoot tr > *").evaluateAll(cells => cells.map(cell => cell.textContent?.trim() ?? ""));
  assert.equal(grandCells[0], "Total");
  assert.equal(grandCells[1], String(SPENDING_ROWS));
  assert.equal(grandCells[2], footerTotal, "the panel's Total row matches the grid footer total");
  checks.push("Totals by a column shows Work's Category groups (Food, Rent, Transport, food, blank) with the grid footer total");

  await panel.getByLabel("Then by", { exact: true }).selectOption({ label: "Date" });
  assert.equal(await panel.getByLabel("Then by date", { exact: true }).inputValue(), "month", "a second Date dimension defaults to month");
  const foodJanuary = spending.filter(row => row.category === "Food" && row.date.startsWith("2026-01"));
  await page.waitForFunction(({ total }) => {
    const table = document.querySelector('table[aria-label="Totals by Category"]');
    if (!table) return false;
    return [...table.querySelectorAll("tbody tr")].some(row => {
      const cells = [...row.querySelectorAll("td, th")].map(cell => cell.textContent?.trim() ?? "");
      return cells[0] === "Food" && cells[1] === "2026-01" && cells[3] === total;
    });
  }, { total: String(sumFor(foodJanuary)) });
  checks.push("Then by Date (Month) shows the Food / 2026-01 group with Work's total");

  await panel.getByLabel("Then by", { exact: true }).selectOption({ label: "None" });
  await waitForGroupRows(allGroups);
  await grid.locator("tbody tr.ts-row").first().locator(".ts-cell").nth(2).dblclick();
  await editor.fill("-100.50"); await editor.press("Enter"); await ready();
  spending[0].amount = -100.5;
  const editedGroups = groupSummary(spending);
  await waitForGroupRows(editedGroups);
  assert.equal((await groupRows("Category")).find(group => group[0] === "Food")?.[2], String(sumFor(spending.filter(row => row.category === "Food"))),
    "the edited Amount changes the Food group at the new revision");
  checks.push("editing an Amount updates the affected group after the new revision arrives");

  await chooseColumnAction(page, "Category", "Filter");
  await page.getByLabel("Filter Category", { exact: true }).fill("Food");
  await page.getByLabel("Filter Category", { exact: true }).press("Enter"); await ready();
  const shownSpending = spending.filter(row => row.category.toLowerCase().includes("food"));
  await panel.getByRole("radio", { name: `Shown rows (${shownSpending.length})`, exact: true }).waitFor();
  assert.equal(await panel.getByRole("radio", { name: `Shown rows (${shownSpending.length})`, exact: true }).isChecked(), true, "a filter totals the shown rows by default");
  const shownGroups = groupSummary(shownSpending);
  await waitForGroupRows(shownGroups);
  const shownCells = await groupTable("Category").locator("tfoot tr > *").evaluateAll(cells => cells.map(cell => cell.textContent?.trim() ?? ""));
  assert.equal(shownCells[1], String(shownSpending.length));
  assert.equal(shownCells[2], String(sumFor(shownSpending)), "the Total row covers only the shown rows");
  await panel.getByRole("radio", { name: `All rows (${SPENDING_ROWS})`, exact: true }).check();
  await waitForGroupRows(editedGroups);
  assert.equal((await groupTable("Category").locator("tfoot tr > *").last().textContent()), String(sumFor(spending)), "All rows restores the whole-table total");
  checks.push("a filter totals only the shown rows; All rows totals the whole table");

  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await panel.getByText(`Copied ${editedGroups.length} groups.`, { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const copiedLines = copied.split("\n");
  assert.equal(copiedLines[0], "Category\tRows\tAmount", "the TSV header matches the panel");
  assert.equal(copiedLines.length, editedGroups.length + 2);
  assert.equal(copiedLines.at(-1), `Total\t${SPENDING_ROWS}\t${sumFor(spending)}`, "the Total line ends with the unformatted total");
  checks.push("Copy writes the same header, groups and Total row as TSV");

  console.log(JSON.stringify({ status: "PASS", checks }));
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}

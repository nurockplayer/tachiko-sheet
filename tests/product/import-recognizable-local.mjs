// #133: imported data stays recognizable through the normal Home import path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { launchIsolatedBrowser } from "./isolated-browser.mjs";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const messyCsv = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.csv");
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const ready = (page) => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();

// A minimal but real XLSX (the same package shape as Work's fixtures): one
// Text sheet, headers in row 1. Text is written literally so a name like
// `_x000D_` reaches Work as the escaped character Excel would store.
function writeXlsx(file, sheetName, headers, rows, options = {}) {
  execFileSync("python3", ["-I", "-c", String.raw`
import json, sys, zipfile
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
target, sheet_name, headers, rows, options = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4]), json.loads(sys.argv[5])
def text(value):
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def column(index):
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name
body = ""
for row_number, row in enumerate([headers, *rows], 1):
    cells = "".join(
        '<c r="%s%d" t="str"><v>%s</v></c>' % (column(index + 1), row_number, text(value))
        for index, value in enumerate(row)
    )
    body += '<row r="%d">%s</row>' % (row_number, cells)
parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="%s"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' % REL,
    "xl/workbook.xml": '<workbook xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>' % (MAIN, text(sheet_name)),
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="%s"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' % REL,
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="%s">%s<sheetData>%s</sheetData></worksheet>' % (
        MAIN,
        ('<cols><col min="1" max="%d" width="%s"/></cols>' % (len(headers), options["width"])) if options.get("width") else "",
        body,
    ),
}
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, content in sorted(parts.items()):
        entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, content.encode())
`, file, sheetName, JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(options)]);
  return file;
}

// The raw sheet XML of a downloaded XLSX, to see what Excel will read.
function sheetXml(file) {
  return execFileSync("python3", ["-I", "-c", String.raw`
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    sys.stdout.write("\n".join(
        archive.read(name).decode("utf-8") for name in archive.namelist() if name.endswith(".xml")
    ))
`, file], { encoding: "utf8", maxBuffer: 8 << 20 });
}

const browser = await launchIsolatedBrowser(chromium, launchOptions);
try {
  const context = await browser.newContext();
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(messyCsv);
  const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await dialog.waitFor();

  const preview = dialog.getByRole("table", { name: /^First rows of / });
  assert.deepEqual(await preview.locator("thead th").allTextContents(), ["item", "quantity", "price"]);
  assert.deepEqual(
    await preview.locator("tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.cells, (cell) => cell.textContent))),
    [[" PEN ", "3", "200"], ["NOTE", "2", "500"], [" PEN ", "3", "200"]],
    "the review shows the user's actual first rows, whitespace included",
  );
  assert.equal(await preview.locator("tbody td").first().evaluate((cell) => getComputedStyle(cell).whiteSpace), "pre", "leading/trailing spaces stay visible");
  const types = dialog.locator(".ts-import-column select");
  assert.deepEqual(await types.evaluateAll((selects) => selects.map((select) => select.value)), ["text", "number", "number"],
    "plain numeric columns are suggested as Number; other text stays Text");
  assert.equal(await dialog.getByText("Number suggested from its values").count(), 2);
  // Notes that only confirm faithful reading are tucked away, not shown as warnings.
  assert.equal(await dialog.getByText(/Numbers are not guessed from regional formatting/).isVisible(), false);
  assert.equal(await dialog.getByText("Nothing in this file needs your attention before import.").isVisible(), true);
  const details = dialog.locator("summary", { hasText: /^Import details \(\d+\)$/ });
  await details.click();
  assert.equal(await dialog.getByText(/Numbers are not guessed from regional formatting/).isVisible(), true);
  // The disclosure is part of the modal focus trap in both directions.
  for (const key of ["Tab", "Shift+Tab"]) {
    await details.focus();
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate((root) => root.contains(document.activeElement)), true, `${key} stays inside the import review`);
    }
  }

  await dialog.getByRole("button", { name: "Import file", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await page.locator("h1.ts-title").textContent(), "messy.csv", "the work is named after the file");
  assert.equal(await page.locator("#ts-active-table option:checked").textContent(), "messy", "the table is named after the file");
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  assert.deepEqual(await grid.locator("thead th").allTextContents(), ["Row", "item", "quantity", "price"], "the grid uses source headers");
  await context.close();

  // Large lossless numeric columns still suggest Number; the user confirms.
  const work = await mkdtemp(path.join(tmpdir(), "tachiko-recognizable-"));
  try {
    const large = path.join(work, "orders-65.csv");
    await writeFile(large, ["item,qty,price", ...Array.from({ length: 65 }, (_, index) => `item ${index},${index + 1},${(index + 1) * 10}`)].join("\r\n") + "\r\n");
    const largeContext = await browser.newContext();
    await installDistRoutes(largeContext, dist);
    const largePage = await largeContext.newPage();
    largePage.setDefaultTimeout(15_000);
    await largePage.goto(LOCAL_ORIGIN);
    await waitForColdHome(largePage);
    await (await homeImportInput(largePage)).setInputFiles(large);
    const largeDialog = largePage.getByRole("dialog", { name: "Review import preview", exact: true });
    await largeDialog.waitFor();
    assert.deepEqual(await largeDialog.locator(".ts-import-column select").evaluateAll((selects) => selects.map((select) => select.value)), ["text", "number", "number"]);
    assert.equal(await largeDialog.getByText("First 5 of 65 rows").count(), 1);
    await largeDialog.getByRole("button", { name: "Import file", exact: true }).click();
    await largePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    assert.equal(await largePage.locator("h1.ts-title").textContent(), "orders-65.csv");
    await largeContext.close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ case: "#133 recognizable CSV import: preview, suggestions, names, 65-row mixed types", status: "PASS" }));

  // Work #638/#639: a sheet over the import limit is refused with its own
  // name and the limit, before any preview or work opens.
  const overLimitWork = await mkdtemp(path.join(tmpdir(), "tachiko-over-limit-"));
  try {
    // A declared column width (as Excel files normally carry) takes the sheet
    // out of the single-table Text-capacity exception, so the shared
    // 128-rows-per-sheet admission applies to it.
    const workbook = writeXlsx(path.join(overLimitWork, "orders-200.xlsx"), "Orders", ["Item", "Note"],
      Array.from({ length: 200 }, (_, index) => [`item ${index + 1}`, `note ${index + 1}`]), { width: 12 });
    const overContext = await browser.newContext();
    await installDistRoutes(overContext, dist);
    const overPage = await overContext.newPage();
    overPage.setDefaultTimeout(15_000);
    await overPage.goto(LOCAL_ORIGIN);
    await waitForColdHome(overPage);
    await (await homeImportInput(overPage)).setInputFiles(workbook);
    const refusal = overPage.locator('p.ts-dialog-error[role="alert"]');
    await refusal.waitFor();
    const message = await refusal.textContent();
    assert.match(message, /^The sheet “Orders” has at least 200 rows; Tachiko can import up to 128 rows per sheet\. The workbook was not imported\./,
      "the refusal names the sheet, says how much was found and the limit, and that nothing was imported");
    assert.equal(await overPage.getByRole("dialog", { name: "Review import preview", exact: true }).count(), 0, "an over-limit workbook opens no preview");
    assert.equal(await overPage.locator('[data-testid="project-ready"]').count(), 0, "an over-limit workbook opens no work");
    await overContext.close();
    console.log(JSON.stringify({ case: "#638/#639 over-limit import: names the sheet and the 128-row limit, imports nothing", status: "PASS" }));
  } finally {
    await rm(overLimitWork, { recursive: true, force: true });
  }

  // Work #639/#640: a literal SpreadsheetML escape in cell text decodes to the
  // character on import, downloads as the same escape, and re-imports unchanged.
  const escapeWork = await mkdtemp(path.join(tmpdir(), "tachiko-escape-"));
  try {
    const escaped = writeXlsx(path.join(escapeWork, "escapes.xlsx"), "Escapes", ["Item", "Note"], [["Cr", "Line1_x000D_Line2"]]);
    const escapeContext = await browser.newContext();
    await installDistRoutes(escapeContext, dist);
    const escapePage = await escapeContext.newPage();
    escapePage.setDefaultTimeout(15_000);
    await escapePage.goto(LOCAL_ORIGIN);
    await waitForColdHome(escapePage);
    await (await homeImportInput(escapePage)).setInputFiles(escaped);
    const escapePreview = escapePage.getByRole("dialog", { name: "Review import preview", exact: true });
    await escapePreview.waitFor();
    await escapePreview.getByRole("button", { name: "Import file", exact: true }).click();
    await ready(escapePage);
    const escapeGrid = escapePage.getByRole("grid", { name: "Table", exact: true });
    const note = () => escapeGrid.locator("tbody tr.ts-row").first().locator("td").nth(1).textContent();
    assert.equal(await note(), "Line1\rLine2", "the escaped character arrives as one cell value with a real line break");
    await escapePage.getByRole("tab", { name: "Import & export", exact: true }).click();
    await escapePage.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
    const consent = escapePage.getByRole("dialog", { name: "Confirm download", exact: true });
    await consent.waitFor();
    const downloaded = escapePage.waitForEvent("download");
    await consent.getByRole("button", { name: "Download", exact: true }).click();
    const exported = path.join(escapeWork, "escapes-export.xlsx");
    await (await downloaded).saveAs(exported);
    await consent.waitFor({ state: "detached" });
    const xml = sheetXml(exported);
    assert.ok(xml.includes("Line1_x000D_Line2"), "the download writes the character as the _x000D_ escape again");
    assert.ok(!xml.includes("Line1\rLine2"), "no raw control character is written into the XML");
    await escapePage.getByRole("button", { name: "Close project", exact: true }).click();
    const unsaved = escapePage.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
    await waitForColdHome(escapePage);
    await (await homeImportInput(escapePage)).setInputFiles(exported);
    const reimportPreview = escapePage.getByRole("dialog", { name: "Review import preview", exact: true });
    await reimportPreview.waitFor();
    await reimportPreview.getByRole("button", { name: "Import file", exact: true }).click();
    await ready(escapePage);
    assert.equal(await note(), "Line1\rLine2", "the downloaded file imports with the same cell text");
    await escapeContext.close();
    console.log(JSON.stringify({ case: "#639/#640 SpreadsheetML escape: import decodes, download re-escapes, re-import keeps the text", status: "PASS" }));
  } finally {
    await rm(escapeWork, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}

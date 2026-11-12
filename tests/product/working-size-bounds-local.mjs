// Real Work kit: paste 300 rows, save and reopen, then download CSV and XLSX.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet-bounds-"));
let context;
try {
  context = await chromium.launchPersistentContext(work, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, dist);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(15000);
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const setup = dialog("New table");
  await setup.getByLabel("Table name", { exact: true }).fill("Bounds");
  await setup.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await setup.getByRole("button", { name: "Add column", exact: true }).click();
  await setup.getByLabel("Column 2 name", { exact: true }).fill("Amount");
  await setup.getByLabel("Column 2 type", { exact: true }).selectOption("number");
  await setup.getByRole("button", { name: "Add column", exact: true }).click();
  await setup.getByLabel("Column 3 name", { exact: true }).fill("Note");
  await setup.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  const text = Array.from({ length: 300 }, (_, i) => `Item ${i + 1}\t1\tNote`).join("\n");
  await draft.focus();
  await draft.evaluate((node, value) => { const data = new DataTransfer(); data.setData("text/plain", value); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); }, text);
  await page.locator('.ts-clipboard-status').filter({ hasText: "Added 300 rows" }).waitFor(); await ready();
  const grid = page.getByRole("grid", { name: "Table" });
  async function assertRows() {
    const count = Number(await grid.getAttribute("aria-rowcount"));
    assert.equal(count - 1 - await grid.locator('.ts-entry-row').count() - await grid.locator('.ts-totals-row').count(), 300);
    assert.match(await grid.locator('.ts-totals-row').textContent(), /300/);
  }
  await assertRows();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const save = dialog("Save a copy");
  await save.getByLabel("Copy name", { exact: true }).fill("Bounds copy");
  await save.getByRole("button", { name: "Create copy", exact: true }).click();
  await save.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click(); await waitForColdHome(page);
  await page.getByRole("button", { name: "Open saved Bounds copy", exact: true }).click(); await ready(); await assertRows();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  for (const format of ["csv", "xlsx"]) {
    await page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true }).click();
    const confirm = dialog("Confirm download");
    await confirm.waitFor();
    const downloaded = page.waitForEvent("download");
    await confirm.getByRole("button", { name: "Download", exact: true }).click();
    const file = path.join(work, `bounds.${format}`);
    await (await downloaded).saveAs(file);
    await confirm.waitFor({ state: "detached" });
    const rows = JSON.parse(execFileSync("python3", ["-I", "-c", String.raw`
import csv, json, sys, zipfile, xml.etree.ElementTree as E
p = sys.argv[1]
if p.endswith('.csv'):
 with open(p, encoding='utf-8-sig', newline='') as f: rows = list(csv.reader(f))
else:
 n = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(p) as z:
  rows = E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row', n)
  rows = [r.get('r') for r in rows]
print(json.dumps(rows))
`, file], { encoding: "utf8" }));
    assert.equal(rows.length, 301, `${format} includes a header and 300 rows`);
    if (format === "csv") {
      for (const index of [1, 150, 300]) assert.deepEqual(rows[index], [`Item ${index}`, "1", "Note"]);
    }
  }
  console.log("PASS: 300 pasted rows survive Save a copy and reopen and download as CSV and XLSX");
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}

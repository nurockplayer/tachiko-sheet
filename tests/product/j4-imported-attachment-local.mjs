// Real built-product J4 journey for an imported two-sheet source. It proves
// that the host-private J3 attachment survives a format-2 save and complete
// browser restart, while all summary work stays in the public core runtime.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-j4-imported-profile-"));
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "tachiko-j4-imported-fixture-"));
const fixture = path.join(fixtureDirectory, "catalog-sales.xlsx");
let context;

const sheet = (columns, rows) => `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${[[...columns], ...rows].map((row, rowIndex) => `<x:row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<x:c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" s="2" t="str"><x:v>${value}</x:v></x:c>`).join("")}</x:row>`).join("")}</x:sheetData></x:worksheet>`;

async function makeImportedFixture() {
  const template = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.xlsx");
  const expanded = path.join(fixtureDirectory, "expanded");
  await mkdir(expanded);
  execFileSync("unzip", ["-q", template, "-d", expanded]);
  await writeFile(path.join(expanded, "xl", "workbook.xml"), `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Catalog" sheetId="1" r:id="Rcatalog" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><x:sheet name="Sales" sheetId="2" r:id="Rsales" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`);
  await writeFile(path.join(expanded, "xl", "_rels", "workbook.xml.rels"), `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Rcatalog"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml" Id="Rsales"/></Relationships>`);
  await writeFile(path.join(expanded, "[Content_Types].xml"), `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  await writeFile(path.join(expanded, "xl", "worksheets", "sheet1.xml"), sheet(["code", "category", "price"], [["PEN ", "PEN ", "200"], ["NOTE", "NOTE", "500"]]));
  await writeFile(path.join(expanded, "xl", "worksheets", "sheet2.xml"), sheet(["product_code", "quantity"], [["PEN ", "4"], ["NOTE", "2"]]));
  execFileSync("zip", ["-Xqr", fixture, "."], { cwd: expanded });
}

async function start() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(LOCAL_ORIGIN);
  return page;
}

async function importFixture(page) {
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /2 sheet\(s\)/, "the normal import review must expose both source sheets");
  const columns = dialog.locator("select");
  await columns.nth(2).selectOption("number");
  await columns.nth(4).selectOption("number");
  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
}

async function bindAndCreate(page) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sheet_2");
  await page.getByLabel("Products table", { exact: true }).selectOption("sheet_1");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("column_1");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("column_2");
  await page.getByLabel("Product key", { exact: true }).selectOption("column_1");
  await page.getByLabel("Product category", { exact: true }).selectOption("column_2");
  await page.getByLabel("Product price", { exact: true }).selectOption("column_3");
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
}

async function groups(page) {
  return (await page.getByLabel("Cross-table groups", { exact: true }).textContent()).replace(/\s+/g, " ").trim();
}

async function savedAttachment(page, name) {
  return page.evaluate(async (copyName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tachiko-sheet-local-copies");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const record = await new Promise((resolve, reject) => {
        const request = db.transaction("opaque-copies", "readonly").objectStore("opaque-copies").get(copyName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      if (!record?.importedSource) throw new Error("saved opaque copy has no imported-source attachment");
      const digest = await crypto.subtle.digest("SHA-256", record.importedSource.bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return { hash, metadata: record.importedSource.metadata, ledger: record.importedSource.ledger };
    } finally {
      db.close();
    }
  }, name);
}

async function visibleTable(page, collection) {
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption(collection);
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  return {
    headers: await grid.locator("thead th").allTextContents(),
    rows: await grid.locator("tbody tr").evaluateAll((rows) => rows.map((row) =>
      Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
    )),
  };
}

try {
  await makeImportedFixture();
  const sourceHash = createHash("sha256").update(await readFile(fixture)).digest("hex");
  let page = await start();
  await importFixture(page);
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByLabel("Source fidelity ledger", { exact: true }).waitFor();
  const initialLedger = page.locator("[aria-label='Source fidelity ledger'] .ts-ledger");
  await assert.doesNotReject(async () => initialLedger.waitFor());
  const initialLedgerText = (await initialLedger.textContent()).trim();
  assert.notEqual(initialLedgerText, "", "the imported source must carry a visible producer ledger entry");
  const initialLedgerEntries = await initialLedger.locator("li").allTextContents();
  await bindAndCreate(page);
  assert.match(await groups(page), /NOTE: 1000/);
  assert.match(await groups(page), /PEN\s*: 800/);

  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  await page.getByRole("button", { name: "Commit preview", exact: true }).click();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.getByLabel("Cross-table groups", { exact: true }).count(), 0, "cleanup publication must not leave the old group result visible");
  await page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true }).click();
  const diagnostics = page.getByLabel("Cross-table diagnostics", { exact: true });
  await diagnostics.waitFor();
  assert.match(await diagnostics.textContent(), /lookup\.missing_key: PEN/);

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-imported-restart");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const savedBeforeRestart = await savedAttachment(page, "j4-imported-restart");
  assert.equal(savedBeforeRestart.hash, sourceHash);
  assert.ok(savedBeforeRestart.ledger.some((entry) => entry.code === "header_style_not_preserved"));
  assert.match(initialLedgerText, /Header text is retained/);

  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j4-imported-restart", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByLabel("Source fidelity ledger", { exact: true }).waitFor();
  const retainedLedger = page.locator("[aria-label='Source fidelity ledger'] .ts-ledger");
  assert.deepEqual(await retainedLedger.locator("li").allTextContents(), initialLedgerEntries);
  const savedAfterRestart = await savedAttachment(page, "j4-imported-restart");
  assert.deepEqual(savedAfterRestart, savedBeforeRestart);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table diagnostics", { exact: true }).waitFor();
  assert.match(await page.getByLabel("Cross-table diagnostics", { exact: true }).textContent(), /lookup\.missing_key: PEN/);

  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  const exported = path.join(fixtureDirectory, "reopened-export.xlsx");
  await (await downloaded).saveAs(exported);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  // The exported source is now independent evidence. If the reopened project
  // is still dirty, take the normal explicit close path before importing it.
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await unsaved.count()) {
    await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  }
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(exported);
  const reimport = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await reimport.waitFor();
  await reimport.locator("select").nth(2).selectOption("number");
  await reimport.locator("select").nth(4).selectOption("number");
  await reimport.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.deepEqual(await visibleTable(page, "sheet_1"), {
    headers: ["Row", "column_1", "column_2", "column_3"],
    rows: [["PEN", "PEN", "200"], ["NOTE", "NOTE", "500"]],
  });
  assert.deepEqual(await visibleTable(page, "sheet_2"), {
    headers: ["Row", "column_1", "column_2"],
    rows: [["PEN ", "4"], ["NOTE", "2"]],
  });
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.getByLabel("Cross-table groups", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Refresh cross-table summary/ }).count(), 0);
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(fixtureDirectory, { recursive: true, force: true });
}

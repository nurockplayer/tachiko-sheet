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
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await waitForHomeOpen(page);
  return page;
}

async function waitForHomeOpen(page) {
  await page.getByRole("region", { name: "Recovery", exact: true }).waitFor({ state: "detached" });
  const input = page.getByLabel("Choose CSV or XLSX", { exact: true });
  await input.waitFor();
  await page.waitForFunction(() => {
    const candidate = document.querySelector('input[type="file"][accept*=".csv"]');
    return candidate instanceof HTMLInputElement && !candidate.disabled && candidate.value === "";
  });
}

async function importFixture(page) {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.waitFor();
  const approvedPanel = await dialog.boundingBox();
  assert.equal(Math.round(approvedPanel.width), 600, "import review uses the approved desktop panel width");
  assert.equal(Math.round(approvedPanel.height), 584, "import review retains its approved content frame");
  assert.equal(Math.round(approvedPanel.x), 456);
  assert.equal(Math.round(approvedPanel.y), 199);
  const importMaterial = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, border: style.borderColor, shadow: style.boxShadow };
  });
  assert.equal(importMaterial.radius, "12px");
  assert.equal(importMaterial.border, "rgb(223, 226, 234)");
  assert.equal(importMaterial.shadow, "rgba(37, 39, 53, 0.24) 0px 16px 48px -12px");
  const importActions = await dialog.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    }),
  );
  assert.equal(importActions[0].x - Math.round(approvedPanel.x), 25);
  assert.equal(importActions[0].width, 88);
  assert.equal(importActions[1].x + importActions[1].width - Math.round(approvedPanel.x), 577);
  assert.equal(importActions[1].width, 168);
  assert.equal(importActions[0].height, 32);
  assert.match(await dialog.textContent(), /2 sheet\(s\)/, "the normal import review must expose both source sheets");
  const columns = dialog.locator("select");
  await page.setViewportSize({ width: 320, height: 640 });
  const compactPanel = await dialog.boundingBox();
  assert.equal(Math.round(compactPanel.x), 16, "long import review stays inset on a phone");
  assert.equal(Math.round(compactPanel.width), 288, "long import review fits a 320px viewport");
  assert.ok(compactPanel.y >= 0 && compactPanel.y + compactPanel.height <= 640, "import panel stays within phone height");
  const importAction = dialog.getByRole("button", { name: "Import candidate", exact: true });
  await importAction.focus();
  const compactAction = await importAction.boundingBox();
  assert.ok(compactAction.y >= 0 && compactAction.y + compactAction.height <= 640, `keyboard focus scrolls the import action into view: ${JSON.stringify({ compactPanel, compactAction, scrollTop: await dialog.evaluate((node) => node.scrollTop) })}`);
  await page.setViewportSize({ width: 1280, height: 720 });
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
  const picker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await picker.selectOption(collection);
  await page.waitForFunction(
    (expectedCollection) => {
      const selectedTable = document.querySelector("#ts-active-table");
      const currentness = document.querySelector('[data-testid="currentness"]');
      const grid = document.querySelector('table[aria-label="Table"]');
      return selectedTable?.value === expectedCollection &&
        currentness?.getAttribute("data-currentness") === "current" &&
        grid?.querySelector("thead th") !== null;
    },
    collection,
  );
  return page.getByRole("grid", { name: "Table", exact: true }).evaluate((grid) => ({
    headers: Array.from(grid.querySelectorAll("thead th"), (cell) => cell.textContent ?? ""),
    rows: Array.from(grid.querySelectorAll("tbody tr"), (row) =>
      Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
    ),
  }));
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

  // Candidate inspection is a home-screen action. Leave the reopened project
  // through its normal close path before selecting another spreadsheet.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const restartUnsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await restartUnsaved.count()) {
    await restartUnsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  }
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await waitForHomeOpen(page);

  // With no resident after the explicit close, an unknown import must not
  // invent a candidate; Refresh must report the real no-resident core failure.
  const importBeforeNoResident = await page.evaluate(() => window.__tachikoAcceptance.importSpreadsheetRequestCount());
  await page.evaluate(() => window.__tachikoAcceptance.loseNextImportBeforeDispatch());
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const unknownImport = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await unknownImport.waitFor();
  await unknownImport.locator("select").nth(2).selectOption("number");
  await unknownImport.locator("select").nth(4).selectOption("number");
  await unknownImport.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(
    await page.evaluate(() => window.__tachikoAcceptance.acceptanceHarnessVersion()),
    "j4-no-resident-runtime-read-probe-v2",
  );
  await page.evaluate(() => window.__tachikoAcceptance.resetCoreFailureProbe());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await waitForHomeOpen(page);
  assert.deepEqual(
    await page.evaluate(() => window.__tachikoAcceptance.coreFailureProbe()),
    {
      name: "NoResidentWorkError",
      causeName: "DesignerRuntimeError",
      causeFailureCode: "no_project_open",
    },
  );
  assert.equal(await page.getByTestId("project-ready").count(), 0, "no-resident unknown import refresh must return to home");
  assert.equal(
    await page.evaluate(() => window.__tachikoAcceptance.importSpreadsheetRequestCount()) - importBeforeNoResident,
    0,
    "before-dispatch import delivery uncertainty must not dispatch a candidate",
  );

  // A separate arm loses the reply only after one real import dispatch. Its
  // unknown result must remain source-unconfirmed through Refresh, without a
  // second import or any actionable project, save, or export surface.
  const importBeforeReplyLoss = await page.evaluate(() => window.__tachikoAcceptance.importSpreadsheetRequestCount());
  const exportBeforeImportReplyLoss = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  const copiesBeforeImportReplyLoss = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.evaluate(() => window.__tachikoAcceptance.loseNextImportReplyAfterDispatch());
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const replyLossImport = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await replyLossImport.waitFor();
  await replyLossImport.locator("select").nth(2).selectOption("number");
  await replyLossImport.locator("select").nth(4).selectOption("number");
  await replyLossImport.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("operation-outcome").filter({ hasText: "Outcome needs review" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__tachikoAcceptance.importSpreadsheetRequestCount()) - importBeforeReplyLoss,
    1,
    "post-dispatch reply loss must call real import exactly once",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Prepare XLSX", exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.__tachikoAcceptance.importSpreadsheetRequestCount()) - importBeforeReplyLoss,
    1,
    "Refresh must not repeat an unknown import",
  );
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportBeforeImportReplyLoss);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeImportReplyLoss);
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open saved j4-imported-restart", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const reopenedUnsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await reopenedUnsaved.count()) {
    await reopenedUnsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  }
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await waitForHomeOpen(page);

  // The import itself can succeed while its first projection observation is
  // lost. That known operation outcome still leaves source provenance
  // unconfirmed, so recovery must remain closed until explicit abandon.
  const exportBeforeImportProjectionLoss = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  const copiesBeforeImportProjectionLoss = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.evaluate(() => window.__tachikoAcceptance.failNextImportProjection());
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const projectionLossImport = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await projectionLossImport.waitFor();
  await projectionLossImport.locator("select").nth(2).selectOption("number");
  await projectionLossImport.locator("select").nth(4).selectOption("number");
  await projectionLossImport.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("operation-outcome").count(), 0, "known import publication recovery keeps outcome idle");
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportBeforeImportProjectionLoss);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeImportProjectionLoss);
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open saved j4-imported-restart", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table diagnostics", { exact: true }).waitFor();
  assert.match(await page.getByLabel("Cross-table diagnostics", { exact: true }).textContent(), /lookup\.missing_key: PEN/);

  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.setViewportSize({ width: 1512, height: 982 });
  const prepareXlsx = page.getByRole("button", { name: "Prepare XLSX", exact: true });
  await prepareXlsx.click();
  const downloadReview = page.getByRole("dialog", { name: "Confirm download", exact: true });
  const downloadPanel = await downloadReview.boundingBox();
  assert.equal(Math.round(downloadPanel.width), 600, "download review uses the approved desktop panel width");
  assert.equal(Math.round(downloadPanel.height), 360, "download review retains its approved content frame");
  assert.equal(Math.round(downloadPanel.x), 456);
  assert.equal(Math.round(downloadPanel.y), 311);
  const downloadMaterial = await downloadReview.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, border: style.borderColor, shadow: style.boxShadow };
  });
  assert.deepEqual(downloadMaterial, {
    radius: "12px",
    border: "rgb(223, 226, 234)",
    shadow: "rgba(37, 39, 53, 0.24) 0px 16px 48px -12px",
  });
  const downloadActions = await downloadReview.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    }),
  );
  assert.equal(downloadActions[0].x - Math.round(downloadPanel.x), 25);
  assert.equal(downloadActions[0].width, 88);
  assert.equal(downloadActions[1].x + downloadActions[1].width - Math.round(downloadPanel.x), 577);
  assert.equal(downloadActions[1].width, 120);
  assert.equal(downloadActions[0].height, 32);

  const cancelledDesktopDownload = page.waitForEvent("download", { timeout: 250 }).then(() => false).catch(() => true);
  await downloadReview.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await cancelledDesktopDownload, true, "desktop cancellation does not download the reviewed file");
  await downloadReview.waitFor({ state: "detached" });
  assert.equal(await prepareXlsx.evaluate((element) => element === document.activeElement), true, "desktop cancel returns focus to Prepare XLSX");

  await page.setViewportSize({ width: 320, height: 300 });
  await prepareXlsx.click();
  await downloadReview.waitFor();
  const shortDownloadPanel = await downloadReview.boundingBox();
  assert.ok(shortDownloadPanel.height <= 252 && shortDownloadPanel.y >= 0 && shortDownloadPanel.y + shortDownloadPanel.height <= 300, `short Download dialog stays within the viewport: ${JSON.stringify(shortDownloadPanel)}`);
  const downloadHeading = downloadReview.getByRole("heading", { name: "Review and download XLSX", exact: true });
  assert.equal(await downloadHeading.evaluate((heading) => heading === document.activeElement), true, "short Download opens with its review heading focused");
  const downloadExplanation = downloadReview.locator(".ts-dialog-intro p");
  const explanationBox = await downloadExplanation.boundingBox();
  assert.ok(explanationBox && explanationBox.y >= shortDownloadPanel.y && explanationBox.y + explanationBox.height <= shortDownloadPanel.y + shortDownloadPanel.height, `Download consent explanation is visible on first short-viewport open: ${JSON.stringify({ shortDownloadPanel, explanationBox })}`);
  const firstExportWarning = downloadReview.locator(".ts-dialog-scroll .ts-ledger li").first();
  assert.notEqual((await firstExportWarning.textContent())?.trim(), "", "the real exporter supplied a warning for the short review");
  const firstWarningBox = await firstExportWarning.boundingBox();
  assert.ok(firstWarningBox && firstWarningBox.y >= shortDownloadPanel.y && firstWarningBox.y < shortDownloadPanel.y + shortDownloadPanel.height, `first producer warning begins in the initial short-viewport frame: ${JSON.stringify({ shortDownloadPanel, firstWarningBox })}`);
  const shortDownloadScroll = await downloadReview.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    overflowY: getComputedStyle(element).overflowY,
    contentOverflowY: getComputedStyle(element.querySelector(".ts-dialog-scroll")).overflowY,
  }));
  assert.ok(shortDownloadScroll.scrollHeight > shortDownloadScroll.clientHeight, `short Download uses parent scrolling: ${JSON.stringify(shortDownloadScroll)}`);
  assert.equal(shortDownloadScroll.overflowY, "auto");
  assert.equal(shortDownloadScroll.contentOverflowY, "visible", "short Download exposes review content to parent scrolling");
  assert.equal(shortDownloadScroll.scrollTop, 0, "initial Download focus preserves the top of the review before consent");
  const downloadButton = downloadReview.getByRole("button", { name: "Download", exact: true });
  await page.keyboard.press("Shift+Tab");
  assert.equal(await downloadButton.evaluate((element) => element === document.activeElement), true, "Shift+Tab from Download heading remains trapped on the final consent action");
  await page.keyboard.press("Tab");
  assert.equal(await downloadHeading.evaluate((element) => element === document.activeElement), true, "Tab from final consent action wraps to Download heading");
  await page.keyboard.press("Tab");
  const cancelDownload = downloadReview.getByRole("button", { name: "Cancel", exact: true });
  assert.equal(await cancelDownload.evaluate((element) => element === document.activeElement), true, "Tab from Download heading reaches Cancel before consent");
  const noCancelledShortDownload = page.waitForEvent("download", { timeout: 250 }).then(() => false).catch(() => true);
  await cancelDownload.click();
  assert.equal(await noCancelledShortDownload, true, "short-viewport pointer cancellation does not download");
  await downloadReview.waitFor({ state: "detached" });
  assert.equal(await prepareXlsx.evaluate((element) => element === document.activeElement), true, "short Download cancel returns focus to Prepare XLSX");

  await prepareXlsx.click();
  await downloadReview.waitFor();
  assert.equal(await downloadHeading.evaluate((element) => element === document.activeElement), true, "reopened short Download again begins at its heading");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await downloadButton.evaluate((element) => element === document.activeElement), true, "keyboard reaches Download consent after Cancel");
  const [shortDownloadAction, scrolledDownloadPanel] = await Promise.all([
    downloadButton.boundingBox(),
    downloadReview.boundingBox(),
  ]);
  assert.ok(shortDownloadAction && shortDownloadPanel.y <= shortDownloadAction.y && shortDownloadAction.y + shortDownloadAction.height <= shortDownloadPanel.y + shortDownloadPanel.height, `Download consent action scrolls into the short dialog: ${JSON.stringify({ initialPanel: shortDownloadPanel, currentPanel: scrolledDownloadPanel, action: shortDownloadAction, scroll: await downloadReview.evaluate((element) => ({ scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY })) })}`);
  assert.ok(await downloadReview.evaluate((element) => element.scrollTop > 0), "keyboard focus scrolls the short Download dialog to its consent action");
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const exported = path.join(fixtureDirectory, "reopened-export.xlsx");
  await (await downloaded).saveAs(exported);
  await page.setViewportSize({ width: 1512, height: 982 });
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

// Actual imported-workbook composition regression for configured Summary,
// Report, and Brief. The projections come from the ordinary public import
// path and visible binding controls; no DOM-only projection is injected.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const profilePath = await mkdtemp(path.join(tmpdir(), "tachiko-result-composition-profile-"));
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "tachiko-result-composition-xlsx-"));
const fixture = path.join(fixtureDirectory, "long-cjk-results.xlsx");
const evidenceDir = process.env.SHEET_COMPOSITION_ARTIFACT_DIR;
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const categories = ["A商品", ...Array.from({ length: 23 }, (_, index) => `東京商品分類長名${String(index + 2).padStart(2, "0")}日本語資料集地域別販売記録対象市場調査確認用長文データ`)];
const prices = categories.map((_, index) => 110 + index * 7);
const quantities = categories.map((_, index) => 2 + index % 3);
const expectedRows = categories.map((category, index) => [category, String(prices[index] * quantities[index])]);
let context;

const worksheet = (columns, rows) => `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${[[...columns], ...rows].map((row, rowIndex) => `<x:row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<x:c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" s="2" t="str"><x:v>${escapeXml(value)}</x:v></x:c>`).join("")}</x:row>`).join("")}</x:sheetData></x:worksheet>`;

async function makeFixture() {
  const template = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.xlsx");
  const expanded = path.join(fixtureDirectory, "expanded");
  await mkdir(expanded);
  execFileSync("unzip", ["-q", template, "-d", expanded]);
  await writeFile(path.join(expanded, "xl", "workbook.xml"), `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Catalog" sheetId="1" r:id="Rcatalog" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><x:sheet name="Sales" sheetId="2" r:id="Rsales" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`);
  await writeFile(path.join(expanded, "xl", "_rels", "workbook.xml.rels"), `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Rcatalog"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml" Id="Rsales"/></Relationships>`);
  await writeFile(path.join(expanded, "[Content_Types].xml"), `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  const catalog = categories.map((category, index) => [`SKU-${String(index + 1).padStart(2, "0")}`, category, String(prices[index])]);
  const sales = categories.map((_, index) => [`SKU-${String(index + 1).padStart(2, "0")}`, String(quantities[index])]);
  await writeFile(path.join(expanded, "xl", "worksheets", "sheet1.xml"), worksheet(["code", "category", "price"], catalog));
  await writeFile(path.join(expanded, "xl", "worksheets", "sheet2.xml"), worksheet(["product_code", "quantity"], sales));
  execFileSync("zip", ["-Xqr", fixture, "."], { cwd: expanded });
}

async function saveScreenshot(page, name, fullPage = true) {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage, animations: "disabled" });
}

async function start() {
  context = await chromium.launchPersistentContext(profilePath, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  return page;
}

async function importWorkbook(page) {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.waitFor();
  const types = dialog.locator("select");
  await types.nth(2).selectOption("number");
  await types.nth(4).selectOption("number");
  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
}

async function createSummary(page) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sheet_2");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("column_1");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("column_2");
  await page.getByLabel("Products table", { exact: true }).selectOption("sheet_1");
  await page.getByLabel("Product key", { exact: true }).selectOption("column_1");
  await page.getByLabel("Product category", { exact: true }).selectOption("column_2");
  await page.getByLabel("Product price", { exact: true }).selectOption("column_3");
  const fields = page.locator(".ts-summary-fields .ts-summary-field");
  assert.equal(await fields.count(), 7, "all seven approved visible binding controls are available");
  const fieldGeometry = await fields.evaluateAll((items) => items.map((item) => {
    const label = item.querySelector("label").getBoundingClientRect();
    const input = item.querySelector("select").getBoundingClientRect();
    return { label: item.querySelector("label").textContent, labelBottom: label.bottom, inputTop: input.top };
  }));
  assert.ok(fieldGeometry.every((item) => item.labelBottom <= item.inputTop), `binding labels sit above their controls: ${JSON.stringify(fieldGeometry)}`);
  await saveScreenshot(page, "summary-binding-desktop.png");
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  const table = page.getByLabel("Cross-table groups", { exact: true });
  await table.waitFor();
  return table;
}

async function groupRows(table) {
  return table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "")));
}

async function setAppearance(page, profileLabel, densityLabel) {
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.locator(".ts-appearance-profile-option").filter({ hasText: profileLabel }).click();
  await page.locator(".ts-appearance-density-option").filter({ hasText: densityLabel }).click();
  const chrome = { Tachiko: "porcelain", "Familiar Spreadsheet": "structured", "Minimal-Focus": "quiet" }[profileLabel];
  const density = densityLabel.toLowerCase();
  await page.waitForFunction(({ expectedChrome, expectedDensity }) =>
    document.documentElement.getAttribute("data-ts-profile-chrome") === expectedChrome &&
    document.documentElement.getAttribute("data-ts-profile-density") === expectedDensity,
  { expectedChrome: chrome, expectedDensity: density });
  await page.getByRole("button", { name: "Close", exact: true }).click();
}

async function panelGeometry(page, selector, viewportWidth) {
  return page.locator(selector).evaluate((panel, expectedViewportWidth) => {
    const panelRect = panel.getBoundingClientRect();
    const root = document.querySelector(".ts-workbook");
    const rootRect = root.getBoundingClientRect();
    return {
      viewportWidth: expectedViewportWidth,
      panel: { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height, right: panelRect.right, bottom: panelRect.bottom, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth },
      workbook: { x: rootRect.x, right: rootRect.right, width: rootRect.width },
      documentWidth: document.documentElement.scrollWidth,
    };
  }, viewportWidth);
}

async function assertInScrollport(locator, panel, label) {
  const bounds = await locator.evaluate((node) => {
    const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
    const scrollport = node.closest(".ts-panel");
    const panelBounds = scrollport.getBoundingClientRect();
    return { top, bottom, left, right, width, height, panelTop: panelBounds.top, panelBottom: panelBounds.bottom, panelLeft: panelBounds.left, panelRight: panelBounds.right };
  });
  assert.ok(bounds.height > 0 && bounds.width > 0 && bounds.top >= bounds.panelTop - 1 && bounds.bottom <= bounds.panelBottom + 1 && bounds.left >= bounds.panelLeft - 1 && bounds.right <= bounds.panelRight + 1, `${label} is inside its actual view scrollport: ${JSON.stringify(bounds)}`);
  return bounds;
}

try {
  await makeFixture();
  const page = await start();
  await importWorkbook(page);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.ok(await page.locator("[role=tabpanel].ts-brief").count(), "unconfigured pre-binding Summary keeps its deferred no-result wrapper");
  await page.getByRole("heading", { name: "Authoritative result", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Cross-table summary", exact: true }).waitFor();
  const summaryTable = await createSummary(page);
  const actual = await groupRows(summaryTable);
  assert.deepEqual(actual, expectedRows, "the actual public-core grouped result retains all 24 imported CJK categories and values");
  assert.deepEqual(await summaryTable.locator("thead th").allTextContents(), ["Product", "Value"]);
  assert.equal(Math.round((await summaryTable.boundingBox()).width), 760, "configured Summary uses the approved bounded 760px result table");
  assert.equal(Math.round(await summaryTable.locator("tbody tr").first().evaluate((row) => row.getBoundingClientRect().height)), 32, "ordinary grouped-result rows retain the 32px pitch");
  assert.equal(await summaryTable.locator("thead th").nth(1).evaluate((header) => getComputedStyle(header).textAlign), "left", "Value header remains left aligned while numeric results align right");
  assert.equal(await summaryTable.locator("tbody tr").first().locator("td").nth(1).evaluate((cell) => getComputedStyle(cell).textAlign), "right");
  const resultPreview = page.locator(".ts-summary-result > .ts-preview").first();
  assert.equal(await resultPreview.evaluate((node) => getComputedStyle(node).borderTopWidth), "0px", "configured result drops only its inherited inner divider");
  assert.equal(await resultPreview.evaluate((node) => getComputedStyle(node).paddingTop), "0px");
  const summaryActions = page.locator(".ts-summary-actions");
  assert.equal(await summaryActions.locator("button").count(), 3, "bar, line and refresh actions share one wrapping group");
  assert.ok((await summaryActions.getByRole("button", { name: "Create bar report", exact: true }).getAttribute("class")).includes("ts-button--primary"));
  assert.ok(!(await summaryActions.getByRole("button", { name: "Create line report", exact: true }).getAttribute("class")).includes("ts-button--primary"));
  await page.locator(".ts-summary-panel").evaluate((panel) => { panel.scrollTop = 0; });
  const summaryGeometry = await panelGeometry(page, ".ts-summary-panel", 1512);
  assert.ok(summaryGeometry.documentWidth <= 1512, JSON.stringify(summaryGeometry));
  await saveScreenshot(page, "summary-desktop.png");

  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const emptyReport = page.getByRole("tabpanel", { name: "Report", exact: true });
  await emptyReport.evaluate((panel) => { panel.scrollTop = 0; });
  assert.ok(await emptyReport.locator(".ts-report-layout--empty").count(), "unconfigured Report retains its compact no-report state");
  assert.equal(await emptyReport.locator(".ts-report-document").isVisible(), false, "no-report state does not reserve an empty document column");
  assert.equal(await emptyReport.locator(".ts-report-remove").count(), 0);
  const emptySettings = await emptyReport.locator(".ts-report-settings").evaluate((node) => {
    const { width, right } = node.getBoundingClientRect();
    return { width, right, border: getComputedStyle(node).borderRightWidth };
  });
  const emptyReportGeometry = await panelGeometry(page, ".ts-report-panel", 1512);
  assert.equal(emptySettings.border, "0px");
  assert.ok(emptySettings.width > 700, `no-report settings use the full content column rather than an empty split: ${JSON.stringify(emptySettings)}`);
  await saveScreenshot(page, "report-empty-desktop.png");

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("region", { name: "Report chart", exact: true }).waitFor();
  const reportRows = await page.getByLabel("Current report data", { exact: true }).locator("dt").evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
  assert.deepEqual(reportRows.slice(0, categories.length), categories, "the Report document preserves every current category in DOM/read order");
  const reportPanel = page.getByRole("tabpanel", { name: "Report", exact: true });
  await reportPanel.evaluate((panel) => { panel.scrollTop = 0; });
  const reportTypography = await page.getByLabel("Current report data", { exact: true }).locator("dt").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight };
  });
  assert.deepEqual(reportTypography, { size: "12px", line: "20px", weight: "400" }, "Report category metadata matches its native 12/20/400 hierarchy");
  await saveScreenshot(page, "report-desktop.png", false);
  const reportSequence = await reportPanel.evaluate((panel) => {
    const settings = panel.querySelector(".ts-report-settings");
    const heading = panel.querySelector("h1");
    const doc = panel.querySelector(".ts-report-document");
    const remove = panel.querySelector(".ts-report-remove");
    const exportButton = Array.from(panel.querySelectorAll("button")).find((button) => button.textContent?.includes("Export current PNG"));
    const chart = panel.querySelector('[aria-label="Report chart"]');
    const box = (node) => { const { x, y, width, height, bottom, right } = node.getBoundingClientRect(); return { x, y, width, height, bottom, right }; };
    return { heading: box(heading), settings: box(settings), document: box(doc), remove: box(remove), export: box(exportButton), chart: box(chart), order: [settings, doc, exportButton, remove].map((node) => Array.from(panel.querySelectorAll("*" )).indexOf(node)) };
  });
  assert.ok(reportSequence.heading.bottom <= reportSequence.settings.y, `report page heading spans above both columns: ${JSON.stringify(reportSequence)}`);
  assert.ok(Math.abs(reportSequence.settings.width - 328) <= 1, `settings use native 304px content plus divider/inset: ${JSON.stringify(reportSequence.settings)}`);
  assert.ok(reportSequence.remove.y >= reportSequence.settings.bottom - 1 && reportSequence.remove.y - reportSequence.settings.bottom <= 28 && reportSequence.remove.y < reportSequence.document.bottom, `Remove follows settings at the native 24px gap plus 4px margin while the right document continues: ${JSON.stringify(reportSequence)}`);
  assert.deepEqual(reportSequence.order, [...reportSequence.order].sort((a, b) => a - b), "DOM focus order keeps settings, document export, then Remove");
  const reportGeometry = await panelGeometry(page, ".ts-report-panel", 1512);
  assert.ok(reportGeometry.documentWidth <= 1512, JSON.stringify(reportGeometry));
  await reportPanel.evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
  await page.waitForTimeout(40);
  assert.ok(await page.getByRole("button", { name: "Export current PNG", exact: true }).isVisible(), "export is reachable at the end of the long report document");
  assert.ok(await page.getByRole("button", { name: "Remove report", exact: true }).isVisible(), "Remove remains reachable while the document is scrolled to its end");
  await saveScreenshot(page, "report-desktop-bottom.png", false);

  const tablePicker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("sheet_1");
  const productGrid = page.getByRole("grid", { name: "Table", exact: true });
  await productGrid.waitFor();
  await productGrid.locator("tbody tr").filter({ hasText: "SKU-02" }).click();
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const facts = page.getByRole("table", { name: "Linked facts", exact: true });
  await facts.waitFor();
  assert.deepEqual(await facts.locator("thead th").allTextContents(), ["Field", "Value"]);
  const firstFact = facts.locator("tbody tr").nth(1);
  assert.equal((await firstFact.locator("th").textContent()).trim(), "column_2");
  assert.equal((await firstFact.locator("td").textContent()).trim(), categories[1]);
  assert.equal(await firstFact.locator("td").getAttribute("data-work-currentness"), "current");
  assert.ok(await firstFact.locator("td").getAttribute("data-work-entity"));
  const briefDesktopColumns = await facts.evaluate((table) => ({
    width: Math.round(table.getBoundingClientRect().width),
    columns: Array.from(table.querySelectorAll("thead th"), (cell) => Math.round(cell.getBoundingClientRect().width)),
  }));
  assert.deepEqual(briefDesktopColumns, { width: 480, columns: [200, 280] }, "Brief desktop facts match the approved 480px field/value allocation");
  const briefRows = await facts.locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
    const { height } = row.getBoundingClientRect();
    return { height, value: row.querySelector("td")?.textContent?.trim() ?? "" };
  }));
  assert.equal(briefRows[0].height, 32, "ordinary linked facts retain the exact approved 32px row pitch");
  assert.ok(briefRows[1].height > briefRows[0].height, `long CJK values grow their own row instead of being clipped: ${JSON.stringify(briefRows.slice(0, 2))}`);
  assert.equal((await page.getByRole("tabpanel", { name: "Brief", exact: true }).getByText("Apply notes to the open work. Saving a copy is a separate action.").count()), 1);
  await saveScreenshot(page, "brief-desktop.png");

  await page.setViewportSize({ width: 360, height: 640 });
  const briefCompactColumns = await facts.evaluate((table) => ({
    width: Math.round(table.getBoundingClientRect().width),
    columns: Array.from(table.querySelectorAll("thead th"), (cell) => Math.round(cell.getBoundingClientRect().width)),
  }));
  assert.deepEqual(briefCompactColumns, { width: 328, columns: [125, 203] }, "Brief compact facts match the approved 328px field/value allocation");

  // Confirm actual vertical reachability at the admitted short phone height;
  // a fitting panel rectangle by itself is not evidence that later controls
  // can be reached inside its scrollport.
  await page.setViewportSize({ width: 320, height: 450 });
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const shortSummary = page.locator(".ts-summary-panel");
  await shortSummary.evaluate((panel) => { panel.scrollTop = 0; });
  const shortSummaryHeader = page.getByLabel("Cross-table groups", { exact: true }).locator("thead");
  await shortSummaryHeader.scrollIntoViewIfNeeded();
  await assertInScrollport(shortSummaryHeader, shortSummary, "Summary table header at 320×450");
  const shortSummaryRows = page.getByLabel("Cross-table groups", { exact: true }).locator("tbody tr");
  await assertInScrollport(shortSummaryRows.first(), shortSummary, "first Summary row at 320×450");
  await shortSummaryRows.last().scrollIntoViewIfNeeded();
  const lastSummaryRow = await assertInScrollport(shortSummaryRows.last(), shortSummary, "last actual Summary row at 320×450");
  await saveScreenshot(page, "summary-phone-bottom.png", false);
  await shortSummary.evaluate((panel) => { panel.scrollTop = 0; });
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  const shortBindingFields = page.locator(".ts-summary-fields .ts-summary-field");
  await shortBindingFields.first().waitFor();
  assert.equal(await shortBindingFields.count(), 7);
  await shortBindingFields.last().locator("select").scrollIntoViewIfNeeded();
  const finalBinding = await assertInScrollport(shortBindingFields.last(), shortSummary, "last binding field at 320×450");

  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const shortReport = page.locator(".ts-report-panel");
  await shortReport.evaluate((panel) => { panel.scrollTop = 0; });
  const shortReportHeading = shortReport.getByRole("heading", { name: "Current report", exact: true });
  await shortReportHeading.scrollIntoViewIfNeeded();
  await assertInScrollport(shortReportHeading, shortReport, "Report heading at 320×450");
  const shortExport = shortReport.getByRole("button", { name: "Export current PNG", exact: true });
  await shortExport.scrollIntoViewIfNeeded();
  const exportReachability = await assertInScrollport(shortExport, shortReport, "Report export at 320×450");
  const shortRemove = shortReport.getByRole("button", { name: "Remove report", exact: true });
  await shortRemove.scrollIntoViewIfNeeded();
  const removeReachability = await assertInScrollport(shortRemove, shortReport, "Report Remove at 320×450");
  await saveScreenshot(page, "report-phone-bottom.png", false);

  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const shortBrief = page.locator(".ts-brief-panel");
  await shortBrief.evaluate((panel) => { panel.scrollTop = 0; });
  const briefHeader = page.getByRole("table", { name: "Linked facts", exact: true }).locator("thead");
  await briefHeader.scrollIntoViewIfNeeded();
  await assertInScrollport(briefHeader, shortBrief, "Brief facts header at 320×450");
  const longFact = page.getByRole("table", { name: "Linked facts", exact: true }).locator("tbody tr").nth(1);
  await longFact.scrollIntoViewIfNeeded();
  const longFactReachability = await assertInScrollport(longFact, shortBrief, "long CJK Brief row at 320×450");
  const applyNotes = shortBrief.getByRole("button", { name: "Apply notes", exact: true });
  await applyNotes.scrollIntoViewIfNeeded();
  const notesReachability = await assertInScrollport(applyNotes, shortBrief, "Brief Apply notes at 320×450");
  await saveScreenshot(page, "brief-phone-notes.png", false);

  const profileLabels = ["Tachiko", "Familiar Spreadsheet", "Minimal-Focus"];
  const densityLabels = ["Compact", "Comfortable"];
  const observations = [];
  for (const profileLabel of profileLabels) {
    for (const densityLabel of densityLabels) {
      await setAppearance(page, profileLabel, densityLabel);
      for (const [viewName, tabName, selector] of [
        ["summary", "Cross-table summary", ".ts-summary-panel"],
        ["report", "Report", ".ts-report-panel"],
        ["brief", "Brief", ".ts-brief-panel"],
      ]) {
        await page.getByRole("tab", { name: tabName, exact: true }).click();
      for (const [width, height] of [[1512, 982], [834, 1194], [512, 900], [360, 640], [320, 640], [320, 450]]) {
          await page.setViewportSize({ width, height });
          const geometry = await panelGeometry(page, selector, width);
          assert.ok(geometry.panel.x >= 0 && geometry.panel.right <= width, `${profileLabel}/${densityLabel}/${viewName}/${width} stays inside its viewport: ${JSON.stringify(geometry)}`);
          assert.ok(geometry.documentWidth <= width, `${profileLabel}/${densityLabel}/${viewName}/${width} has no page-level horizontal overflow: ${JSON.stringify(geometry)}`);
          assert.ok(geometry.panel.height >= 100, `${viewName} panel has visible content: ${JSON.stringify(geometry)}`);
          if (viewName === "report" && width > 1023) {
            const reportBoxes = await page.locator(".ts-report-settings, .ts-report-document, .ts-report-remove").evaluateAll((nodes) => nodes.map((node) => { const { x, y, width, bottom } = node.getBoundingClientRect(); return { x, y, width, bottom }; }));
            assert.ok(reportBoxes[0].x < reportBoxes[1].x && reportBoxes[2].y >= reportBoxes[0].bottom - 1, `${viewName} desktop columns and remove placement stay separated: ${JSON.stringify(reportBoxes)}`);
          }
          if (evidenceDir && width === 320 && profileLabel === "Tachiko" && densityLabel === "Compact") await saveScreenshot(page, `${viewName}-phone.png`);
          observations.push({ profile: profileLabel, density: densityLabel, view: viewName, ...geometry });
        }
      }
    }
  }

  // Import leaves all license notices outside the workbook output and reachable
  // by ordinary page scrolling after the complete view content.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const notices = page.locator(".ts-notices");
  const noticeLinks = notices.getByRole("link");
  assert.deepEqual(await noticeLinks.allTextContents(), ["third-party licenses", "MIT", "Apache-2.0"]);
  assert.deepEqual(await noticeLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), [
    "/core-kit/notices/THIRD_PARTY_LICENSES.md", "/core-kit/notices/LICENSE-MIT", "/core-kit/notices/LICENSE-APACHE",
  ]);
  const workbookBottom = await page.locator(".ts-workbook").evaluate((node) => node.getBoundingClientRect().bottom);
  const noticeBox = await notices.boundingBox();
  assert.ok(noticeBox && noticeBox.y >= workbookBottom, "license notices stay outside the workbook output");
  await noticeLinks.first().scrollIntoViewIfNeeded();
  assert.ok(await noticeLinks.evaluateAll((links) => links.every((link) => {
    const rect = link.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  })), "all three legal notice links are reachable by page scrolling at phone height");
  await saveScreenshot(page, "notices-phone.png", false);
  if (evidenceDir) await writeFile(path.join(evidenceDir, "composition-observations.json"), JSON.stringify({ actualGroups: actual, reportCategories: reportRows, reportTypography, briefRows, briefDesktopColumns, briefCompactColumns, summaryGeometry, emptyReportGeometry, reportGeometry, reportSequence, shortHeight: { lastSummaryRow, finalBinding, exportReachability, removeReachability, longFactReachability, notesReachability }, observations, notices: { ...noticeBox, workbookBottom } }, null, 2));
  console.log(JSON.stringify({ status: "PASS", fixture: { sheets: 2, groups: categories.length, longCategoryLength: categories[1].length }, views: observations.length, viewportSamples: [[1512, 982], [834, 1194], [512, 900], [360, 640], [320, 640], [320, 450]], width512Label: "effective-width layout proxy only; not actual browser zoom evidence", shortHeight: "actual panel scroll reachability checked for all three views at 320×450", evidence: evidenceDir ?? null }));
  await context.close();
  context = undefined;
} catch (error) {
  if (evidenceDir && context) {
    try {
      const page = context.pages()[0];
      if (page) await saveScreenshot(page, "failure.png");
    } catch { /* retain the original failure */ }
  }
  throw error;
} finally {
  if (context) await context.close();
  await rm(profilePath, { recursive: true, force: true });
  await rm(fixtureDirectory, { recursive: true, force: true });
}

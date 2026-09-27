// Real built-product J4 journey over the fixed Sheet canary. This uses only
// visible controls and labels; core IDs stay inside the runtime adapter.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-j4-product-"));
let context;

async function start() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  return page;
}

async function openCanary(page) {
  await page.getByRole("button", { name: "Try sales example", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
}

async function chooseBinding(page, { orderQuantity = "quantity", productCategory = "category" } = {}) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption(orderQuantity);
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption(productCategory);
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
}

async function bindAndCreate(page, { failPostPublicationRead = false, productCategory = "category" } = {}) {
  await chooseBinding(page, { productCategory });
  if (failPostPublicationRead) await page.evaluate(() => window.__tachikoAcceptance.failNextJ4PostPublicationRead());
  const previousResultCount = await page.locator('[data-testid^="j4-result-"]').count();
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  if (!failPostPublicationRead) {
    await page.waitForFunction((count) =>
      document.querySelectorAll('[data-testid^="j4-result-"]').length > count &&
      document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current",
    previousResultCount);
    await page.locator('[data-testid^="j4-result-"]').last().getByLabel("Cross-table groups", { exact: true }).waitFor();
  }
}

async function groupText(page) {
  return (await groupRows(page.getByTestId("j4-result-0").getByLabel("Cross-table groups", { exact: true }))).join(" ");
}

async function groupRows(table) {
  return table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("td"));
    return `${cells[0]?.textContent?.trim() ?? ""}: ${cells[1]?.textContent?.trim() ?? ""}`;
  }));
}

async function allGroupRows(page) {
  const tables = await page.getByLabel("Cross-table groups", { exact: true }).all();
  return Promise.all(tables.map((table) => groupRows(table)));
}

try {
  let page = await start();
  await openCanary(page);
  await bindAndCreate(page, { failPostPublicationRead: true });
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator("[data-work-dirty]").getAttribute("data-work-dirty"), "true");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.doesNotMatch(await page.locator("body").textContent(), /was not created/i);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 800/);

  // The visible selectors permit a text field in the numeric quantity role.
  // The core must reject that second Create before publication, and the
  // existing current result must remain available without a refresh.
  const firstSummary = await groupText(page);
  const firstRefreshControls = await page.getByRole("button", { name: "Refresh core result", exact: true }).count();
  await chooseBinding(page, { orderQuantity: "product_code" });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal(await page.getByTestId("j4-result-0").count(), 1, "a known pre-publication rejection must retain the existing result");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), firstRefreshControls, "a known pre-publication rejection must retain existing refresh controls");
  assert.equal(await groupText(page), firstSummary, "a known pre-publication rejection must retain the current grouped values");

  const tablePicker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  // Opening a clean editor must not leave it mounted across a collection
  // switch. The source witness and value must remain unchanged, and switching
  // tables must not dispatch an Execute mutation.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const cleanHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const cleanPriceIndex = cleanHeaders.filter((header) => header !== "Row").indexOf("price");
  const cleanPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  const cleanCell = cleanPenRow.locator("td").nth(cleanPriceIndex);
  const cleanEntity = await cleanCell.getAttribute("data-work-entity");
  const cleanOccurrence = await cleanCell.getAttribute("data-work-occurrence");
  const cleanRevision = await cleanCell.getAttribute("data-work-revision");
  const cleanValue = await cleanCell.locator(".ts-cell-value").textContent();
  assert.ok(cleanEntity, "Catalog clean-edit target must expose its entity.");
  await cleanCell.dblclick();
  const cleanEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await cleanEditor.waitFor();
  assert.equal(await cleanEditor.inputValue(), cleanValue, "clean editor must retain the source value");
  const cleanSwitchDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  await tablePicker.selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).count(), 0, "clean editor must clear when leaving its collection");
  const salesGrid = page.locator('table[aria-label="Table"]');
  assert.equal(await salesGrid.locator('td[tabindex="0"]').count(), 1, "a new collection grid must retain exactly one roving tab stop");
  // The table selector retains keyboard focus after selection. Reach the grid
  // by normal Tab navigation, then verify grid navigation with real keys.
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  const salesFirstCell = salesGrid.locator('td[tabindex="0"]');
  assert.equal(await salesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Tab must enter the new grid at its roving tab stop");
  const enteredSalesCellId = await salesFirstCell.getAttribute("data-testid");
  await page.keyboard.press("ArrowRight");
  const arrowSalesCellId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.ok(arrowSalesCellId?.startsWith("cell:"), "Arrow navigation must remain in the new grid");
  assert.notEqual(arrowSalesCellId, enteredSalesCellId, "Arrow navigation must leave the entered Sales cell");
  await page.waitForFunction((testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("tabindex") === "0", arrowSalesCellId);
  await page.keyboard.press("Shift+Tab");
  const tabSalesCellId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.equal(tabSalesCellId, enteredSalesCellId, "Shift+Tab navigation must remain in the Sales grid");
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const returnedCell = page.locator(`td[data-work-entity="${cleanEntity}"]`).nth(cleanPriceIndex);
  await returnedCell.waitFor();
  assert.equal(await returnedCell.getAttribute("data-work-occurrence"), cleanOccurrence, "collection switch must retain occurrence");
  assert.equal(await returnedCell.getAttribute("data-work-revision"), cleanRevision, "collection switch must retain revision");
  assert.equal(await returnedCell.locator(".ts-cell-value").textContent(), cleanValue, "collection switch must retain value");
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).count(), 0, "clean editor must not resurrect on return");
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-testid="cell-editor"]') ?? false), false, "clean editor must not retain focus on return");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), cleanSwitchDispatches, "collection switches must not dispatch Execute");
  await returnedCell.dblclick();
  const retainedEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await retainedEditor.fill("250");
  assert.equal(await tablePicker.isDisabled(), true, "a modified cell draft must block collection switching");
  assert.equal(await retainedEditor.inputValue(), "250", "modified draft must be retained");
  assert.equal(await retainedEditor.evaluate((input) => document.activeElement === input), true, "modified draft must retain focus");
  await retainedEditor.press("Escape");

  // A cleanup preview is tied to its collection. Switching from A to B must
  // remove the old preview and never dispatch its stale commit.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const catalogHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const categoryIndex = catalogHeaders.filter((header) => header !== "Row").indexOf("category");
  assert.ok(categoryIndex >= 0, "Catalog must expose its visible category field.");
  const catalogRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  const catalogCategory = catalogRow.locator("td").nth(categoryIndex);
  await catalogCategory.dblclick();
  const catalogEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await catalogEditor.fill(" PEN ");
  await catalogEditor.press("Enter");
  await catalogEditor.waitFor({ state: "detached" });
  assert.match(await catalogCategory.textContent(), /\sPEN\s/, "Catalog A must contain a real trim candidate before preview");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  const switchedSalesGrid = page.locator('table[aria-label="Table"]');
  const switchedSalesFirstCell = switchedSalesGrid.locator("td").first();
  const switchedSalesFirstId = await switchedSalesFirstCell.getAttribute("data-testid");
  // The last focused Catalog cell is now unmounted. Both close-dialog exits
  // must resolve focus against the live Sales grid instead.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesFirstId);
  assert.equal(await switchedSalesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Escape from unsaved-work must focus the live Sales first cell");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesFirstId);
  assert.equal(await switchedSalesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Keep editing must focus the live Sales first cell");
  await page.keyboard.press("ArrowRight");
  const switchedSalesSecondId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.ok(switchedSalesSecondId?.startsWith("cell:"), "Sales keyboard navigation must remain in the grid");
  assert.notEqual(switchedSalesSecondId, switchedSalesFirstId, "Sales keyboard navigation must focus a non-first cell");
  await tablePicker.selectOption("sales");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null), switchedSalesSecondId, "same-collection selection must preserve current focus");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesSecondId);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null), switchedSalesSecondId, "Keep editing must restore a connected current-grid cell");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.equal(await page.getByTestId("cleanup-preview").count(), 0, "collection switch must clear the A preview");
  const staleCommitDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  assert.equal(await page.getByRole("button", { name: "Commit preview", exact: true }).count(), 0, "stale A commit must not remain actionable");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), staleCommitDispatches, "retained stale cleanup must dispatch zero requests");

  // Fresh B preview/commit targets only the selected sales collection.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Diagnostic source report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const salesRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await salesRow.locator("td").first().dblclick();
  const salesEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await salesEditor.fill(" PEN ");
  await salesEditor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") !== "pending");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "diagnostics are a confirmed Work observation, not an unknown workbook state");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table diagnostics", { exact: true }).waitFor();
  assert.match(await page.getByText("Some results need attention. Correct the source data to update them.", { exact: true }).textContent(), /Some results need attention/);
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "confirmed observation retains its complete definition inventory");
  assert.equal(await page.getByLabel("Cross-table diagnostics", { exact: true }).count(), 1, "the affected result exposes its Work diagnostics");
  assert.equal(await page.getByLabel("Cross-table groups", { exact: true }).count(), 0, "diagnostic results withhold grouped values");
  const diagnosticResult = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) });
  assert.equal(await diagnosticResult.getByLabel("Cross-table groups", { exact: true }).count(), 0, "diagnostic values do not retain the old grouped result");
  assert.equal(await page.getByRole("tab", { name: "Import & export", exact: true }).count(), 1, "confirmed diagnostics keep normal workbook navigation available");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.match(await page.getByText(/This summary needs attention.*Previous chart values are hidden/i).textContent(), /Correct the source data to see the report/);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Diagnostic source report", "diagnostics retain report configuration and draft");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 0, "a diagnostic source never revives its previous chart");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "PNG is withheld for a diagnostic source");
  const copiesBeforeDiagnosticSave = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("diagnostic-source-blocked");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeDiagnosticSave, "the invalid configured report blocks its copy before storage write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Diagnostic source report");
  await page.getByRole("button", { name: "Remove report", exact: true }).click();
  await page.getByText("The report configuration was removed. Table data and the cross-table definition were kept.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  const bTargets = page.getByLabel("Cleanup targets", { exact: true });
  assert.ok(await bTargets.locator("tbody tr").count() > 0, "B preview must expose an explicit target");
  assert.match(await bTargets.textContent(), /product_code/, "B preview target must belong to sales");
  const bCommitDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const bCommit = page.getByRole("button", { name: "Commit preview", exact: true });
  await bCommit.click();
  await bCommit.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), bCommitDispatches + 1, "fresh B cleanup must dispatch once");
  assert.equal(await tablePicker.inputValue(), "sales", "B cleanup must leave the sales collection active");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.locator('table[aria-label="Table"]').waitFor();
  assert.match(await page.locator('table[aria-label="Table"]').textContent(), /PEN/, "B cleanup must retain the normalized sales value");

  // A later definition publication whose projection/read fails is known
  // published but not current. It must remain fail-closed until Refresh
  // re-reads the full inventory, retaining every earlier definition.
  await bindAndCreate(page, { failPostPublicationRead: true });
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.doesNotMatch(await page.locator("body").textContent(), /was not created/i);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-1").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "recovery must retain the first summary after the second publication");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 2, "recovery must retain the first refresh control");

  // A modified cell draft must remain in place when summary creation is
  // attempted. Cancelling it permits the normal create path to continue.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const draftHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const draftPriceIndex = draftHeaders.filter((header) => header !== "Row").indexOf("price");
  const draftPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await draftPenRow.locator("td").nth(draftPriceIndex).dblclick();
  const draftEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await draftEditor.fill("250");
  const blockedCreateDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await chooseBinding(page);
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /Apply or cancel.*before creating a cross-table summary/i);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), blockedCreateDispatches, "draft guard must dispatch zero creates");
  assert.equal(await draftEditor.inputValue(), "250", "draft guard must retain the modified value");
  assert.equal(await draftEditor.evaluate((input) => document.activeElement === input), true, "draft guard must restore editor focus");
  await draftEditor.press("Escape");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-2").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "cancelled drafts must allow normal summary creation");

  // A scalar rejection before publication must restore every current J4
  // result and definition, rather than leaving just one sibling visible.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const priorGroups = await allGroupRows(page);
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const rejectedHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const rejectedPriceIndex = rejectedHeaders.filter((header) => header !== "Row").indexOf("price");
  const rejectedPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await rejectedPenRow.locator("td").nth(rejectedPriceIndex).dblclick();
  const rejectedEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await rejectedEditor.fill("not a number");
  await rejectedEditor.press("Enter");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  await rejectedEditor.press("Escape");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "a known edit rejection must retain every result");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3, "a known edit rejection must retain sibling refresh controls");
  assert.deepEqual(await allGroupRows(page), priorGroups, "a known edit rejection must restore complete prior J4 results");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog must expose its visible price field.");
  const penRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" });
  await penRow.first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  assert.equal(await tablePicker.isDisabled(), true, "a modified cell draft must block collection switching");
  assert.equal(await editor.evaluate((input) => document.activeElement === input), true, "collection guard must retain draft focus");
  await editor.press("Enter");

  // Steward acceptance provenance: #46 comment 5860466401 amends the
  // ordinary confirmed scalar-edit oracle to automatic complete re-query.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-2").getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByTestId("currentness").filter({ hasText: "Up to date" }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "all known summary definitions must be re-queried");
  for (const result of await page.locator('[data-testid^="j4-result-"]').all()) {
    const values = (await groupRows(result.getByLabel("Cross-table groups", { exact: true }))).join(" ");
    assert.match(values, /NOTE: 1000/);
    assert.match(values, /PEN: 1000/);
  }
  assert.equal(await page.getByRole("button", { name: /Refresh cross-table summary/ }).count(), 0, "the ordinary edit path must not need manual Refresh");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3);

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-restart");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();

  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j4-restart", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-0").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 1000/);

  // Steward acceptance provenance: #46 comment 5860466401 requires the
  // second-definition failure witness after a confirmed scalar publication.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await bindAndCreate(page, { productCategory: "code" });
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "fault witness starts with two real definitions");
  await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Second query recovery report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const failureHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const failurePriceIndex = failureHeaders.filter((header) => header !== "Row").indexOf("price");
  const failurePenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await failurePenRow.locator("td").nth(failurePriceIndex).dblclick();
  const failureEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await failureEditor.fill("250");
  const executeBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const copiesBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  const exportsBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(() => {
    window.__tachikoAcceptance.failSecondScalarRequeryReplyAfterFirst();
    window.__tachikoAcceptance.deferSecondScalarRequeryReply();
  });
  await failureEditor.press("Enter");
  await page.waitForFunction(() => window.__tachikoAcceptance.scalarRequeryFaultProbe().invokedDefinitionIds.length === 2);
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "pending");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Updating…");
  const pendingSnapshotStatus = page.getByText("Updating… — showing previous results.", { exact: true });
  assert.equal(await pendingSnapshotStatus.isVisible(), true, "the pending previous-snapshot status stays visible across workbook tabs");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isDisabled(), true, "Save is withheld while grouped results are pending");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("heading", { name: "Previous grouped result", exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 800/);
  assert.equal(await page.getByRole("button", { name: "Create bar report", exact: true }).first().isDisabled(), true, "report creation is withheld while grouped results are pending");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByText("Updating… — the report is unavailable until previous results are confirmed.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0, "the old report is not exposed as current while pending");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "PNG is withheld while the report source is pending");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeFault, "pending re-query dispatches no copy write");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeFault, "pending re-query dispatches no semantic export");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "pending re-query does not retry the published scalar edit");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.releaseSecondScalarRequeryReply());
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.match(await page.locator("body").textContent(), /change was published/i);
  assert.doesNotMatch(await page.locator("body").textContent(), /change was not applied/i);
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "the successful first query must not be partially installed");
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0, "recovery withholds the prior report as current");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "recovery withholds PNG");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0, "recovery withholds Save");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeFault, "recovery dispatches no copy write");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeFault, "recovery dispatches no semantic export");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "published edit is never retried after query failure");
  const queryFault = await page.evaluate(() => window.__tachikoAcceptance.scalarRequeryFaultProbe());
  assert.equal(queryFault.publicationAcknowledged, true, "fault is armed only after a real scalar publication acknowledgement");
  assert.equal(queryFault.invokedDefinitionIds.length, 2, "the first query returns before the second real query fails");
  assert.notEqual(queryFault.invokedDefinitionIds[0], queryFault.invokedDefinitionIds[1]);
  assert.equal(queryFault.discardedDefinitionId, queryFault.invokedDefinitionIds[1], "the second real query reply is the discarded reply");

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "one explicit Refresh re-observes the complete definition set");
  const recoveredGroups = await allGroupRows(page);
  assert.ok(recoveredGroups.every((rows) => /NOTE: 1000/.test(rows.join(" ")) && /PEN: 1000/.test(rows.join(" "))));
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const recoveredReport = page.getByLabel("Current report data", { exact: true });
  await recoveredReport.waitFor();
  assert.match(await recoveredReport.textContent(), /PEN\s*1000/);
  assert.match(await recoveredReport.textContent(), /NOTE\s*1000/);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Second query recovery report", "report configuration and presentation draft survive recovery");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "Refresh observes; it does not replay the semantic edit");
  await page.evaluate(() => window.__tachikoAcceptance.resetScalarRequeryFaultProbe());
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.scalarRequeryFaultProbe()), {
    publicationAcknowledged: false,
    invokedDefinitionIds: [],
    discardedDefinitionId: null,
  }, "the one-shot query fault and evidence reset deterministically");
} finally {
  if (context) {
    const cleanupPage = context.pages()[0];
    await cleanupPage?.evaluate(() => window.__tachikoAcceptance?.releaseSecondScalarRequeryReply()).catch(() => {});
    await context.close().catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
}

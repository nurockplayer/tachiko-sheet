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

async function chooseBinding(page, {
  ordersTable = "sales", orderLookupKey = "product_code", orderQuantity = "quantity",
  productsTable = "catalog", productKey = "code", productCategory = "category", productPrice = "price",
} = {}) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption(ordersTable);
  await page.getByLabel("Order lookup key", { exact: true }).selectOption(orderLookupKey);
  await page.getByLabel("Order quantity", { exact: true }).selectOption(orderQuantity);
  await page.getByLabel("Products table", { exact: true }).selectOption(productsTable);
  await page.getByLabel("Product key", { exact: true }).selectOption(productKey);
  await page.getByLabel("Product category", { exact: true }).selectOption(productCategory);
  await page.getByLabel("Product price", { exact: true }).selectOption(productPrice);
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
  assert.match(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).textContent(), /Some results need attention/);
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
  const scalarWitnessBeforeEdit = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  const exportsBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(() => {
    window.__tachikoAcceptance.failSecondScalarRequeryReplyAfterFirst();
    window.__tachikoAcceptance.deferSecondScalarRequeryReply();
  });
  await failureEditor.press("Enter");
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.scalarRequeryFaultProbe();
    return probe.invokedDefinitionIds.length === 2 && probe.secondReplyHeld;
  });
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
  assert.equal(typeof queryFault.attemptId, "number", "the scalar witness belongs to one immutable attempt");
  assert.equal(typeof queryFault.clientIdentity, "number", "the scalar witness identifies its owning public client");
  assert.equal(queryFault.occurrence, scalarWitnessBeforeEdit.occurrence, "the publication remains on the observed Work occurrence");
  assert.equal(typeof queryFault.publicationCallId, "number", "the attempt records its real publication dispatch");
  assert.equal(queryFault.suppliedWitness.occurrence, queryFault.occurrence);
  assert.equal(queryFault.suppliedWitness.revision, queryFault.revision, "discovery uses the acknowledged result revision");
  assert.equal(typeof queryFault.discoveryInvocationId, "number", "the attempt records the exact discovery invocation");
  assert.equal(queryFault.queryCallIds.length, 2, "both real query dispatches are captured by this attempt");
  assert.notEqual(queryFault.queryCallIds[0], queryFault.queryCallIds[1]);
  assert.equal(queryFault.invokedDefinitionIds.length, 2, "the first query returns before the second real query fails");
  assert.equal(queryFault.secondReplyHeld, false, "the deterministic second-reply hold has been released");
  assert.notEqual(queryFault.invokedDefinitionIds[0], queryFault.invokedDefinitionIds[1]);
  assert.equal(queryFault.discardedDefinitionId, queryFault.invokedDefinitionIds[1], "the second real query reply is the discarded reply");
  console.log(JSON.stringify({
    case: "steward-46-scalar-requery-fault-attribution",
    attemptId: queryFault.attemptId,
    clientIdentity: queryFault.clientIdentity,
    occurrence: queryFault.occurrence,
    publicationCallId: queryFault.publicationCallId,
    resultRevision: queryFault.revision,
    discoveryInvocationId: queryFault.discoveryInvocationId,
    suppliedWitness: queryFault.suppliedWitness,
    actualQueryCallIds: queryFault.queryCallIds,
    actualDefinitionIds: queryFault.invokedDefinitionIds,
    discardedDefinitionId: queryFault.discardedDefinitionId,
  }));

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
    attemptId: null,
    publicationAcknowledged: false,
    clientIdentity: null,
    occurrence: null,
    publicationCallId: null,
    revision: null,
    discoveryInvocationId: null,
    suppliedWitness: null,
    queryCallIds: [],
    invokedDefinitionIds: [],
    discardedDefinitionId: null,
    secondReplyHeld: false,
    invalidReason: null,
  }, "the one-shot query fault and evidence reset deterministically");

  // On the unchanged pinned core, the normal UI admits the exact self-binding
  // Orders catalog/code/price -> Products catalog/code/code/price. Pair it
  // with Sales/product_code so its diagnostic leaves a real valid sibling.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await chooseBinding(page, {
    ordersTable: "catalog", orderLookupKey: "code", orderQuantity: "price",
    productsTable: "catalog", productKey: "code", productCategory: "code", productPrice: "price",
  });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-1").getByLabel("Cross-table groups", { exact: true }).waitFor();
  const twoDefinitions = await page.locator('[data-testid^="j4-result-"]').count();
  assert.equal(twoDefinitions, 2, "both summaries are created through the visible binding controls");
  const salesBackedResult = page.locator('[data-testid^="j4-result-"]').filter({ hasText: /PEN\s*800/ });
  assert.equal(await salesBackedResult.count(), 1, "the Sales-backed definition is identified by its real grouped output");
  await salesBackedResult.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Catalog sibling report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  const siblingSales = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await siblingSales.locator("td").first().dblclick();
  const siblingEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await siblingEditor.fill(" PEN ");
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await siblingEditor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  const diagnosticDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(diagnosticDefinitionIds.length, 2, "both actual Work definitions are re-queried after publication");
  assert.notEqual(diagnosticDefinitionIds[0], diagnosticDefinitionIds[1], "the automatic re-query addresses two distinct definition IDs");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const diagnosticDefinition = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) });
  const validSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  await diagnosticDefinition.waitFor();
  await validSibling.waitFor();
  assert.equal(await diagnosticDefinition.count(), 1, "Sales-backed definition A keeps its source diagnostics");
  assert.equal(await validSibling.count(), 1, "Catalog self-binding definition B retains its genuine grouped result");
  const selfBindingRows = await groupRows(validSibling.getByLabel("Cross-table groups", { exact: true }));
  assert.deepEqual(selfBindingRows, ["NOTE: 250000", "PEN: 40000"], "the sibling shows actual Catalog-to-Catalog Work values");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");

  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  const blockedSiblingCopies = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-diagnostic-sibling");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), blockedSiblingCopies, "a diagnostic report source blocks Save before the storage write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Remove report", exact: true }).click();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-diagnostic-sibling");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal((await page.getByTestId("save-status").textContent())?.includes("Saved on this device"), true, "without an invalid report dependency, Save succeeds with the confirmed results");

  await context.close();
  context = undefined;
  page = await start();
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: "Open saved j4-diagnostic-sibling", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const reopenedDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(reopenedDefinitionIds.length, 2, "reopen re-queries both saved real definition IDs");
  assert.notEqual(reopenedDefinitionIds[0], reopenedDefinitionIds[1]);
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention", "saved truth retains diagnostic attention");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const reopenedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await reopenedSibling.count(), 1, "fresh reopen retains the unaffected sibling result");
  assert.match(await reopenedSibling.textContent(), /NOTE/);
  assert.match(await reopenedSibling.textContent(), /PEN/);
  assert.deepEqual(await groupRows(reopenedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"], "fresh reopen re-queries the stored binding through Work");

  // A later scalar edit starts with a prior diagnostic plus a genuine sibling.
  // While the second real query is held, neither snapshot may be labeled current.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const pendingHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const pendingPriceIndex = pendingHeaders.filter((header) => header !== "Row").indexOf("price");
  const pendingPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await pendingPenRow.locator("td").nth(pendingPriceIndex).dblclick();
  const pendingEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await pendingEditor.fill("250");
  const pendingExecuteCount = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const pendingCopyWrites = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  const pendingExports = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(() => {
    window.__tachikoAcceptance.failSecondScalarRequeryReplyAfterFirst();
    window.__tachikoAcceptance.deferSecondScalarRequeryReply();
  });
  await pendingEditor.press("Enter");
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.scalarRequeryFaultProbe();
    return probe.invokedDefinitionIds.length === 2 && probe.secondReplyHeld;
  });
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "pending");
  assert.equal(await page.getByText("Updating… — showing previous results.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isDisabled(), true);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("heading", { name: "Previous grouped result", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const previousSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await previousSibling.count(), 1);
  assert.equal(await previousSibling.locator(".ts-content-meta").textContent().then((text) => text?.startsWith("Previous result") ?? false), true, "a valid sibling snapshot is labeled previous while pending");
  assert.equal(await page.getByText("This previous result has source issues. Its values are hidden while results update.", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).count(), 0, "the neutral attention notice is withheld while results are pending");
  const pendingCreateButtons = page.getByRole("button", { name: "Create bar report", exact: true });
  assert.equal(await pendingCreateButtons.count(), 1, "the result with no grouped values offers no report creation");
  for (const button of await pendingCreateButtons.all()) assert.equal(await button.isDisabled(), true);
  const pendingRefreshButtons = page.getByRole("button", { name: "Refresh core result", exact: true });
  assert.equal(await pendingRefreshButtons.count(), 2);
  for (const button of await pendingRefreshButtons.all()) assert.equal(await button.isDisabled(), true);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), pendingCopyWrites);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), pendingExports);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1, "a held re-query never retries the scalar edit");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.releaseSecondScalarRequeryReply());
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "failed sibling refresh installs no partial query set");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), pendingCopyWrites);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), pendingExports);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const refreshedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await refreshedSibling.count(), 1);
  assert.deepEqual(await groupRows(refreshedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 62500"], "explicit Refresh observes the scalar edit through Work");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1, "Refresh re-observes without replaying the published edit");

  // Steward amendment #46 comment 5860466401 clause 8: a known targeted
  // query failure must remove only that definition and preserve its sibling.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => window.__tachikoAcceptance.queryDefinitionIds().length === 1);
  const firstDefinitionQueryIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(firstDefinitionQueryIds.length, 1, "the first real definition ID is captured after its real Work query");
  const targetId = firstDefinitionQueryIds[0];
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const initialA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  assert.equal(await initialA.count(), 1, "A is identified by its distinct real Sales groups");
  await initialA.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Targeted recovery report");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await chooseBinding(page, {
    ordersTable: "catalog", orderLookupKey: "code", orderQuantity: "price",
    productsTable: "catalog", productKey: "code", productCategory: "code", productPrice: "price",
  });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.locator('[data-testid^="j4-result-"]').filter({ hasText: /PEN\s*40000/ }).getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2);
  const targetDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(targetDefinitionIds.length, 2, "creation of B re-queries both definitions through real Work");
  assert.ok(targetDefinitionIds.includes(targetId), "the original A definition ID remains in the real definition set");
  assert.notEqual(targetDefinitionIds[0], targetDefinitionIds[1]);
  const targetIndex = targetDefinitionIds.indexOf(targetId);
  assert.notEqual(targetIndex, -1);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const currentA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  const currentB = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*40000/ });
  assert.equal(await currentA.count(), 1, "A is selected by its distinct real Sales groups");
  assert.equal(await currentB.count(), 1, "B is selected by its distinct real Catalog groups");
  assert.deepEqual(await groupRows(currentA.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await groupRows(currentB.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 1, "A's current report chart is available before the fault");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 1, "A's current PNG is available before the fault");
  const beforeTargetedFailure = await page.evaluate(() => ({
    execute: window.__tachikoAcceptance.executeRequestCount(),
    copies: window.__tachikoAcceptance.copyWriteDispatchCounts(),
  }));
  const targetSnapshot = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  const exportsBeforeTargetedRefresh = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(({ definitionId, occurrence, revision }) =>
    window.__tachikoAcceptance.armTargetedQueryReplyFault(definitionId, occurrence, revision),
  { definitionId: targetId, occurrence: targetSnapshot.occurrence, revision: targetSnapshot.revision });
  const armedTargetProbe = await page.evaluate(() => window.__tachikoAcceptance.targetedQueryFaultProbe());
  assert.equal(armedTargetProbe.armed, true);
  assert.equal(armedTargetProbe.definitionId, targetId);
  assert.equal(armedTargetProbe.occurrence, targetSnapshot.occurrence);
  assert.equal(armedTargetProbe.revision, targetSnapshot.revision);
  assert.equal(typeof armedTargetProbe.owningClientIdentity, "number");
  assert.equal(armedTargetProbe.actualReplyRevision, null);
  assert.equal(armedTargetProbe.consumed, false);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await currentA.getByRole("button", { name: "Refresh core result", exact: true }).click();
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.targetedQueryFaultProbe();
    return !probe.armed && document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current";
  });
  const targetedFaultEvidence = await page.evaluate(() => window.__tachikoAcceptance.targetedQueryFaultProbe());
  assert.equal(targetedFaultEvidence.consumed, true, `one matching real target reply is discarded: ${JSON.stringify(targetedFaultEvidence)}`);
  assert.equal(targetedFaultEvidence.definitionId, targetId);
  assert.equal(targetedFaultEvidence.occurrence, targetSnapshot.occurrence);
  assert.equal(targetedFaultEvidence.revision, targetSnapshot.revision);
  assert.equal(targetedFaultEvidence.actualReplyRevision, targetSnapshot.revision, "the discarded reply came from real Work at the armed revision");
  assert.equal(typeof targetedFaultEvidence.owningClientIdentity, "number");
  assert.equal(targetedFaultEvidence.consumed, true, "the one-shot target was consumed exactly once");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "the workbook remains current after this known targeted failure");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");
  assert.equal(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).isVisible(), true, "a read failure uses neutral attention guidance");
  assert.equal(await page.getByText("Some results need attention. Correct the source data to update them.", { exact: true }).count(), 0, "a read failure does not claim the source data changed");
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "only targeted A is withdrawn");
  const preservedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await preservedSibling.count(), 1);
  assert.equal(await preservedSibling.locator(".ts-content-meta").textContent().then((text) => text?.startsWith("Current result") ?? false), true);
  assert.deepEqual(await groupRows(preservedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  assert.equal(await page.getByText("This summary has no confirmed current result. Refresh it to try again.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: `Refresh cross-table summary ${targetIndex + 1}`, exact: true }).count(), 1, "A keeps a targeted recovery control");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), beforeTargetedFailure.execute, "the targeted query failure dispatches no semantic operation");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeTargetedRefresh, "the targeted query failure dispatches no exports");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report", "A report draft is retained while its source result is missing");
  assert.equal(await page.getByText("This summary has no confirmed current result. Refresh it to try again. Previous chart values are hidden.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/Correct the source data to see the report/i).count(), 0, "the read failure does not show diagnostic source-correction guidance");
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  const beforeDependentSave = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("targeted-failure-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), beforeDependentSave, "the report dependency blocks Save before a copy write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: `Refresh cross-table summary ${targetIndex + 1}`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.textContent?.trim() === "Up to date");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "ordinary targeted Refresh restores both results");
  const recoveredA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  const recoveredB = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*40000/ });
  assert.equal(await recoveredA.count(), 1);
  assert.equal(await recoveredB.count(), 1);
  assert.deepEqual(await groupRows(recoveredA.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await groupRows(recoveredB.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 1, "A's chart returns after the real targeted query");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 1, "A's PNG returns after the real targeted query");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), beforeTargetedFailure.execute, "targeted failure and recovery do not replay a semantic operation");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), {
    canonical: exportsBeforeTargetedRefresh.canonical,
    opaque: exportsBeforeTargetedRefresh.opaque + 1,
  }, "only the blocked Save's prerequisite snapshot export occurs; targeted failure and recovery dispatch none");
  console.log(JSON.stringify({
    case: "steward-46-clause-8-targeted-refresh",
    actualDefinitionIds: { a: targetId, afterB: targetDefinitionIds },
    actualWitness: { occurrence: targetSnapshot.occurrence, revision: targetSnapshot.revision },
    actualFault: targetedFaultEvidence,
    recoveredValues: { a: ["NOTE: 1000", "PEN: 800"], b: ["NOTE: 250000", "PEN: 40000"] },
  }));
  await page.evaluate(() => window.__tachikoAcceptance.resetTargetedQueryReplyFault());
} finally {
  if (context) {
    const cleanupPage = context.pages()[0];
    await cleanupPage?.evaluate(() => window.__tachikoAcceptance?.releaseSecondScalarRequeryReply()).catch(() => {});
    await cleanupPage?.evaluate(() => window.__tachikoAcceptance?.resetTargetedQueryReplyFault()).catch(() => {});
    await context.close().catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
}

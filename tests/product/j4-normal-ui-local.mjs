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

async function chooseBinding(page, { orderQuantity = "quantity" } = {}) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption(orderQuantity);
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption("category");
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
}

async function bindAndCreate(page, { failPostPublicationRead = false } = {}) {
  await chooseBinding(page);
  if (failPostPublicationRead) await page.evaluate(() => window.__tachikoAcceptance.failNextJ4PostPublicationRead());
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  if (!failPostPublicationRead) {
    await page.locator('[data-testid^="j4-result-"]').last().getByLabel("Cross-table groups", { exact: true }).waitFor();
  }
}

async function groupText(page) {
  return (await page.getByTestId("j4-result-0").getByLabel("Cross-table groups", { exact: true }).textContent())
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ": ")
    .trim();
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
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const salesRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await salesRow.locator("td").first().dblclick();
  const salesEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await salesEditor.fill(" PEN ");
  await salesEditor.press("Enter");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  const bTargets = page.getByLabel("Cleanup targets", { exact: true });
  assert.ok(await bTargets.locator("li").count() > 0, "B preview must expose an explicit target");
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
  const priorGroups = await page.getByLabel("Cross-table groups", { exact: true }).allTextContents();
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
  assert.deepEqual(await page.getByLabel("Cross-table groups", { exact: true }).allTextContents(), priorGroups, "a known edit rejection must restore complete prior J4 results");
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

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByText("Source data changed, so the previous result is not current.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 1000/);
  assert.equal(await page.getByRole("button", { name: "Refresh cross-table summary 2", exact: true }).count(), 1);
  const refreshSummary2 = page.getByRole("button", { name: "Refresh cross-table summary 2", exact: true });
  await refreshSummary2.click();
  await refreshSummary2.waitFor({ state: "detached" });
  const refreshSummary3 = page.getByRole("button", { name: "Refresh cross-table summary 3", exact: true });
  await refreshSummary3.click();
  await refreshSummary3.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Refresh cross-table summary 2", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Refresh cross-table summary 3", exact: true }).count(), 0);
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
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}

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
  return page;
}

async function openCanary(page) {
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
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

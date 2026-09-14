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

async function bindAndCreate(page, { failPostPublicationRead = false } = {}) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("quantity");
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption("category");
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
  if (failPostPublicationRead) await page.evaluate(() => window.__tachikoAcceptance.failNextJ4PostPublicationRead());
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  if (!failPostPublicationRead) await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
}

async function groupText(page) {
  return (await page.getByLabel("Cross-table groups", { exact: true }).textContent()).replace(/\s+/g, " ").trim();
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

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog must expose its visible price field.");
  const penRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" });
  await penRow.first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  await editor.press("Enter");

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByText("Source data changed, so the previous result is not current.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 1000/);

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
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 1000/);
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}

// Real built-product J5 journey. Report values are observed only through the
// current core J4 result; the test never supplies a client-side total.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-j5-product-"));
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
let context;

async function start() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(LOCAL_ORIGIN);
  return page;
}

async function bindSummary(page) {
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("quantity");
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption("category");
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
}

async function editPenPrice(page) {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0);
  await page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  await editor.press("Enter");
}

try {
  let page = await start();
  await bindSummary(page);
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  let reportData = page.getByLabel("Current report data", { exact: true });
  await reportData.waitFor();
  assert.match(await reportData.textContent(), /PEN\s*800/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);
  await page.getByLabel("Title", { exact: true }).fill("Current sales report");
  await page.getByLabel("Show legend", { exact: true }).uncheck();

  await editPenPrice(page);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByText("This report source is not current. Refresh the cross-table summary before viewing or sharing it, or remove this report configuration before saving.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Remove report", exact: true }).click();
  await page.getByText("The report configuration was removed. Table data and the cross-table definition were kept.", { exact: true }).waitFor();
  await page.getByText("Create a bar or line report from a current cross-table result.", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-stale-report-removed");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j5-stale-report-removed", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByText("Create a bar or line report from a current cross-table result.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const refreshMissingSummary = page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true });
  if (await refreshMissingSummary.count()) await refreshMissingSummary.click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create line report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  reportData = page.getByLabel("Current report data", { exact: true });
  await reportData.waitFor();
  assert.match(await reportData.textContent(), /PEN\s*1000/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current PNG", exact: true }).click();
  const download = await downloadPromise;
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const base64 = png.toString("base64");
  assert.equal(await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return valid;
  }, base64), true);

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j5-report", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  reportData = page.getByLabel("Current report data", { exact: true });
  assert.ok(await reportData.count(), await page.locator("body").textContent());
  assert.match(await reportData.textContent(), /PEN\s*1000/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}

// #133: imported data stays recognizable through the normal Home import path.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const messyCsv = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.csv");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };

const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext();
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(messyCsv);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.waitFor();

  const preview = dialog.getByRole("table", { name: /^First rows of / });
  assert.deepEqual(await preview.locator("thead th").allTextContents(), ["item", "quantity", "price"]);
  assert.deepEqual(
    await preview.locator("tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.cells, (cell) => cell.textContent))),
    [[" PEN ", "3", "200"], ["NOTE", "2", "500"], [" PEN ", "3", "200"]],
    "the review shows the user's actual first rows, whitespace included",
  );
  const types = dialog.locator("select");
  assert.deepEqual(await types.evaluateAll((selects) => selects.map((select) => select.value)), ["text", "number", "number"],
    "plain numeric columns are suggested as Number; other text stays Text");
  assert.equal(await dialog.getByText("Number suggested from its values").count(), 2);

  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await page.locator("h1.ts-title").textContent(), "messy.csv", "the work is named after the file");
  assert.equal(await page.locator("#ts-active-table option:checked").textContent(), "messy", "the table is named after the file");
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  assert.deepEqual(await grid.locator("thead th").allTextContents(), ["Row", "item", "quantity", "price"], "the grid uses source headers");
  await context.close();
  console.log(JSON.stringify({ case: "#133 recognizable CSV import: preview, suggestions, names", status: "PASS" }));
} finally {
  await browser.close();
}

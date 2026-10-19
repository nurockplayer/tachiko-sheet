// #133: imported data stays recognizable through the normal Home import path.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { launchIsolatedBrowser } from "./isolated-browser.mjs";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const messyCsv = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.csv");
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };

const browser = await launchIsolatedBrowser(chromium, launchOptions);
try {
  const context = await browser.newContext();
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(messyCsv);
  const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await dialog.waitFor();

  const preview = dialog.getByRole("table", { name: /^First rows of / });
  assert.deepEqual(await preview.locator("thead th").allTextContents(), ["item", "quantity", "price"]);
  assert.deepEqual(
    await preview.locator("tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.cells, (cell) => cell.textContent))),
    [[" PEN ", "3", "200"], ["NOTE", "2", "500"], [" PEN ", "3", "200"]],
    "the review shows the user's actual first rows, whitespace included",
  );
  assert.equal(await preview.locator("tbody td").first().evaluate((cell) => getComputedStyle(cell).whiteSpace), "pre", "leading/trailing spaces stay visible");
  const types = dialog.locator("select");
  assert.deepEqual(await types.evaluateAll((selects) => selects.map((select) => select.value)), ["text", "number", "number"],
    "plain numeric columns are suggested as Number; other text stays Text");
  assert.equal(await dialog.getByText("Number suggested from its values").count(), 2);
  // Notes that only confirm faithful reading are tucked away, not shown as warnings.
  assert.equal(await dialog.getByText(/Numbers are not guessed from regional formatting/).isVisible(), false);
  assert.equal(await dialog.getByText("Nothing in this file needs your attention before import.").isVisible(), true);
  const details = dialog.locator("summary", { hasText: /^Import details \(\d+\)$/ });
  await details.click();
  assert.equal(await dialog.getByText(/Numbers are not guessed from regional formatting/).isVisible(), true);
  // The disclosure is part of the modal focus trap in both directions.
  for (const key of ["Tab", "Shift+Tab"]) {
    await details.focus();
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate((root) => root.contains(document.activeElement)), true, `${key} stays inside the import review`);
    }
  }

  await dialog.getByRole("button", { name: "Import file", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await page.locator("h1.ts-title").textContent(), "messy.csv", "the work is named after the file");
  assert.equal(await page.locator("#ts-active-table option:checked").textContent(), "messy", "the table is named after the file");
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  assert.deepEqual(await grid.locator("thead th").allTextContents(), ["Row", "item", "quantity", "price"], "the grid uses source headers");
  await context.close();

  // Large lossless numeric columns still suggest Number; the user confirms.
  const work = await mkdtemp(path.join(tmpdir(), "tachiko-recognizable-"));
  try {
    const large = path.join(work, "orders-65.csv");
    await writeFile(large, ["item,qty,price", ...Array.from({ length: 65 }, (_, index) => `item ${index},${index + 1},${(index + 1) * 10}`)].join("\r\n") + "\r\n");
    const largeContext = await browser.newContext();
    await installDistRoutes(largeContext, dist);
    const largePage = await largeContext.newPage();
    largePage.setDefaultTimeout(15_000);
    await largePage.goto(LOCAL_ORIGIN);
    await waitForColdHome(largePage);
    await (await homeImportInput(largePage)).setInputFiles(large);
    const largeDialog = largePage.getByRole("dialog", { name: "Review import preview", exact: true });
    await largeDialog.waitFor();
    assert.deepEqual(await largeDialog.locator("select").evaluateAll((selects) => selects.map((select) => select.value)), ["text", "number", "number"]);
    assert.equal(await largeDialog.getByText("First 5 of 65 rows").count(), 1);
    await largeDialog.getByRole("button", { name: "Import file", exact: true }).click();
    await largePage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    assert.equal(await largePage.locator("h1.ts-title").textContent(), "orders-65.csv");
    await largeContext.close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ case: "#133 recognizable CSV import: preview, suggestions, names, 65-row mixed types", status: "PASS" }));
} finally {
  await browser.close();
}

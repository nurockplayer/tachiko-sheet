// Row-windowing edge cases on a real imported table larger than the window
// threshold, through the normal UI:
// a draft kept while scrolling away, density change geometry, Undo while the
// Table panel is hidden, and the last rows.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const UNIQUE = 260;
const DUPLICATES = 60;
const work = await mkdtemp(path.join(tmpdir(), "tachiko-grid-window-"));
const csv = path.join(work, "dupes.csv");
// Above 64 rows the pinned kit admits one headered three-Text-column table.
const rows = Array.from({ length: UNIQUE }, (_, index) => `item-${String(index).padStart(3, "0")},note ${index},code-${index}`);
await writeFile(csv, ["name,note,code", ...rows, ...rows.slice(0, DUPLICATES)].join("\r\n") + "\r\n");

const grid = (page) => page.getByRole("grid", { name: "Table", exact: true });
const rowAt = (page, row) => grid(page).locator(`tbody tr[aria-rowindex="${row + 2}"]`);
const scrollTo = (page, row) => page.evaluate((index) => {
  const scroller = document.querySelector(".ts-grid-scroll");
  const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row')?.offsetHeight || 32;
  scroller.scrollTop = Math.max(0, index * pitch - scroller.clientHeight / 2);
}, row);
const geometry = (page) => page.evaluate(() => {
  const table = document.querySelector('table[aria-label="Table"]');
  const pitch = table.querySelector("tbody tr.ts-row").offsetHeight;
  const body = table.querySelector("tbody").offsetHeight;
  return { pitch, body, rows: Number(table.getAttribute("aria-rowcount")) - 1 };
});
const pageErrors = [];

const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext();
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(csv);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.or(page.getByRole("alert")).first().waitFor();
  assert.equal(await dialog.count(), 1, `import review opens: ${(await page.getByRole("alert").allTextContents()).join(" ")}`);
  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal((await geometry(page)).rows, UNIQUE + DUPLICATES);

  // A live draft survives scrolling far away and back.
  await rowAt(page, 5).locator("td").nth(1).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("kept while scrolling");
  await scrollTo(page, UNIQUE + DUPLICATES - 1);
  await rowAt(page, UNIQUE + DUPLICATES - 1).waitFor();
  await scrollTo(page, 0);
  await rowAt(page, 0).waitFor();
  assert.equal(await editor.inputValue(), "kept while scrolling");
  await editor.press("Escape");

  // Spacer geometry follows a density change: every row keeps one pitch.
  for (const density of ["Compact", "Comfortable"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.locator(".ts-appearance-density-option").filter({ hasText: density }).click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="Table"]');
      const pitch = table.querySelector("tbody tr.ts-row").offsetHeight;
      return Math.abs(table.querySelector("tbody").offsetHeight - pitch * (Number(table.getAttribute("aria-rowcount")) - 1)) <= 2;
    });
  }

  // Undo while the Table panel is hidden falls back to the initiating control
  // and never later steals focus when Table returns.
  await scrollTo(page, UNIQUE - 10);
  const far = rowAt(page, UNIQUE - 10).locator("td").nth(1);
  await far.dblclick();
  await editor.fill("undo me");
  await editor.press("Enter");
  await editor.waitFor({ state: "hidden" });
  await scrollTo(page, 0);
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  await page.waitForTimeout(300);
  assert.equal(await undo.evaluate((node) => node === document.activeElement || node.disabled), true, "hidden-table Undo keeps focus on its own control");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab"), true, "returning to Table does not replay an old focus request");

  // Large (capacity) tables are a single sheet and refuse deduplication in
  // this kit, so a windowed table cannot shrink or switch through the UI
  // today; the stale-window clamp is covered by grid-window unit tests.
  await scrollTo(page, UNIQUE + DUPLICATES - 1);
  await rowAt(page, UNIQUE + DUPLICATES - 1).waitFor();
  assert.equal(await rowAt(page, UNIQUE + DUPLICATES - 1).locator("td").first().textContent(), `item-${String(DUPLICATES - 1).padStart(3, "0")}`);
  assert.deepEqual(pageErrors, [], "no render errors");
  await context.close();
  console.log(JSON.stringify({ case: "grid window: draft scroll, density, hidden-table undo, bottom rows", status: "PASS" }));
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}

// #182: ordinary Sales edits/history must redraw the real MiniBarChart.
// Defaults to the production build; no acceptance hooks or result mocks.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist");
const url = process.env.WORK_CLIENT_URL ?? LOCAL_ORIGIN;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const stages = [];
let previousRegion;
try {
  if (!process.env.WORK_CLIENT_URL) await installDistRoutes(context, dist);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await waitForColdHome(page);
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const card = page.getByTestId("results-pane").locator(".ts-result-card");
  const region = card.locator(".ts-mini-chart-region");

  async function assertChart(penValue, stage) {
    await page.waitForFunction((expected) => {
      const card = document.querySelector('.ts-results-pane .ts-result-card');
      const rows = Array.from(card?.querySelectorAll("tbody tr") ?? []);
      return document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current"
        && card?.querySelector(".ts-result-status")?.textContent?.includes("Up to date")
        && rows.some((row) => row.cells[0]?.textContent === "PEN" && row.cells[1]?.textContent === String(expected));
    }, penValue);
    assert.deepEqual(await card.locator("tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.cells, (cell) => cell.textContent))),
      [["NOTE", "1000"], ["PEN", String(penValue)]], `${stage}: authoritative current values`);
    const svg = card.locator("svg.ts-mini-chart");
    await svg.waitFor({ state: "visible" });
    assert.equal(await card.getAttribute("data-result-state"), "A", `${stage}: chart fits`);
    assert.equal(await card.locator(".ts-result-deferred").count(), 0, `${stage}: no deferral`);
    const bars = await svg.locator("g").evaluateAll((groups) => groups.map((group) => ({
      category: group.querySelector(".ts-mini-chart-category")?.textContent,
      value: group.querySelector(".ts-mini-chart-value")?.textContent,
      height: Number(group.querySelector("rect")?.getAttribute("height")),
    })));
    assert.deepEqual(bars.map(({ category, value }) => [category, value]), [["NOTE", "1000"], ["PEN", String(penValue)]], `${stage}: SVG labels updated`);
    for (const [index, value] of [1000, penValue].entries()) {
      assert.ok(Math.abs(bars[index].height - 100 * value / Math.max(1000, penValue)) < 0.001, `${stage}: bar height represents ${value}`);
    }
    stages.push({ stage, penValue, width: (await region.boundingBox()).width, bars });
  }

  async function assertNarrowRecovery(penValue, stage) {
    // Constrain only layout, below the real two-slot minimum (24 + 2 * 32).
    // Neither data nor chart-fit logic is replaced.
    await region.evaluate((node) => { node.style.width = "72px"; });
    await card.locator(".ts-result-deferred").waitFor({ state: "visible" });
    assert.equal((await region.boundingBox()).width, 72);
    assert.equal(await card.getAttribute("data-result-state"), "H");
    assert.equal(await card.locator("svg.ts-mini-chart").count(), 0);
    assert.equal(await card.locator(".ts-result-deferred").textContent(), "The chart is shown in Report.");
    stages.push({ stage: `${stage}: genuine narrow deferral`, width: 72 });
    await region.evaluate((node) => { node.style.removeProperty("width"); });
    await assertChart(penValue, `${stage}: widened`);
  }
  await assertChart(800, "initial");
  await assertNarrowRecovery(800, "initial");

  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const headers = await grid.locator('th[scope="col"]').allTextContents();
  const priceIndex = headers.indexOf("price") - 1;
  assert.ok(priceIndex >= 0, "Sales catalog exposes the price column");
  const penPrice = grid.locator("tbody tr").filter({ hasText: "PEN" }).locator("td").nth(priceIndex);
  assert.equal(await penPrice.locator(".ts-cell-value").textContent(), "200");
  async function edit(value) {
    await penPrice.dblclick();
    const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
    await editor.fill(String(value));
    await editor.press("Enter");
    await editor.waitFor({ state: "detached" });
  }
  previousRegion = await region.elementHandle();
  await edit(300);
  await assertChart(1200, "first edit");
  await edit(400);
  await assertChart(1600, "second edit");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await assertChart(1200, "Undo");
  assert.equal(await penPrice.locator(".ts-cell-value").textContent(), "300");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await assertChart(1600, "Redo");
  assert.equal(await penPrice.locator(".ts-cell-value").textContent(), "400");
  await assertNarrowRecovery(1600, "after edits/history");
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log(JSON.stringify({ status: "PASS", url, dist, stages }));
} catch (error) {
  const chart = await page.locator(".ts-results-pane .ts-result-card").evaluateAll((cards) => cards.map((card) => ({
    state: card.getAttribute("data-result-state"),
    width: card.querySelector(".ts-mini-chart-region")?.getBoundingClientRect().width,
    svgCount: card.querySelectorAll("svg.ts-mini-chart").length,
    text: card.textContent,
  })));
  const previousNode = previousRegion ? await previousRegion.evaluate((node) => ({ connected: node.isConnected, width: node.getBoundingClientRect().width })) : null;
  console.error(JSON.stringify({ status: "FAIL", completedStages: stages, chart, previousNode }));
  throw error;
} finally {
  await context.close();
  await browser.close();
}

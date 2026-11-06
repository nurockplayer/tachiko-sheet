import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const browser = await chromium.launch({ headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await installDistRoutes(context, dist);
await context.addInitScript(() => {
  window.__replaceEvidence = { records: [] };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      const record = { requests: [], replies: [], tables: [] };
      window.__replaceEvidence.records.push(record);
      this.addEventListener("message", event => {
        record.replies.push(structuredClone(event.data));
        if (event.data.response?.type === "table") record.tables.push(structuredClone(event.data.response.payload));
      });
      this.record = record;
    }
    postMessage(message, ...args) { this.record.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
  };
});
const page = await context.newPage();
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = () => page.evaluate(() => window.__replaceEvidence.records.flatMap(record => record.tables).at(-1));
const requests = type => page.evaluate(type => window.__replaceEvidence.records.flatMap(record => record.requests).filter(message => message.request?.type === type).length, type);
const publications = () => page.evaluate(() => window.__replaceEvidence.records.reduce((n, record) => n + record.replies.filter(reply => reply.response?.type === "published").length, 0));
const texts = table => table.rows.map(row => row.fields.find(field => field.target.field === table.columns[0].id)?.stored?.value);
const openFilter = async name => {
  await page.getByRole("columnheader", { name, exact: true }).hover();
  await page.getByRole("button", { name: `Column actions for ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Filter…", exact: true }).click();
};
const condition = async (name, op, value) => {
  await openFilter(name); await page.getByLabel(`Filter type for ${name}`).selectOption("condition");
  await page.getByLabel(`Condition for ${name}`).selectOption(op); await page.getByLabel(`Value for ${name}`).fill(value);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
};
const pick = async values => {
  await openFilter("Region"); await page.getByLabel("Filter type for Region").selectOption("values");
  const controls = page.locator('.ts-column-overflow[open] .ts-row-view-filter input[type="checkbox"], .ts-column-overflow[open] .ts-row-view-filter button[type="submit"]');
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    assert.equal(await control.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === node || node.contains(hit);
    }), true, "filter control receives pointer at its centre");
  }
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  for (const value of values) await page.getByLabel(value, { exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
};
try {
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Filter test");
  await dialog.getByLabel("Column 1 name", { exact: true }).fill("Item");
  for (const [index, name, type] of [[2, "Region", "text"], [3, "Qty", "number"], [4, "Due", "date"]]) {
    await dialog.getByRole("button", { name: "Add column", exact: true }).click();
    await dialog.getByLabel(`Column ${index} name`, { exact: true }).fill(name);
    if (type !== "text") await dialog.getByLabel(`Column ${index} type`, { exact: true }).selectOption(type);
  }
  await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  for (const text of ["A\tNorth\t10\t2026-04-01", "B\tSouth\t20\t2026-04-02", "C\tEast\t5\t2026-04-03", "D\t\t15\t2026-04-04", "E\tNorth\t\t2026-04-05", "F\tSouth\t2\t2026-04-06"]) {
    await draft.focus(); await draft.evaluate((node, value) => { const data = new DataTransfer(); data.setData("text/plain", value); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); }, text);
    await draft.press("Enter"); await ready();
  }
  const before = await publications();
  await pick(["North", "South"]); await condition("Qty", ">=", "10");
  await page.getByText("Showing 2 of 6 rows", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear 2 filters", exact: true }).waitFor(); assert.equal(await publications(), before);
  const table = await projection();
  await page.getByTestId(`cell:${table.rows[0].id}:${table.columns[1].id}`).dblclick();
  await page.getByTestId("cell-editor").fill("West"); await page.getByTestId("cell-editor").press("Enter"); await ready();
  await page.getByText("Showing 2 of 6 rows", { exact: true }).waitFor();

  await openFilter("Region"); await page.getByRole("button", { name: "Clear this filter", exact: true }).click();
  await page.getByText("Showing 3 of 6 rows", { exact: true }).waitFor();
  await condition("Qty", "<>", "10"); await page.getByText("Showing 4 of 6 rows", { exact: true }).waitFor();
  await condition("Due", ">=", "2026-04-04"); await page.getByText("Showing 2 of 6 rows", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear 2 filters", exact: true }).click();
  await pick(["(Blank)"]); await page.getByText("Showing 1 of 6 rows", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await openFilter("Qty"); await page.getByLabel("Filter type for Qty").selectOption("condition");
  assert.equal(await page.getByRole("button", { name: "Rename…", exact: true }).isVisible(), false, "the editor replaces the column's actions");
  await page.getByLabel("Value for Qty").fill("Infinity"); await page.getByRole("alert").filter({ hasText: "Enter a number." }).waitFor();
  await page.getByRole("button", { name: "Apply", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Enter a number." }).waitFor();
  assert.equal(await publications(), before + 1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 900, height: 420 });
  await page.getByRole("columnheader", { name: "Qty", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Qty", exact: true }).click();
  const lastItem = page.locator('.ts-column-overflow[open] .ts-command-menu button').last();
  assert.equal(await lastItem.getAttribute("aria-label"), "Filter…");
  await lastItem.click();
  await page.getByLabel("Filter Qty", { exact: true }).waitFor();
  console.log("PASS: local multi-column value and condition filters do not publish");
} finally { await context.close(); await browser.close(); }

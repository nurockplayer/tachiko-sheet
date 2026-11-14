import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await installDistRoutes(context, dist);
await context.addInitScript(() => {
  const evidence = window.__selectionEvidence = { records: [], holdNext: false, held: null, outstanding: new Set(), maximumOutstanding: 0 };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.record = { requests: [], replies: [], tables: [] };
      evidence.records.push(this.record);
      this.addEventListener("message", event => {
        const reply = event.data;
        this.record.replies.push(structuredClone(reply));
        if (reply.response?.type === "table") this.record.tables.push(structuredClone(reply.response.payload));
        if (reply.response?.type === "table_window") {
          const window = structuredClone(reply.response.payload);
          if (window.start === 0) this.table = { ...window, rows: [] };
          this.table.rows.push(...window.rows);
          if (this.table.rows.length >= window.total_rows) this.record.tables.push(structuredClone(this.table));
        }
        if (reply.response?.type === "selection_statistics" && evidence.holdNext) {
          evidence.holdNext = false;
          evidence.held = { worker: this, reply };
          event.stopImmediatePropagation();
          return;
        }
        evidence.outstanding.delete(reply.id);
      });
    }
    postMessage(message, ...args) {
      this.record.requests.push(structuredClone(message));
      if (message.request?.type === "query_selection_statistics") {
        evidence.outstanding.add(message.id);
        evidence.maximumOutstanding = Math.max(evidence.maximumOutstanding, evidence.outstanding.size);
      }
      return super.postMessage(message, ...args);
    }
  };
});
const page = await context.newPage();
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = () => page.evaluate(() => window.__selectionEvidence.records.flatMap(record => record.tables).at(-1));
const queryCount = () => page.evaluate(() => window.__selectionEvidence.records.flatMap(record => record.requests).filter(message => message.request?.type === "query_selection_statistics").length);
const publications = () => page.evaluate(() => window.__selectionEvidence.records.flatMap(record => record.replies).filter(reply => reply.response?.type === "published").length);
const cell = (table, row, column) => page.getByTestId(`cell:${table.rows[row].id}:${table.columns[column].id}`);
const select = async (table, top, left, bottom, right) => {
  await cell(table, top, left).click();
  await cell(table, bottom, right).click({ modifiers: ["Shift"] });
};
const paste = async (target, text) => {
  await target.focus();
  await target.evaluate((node, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
};
async function expectStatistics(expected) {
  await page.waitForFunction(expected => Object.entries(expected).every(([key, value]) =>
    document.querySelector(`[data-testid="selection-${key}"]`)?.textContent === String(value)), expected);
}
async function expectNoStatistics() {
  assert.equal(await page.getByTestId("selection-statistics").count(), 0);
}
try {
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Selection statistics");
  await dialog.getByLabel("Column 1 name", { exact: true }).fill("Amount");
  await dialog.getByLabel("Column 1 type", { exact: true }).selectOption("number");
  await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  await dialog.getByLabel("Column 2 name", { exact: true }).fill("Label");
  await dialog.getByLabel("Column 2 Required", { exact: true }).check();
  await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  for (const text of ["2\tx", "4\t", "\t123"]) {
    const draft = page.locator('.ts-entry-row [data-entry-field]').first();
    await paste(draft, text); await draft.press("Enter"); await ready();
  }
  let table = await projection();
  assert.equal(table.rows.length, 3);
  assert.ok(table.rows[2].blank_fields.includes(table.columns[0].id), "optional Number is a real blank");
  assert.equal(table.rows[1].fields.find(field => field.target.field === table.columns[1].id).stored.value, "", "required Text is real empty text");
  const mixed = { count: 4, "numerical-count": 2, sum: 6, average: 3, min: 2, max: 4 };
  const before = { publications: await publications(), save: await page.getByTestId("work-state").getAttribute("data-work-state"), revision: table.revision };
  await select(table, 0, 0, 2, 1); await expectStatistics(mixed);
  const reply = await page.evaluate(() => window.__selectionEvidence.records.flatMap(record => record.replies).filter(reply => reply.response?.type === "selection_statistics").at(-1).response.payload);
  assert.deepEqual(reply, { revision: table.revision, count: 4, numerical_count: 2, sum: 6, average: 3, min: 2, max: 4, error_count: 0 });
  console.log("PASS: mixed 3x2 selection displays all six statistics from real Worker/WASM");

  await select(table, 0, 1, 2, 1); await expectStatistics({ count: 2 });
  assert.equal(await page.getByTestId("selection-sum").count(), 0);
  assert.equal(await page.getByTestId("selection-numerical-count").count(), 0);
  console.log("PASS: text-only selection shows Count only");

  await cell(table, 0, 0).click(); await expectNoStatistics();
  const singleQueries = await queryCount(); await page.waitForTimeout(220);
  await expectNoStatistics(); assert.equal(await queryCount(), singleQueries, "single cell sends no read");
  await page.locator('.ts-entry-row [data-entry-field]').first().click();
  await expectNoStatistics();
  console.log("PASS: single cells and draft rows show no statistics");

  await page.getByRole("columnheader", { name: "Label", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Label", exact: true }).click();
  await page.getByRole("button", { name: "Filter…", exact: true }).click();
  await page.getByLabel("Filter type for Label").selectOption("values");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  for (const value of ["x", "123"]) await page.getByLabel(value, { exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByText("Showing 2 of 3 rows", { exact: true }).waitFor();
  await page.getByRole("columnheader", { name: "Amount", exact: true }).click();
  await expectStatistics({ count: 1, "numerical-count": 1, sum: 2, average: 2, min: 2, max: 2 });
  const filteredTargets = await page.evaluate(() => window.__selectionEvidence.records.flatMap(record => record.requests).filter(message => message.request?.type === "query_selection_statistics").at(-1).request.targets);
  assert.deepEqual(filteredTargets, [table.rows[0], table.rows[2]].map(row => ({ entity: row.id, field: table.columns[0].id })));
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expectNoStatistics();
  console.log("PASS: filtered whole-column header selection sends only displayed rows");

  await page.evaluate(() => { window.__selectionEvidence.holdNext = true; });
  await select(table, 0, 0, 1, 0);
  await page.waitForFunction(() => window.__selectionEvidence.held !== null);
  const heldQueries = await queryCount();
  await select(table, 0, 1, 2, 1);
  await select(table, 0, 0, 1, 1);
  await expectNoStatistics();
  await page.waitForTimeout(220);
  assert.equal(await queryCount(), heldQueries, "only one read is in flight");
  await page.evaluate(() => {
    const evidence = window.__selectionEvidence, held = evidence.held;
    evidence.held = null;
    held.worker.dispatchEvent(new MessageEvent("message", { data: held.reply }));
  });
  await expectStatistics({ ...mixed, count: 3 });
  assert.equal(await queryCount(), heldQueries + 1, "only the latest pending selection is read");
  assert.equal(await page.evaluate(() => window.__selectionEvidence.maximumOutstanding), 1);
  assert.equal(await publications(), before.publications, "selection and filter reads never publish");
  assert.equal(await page.getByTestId("work-state").getAttribute("data-work-state"), before.save, "reads do not change Save state");
  assert.equal((await projection()).revision, before.revision);
  console.log("PASS: rapid changes drop held stale replies; only the final selection displays, without publication or Save change");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("selection-max").scrollIntoViewIfNeeded();
  const layout = await page.locator('.ts-workbook-status').evaluate(strip => {
    const bounds = strip.getBoundingClientRect();
    const items = [...strip.querySelectorAll('.ts-selection-statistics .ts-status-pair')];
    return { scrolls: strip.scrollWidth > strip.clientWidth, width: bounds.width,
      withinViewport: bounds.top >= 0 && bounds.bottom <= innerHeight,
      unclipped: items.every(item => { const box = item.getBoundingClientRect(); return box.top >= bounds.top && box.bottom <= bounds.bottom; }),
      inFlow: getComputedStyle(strip.querySelector('.ts-selection-statistics')).position === "static" };
  });
  assert.equal(layout.scrolls, true); assert.ok(layout.width <= 390);
  assert.equal(layout.withinViewport, true); assert.equal(layout.unclipped, true); assert.equal(layout.inFlow, true);
  console.log("PASS: 390px status strip scrolls horizontally with no overlay or vertical clipping");
  console.log("PASS: selection statistics browser acceptance cases 1, 2, 4–7");
} finally { await context.close(); await browser.close(); }

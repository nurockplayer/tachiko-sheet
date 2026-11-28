import { expect } from "@playwright/test";
import { installPublishedTablePatcher } from "./published-table-patcher.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome, openReleasePlanExample } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const browser = await chromium.launch({ headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1440, height: 900 } });
await installDistRoutes(context, dist);
await installPublishedTablePatcher(context);
await context.addInitScript(() => {
  window.__editingEvidence = { records: [] };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      const record = { requests: [], replies: [], tables: [] };
      window.__editingEvidence.records.push(record);
      this.addEventListener("message", event => {
        record.replies.push(structuredClone(event.data));
        if (event.data.response?.type === "table") record.tables.push(window.__trackObservedTable(record, structuredClone(event.data.response.payload)));
        if (event.data.response?.type === "published") {
          const table = window.__trackPublished(record, event.data.response.payload);
          if (table) record.tables.push(table);
        }
      });
      this.record = record;
    }
    postMessage(message, ...args) { this.record.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
  };
});
const page = await context.newPage();
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = () => page.evaluate(() => window.__readObservedTable(window.__editingEvidence.records.findLast(record => record.tables.length)));
const counts = () => page.evaluate(() => {
  const counts = { edits: 0, moves: 0, publishedMoves: 0 };
  for (const record of window.__editingEvidence.records) {
    for (const message of record.requests) {
      if (message.request?.type === "edit_cells") counts.edits++;
      if (message.request?.type === "move_cells") {
        counts.moves++;
        if (record.replies.some(reply => reply.id === message.id && reply.response?.type === "published")) counts.publishedMoves++;
      }
    }
  }
  return counts;
});
const cell = (table, r, c) => page.getByTestId(`cell:${table.rows[r].fields[0]?.target.entity ?? table.rows[r].id}:${table.columns[c].id}`);
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
async function drag(from, to) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}
try {
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Editing basics");
  await dialog.getByLabel("Column 1 name", { exact: true }).fill("First");
  await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  await dialog.getByLabel("Column 2 name", { exact: true }).fill("Second");
  await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  for (const text of ["one\ttwo", "three\tfour", "five\tsix"]) {
    await draft.focus();
    await draft.evaluate((node, text) => { const data = new DataTransfer(); data.setData("text/plain", text); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); }, text);
    await draft.press("Enter"); await ready();
  }
  let table = await projection();
  const original = table.rows;
  const originalText = [["one", "two"], ["three", "four"], ["five", "six"]];
  for (const [r, row] of originalText.entries()) for (const [c, text] of row.entries()) await expect(cell(table, r, c)).toHaveText(text);
  // Focus the grid, then use only arrow keys to reach the target cell.
  await cell(table, 0, 0).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await cell(table, 0, 1).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ControlOrMeta+C");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Copied" }).waitFor();
  const beforeSingle = await counts();
  await page.keyboard.press("ControlOrMeta+X");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Cut 1 cell" }).waitFor(); await ready();
  assert.deepEqual(await counts(), beforeSingle);
  assert.deepEqual((await projection()).rows, original);
  await expect(cell(table, 0, 1)).toHaveText("two");
  await cell(table, 2, 1).click();
  await page.keyboard.press("ControlOrMeta+V"); await ready();
  await expect(cell(table, 2, 1)).toHaveText("two");
  assert.deepEqual(await counts(), { ...beforeSingle, moves: beforeSingle.moves + 1, publishedMoves: beforeSingle.publishedMoves + 1 });
  table = await projection();
  assert.ok(!table.rows[0].fields.some(field => field.target.field === table.columns[1].id && field.stored?.value));
  await expect(cell(table, 0, 1)).toHaveText("");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  table = await projection(); assert.deepEqual(table.rows, original);
  for (const [r, row] of originalText.entries()) for (const [c, text] of row.entries()) await expect(cell(table, r, c)).toHaveText(text);
  await drag(cell(table, 0, 0), cell(table, 1, 1));
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 4);
  await page.keyboard.press("ControlOrMeta+C");
  assert.equal(await clipboard(), "one\ttwo\nthree\tfour");
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 4);
  await cell(table, 0, 0).click();
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 0);
  await drag(cell(table, 0, 0), cell(table, 1, 1));
  const beforeBlock = await counts();
  await page.keyboard.press("ControlOrMeta+X");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Cut 4 cells" }).waitFor(); await ready();
  assert.equal(await clipboard(), "one\ttwo\nthree\tfour");
  assert.deepEqual(await counts(), beforeBlock);
  assert.deepEqual((await projection()).rows, original);
  await cell(table, 1, 0).click();
  await page.keyboard.press("ControlOrMeta+V"); await ready();
  const movedText = [["", ""], ["one", "two"], ["three", "four"]];
  for (const [r, row] of movedText.entries()) for (const [c, text] of row.entries()) await expect(cell(table, r, c)).toHaveText(text);
  assert.deepEqual(await counts(), { ...beforeBlock, moves: beforeBlock.moves + 1, publishedMoves: beforeBlock.publishedMoves + 1 });
  table = await projection();
  for (const [r, row] of movedText.entries()) for (const [c, text] of row.entries()) {
    assert.equal(table.rows[r].fields.find(field => field.target.field === table.columns[c].id)?.stored?.value ?? "", text);
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  table = await projection(); assert.deepEqual(table.rows, original);
  for (const [r, row] of originalText.entries()) for (const [c, text] of row.entries()) await expect(cell(table, r, c)).toHaveText(text);
  await drag(cell(table, 0, 0), cell(table, 2, 1));
  await page.getByRole("button", { name: "Delete 3 rows", exact: true }).click(); await ready();
  assert.equal((await projection()).rows.length, 0);
  for (const r of [0, 1, 2]) for (const c of [0, 1]) await expect(cell(table, r, c)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, original);
  for (const [r, row] of originalText.entries()) for (const [c, text] of row.entries()) await expect(cell(table, r, c)).toHaveText(text);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page); await openReleasePlanExample(page); await ready();
  table = await projection();
  const calculated = table.rows.flatMap((row, r) => table.columns.flatMap((column, c) => column.required && row.fields.find(field => field.target.field === column.id)?.calculated?.status === "value" ? [{ r, c }] : []))[0];
  assert.ok(calculated);
  await cell(table, calculated.r, calculated.c).click();
  const beforeRefusal = await counts();
  await page.keyboard.press("ControlOrMeta+X");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Cut 1 cell" }).waitFor();
  assert.deepEqual(await counts(), beforeRefusal);
  const formulaClipboard = await clipboard();
  assert.match(formulaClipboard, /^=/);
  // Moving this formula would leave its required Number source blank.
  await cell(table, (calculated.r + 1) % table.rows.length, calculated.c).click();
  await page.keyboard.press("ControlOrMeta+V");
  const refusal = page.locator('.ts-clipboard-status').filter({ hasText: /\S/, hasNotText: "Cut 1 cell" });
  await expect(refusal).toBeVisible(); await ready();
  assert.deepEqual(await counts(), { ...beforeRefusal, moves: beforeRefusal.moves + 1 });
  assert.deepEqual((await projection()).rows, table.rows);
  assert.equal(await clipboard(), formulaClipboard);
  console.log("PASS: drag, real-key copy and cut/paste, refusal, multi-row delete and undo");
} finally { await context.close(); await browser.close(); }

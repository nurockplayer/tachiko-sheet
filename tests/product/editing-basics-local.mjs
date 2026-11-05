import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome, openReleasePlanExample } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const browser = await chromium.launch({ headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1440, height: 900 } });
await installDistRoutes(context, dist);
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
        if (event.data.response?.type === "table") record.tables.push(structuredClone(event.data.response.payload));
      });
      this.record = record;
    }
    postMessage(message, ...args) { this.record.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
  };
});
const page = await context.newPage();
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const projection = () => page.evaluate(() => window.__editingEvidence.records.flatMap(record => record.tables).at(-1));
const count = () => page.evaluate(() => window.__editingEvidence.records.flatMap(record => record.requests).filter(message => message.request?.type === "edit_cells").length);
const publications = () => page.evaluate(() => window.__editingEvidence.records.reduce((n, record) => n + record.replies.filter(reply => reply.response?.type === "published" && record.requests.find(request => request.id === reply.id)?.request?.type === "edit_cells").length, 0));
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
  await drag(cell(table, 0, 0), cell(table, 1, 1));
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 4);
  await page.keyboard.press("ControlOrMeta+C");
  assert.equal(await clipboard(), "one\ttwo\nthree\tfour");
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 4);
  await cell(table, 0, 0).click();
  assert.equal(await page.locator('.ts-cell--range-selected').count(), 0);
  await drag(cell(table, 0, 0), cell(table, 1, 1));
  const before = await count(), beforePublications = await publications();
  await page.keyboard.press("ControlOrMeta+X");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Cut 4 cells" }).waitFor(); await ready();
  assert.equal(await clipboard(), "one\ttwo\nthree\tfour");
  assert.equal(await count(), before + 1); assert.equal(await publications(), beforePublications + 1);
  table = await projection();
  for (const row of table.rows.slice(0, 2)) for (const column of table.columns.slice(0, 2)) assert.ok(!row.fields.some(field => field.target.field === column.id && field.stored?.value));
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  table = await projection(); assert.deepEqual(table.rows, original);
  await drag(cell(table, 0, 0), cell(table, 2, 1));
  await page.getByRole("button", { name: "Delete 3 rows", exact: true }).click(); await ready();
  assert.equal((await projection()).rows.length, 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await projection()).rows, original);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page); await openReleasePlanExample(page); await ready();
  table = await projection();
  const calculated = table.rows.flatMap((row, r) => table.columns.flatMap((column, c) => row.fields.find(field => field.target.field === column.id)?.calculated?.status === "value" ? [{ r, c }] : []))[0];
  assert.ok(calculated);
  await cell(table, calculated.r, calculated.c).click();
  await page.evaluate(() => navigator.clipboard.writeText("unchanged clipboard"));
  const refusedCount = await count();
  await page.keyboard.press("ControlOrMeta+X");
  await page.locator('.ts-clipboard-status').filter({ hasText: "Nothing was cut." }).waitFor();
  assert.equal(await count(), refusedCount); assert.equal(await clipboard(), "unchanged clipboard");
  console.log("PASS: drag, real-key copy and cut, refusal, multi-row delete and undo");
} finally { await context.close(); await browser.close(); }

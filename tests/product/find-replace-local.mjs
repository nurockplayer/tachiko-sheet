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
const publications = () => page.evaluate(() => window.__replaceEvidence.records.reduce((n, record) => n + record.replies.filter(reply => reply.response?.type === "published" && record.requests.find(request => request.id === reply.id)?.request?.type === "commit_cleanup").length, 0));
const texts = table => table.rows.map(row => row.fields.find(field => field.target.field === table.columns[0].id)?.stored?.value);
try {
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Replace test");
  await dialog.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  await dialog.getByLabel("Column 2 name", { exact: true }).fill("Amount");
  await dialog.getByLabel("Column 2 type", { exact: true }).selectOption("number");
  await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  for (const text of ["Red apple\t1", "red pear\t2", "Red plum\t3"]) {
    await draft.focus();
    await draft.evaluate((node, value) => { const data = new DataTransfer(); data.setData("text/plain", value); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); }, text);
    await draft.press("Enter"); await ready();
  }
  const original = (await projection()).rows;
  await page.keyboard.press("ControlOrMeta+F");
  const find = page.getByLabel("Find in table"), replacement = page.getByLabel("Replace with");
  await find.fill("Red"); await page.getByRole("button", { name: "Replace…" }).click(); await replacement.fill("Green");
  const beforePublications = await publications();
  await page.getByRole("button", { name: "Preview replace" }).click();
  const preview = page.getByRole("table", { name: "Replace preview" });
  await preview.waitFor();
  assert.match(await preview.textContent(), /Red apple.*Green apple/); assert.match(await preview.textContent(), /Red plum.*Green plum/);
  await page.getByText("2 cells would change", { exact: true }).waitFor();
  await page.getByText("Find ignores case and looks at all shown text. Replace changes only Text cells that match exactly.").waitFor();
  assert.equal(await publications(), beforePublications); assert.deepEqual((await projection()).rows, original);
  await page.getByRole("button", { name: "Replace 2 cells", exact: true }).click();
  await page.locator('.ts-clipboard-status').filter({ hasText: "Replaced 2 cells" }).waitFor(); await ready();
  assert.deepEqual(texts(await projection()), ["Green apple", "red pear", "Green plum"]); assert.equal(await publications(), beforePublications + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(); assert.deepEqual((await projection()).rows, original);
  await page.getByRole("button", { name: "Preview replace" }).click(); await preview.waitFor();
  await replacement.fill("Blue"); await preview.waitFor({ state: "detached" });
  await find.fill("2"); const beforeRequests = await requests("preview_cleanup");
  await page.getByRole("button", { name: "Preview replace" }).click();
  await page.getByText(/No Text cells contain exactly “2”/).waitFor(); assert.equal(await requests("preview_cleanup"), beforeRequests);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("grid", { name: "Table", exact: true }).getByRole("columnheader", { name: "Item", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Item", exact: true }).click();
  // A real click: the grid must get its height back when the replace area closes,
  // or the short grid clips this menu and the row actions below take the click.
  await page.getByRole("button", { name: "Filter…", exact: true }).click();
  await page.getByLabel("Filter Item", { exact: true }).fill("apple"); await page.getByLabel("Filter Item", { exact: true }).press("Enter"); await ready();
  await page.keyboard.press("ControlOrMeta+F"); await find.fill("Red"); await page.getByRole("button", { name: "Replace…" }).click(); await replacement.fill("Green");
  await page.getByRole("button", { name: "Preview replace" }).click(); await page.getByRole("button", { name: "Replace 1 cell", exact: true }).click();
  await page.locator('.ts-clipboard-status').filter({ hasText: "Replaced 1 cell" }).waitFor(); await ready();
  assert.deepEqual(texts(await projection()), ["Green apple", "red pear", "Red plum"]);
  console.log("PASS: replace preview, publication, undo, cancellation, Text-only matching and filtered rows");
} finally { await context.close(); await browser.close(); }

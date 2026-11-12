// Working-size journey through the built Sheet and real Work kit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { j4CanaryText } from "../fixtures/j4-catalog-sales.mjs";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";
import { observeCapacity, capacitySnapshot, beginCapacityStep, finishCapacityStep } from "./capacity-diagnostics.mjs";

const dist = process.env.WORK_DIST;
if (!dist) throw new Error("WORK_DIST must name a built product");
const fixture = process.env.WORKING_SIZE_FIXTURE ?? "text";
assert.ok(["text", "numeric"].includes(fixture), "WORKING_SIZE_FIXTURE must be text or numeric");
const rowCount = Number(process.env.WORKING_SIZE_ROWS ?? 10000);
assert.ok([1000, 5000, 10000].includes(rowCount), "WORKING_SIZE_ROWS must be 1000, 5000 or 10000");
console.log(`FIXTURE ${fixture} rows=${rowCount} columns=10 stored=7 formulas=3 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" })} JST`);
const firstValue = index => fixture === "text" ? `Row ${index + 1}` : String(index + 1);
const lastRow = rowCount - 1;
const work = await mkdtemp(path.join(tmpdir(), "sheet-working-size-"));
const folder = path.join(work, "fixture");
const schema = JSON.parse(j4CanaryText["schemas.json"])[0];
const types = [fixture === "text" ? "text" : "number", "number", "number", "date", "boolean", fixture === "text" ? "text" : "number", "number", "number", "number", "number"];
schema.fields = types.map((type, i) => ({ id: `10000000-0000-4000-8000-${String(i + 101).padStart(12, "0")}`, key: `column_${i}`, field_type: { type }, required: false, constraint: { type: "none" } }));
await mkdir(path.join(folder, "entities"), { recursive: true });
const manifest = JSON.parse(j4CanaryText["manifest.json"]); manifest.format_version = 3;
await writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(folder, "definitions.json"), "[]\n");
await writeFile(path.join(folder, "schemas.json"), JSON.stringify([schema], null, 2) + "\n");
const shards = Object.fromEntries([..."0123456789abcdef"].map(key => [key, ""]));
for (let i = 0; i < rowCount; i++) {
  const id = `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const ref = index => ({ op: "reference", args: { entity: id, field: schema.fields[index].id } });
  const add = (left, right) => ({ kind: "formula", value: { op: "add", args: { left, right } } });
  const values = [fixture === "text" ? { kind: "text", value: firstValue(i) } : { kind: "number", value: i + 1 }, { kind: "number", value: i + 1 },
    { kind: "number", value: 2 }, { kind: "date", value: "2026-10-20" }, { kind: "boolean", value: true },
    fixture === "text" ? { kind: "text", value: "Filled" } : { kind: "number", value: 4 }, { kind: "number", value: 3 },
    add(ref(1), ref(1)), add(ref(1), ref(2)), add(ref(2), ref(6))];
  const fields = Object.fromEntries(values.map((value, index) => [schema.fields[index].id, value]));
  shards[createHash("sha256").update(id).digest("hex")[0]] += JSON.stringify({ id, key: `r${String(i).padStart(5, "0")}`, schema: schema.id, fields }) + "\n";
}
for (const [shard, text] of Object.entries(shards)) await writeFile(path.join(folder, "entities", `${shard}.jsonl`), text);
const timings = {};
const timed = async (label, action, target) => {
  await beginCapacityStep(page, target);
  const started = performance.now();
  const result = await action();
  (timings[label] ??= []).push(performance.now() - started);
  await finishCapacityStep(page, `${fixture}/${rowCount}/${label}/${timings[label].length}`);
  return result;
};
const measure = (name, value, budget) => { const rounded = Math.round(value); const pass = budget == null || value <= budget; console.log(`MEASURE ${name} ${rounded} ms (budget ${budget ?? "none"} ms) ${pass ? "PASS" : "OVER"}`); if (!pass && process.env.WORKING_SIZE_ENFORCE_BUDGETS === "1") throw new Error(`${name} exceeded budget`); };
let context, page;
try {
  context = await chromium.launchPersistentContext(path.join(work, "profile"), { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}) });
  await installDistRoutes(context, dist); await observeCapacity(context, { timing: true });
  page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(120000); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const row = index => grid.locator(`tbody tr[aria-rowindex="${index + 2}"]`);
  const cell = (index, column) => row(index).locator("td").nth(column);
  const ready = async () => { await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor(); await grid.locator("tbody tr.ts-row").first().waitFor(); };
  const requests = () => page.evaluate(() => ({ ...window.__capacityEvidence.requests }));
  const reveal = async index => { await page.evaluate(i => { const s = document.querySelector(".ts-grid-scroll"); const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row')?.offsetHeight || 32; s.scrollTop = Math.max(0, i * pitch - s.clientHeight / 2); }, index); await row(index).waitFor(); };
  const textIs = async (index, column, value) => page.waitForFunction(([r, c, v]) => document.querySelector(`table[aria-label="Table"] tbody tr[aria-rowindex="${r + 2}"] td:nth-of-type(${c + 1})`)?.textContent.trim() === v, [index, column, String(value)]);
  let before = await requests();
  await timed("open", async () => { await page.getByTestId("open-project").setInputFiles(folder); await ready(); await textIs(0, 7, 2); await textIs(0, 8, 3); await textIs(0, 9, 5); }, { ready: true, row: 0, cells: [[7, 2], [8, 3], [9, 5]] });
  measure("open", timings.open[0], 3000); console.log(`PASS open query_table_window requests ${(await requests()).query_table_window - (before.query_table_window ?? 0)}`);
  const edits = [];
  for (let i = 0; i < 30; i++) {
    const index = Math.round(i * lastRow / 29), value = 20001 + i; edits.push([index, value]);
    await reveal(index); await cell(index, 1).dblclick(); const editor = page.getByTestId("cell-editor"); await editor.fill(String(value)); before = await requests();
    await timed("edit", async () => { await editor.press("Enter"); await textIs(index, 1, value); await textIs(index, 7, value * 2); await textIs(index, 8, value + 2); }, { row: index, cells: [[1, value], [7, value * 2], [8, value + 2]] });
    const after = await requests();
    // At <=1,000 rows queryWholeTable succeeds, so no columnsRevision is
    // retained and confirmedMutation deliberately reloads the whole table.
    assert.equal((after.query_table ?? 0) - (before.query_table ?? 0), rowCount <= 1000 ? 1 : 0, `unexpected full-table read count during edit ${i + 1}`);
    console.log(`PASS edit ${i + 1} query_table_window requests ${(after.query_table_window ?? 0) - (before.query_table_window ?? 0)}`);
  }
  const sorted = [...timings.edit].sort((a, b) => a - b);
  measure("edit_p50", sorted[14], 100); measure("edit_p95", sorted[28], 100); measure("edit_max", sorted[29], 100);
  await timed("save", async () => {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const save = page.getByRole("dialog", { name: "Save a copy", exact: true }); await save.getByLabel("Copy name", { exact: true }).fill("Working size copy"); await save.getByRole("button", { name: "Create copy", exact: true }).click(); await save.waitFor({ state: "detached" }); await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  }, { saved: true }); measure("save", timings.save[0], null);
  await page.reload(); await waitForColdHome(page);
  await timed("reload", async () => { await page.getByRole("button", { name: "Open saved Working size copy", exact: true }).click(); await ready(); await textIs(0, 7, edits[0][1] * 2); }, { ready: true, row: 0, cells: [[7, edits[0][1] * 2]] }); measure("reload", timings.reload[0], 3000);
  assert.equal(Number(await grid.getAttribute("aria-rowcount")) - 1 - await grid.locator('.ts-entry-row').count() - await grid.locator('.ts-totals-row').count(), rowCount);
  for (const [index, value] of [edits[0], edits[15], edits[29]]) { await reveal(index); await textIs(index, 1, value); await textIs(index, 7, value * 2); }
  await timed("scroll", () => reveal(lastRow), { row: lastRow }); measure("scroll", timings.scroll[0], null);
  await reveal(0); await cell(0, 0).click(); await reveal(lastRow); await cell(lastRow, 0).click({ modifiers: ["Shift"] });
  await timed(`clear_${rowCount}`, async () => { await page.keyboard.press("Delete"); await page.locator('.ts-clipboard-status').filter({ hasText: `Cleared ${rowCount} cells` }).waitFor(); await ready(); await textIs(lastRow, 0, ""); }, { ready: true, status: `Cleared ${rowCount} cells`, row: lastRow, cells: [[0, ""]] }); measure(`clear_${rowCount}`, timings[`clear_${rowCount}`][0], null);
  await textIs(lastRow, 0, ""); await reveal(0); await textIs(0, 0, "");
  await timed(`undo_${rowCount}`, async () => { await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(); await textIs(0, 0, firstValue(0)); }, { ready: true, row: 0, cells: [[0, firstValue(0)]] }); measure(`undo_${rowCount}`, timings[`undo_${rowCount}`][0], null); await reveal(lastRow); await textIs(lastRow, 0, firstValue(lastRow));
  await reveal(0); await cell(0, 0).click(); await reveal(lastRow); await cell(lastRow, 6).click({ modifiers: ["Shift"] });
  await timed(`clear_${rowCount * 7}`, async () => { await page.keyboard.press("Delete"); await page.locator('.ts-clipboard-status').filter({ hasText: `Cleared ${rowCount * 7} cells` }).waitFor(); await ready(); await textIs(lastRow, 0, ""); }, { ready: true, status: `Cleared ${rowCount * 7} cells`, row: lastRow, cells: [[0, ""]] }); measure(`clear_${rowCount * 7}`, timings[`clear_${rowCount * 7}`][0], null);
  await textIs(lastRow, 0, ""); await reveal(0); await textIs(0, 0, "");
  await timed(`undo_${rowCount * 7}`, async () => { await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(); await textIs(0, 0, firstValue(0)); }, { ready: true, row: 0, cells: [[0, firstValue(0)]] }); measure(`undo_${rowCount * 7}`, timings[`undo_${rowCount * 7}`][0], null);
  await reveal(lastRow); await textIs(lastRow, 0, firstValue(lastRow)); console.log(`PASS: ${rowCount * 7} stored cells cleared in one operation and restored with Undo`);
} catch (error) {
  if (page) await capacitySnapshot(page, "failure").catch(() => {});
  console.error(`Error: ${error.stack ?? error}`);
  throw error;
} finally { await context?.close(); await rm(work, { recursive: true, force: true }); }

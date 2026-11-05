// #292 item 7: Home templates open as ordinary, unsaved work in normal UI.
// Each committed .ro is produced by Work's exporter; this checks the opened
// table name, row count, a calculated value and the declared list values.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name an acceptance build.");
  process.exit(78);
}
const output = await mkdtemp(path.join(tmpdir(), "sheet-templates-"));
const checks = [];
let context;
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();

async function grid(page) {
  const table = page.locator('table[aria-label="Table"]');
  await table.waitFor();
  return table.locator("tbody tr.ts-row").evaluateAll(rows => rows.map(row =>
    [...row.querySelectorAll("td")].map(cell => cell.textContent.trim())));
}

async function open(page, label) {
  await page.getByRole("button", { name: `Open ${label} template`, exact: true }).click();
  await ready(page);
  assert.equal(await page.locator("#ts-active-table option").textContent(), label === "Task tracker" ? "Tasks"
    : label === "Gradebook" ? "Grades" : label === "Budget" ? "Monthly budget" : label,
    `${label} opens its table by name`);
  assert.equal((await page.getByTestId("save-status").textContent()).trim(), "Not saved yet",
    `${label} opens as unsaved work`);
}

async function close(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await dialog.count()) await dialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}

try {
  context = await chromium.launchPersistentContext(path.join(output, "profile"), {
    headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  await installDistRoutes(context, dist);
  const page = context.pages()[0];
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);

  await open(page, "Budget");
  const budget = await grid(page);
  assert.equal(budget.length, 8, "Monthly budget has eight rows");
  assert.deepEqual(budget[0], ["Rent", "$1,200.00", "$1,200.00", "$0.00"], "Budget Rent is planned, actual and left");
  assert.equal(budget[5][3], "-$34.00", "Budget Eating out shows the overspend");
  checks.push("budget: 8 rows, currency columns, calculated Left");
  await close(page);

  await open(page, "Invoice");
  const invoice = await grid(page);
  assert.equal(invoice.length, 5, "Invoice has five rows");
  assert.deepEqual(invoice[0], ["Paper", "10", "$3.50", "$35.00"], "Invoice Paper Amount is quantity times unit price");
  checks.push("invoice: 5 rows, calculated Amount");
  await close(page);

  await open(page, "Task tracker");
  const tasks = await grid(page);
  assert.equal(tasks.length, 6, "Tasks has six rows");
  assert.ok(tasks.some(row => row[3] === "In progress"), "Tasks shows a mixed status");
  await page.locator('table[aria-label="Table"] tbody tr.ts-row').first().locator("td").nth(3).dblclick();
  const options = page.getByTestId("cell-editor-options");
  await options.waitFor();
  assert.deepEqual((await options.getByRole("option").allTextContents()).sort(), ["Done", "In progress", "To do"],
    "Status offers its three list values");
  await page.getByTestId("cell-editor").press("Escape");
  checks.push("tasks: 6 rows, Status list values offered inline");
  await close(page);

  await open(page, "Gradebook");
  const grades = await grid(page);
  assert.equal(grades.length, 6, "Grades has six students");
  assert.deepEqual(grades[0], ["Alex Kim", "85", "78", "92", "85"], "Gradebook average is rounded to one decimal");
  assert.equal(grades[4][4], "58.3", "Gradebook keeps the calculated average");
  checks.push("gradebook: 6 rows, calculated Average");
  await close(page);

  console.log(JSON.stringify({ status: "PASS", checks, output }));
} finally {
  if (context) await context.close();
}

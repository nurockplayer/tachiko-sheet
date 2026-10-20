import { observeTableProjections, observedTable } from "./table-projection-observer.mjs";
// Sheet #160 consumer acceptance: large mixed Text/Number shapes through the
// built product's normal UI only (Home file input, cell editor, Undo/Redo,
// Save a copy, full browser termination, reopen and browser downloads). An
// independent stdlib oracle checks every exported cell/type; no acceptance hook
// installs data or invokes kit capabilities on the app's behalf.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";
import { collectWindowedRows } from "./windowed-table-collector.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const oracle = path.join(root, "acceptance", "mixed-import", "oracle.py");
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
// Opt-in slow-rendering regression: apply on every page, including reopen.
const cpuRate = Number(process.env.MIXED_CPU_THROTTLE ?? 1);
assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1, "MIXED_CPU_THROTTLE must be a finite rate >= 1");
let ROWS, COLS;
const work = await mkdtemp(path.join(tmpdir(), "tachiko-mixed-import-"));
const fixtures = path.join(work, "fixtures");
execFileSync("python3", ["-I", oracle, "generate", fixtures], { stdio: "inherit" });
const expected = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(fixtures, "expected.json"), "utf8"));
const timings = {};
const timed = async (label, action) => {
  const start = performance.now();
  const result = await action();
  (timings[label] ??= []).push(Math.round(performance.now() - start));
  return result;
};
let context;
async function start(profile) {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  await observeTableProjections(context);
  const page = await context.newPage();
  if (cpuRate > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  }
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await page.getByRole("region", { name: "Recovery", exact: true }).waitFor({ state: "detached" });
  return page;
}

const grid = (page) => page.getByRole("grid", { name: "Table", exact: true });
// Large tables are row-windowed: scroll like a user, then address rows by
// their ARIA index (header is row 1).
const rowAt = (page, row) => grid(page).locator(`tbody tr[aria-rowindex="${row + 2}"]`);
const cellAt = (page, row, column) => rowAt(page, row).locator("td").nth(column);
async function reveal(page, row) {
  await page.evaluate((index) => {
    const scroller = document.querySelector(".ts-grid-scroll");
    const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row')?.offsetHeight || 32;
    scroller.scrollTop = Math.max(0, index * pitch - scroller.clientHeight / 2);
  }, row);
  await rowAt(page, row).waitFor();
}
const cellSelector = (row, column) => `table[aria-label="Table"] tbody tr[aria-rowindex="${row + 2}"] td:nth-of-type(${column + 1})`;
const ready = (page) => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const current = (page) => page.waitForFunction(() =>
  document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current" &&
  document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");

async function rowCount(page) {
  const projection = await observedTable(page);
  assert.equal(projection.native_table_profile, true, "Text/Number fixture is structurally native");
  assert.equal(await grid(page).locator(".ts-entry-row").count(), 0, "no draft at or above the insertion gate");
  await page.getByText("This table has reached the 128-row limit for adding rows here.", { exact: true }).waitFor();
  const declared = Number(await grid(page).getAttribute("aria-rowcount")) - 1;
  assert.equal(declared, projection.rows.length, "ARIA data rows match stored records, excluding drafts");
  const rendered = await grid(page).locator("tbody tr.ts-row").count();
  assert.ok(rendered < 400, `large table renders a window, not ${rendered} rows`);
  return declared;
}

async function cellText(page, row, column) {
  await reveal(page, row);
  return (await cellAt(page, row, column).textContent()) ?? "";
}

async function importSource(page, file) {
  await (await homeImportInput(page)).setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await dialog.waitFor();
  const types = dialog.locator("select");
  assert.equal(await types.count(), COLS);
  for (let c = 0; c < COLS; c++) {
    const type = c % 2 === 0 ? "text" : "number";
    assert.equal(await types.nth(c).inputValue(), type, "lossless mixed suggestions");
    // Explicit confirmation through the ordinary type controls.
    await types.nth(c).selectOption(type);
  }
  await dialog.getByRole("button", { name: "Import file", exact: true }).click();
  await ready(page);
}

async function edit(page, row, column, value) {
  await reveal(page, row);
  await cellAt(page, row, column).dblclick();
  const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await input.fill(value);
  await timed("edit", async () => {
    await input.press("Enter");
    await input.waitFor({ state: "hidden" });
    await current(page);
    await page.waitForFunction(([selector, expected]) =>
      document.querySelector(selector)?.textContent === expected, [cellSelector(row, column), value]);
  });
}

async function history(page, direction, row, column, value) {
  await timed(direction, async () => {
    await page.getByRole("button", { name: direction === "undo" ? "Undo" : "Redo", exact: true }).click();
    await current(page);
    await page.waitForFunction(([selector, expected]) =>
      document.querySelector(selector)?.textContent === expected, [cellSelector(row, column), value]);
  });
}

async function download(page, format, destination) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await timed(`prepare_${format}`, async () => {
    await page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true }).click();
    await page.getByRole("dialog", { name: "Confirm download", exact: true }).waitFor();
  });
  const consent = page.getByRole("dialog", { name: "Confirm download", exact: true });
  const downloaded = page.waitForEvent("download");
  await consent.getByRole("button", { name: "Download", exact: true }).click();
  await (await downloaded).saveAs(destination);
  await consent.waitFor({ state: "detached" });
  execFileSync("python3", ["-I", oracle, "verify", destination, String(ROWS), String(COLS), "edited"], { stdio: "inherit" });
}

// Read every UI row/cell and stable target, including across row windows.
// This checks the rendered data independently of the export parser.
async function allCells(page, edited) {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  assert.equal(await rowCount(page), ROWS);
  assert.deepEqual((await grid(page).locator("thead th").allTextContents()).slice(1), expected[`${ROWS}x${COLS}`][0]);
  const records = new Map(await page.evaluate(collectWindowedRows, { rowCount: ROWS, columnCount: COLS }));
  assert.equal(records.size, ROWS, "all rows independently read");
  const ids = [];
  for (let r = 0; r < ROWS; r++) {
    const cells = records.get(r);
    assert.equal(cells.length, COLS);
    for (let c = 0; c < COLS; c++) {
      assert.equal(cells[c].text, edited && r === (ROWS >> 1) && c === 1 ? "424242" : expected[`${ROWS}x${COLS}`][r + 1][c], `row ${r} column ${c}`);
      ids.push(cells[c].target);
    }
  }
  assert.equal(new Set(ids).size, ROWS * COLS, "unique cell identities");
  return ids;
}

async function closeToHome(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await unsaved.or(page.getByRole("heading", { name: "Tachiko Sheet", exact: true })).first().waitFor();
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}

async function refusedImport(page, file, label) {
  await (await homeImportInput(page)).setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  const refusal = page.getByRole("alert");
  await dialog.or(refusal).first().waitFor();
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await refusal.first().waitFor();
    const text = (await refusal.allTextContents()).join(" ");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    return text;
  }
  const text = (await refusal.allTextContents()).join(" ");
  assert.equal(await page.getByTestId("project-ready").count(), 0, `${label}: refusal opens no workbook`);
  return text;
}

try {
  for (const [rows, cols] of [[320, 2], [1000, 16]]) {
    ROWS = rows; COLS = cols;
    for (const format of ["csv", "xlsx"]) {
      const profile = await mkdtemp(path.join(work, "profile-"));
      const name = `mixed-${rows}x${cols}-${format}`;
      let page = await start(profile);
      await importSource(page, path.join(fixtures, `source-${rows}x${cols}.${format}`));
      const identities = await allCells(page, false);
      await edit(page, rows >> 1, 1, "424242");
      assert.deepEqual(await allCells(page, true), identities, "Edit retains every cell identity");
      await download(page, "xlsx", path.join(work, `${name}-edited.xlsx`));
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      await reveal(page, rows >> 1);
      await history(page, "undo", rows >> 1, 1, expected[`${rows}x${cols}`][(rows >> 1) + 1][1]);
      assert.deepEqual(await allCells(page, false), identities, "Undo retains every cell identity");
      await reveal(page, rows >> 1);
      await history(page, "redo", rows >> 1, 1, "424242");
      assert.deepEqual(await allCells(page, true), identities, "Redo retains every cell identity");
      for (const exportFormat of ["csv", "xlsx"]) await download(page, exportFormat, path.join(work, `${name}-before.${exportFormat}`));
      await page.getByRole("button", { name: "Save a copy", exact: true }).click();
      await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
      await page.getByRole("button", { name: "Create copy", exact: true }).click();
      await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
      await context.close(); context = undefined;
      page = await start(profile);
      await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
      await ready(page);
      assert.deepEqual(await allCells(page, true), identities, "full restart/reopen retains every cell identity and value");
      for (const exportFormat of ["csv", "xlsx"]) await download(page, exportFormat, path.join(work, `${name}-reopened.${exportFormat}`));
      await closeToHome(page);
      // Home is the ordinary import entry. Refusals protect the saved copy;
      // native-parity separately proves a resident occurrence/history unchanged.
      const refusals = {};
      for (const file of [`source-320x17.${format}`, `source-8407x2.${format}`, `source-1577x16.${format}`, `malformed.${format}`]) {
        refusals[file] = await refusedImport(page, path.join(fixtures, file), file);
        assert.match(refusals[file], file.startsWith("malformed") ? /file could not be read/ : /outside what this beta can open/);
      }
      // CSV keeps nonfinite-looking source Text; explicit Number must fail.
      await (await homeImportInput(page)).setInputFiles(path.join(fixtures, `nonfinite.${format}`));
      const review = page.getByRole("dialog", { name: "Review import preview", exact: true });
      await review.or(page.getByRole("alert")).first().waitFor();
      if (await review.count()) {
        await review.locator("select").nth(1).selectOption("number");
        await review.getByRole("button", { name: "Import file", exact: true }).click();
        await review.getByRole("alert").waitFor();
        assert.match(await review.getByRole("alert").textContent(), /column could not be converted to Number/);
        await review.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      assert.equal(await page.getByTestId("project-ready").count(), 0, "nonfinite confirmation opens no workbook");
      await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
      await ready(page);
      assert.deepEqual(await allCells(page, true), identities, "saved work intact after refusals");
      for (const exportFormat of ["csv", "xlsx"]) await download(page, exportFormat, path.join(work, `${name}-refused.${exportFormat}`));
      await context.close(); context = undefined;
      console.log(JSON.stringify({ case: name, status: "PASS", cells: rows * cols, refusals }));
    }
  }
} finally {
  if (context) await context.close();
  console.log(JSON.stringify({ suite: "mixed-import", timingsMs: timings }));
  if (process.env.MIXED_KEEP) console.log(JSON.stringify({ kept: work }));
  else await rm(work, { recursive: true, force: true });
}

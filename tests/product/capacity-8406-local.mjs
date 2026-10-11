// Sheet #150 consumer acceptance: 8,406 x 3 synthetic Text rows through the
// built product's normal UI only (Home file input, cell editor, Undo/Redo,
// Save a copy, full browser termination, reopen and browser downloads). An
// independent stdlib oracle checks every exported cell; no acceptance hook
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

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const oracle = path.join(root, "acceptance", "capacity-8406", "oracle.py");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const ROWS = 8406;
const EDITS = [
  [0, 0, '000-edited-雪,"first"'],
  [ROWS >> 1, 1, "https://example.invalid/edited-middle?x=0007"],
  [ROWS - 1, 2, "0001700008405999"],
];
const formats = (process.env.CAPACITY_FORMATS ?? "csv,xlsx").split(",");
const work = await mkdtemp(path.join(tmpdir(), "tachiko-capacity-8406-"));
const fixtures = path.join(work, "fixtures");
execFileSync("python3", ["-I", oracle, "generate", fixtures], { stdio: "inherit" });
const timings = {};
const timed = async (label, action) => {
  const started = performance.now();
  const result = await action();
  (timings[label] ??= []).push(Math.round(performance.now() - started));
  return result;
};
let context;

async function start(profile) {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await page.getByRole("region", { name: "Recovery", exact: true }).waitFor({ state: "detached" });
  return page;
}

const grid = (page) => page.getByRole("grid", { name: "Table", exact: true });
const cellAt = (page, row, column) => grid(page).locator("tbody tr").nth(row).locator("td").nth(column);
const ready = (page) => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const current = (page) => page.waitForFunction(() =>
  document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current" &&
  document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");

async function rowCount(page) {
  return grid(page).locator("tbody tr").count();
}

async function cellText(page, row, column) {
  return (await cellAt(page, row, column).textContent()) ?? "";
}

async function importSource(page, file) {
  await (await homeImportInput(page)).setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await dialog.waitFor();
  const types = dialog.locator("select");
  for (let index = 0; index < await types.count(); index++) {
    assert.equal(await types.nth(index).inputValue(), "text", "all three columns stay Text");
  }
  await timed("import", async () => {
    await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
    await ready(page);
    await grid(page).locator("tbody tr").nth(ROWS - 1).waitFor({ state: "attached" });
  });
}

async function edit(page, row, column, value) {
  const target = cellAt(page, row, column);
  await target.scrollIntoViewIfNeeded();
  await target.dblclick();
  const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await input.fill(value);
  await timed("edit", async () => {
    await input.press("Enter");
    await input.waitFor({ state: "hidden" });
    await current(page);
    await page.waitForFunction(([r, c, v]) =>
      document.querySelector('table[aria-label="Table"]')?.querySelectorAll("tbody tr")[r]?.querySelectorAll("td")[c]?.textContent === v,
    [row, column, value]);
  });
}

async function history(page, direction, row, column, value) {
  await timed(direction, async () => {
    await page.getByRole("button", { name: direction === "undo" ? "Undo" : "Redo", exact: true }).click();
    await current(page);
    await page.waitForFunction(([r, c, v]) =>
      document.querySelector('table[aria-label="Table"]')?.querySelectorAll("tbody tr")[r]?.querySelectorAll("td")[c]?.textContent === v,
    [row, column, value]);
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
  execFileSync("python3", ["-I", oracle, "verify", destination], { stdio: "inherit" });
}

async function assertEdited(page, label) {
  assert.equal(await rowCount(page), ROWS, `${label}: all rows present`);
  for (const [row, column, value] of EDITS) {
    assert.equal(await cellText(page, row, column), value, `${label}: edit at ${row},${column}`);
  }
  assert.equal(await cellText(page, 1, 0), "invented_00001", `${label}: unedited neighbour`);
  assert.equal(await cellText(page, 97, 2), "0001700000000097", `${label}: leading-zero timestamp text`);
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
  const dialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  const refusal = page.getByRole("alert");
  await dialog.or(refusal).first().waitFor();
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
    await refusal.first().waitFor();
    const text = (await refusal.allTextContents()).join(" ");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    return text;
  }
  const text = (await refusal.allTextContents()).join(" ");
  assert.equal(await page.getByTestId("project-ready").count(), 0, `${label}: refusal opens no workbook`);
  return text;
}

const results = [];
try {
  for (const format of formats) {
    const profile = await mkdtemp(path.join(work, `profile-${format}-`));
    const name = `capacity-8406-${format}`;
    let page = await start(profile);
    await importSource(page, path.join(fixtures, `source-${ROWS}.${format}`));
    assert.equal(await rowCount(page), ROWS, "imported row count");
    assert.match(await cellText(page, 0, 0), /^invented_00000,雪"quote"/, "readable first imported cell");
    assert.equal(await cellText(page, ROWS - 1, 1), "https://example.invalid/account/08405");
    for (const [row, column, value] of EDITS) await edit(page, row, column, value);
    const [lastRow, lastColumn] = EDITS[2];
    const [middleRow, middleColumn] = EDITS[1];
    const original = (row, column) => [
      `invented_${String(row).padStart(5, "0")}`,
      `https://example.invalid/account/${String(row).padStart(5, "0")}`,
      (row % 97 === 0 ? "000" : "") + String(1700000000000 + row),
    ][column];
    await history(page, "undo", lastRow, lastColumn, original(lastRow, lastColumn));
    await history(page, "undo", middleRow, middleColumn, original(middleRow, middleColumn));
    await history(page, "redo", middleRow, middleColumn, EDITS[1][2]);
    await history(page, "redo", lastRow, lastColumn, EDITS[2][2]);
    await assertEdited(page, "after history");

    await page.getByRole("button", { name: "Save a copy", exact: true }).click();
    await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
    await timed("save", async () => {
      await page.getByRole("button", { name: "Create copy", exact: true }).click();
      await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
    });

    // Complete browser termination, then a fresh process on the same profile.
    await context.close();
    context = undefined;
    page = await start(profile);
    await timed("reopen", async () => {
      await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
      await ready(page);
      await grid(page).locator("tbody tr").nth(ROWS - 1).waitFor({ state: "attached" });
    });
    await assertEdited(page, "after restart");
    for (const exportFormat of ["csv", "xlsx"]) {
      await download(page, exportFormat, path.join(work, `${name}-export.${exportFormat}`));
    }

    // Over-limit and malformed sources are refused without touching saved work.
    await closeToHome(page);
    const refusals = {};
    for (const file of [`source-${ROWS + 1}.${format}`, `malformed.${format}`]) {
      refusals[file] = await refusedImport(page, path.join(fixtures, file), file);
    }
    await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
    await ready(page);
    await assertEdited(page, "after refusals");
    await context.close();
    context = undefined;
    results.push({ format, status: "PASS", refusals });
    console.log(JSON.stringify({ case: `8,406 x 3 ${format} lifecycle`, status: "PASS", refusals }));
  }
} finally {
  if (context) await context.close().catch(() => undefined);
  console.log(JSON.stringify({ suite: "capacity-8406", timingsMs: timings }));
  if (!process.env.CAPACITY_KEEP) await rm(work, { recursive: true, force: true });
  else console.log(JSON.stringify({ kept: work }));
}
assert.equal(results.length, formats.length);

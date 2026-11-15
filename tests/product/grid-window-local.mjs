import { observeTableProjections, observedTable } from "./table-projection-observer.mjs";
// Row-windowing edge cases on a real imported table larger than the window
// threshold, through the normal UI:
// a draft kept while scrolling away, density change geometry, Undo while the
// Table panel is hidden, and the last rows.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const launchOptions = { headless: true, ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}), ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const UNIQUE = 260;
const DUPLICATES = 60;
const work = await mkdtemp(path.join(tmpdir(), "tachiko-grid-window-"));
const csv = path.join(work, "dupes.csv");
// Keep the original tall fixture for virtualization and a small wide one for freezing.
const rows = Array.from({ length: UNIQUE }, (_, index) => `item-${String(index).padStart(3, "0")},note ${index},code-${index}`);
await writeFile(csv, ["name,note,code", ...rows, ...rows.slice(0, DUPLICATES)].join("\r\n") + "\r\n");
const wideCsv = path.join(work, "wide.csv");
const extraColumns = Array.from({ length: 12 }, (_, index) => `extra${index}`);
const wideRows = rows.slice(0, 3).map((row, index) => `${row},${extraColumns.map(name => `${name}-${index}`).join(",")}`);
await writeFile(wideCsv, [`name,note,code,${extraColumns.join(",")}`, ...wideRows].join("\r\n") + "\r\n");

const grid = (page) => page.getByRole("grid", { name: "Table", exact: true });
const rowAt = (page, row) => grid(page).locator(`tbody tr[aria-rowindex="${row + 2}"]`);
const scrollTo = (page, row) => page.evaluate((index) => {
  const scroller = document.querySelector(".ts-grid-scroll");
  const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row')?.offsetHeight || 32;
  scroller.scrollTop = Math.max(0, index * pitch - scroller.clientHeight / 2);
}, row);
const geometry = (page) => page.evaluate(() => {
  const table = document.querySelector('table[aria-label="Table"]');
  const pitch = table.querySelector("tbody tr.ts-row").offsetHeight;
  const body = table.querySelector("tbody").offsetHeight;
  // The column totals row (tfoot) is counted by aria-rowcount but is not a body row.
  return { pitch, body, rows: Number(table.getAttribute("aria-rowcount")) - 2 - table.querySelectorAll("tr.ts-totals-row").length };
});
const pageErrors = [];

const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext({ colorScheme: "light" });
  await installDistRoutes(context, dist);
  await observeTableProjections(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(wideCsv);
  const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await dialog.or(page.getByRole("alert")).first().waitFor();
  assert.equal(await dialog.count(), 1, `import review opens: ${(await page.getByRole("alert").allTextContents()).join(" ")}`);
  await dialog.getByRole("button", { name: "Import file", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal((await observedTable(page)).columns.length, 15);

  // #292 item 7a: real wide-table freeze, keyboard reveal and width saves.
  const scroller = page.locator(".ts-grid-scroll");
  const headers = grid(page).locator("thead th.ts-column-header");
  const firstRow = grid(page).locator("tbody tr.ts-row").first();
  const firstCell = firstRow.locator("td").first();
  const commandCount = () => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const toggleFreeze = async () => {
    await scroller.evaluate(node => { node.scrollLeft = 0; });
    await headers.first().hover();
    await page.getByRole("button", { name: "Column actions for name", exact: true }).click();
    await page.getByRole("button", { name: "Freeze first column", exact: true }).click();
  };
  const resizeColumn = async (name, column, delta) => {
    await scroller.evaluate(node => { node.scrollLeft = 0; });
    const handle = page.getByRole("separator", { name: `Resize ${name}`, exact: true });
    const box = await handle.boundingBox();
    const before = await observedTable(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(revision => window.__observedTable?.revision !== revision, before.revision);
    await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    return (await observedTable(page)).columns[column].width;
  };
  const resizeC = delta => resizeColumn("code", 2, delta);
  // Save exactly the same drag with freeze off and on, starting at the same width.
  // Establish explicit widths first: the initial equal-share layout differs
  // from the fixed-width layout installed by the first saved resize.
  await resizeC(240);
  const baselineWidth = (await headers.nth(2).boundingBox()).width;
  const unfrozenWidth = await resizeC(40);
  await resizeC(-40);
  assert.ok(Math.abs((await headers.nth(2).boundingBox()).width - baselineWidth) < 1);
  const beforeToggle = await commandCount();
  await toggleFreeze();
  assert.equal(await commandCount(), beforeToggle, "freeze sends no command to Work");
  assert.equal(await grid(page).locator("thead .ts-frozen-first-column").count(), 1);
  const frozenWidth = await resizeC(40);
  assert.equal(frozenWidth, unfrozenWidth, "column C saves the same width with freeze on");
  const beforeHeader = await headers.first().boundingBox();
  const beforeBody = await firstCell.boundingBox();
  await scroller.evaluate(node => { node.scrollLeft = 900; });
  await page.waitForFunction(() => document.querySelector(".ts-grid-scroll").scrollLeft > 100);
  assert.ok(Math.abs((await headers.first().boundingBox()).x - beforeHeader.x) < 1, "A header stays fixed");
  assert.ok(Math.abs((await firstCell.boundingBox()).x - beforeBody.x) < 1, "A body stays fixed");
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : ".artifacts/freeze-first-column";
  await mkdir(out, { recursive: true });
  await scroller.screenshot({ path: path.join(out, "frozen-first-column-light.png") });
  await firstCell.focus();
  const assertActiveVisible = async column => {
    const cell = firstRow.locator("td").nth(column);
    await page.waitForFunction(index => {
      const row = document.querySelector("tbody tr.ts-row");
      return row?.querySelectorAll("td")[index] === document.activeElement;
    }, column);
    const active = await cell.boundingBox();
    const frozen = await firstCell.boundingBox();
    const port = await scroller.boundingBox();
    if (column > 0) assert.ok(active.x >= frozen.x + frozen.width - 1, `column ${column} clears A`);
    assert.ok(active.x + active.width <= port.x + port.width + 1, `column ${column} is within right edge`);
  };
  for (let column = 1; column < 15; column++) {
    await page.keyboard.press("ArrowRight");
    await assertActiveVisible(column);
  }
  for (let column = 13; column >= 0; column--) {
    await page.keyboard.press("ArrowLeft");
    await assertActiveVisible(column);
  }
  // Selection extension reveals its end without moving focus off the anchor.
  for (let column = 1; column < 15; column++) await page.keyboard.press("Shift+ArrowRight");
  const selectionEnd = await firstRow.locator("td").last().boundingBox();
  const frozenA = await firstCell.boundingBox();
  const scrollport = await scroller.boundingBox();
  assert.ok(selectionEnd.x >= frozenA.x + frozenA.width, "selection end clears frozen A");
  assert.ok(selectionEnd.x + selectionEnd.width <= scrollport.x + scrollport.width + 1, "selection end fits inside scrollport");
  await page.keyboard.press("Escape");
  // Wide A suspends freezing without changing the setting, then restores it.
  await page.setViewportSize({ width: 900, height: 720 });
  await scroller.evaluate(node => { node.scrollLeft = 0; });
  await resizeColumn("name", 0, 600 - (await headers.first().boundingBox()).width);
  await page.waitForFunction(() => !document.querySelector(".ts-frozen-first-column"));
  assert.ok(Math.abs((await headers.first().boundingBox()).width - 600) <= 1, "A is 600 px wide");
  const wideAStart = await firstCell.boundingBox();
  await scroller.evaluate(node => { node.scrollLeft = 100; });
  assert.ok(Math.abs((await firstCell.boundingBox()).x - wideAStart.x + 100) <= 1, "wide A scrolls normally");
  await scroller.evaluate(node => { node.scrollLeft = 0; });
  await headers.first().hover();
  const aMenu = headers.first().locator(".ts-column-overflow");
  await aMenu.getByRole("button", { name: "Column actions for name", exact: true }).click();
  assert.equal(await aMenu.getByRole("button", { name: "Freeze first column", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await aMenu.getByText("Column A is too wide to freeze in this window.", { exact: true }).isVisible(), true);
  await page.keyboard.press("Escape");
  await resizeColumn("name", 0, -440);
  await page.waitForFunction(() => Boolean(document.querySelector(".ts-frozen-first-column")));
  assert.equal(await page.getByText("Column A is too wide to freeze in this window.", { exact: true }).count(), 0);

  // Upward-clamped menus must paint above frozen headers and row gutters.
  await page.setViewportSize({ width: 800, height: 420 });
  for (const index of [0, 1]) {
    await scroller.evaluate(node => { node.scrollLeft = 0; });
    const header = headers.nth(index);
    await header.hover();
    const menu = header.locator(".ts-column-overflow");
    await menu.locator("summary").click();
    const controls = menu.locator(".ts-command-menu button, .ts-command-menu input, .ts-command-menu select");
    for (const control of [controls.first(), controls.last()]) {
      await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
      }), true, `column ${index} menu control is hit-testable`);
    }
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 720 });
  await page.waitForFunction(() => !document.querySelector(".ts-frozen-first-column"));
  assert.equal(await page.getByRole("button", { name: "Freeze first column", exact: true }).count(), 0, "phone hides toggle");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => Boolean(document.querySelector(".ts-frozen-first-column")));
  await toggleFreeze();
  assert.equal(await grid(page).locator(".ts-frozen-first-column").count(), 0);
  await scroller.evaluate(node => { node.scrollLeft = 0; });

  // Run the existing windowing cases against their original 320 × 3 fixture.
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(csv);
  await dialog.or(page.getByRole("alert")).first().waitFor();
  assert.equal(await dialog.count(), 1, "tall import review opens");
  await dialog.getByRole("button", { name: "Import file", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const imported = await observedTable(page);
  assert.equal(imported.native_table_profile, true, "imported all-Text fixture is structurally native");
  assert.equal(imported.rows.length, UNIQUE + DUPLICATES);
  assert.equal((await geometry(page)).rows, UNIQUE + DUPLICATES, "only stored records count toward window geometry");

  // Filtering across the windowing threshold remounts the table in both directions.
  // This capacity fixture keeps widths locally, without a Work revision change.
  const firstColumnResize = page.getByRole("separator", { name: "Resize name", exact: true });
  await firstColumnResize.press("ArrowRight");
  await firstColumnResize.press("Tab");
  await grid(page).and(page.locator(".ts-grid--sized")).waitFor();
  await toggleFreeze();
  await headers.first().hover();
  await page.getByRole("button", { name: "Column actions for name", exact: true }).click();
  await page.getByRole("button", { name: "Filter…", exact: true }).click();
  await page.getByRole("textbox", { name: "Filter name", exact: true }).fill("item-02");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.locator(".ts-grid-extent").waitFor({ state: "detached" });
  assert.equal(await grid(page).locator("tbody tr.ts-row").count(), 20);
  const checkRemountedFreeze = async () => {
    await page.setViewportSize({ width: 800, height: 720 });
    await page.waitForFunction(() => !document.querySelector(".ts-frozen-first-column"));
    await headers.first().hover();
    await page.getByRole("button", { name: "Column actions for name", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Freeze first column", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByText("Column A is too wide to freeze in this window.", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.waitForFunction(() => Boolean(document.querySelector(".ts-frozen-first-column")));
    assert.equal(await page.getByText("Column A is too wide to freeze in this window.", { exact: true }).count(), 0);
    await scroller.evaluate(node => { node.scrollLeft = 100; });
    assert.ok(await scroller.evaluate(node => node.scrollLeft > 0), "alignment is checked while horizontally scrolled");
    const gutter = await grid(page).locator(".ts-gutter-head").boundingBox();
    for (const cell of [headers.first(), firstCell]) {
      assert.ok(Math.abs((await cell.boundingBox()).x - gutter.x - gutter.width) <= 1, "frozen A aligns with the gutter after a remount and resize");
    }
    await scroller.evaluate(node => { node.scrollLeft = 0; });
  };
  await checkRemountedFreeze();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await page.locator(".ts-grid-extent").waitFor();
  assert.equal((await geometry(page)).rows, UNIQUE + DUPLICATES);
  await checkRemountedFreeze();
  await toggleFreeze();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Selecting a whole column must not reveal the far end of the range.
  for (const row of [0, 150]) {
    await scrollTo(page, row);
    await rowAt(page, row).waitFor();
    const scroller = page.locator(".ts-grid-scroll");
    const before = await scroller.evaluate(node => node.scrollTop);
    await page.locator("th.ts-column-header .ts-col-head").nth(1).click();
    assert.equal(await scroller.evaluate(node => node.scrollTop), before, "column selection preserves the viewport");
    assert.ok(await page.locator(".ts-cell--range-selected").count() > 1, "column selection remains visible");
  }
  await scrollTo(page, 0);
  await rowAt(page, 0).waitFor();

  // A live draft survives scrolling far away and back.
  await rowAt(page, 5).locator("td").nth(1).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("kept while scrolling");
  await scrollTo(page, UNIQUE + DUPLICATES - 1);
  await rowAt(page, UNIQUE + DUPLICATES - 1).waitFor();
  await scrollTo(page, 0);
  await rowAt(page, 0).waitFor();
  assert.equal(await editor.inputValue(), "kept while scrolling");
  await editor.press("Escape");

  // Spacer geometry follows a density change: every row keeps one pitch.
  for (const density of ["Compact", "Comfortable"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.locator(".ts-appearance-density-option").filter({ hasText: density }).click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="Table"]');
      const pitch = table.querySelector("tbody tr.ts-row").offsetHeight;
      return Math.abs(table.querySelector("tbody").offsetHeight - pitch * (Number(table.getAttribute("aria-rowcount")) - 2 - table.querySelectorAll("tr.ts-totals-row").length)) <= 2;
    });
  }

  // A taller viewport renders more rows instead of exposing blank spacer.
  await scrollTo(page, 150);
  await rowAt(page, 150).waitFor();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 1280, height: 2600 });
  await page.waitForFunction(() => {
    const scroller = document.querySelector(".ts-grid-scroll");
    const rendered = [...scroller.querySelectorAll("tbody tr.ts-row")];
    const last = rendered[rendered.length - 1];
    return last && last.getBoundingClientRect().bottom >= scroller.getBoundingClientRect().bottom - 1;
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Undo while the Table panel is hidden falls back to the initiating control
  // and never later steals focus when Table returns.
  for (const [offset, value] of [[20, "first change"], [10, "undo me"]]) {
    await scrollTo(page, UNIQUE - offset);
    await rowAt(page, UNIQUE - offset).locator("td").nth(1).dblclick();
    await editor.fill(value);
    await editor.press("Enter");
    await editor.waitFor({ state: "hidden" });
  }
  await scrollTo(page, 0);
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  await page.waitForTimeout(300);
  assert.equal(await undo.evaluate((node) => !node.disabled && node === document.activeElement), true, "hidden-table Undo keeps focus on its own (still enabled) control");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab"), true, "returning to Table does not replay an old focus request");

  // Large (capacity) tables are a single sheet and refuse deduplication in
  // this kit, so a windowed table cannot shrink or switch through the UI
  // today; the stale-window clamp is covered by grid-window unit tests.
  await scrollTo(page, UNIQUE + DUPLICATES - 1);
  await rowAt(page, UNIQUE + DUPLICATES - 1).waitFor();
  assert.equal(await rowAt(page, UNIQUE + DUPLICATES - 1).locator("td").first().textContent(), `item-${String(DUPLICATES - 1).padStart(3, "0")}`);
  assert.deepEqual(pageErrors, [], "no render errors");
  await context.close();
  console.log(JSON.stringify({ case: "grid window: frozen A, filter remount geometry, keyboard reveal, width saves, phone, draft scroll, density, hidden-table undo, bottom rows", status: "PASS" }));
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";
import { observeTableProjections, observedTable } from "./table-projection-observer.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const work = await mkdtemp(path.join(tmpdir(), "sheet-freeze-panes-"));
const csv = path.join(work, "freeze-30x300.csv");
const value = (r, c) => `r${r}-c${c} column content`;
await writeFile(csv, [
  Array.from({ length: 30 }, (_, c) => `field${c}`).join(","),
  ...Array.from({ length: 300 }, (_, r) => Array.from({ length: 30 }, (_, c) => value(r, c)).join(",")),
].join("\r\n"));
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installDistRoutes(context, process.env.WORK_DIST ?? path.join(root, "dist-acceptance"));
  await observeTableProjections(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(csv);
  await page.getByRole("dialog", { name: "Review import preview", exact: true })
    .getByRole("button", { name: "Import file", exact: true }).click();
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await ready();
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const scroller = page.locator(".ts-grid-scroll");
  const headers = grid.locator("thead .ts-column-header");
  const row = r => grid.locator(`tbody tr.ts-row[aria-rowindex="${r + 2}"]`);
  const toggle = page.getByRole("group", { name: "View commands", exact: true })
    .getByRole("button", { name: "Freeze First Column", exact: true });
  assert.equal(await headers.count(), 30);
  assert.equal(await grid.getAttribute("aria-rowcount"), "302");
  assert.ok(await grid.locator("tbody tr.ts-row").count() < 200, "fixture uses row windowing");
  // The initial grid shares the viewport among all columns. AutoFit through
  // the UI creates a genuinely wide table before testing twenty-column scroll.
  for (let c = 0; c < 30; c++) {
    const before = await observedTable(page);
    await page.getByRole("separator", { name: `Resize field${c}`, exact: true }).dblclick();
    await page.waitForFunction(revision => window.__observedTable?.revision !== revision, before.revision);
    await ready();
  }
  await scroller.evaluate(node => { node.scrollLeft = 0; });
  const commandCount = () => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const beforeToggle = await commandCount();
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await commandCount(), beforeToggle, "freeze changes only view state");

  // Resizing A while frozen must keep header and body at the same width.
  const beforeWidth = (await headers.first().boundingBox()).width;
  const handle = await page.getByRole("separator", { name: "Resize field0", exact: true }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up();
  await ready();
  await page.waitForFunction(width => document.querySelector("thead .ts-column-header").getBoundingClientRect().width > width + 30, beforeWidth);

  // Scroll twenty columns to the right, then into rows outside the first window.
  const horizontal = await scroller.evaluate(node => {
    const headers = [...node.querySelectorAll("thead .ts-column-header")];
    const target = headers.slice(0, 20).reduce((sum, th) => sum + th.getBoundingClientRect().width, 0);
    node.scrollLeft = target;
    node.scrollTop = node.querySelector("tbody tr.ts-row").offsetHeight * 220;
    return { target, max: node.scrollWidth - node.clientWidth };
  });
  await row(225).waitFor();
  const port = await scroller.boundingBox();
  const head = await headers.first().boundingBox();
  assert.ok(Math.abs(head.y - port.y) <= 2, "header row stays at the top during vertical scroll");
  assert.ok(horizontal.max >= horizontal.target, "fixture permits scrolling twenty columns");
  assert.ok(Math.abs(await scroller.evaluate(node => node.scrollLeft) - horizontal.target) <= 1, "wide table actually scrolled twenty columns");
  for (const r of [225, 226]) {
    const cells = row(r).locator("td");
    const a = await cells.first().boundingBox();
    const other = await cells.nth(20).boundingBox();
    assert.ok(Math.abs(a.x - head.x) <= 1, "frozen cells align with column A header");
    assert.ok(Math.abs(a.width - head.width) <= 1, "resized frozen widths align");
    assert.ok(Math.abs(a.y - other.y) <= 1, "frozen cells align with their rows");
    assert.ok(a.y >= head.y + head.height && a.y + a.height <= port.y + port.height, "frozen cell is visible");
    assert.equal(await cells.first().innerText(), value(r, 0));
  }
  const frozen = row(225).locator("td").first();
  await frozen.click();
  assert.equal(await frozen.evaluate(node => node === document.activeElement), true, "frozen cell accepts selection");
  await frozen.dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("edited frozen name");
  await editor.press("Enter");
  await editor.waitFor({ state: "hidden" });
  await ready();
  assert.equal(await frozen.innerText(), "edited frozen name");

  const scrollLeft = await scroller.evaluate(node => node.scrollLeft);
  const beforeOff = await commandCount();
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await grid.locator(".ts-frozen-first-column").count(), 0);
  assert.equal(await commandCount(), beforeOff, "unfreeze sends no semantic command");
  assert.equal(await scroller.evaluate(node => node.scrollLeft), scrollLeft);
  assert.ok((await frozen.boundingBox()).x < port.x, "column A scrolls offscreen after unfreezing");

  // Desktop View dispatch reaches the same view-only state and visible toggle.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tachiko-menu", { detail: "freeze-first-column" })));
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.ok((await frozen.boundingBox()).x >= port.x, "native command freezes A");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("tachiko-menu", { detail: "freeze-first-column" })));
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  console.log("PASS: N8 freeze panes, 30 columns x 300 rows, resize, windowed alignment, header, selection/editing, unfreeze, native command");
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}

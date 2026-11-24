import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) throw new Error("WORK_DIST must name a built product");
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await installDistRoutes(context, dist);
const page = await context.newPage();
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const grid = page.getByRole("grid", { name: "Table", exact: true });
const cell = (row, column) => grid.locator(`tbody tr[aria-rowindex="${row + 2}"] td.ts-cell`).nth(column);
const center = async locator => {
  const box = await locator.boundingBox();
  assert.ok(box, "hit target is rendered");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
};
try {
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Zoom test");
  for (let index = 1; index <= 4; index++) {
    if (index > 1) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
    await dialog.getByLabel(`Column ${index} name`, { exact: true }).fill(`Column ${index}`);
  }
  await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first();
  await draft.focus();
  await draft.evaluate(node => {
    const data = new DataTransfer();
    data.setData("text/plain", Array.from({ length: 300 }, (_, row) => ["a", "b", "c", "d"].map(value => `${value}${row}`).join("\t")).join("\n"));
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByText("Added 300 rows. Save to keep these changes.", { exact: true }).waitFor(); await ready();
  const slider = page.getByRole("slider", { name: "Grid zoom percentage" });
  const setZoom = async value => {
    await slider.fill(String(value));
    await page.getByRole("group", { name: "Grid zoom", exact: true }).locator("output").filter({ hasText: `${value}%` }).waitFor();
    await page.getByLabel("Name Box", { exact: true }).fill("A2");
    await page.getByLabel("Name Box", { exact: true }).press("Enter");
  };
  const baseHeight = await cell(0, 0).locator(".ts-cell-value").evaluate(node => node.getBoundingClientRect().height);
  for (const zoom of [50, 125, 200]) {
    await setZoom(zoom);
    const fontHeight = await cell(0, 0).locator(".ts-cell-value").evaluate(node => node.getBoundingClientRect().height);
    assert.ok(Math.abs(fontHeight / baseHeight - zoom / 100) < 0.1, `text scales at ${zoom}%`);
    const click = await center(cell(1, 1));
    await page.mouse.click(click.x, click.y);
    assert.equal(await cell(1, 1).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByLabel("Name Box", { exact: true }).inputValue(), "B3");
    await drag(await center(cell(0, 1)), await center(cell(2, 3)));
    const selected = grid.locator('tbody td.ts-cell[aria-selected="true"]');
    assert.equal(await selected.count(), 9, `exact B2:D4 at ${zoom}%`);
    assert.deepEqual(await selected.locator(".ts-cell-value").allTextContents(), ["b0", "c0", "d0", "b1", "c1", "d1", "b2", "c2", "d2"]);
    await cell(0, 0).click();
    await page.keyboard.type(`zoom${zoom}`); await page.keyboard.press("Enter"); await ready();
    await cell(0, 0).locator(".ts-cell-value").filter({ hasText: `zoom${zoom}` }).waitFor();
    // Drag the scaled fill handle through the real hit target.
    await cell(0, 0).click();
    // The visible handle is a pseudo-element; its span has a zero-size box.
    const source = await cell(0, 0).boundingBox();
    const inset = 3.5 * zoom / 100;
    await drag({ x: source.x + source.width - inset, y: source.y + source.height - inset }, await center(cell(1, 0)));
    await ready();
    await cell(1, 0).locator(".ts-cell-value").filter({ hasText: `zoom${zoom}` }).waitFor();
    const header = grid.getByRole("columnheader", { name: "Column 1", exact: true });
    await header.hover();
    const grip = page.getByRole("separator", { name: "Resize Column 1", exact: true });
    const before = (await header.boundingBox()).width;
    const start = await center(grip);
    await drag(start, { x: start.x + 40 * zoom / 100, y: start.y }); await ready();
    const after = (await header.boundingBox()).width;
    assert.ok(Math.abs(after - before - 40 * zoom / 100) < 3, `resize uses logical width at ${zoom}%: before=${before}, after=${after}, expected delta=${40 * zoom / 100}`);
    assert.ok(await grid.locator("tbody tr.ts-row").count() < 300, "windowing stays enabled");
    const nameBox = page.getByLabel("Name Box", { exact: true });
    await nameBox.fill("D301"); await nameBox.press("Enter");
    await cell(299, 3).waitFor();
    assert.equal(await cell(299, 3).evaluate(node => node === document.activeElement), true);
    const last = await cell(299, 3).boundingBox();
    const port = await page.locator(".ts-grid-scroll").boundingBox();
    assert.ok(last.y >= port.y && last.y + last.height <= port.y + port.height + 1, `last row revealed at ${zoom}%`);
    // Wheel scrolling must render the rows at the new scroll offset, too.
    await page.locator(".ts-grid-scroll").evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
    await grid.locator('tbody tr[aria-rowindex="152"]').waitFor();
    console.log(`PASS: ${zoom}% click, B2:D4, edit, fill, resize, scaled text and windowing`);
  }
  const scrollport = page.locator(".ts-grid-scroll");
  await scrollport.evaluate(node => { node.style.width = "500px"; });
  for (const zoom of [100, 125]) {
    await setZoom(zoom);
    await scrollport.evaluate(node => { node.scrollLeft = 0; node.scrollTop = 0; });
    const port = await scrollport.boundingBox();
    const start = await center(cell(0, 0));
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(port.x + port.width + 30, port.y + port.height + 30, { steps: 10 });
    await page.waitForFunction(() => {
      const port = document.querySelector(".ts-grid-scroll");
      const selected = [...port.querySelectorAll('tbody tr.ts-row:has(td[aria-selected="true"])')];
      return port.scrollTop > 300 && port.scrollLeft > 100 && selected.some(row => Number(row.getAttribute("aria-rowindex")) > 20);
    });
    await page.mouse.up();
    assert.equal(await cell(0, 0).getAttribute("aria-selected"), "true", `drag keeps its anchor selected at ${zoom}%`);
    assert.ok(await grid.locator('tbody tr.ts-row:has(td[aria-selected="true"])').evaluateAll(rows => rows.some(row => Number(row.getAttribute("aria-rowindex")) > 20)), `selection extends beyond row 20 while scrolling at ${zoom}%`);
    const reverse = await scrollport.evaluate(node => {
      const port = node.getBoundingClientRect();
      const target = document.elementFromPoint(port.x + 200, port.y + 150).closest("td[data-work-field]");
      const box = target.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, row: Number(target.closest("tr").getAttribute("aria-rowindex")), top: node.scrollTop, left: node.scrollLeft };
    });
    await page.mouse.move(reverse.x, reverse.y); await page.mouse.down();
    await page.mouse.move(port.x - 30, port.y - 30, { steps: 10 });
    await page.waitForFunction(({ top, left, row }) => {
      const port = document.querySelector(".ts-grid-scroll");
      return port.scrollTop < top - 150 && port.scrollLeft < left - 50
        && [...port.querySelectorAll('tbody tr.ts-row:has(td[aria-selected="true"])')].some(item => Number(item.getAttribute("aria-rowindex")) < row);
    }, reverse);
    await page.mouse.up();
    console.log(`PASS: drag selection scrolls and extends in all four directions at ${zoom}%`);
  }
  await scrollport.evaluate(node => { node.style.width = ""; });
  await page.evaluate(() => {
    const listeners = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.__columnMenuResizeListeners = listeners;
    window.addEventListener = function(type, listener, ...options) {
      if (type === "resize") listeners.add(listener);
      return add(type, listener, ...options);
    };
    window.removeEventListener = function(type, listener, ...options) {
      if (type === "resize") listeners.delete(listener);
      return remove(type, listener, ...options);
    };
  });
  for (const zoom of [50, 100, 200]) {
    await setZoom(zoom);
    // Earlier resize cases widened A; keep freeze eligible at both scales.
    const header = grid.getByRole("columnheader", { name: "Column 1", exact: true });
    await header.hover();
    const grip = page.getByRole("separator", { name: "Resize Column 1", exact: true });
    const start = await center(grip);
    const width = (await header.boundingBox()).width;
    await drag(start, { x: start.x + 140 * zoom / 100 - width, y: start.y }); await ready();
    const trigger = grid.getByRole("button", { name: "Column actions for Column 1", exact: true });
    await trigger.click();
    const menu = grid.locator("details[open] .ts-command-menu");
    await page.waitForFunction(() => window.__columnMenuResizeListeners.size === 1);
    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(menuBox.x >= 15 && menuBox.x + menuBox.width <= viewport.width - 15, `menu within viewport at ${zoom}%`);
    assert.ok(Math.abs(menuBox.y - Math.max(16, Math.min(triggerBox.y + triggerBox.height + 4, viewport.height - menuBox.height - 16))) < 2, `menu aligned vertically at ${zoom}%`);
    assert.ok(menuBox.y >= 0 && menuBox.y + menuBox.height <= viewport.height, `menu height fits viewport at ${zoom}%`);
    await page.setViewportSize({ width: 1300, height: 700 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resizedTriggerBox = await trigger.boundingBox();
    const resizedMenuBox = await menu.boundingBox();
    assert.ok(resizedMenuBox.y >= 0 && resizedMenuBox.y + resizedMenuBox.height <= 700, `resized menu stays inside viewport at ${zoom}%`);
    assert.ok(Math.abs(resizedMenuBox.y - Math.max(16, Math.min(resizedTriggerBox.y + resizedTriggerBox.height + 4, 700 - resizedMenuBox.height - 16))) < 2, `resized menu remains anchored at ${zoom}%`);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await menu.getByRole("button", { name: "Freeze first column", exact: true }).click();
    await scrollport.evaluate(node => { node.scrollLeft = 100; });
    const frozen = await grid.locator("thead .ts-frozen-first-column").boundingBox();
    const gutter = await grid.locator(".ts-gutter-head").boundingBox();
    assert.ok(Math.abs(frozen.x - gutter.x - gutter.width) < 2, `frozen column follows gutter at ${zoom}%`);
    await trigger.click();
    await page.waitForFunction(() => window.__columnMenuResizeListeners.size === 0);
    await menu.getByRole("button", { name: "Freeze first column", exact: true }).click();
    console.log(`PASS: frozen offset and column menu placement at ${zoom}%`);
  }
  await setZoom(200);
  await scrollport.evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await scrollport.evaluate(node => {
    const port = node.getBoundingClientRect();
    return [...node.querySelectorAll("tbody tr.ts-row")].some(row => {
      const box = row.getBoundingClientRect();
      return box.top <= port.top + 150 && box.bottom > port.top + 150;
    });
  }), "200% zoom then resize renders rows at the viewport instead of blank spacer");
  console.log("PASS: windowed rows remain visible after zoom 200% then window resize");
  await page.getByRole("button", { name: "Reset grid zoom", exact: true }).click();
  assert.equal(await slider.inputValue(), "100");
  await page.getByRole("button", { name: "Zoom in grid", exact: true }).click();
  assert.equal(await slider.inputValue(), "110");
  await page.getByRole("button", { name: "Zoom out grid", exact: true }).click();
  assert.equal(await slider.inputValue(), "100");
  const port = page.locator(".ts-grid-scroll");
  await port.hover();
  for (const modifier of ["Control", "Meta"]) {
    await page.keyboard.down(modifier); await page.mouse.wheel(0, -100); await page.keyboard.up(modifier);
    await page.waitForFunction(() => document.querySelector('[aria-label="Grid zoom percentage"]').value === "110");
    await page.keyboard.down(modifier); await page.mouse.wheel(0, 100); await page.keyboard.up(modifier);
    await page.waitForFunction(() => document.querySelector('[aria-label="Grid zoom percentage"]').value === "100");
  }
  await page.getByRole("group", { name: "Grid zoom", exact: true }).hover();
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
  assert.equal(await slider.inputValue(), "100", "wheel outside grid does not change grid zoom");
  console.log("PASS: reset, 10% buttons, Ctrl/Meta wheel confined to grid");
} finally { await context.close(); await browser.close(); }

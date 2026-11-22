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
    assert.ok(await grid.locator('tbody tr[aria-rowindex="20"] td[aria-selected="true"]').count() > 0, `selection extends while scrolling at ${zoom}%`);
    console.log(`PASS: drag selection scrolls down and right at ${zoom}%`);
  }
  await scrollport.evaluate(node => { node.style.width = ""; });
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

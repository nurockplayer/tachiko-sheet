// #563 / #560: exercise the browser's mousedown -> focus -> click ordering.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST ?? fileURLToPath(new URL("../../dist-acceptance", import.meta.url));
const rows = Array.from({ length: 450 }, (_, index) =>
  [1, 2, 3, 4].map(column => `R${index + 2}C${column}`));
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: LOCAL_ORIGIN });
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const scroller = page.locator(".ts-grid-scroll");
  const cell = (row, column) => grid.locator(`tbody tr.ts-row[aria-rowindex="${row}"] td.ts-cell`).nth(column - 1);
  const anchor = cell(2, 2);
  const commandKey = process.platform === "darwin" ? "Meta" : "Control";

  async function pointerClick(target, shift = false) {
    await expect(target).toBeInViewport();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.down();
    if (shift) await expect(anchor).toBeFocused();
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  }

  async function wheelTo(row) {
    const delta = await scroller.evaluate((node, row) => {
      const pitch = node.querySelector("tbody tr.ts-row").offsetHeight;
      return Math.max(0, (row - 2) * pitch - node.clientHeight / 2) - node.scrollTop;
    }, row);
    await scroller.hover();
    await page.mouse.wheel(0, delta);
    await expect(cell(row, 4)).toBeInViewport();
  }

  async function expectHighlights(lastRow) {
    const mounted = await grid.locator("tbody tr.ts-row").evaluateAll(nodes => nodes.map(row => ({
      row: Number(row.getAttribute("aria-rowindex")),
      cells: [...row.querySelectorAll("td.ts-cell")].map(cell => ({
        selected: cell.getAttribute("aria-selected") === "true",
        highlighted: cell.classList.contains("ts-cell--range-selected"),
      })),
    })));
    assert.ok(mounted.length > 0 && mounted.length < 100, "450 rows are windowed");
    for (const row of mounted) {
      assert.equal(row.cells.length, 4);
      row.cells.forEach((cell, index) => {
        const selected = row.row >= 2 && row.row <= lastRow && index >= 1 && index <= 3;
        assert.deepEqual(cell, { selected, highlighted: selected }, `row ${row.row}, column ${index + 1}`);
      });
    }
  }

  for (const extension of ["Shift+click", "Ctrl+Shift+End"]) {
    // Each case starts with a fresh workbook and selects B2 with the mouse.
    await page.goto(LOCAL_ORIGIN);
    await waitForColdHome(page);
    await (await homeImportInput(page)).setInputFiles({ name: "anchor.csv", mimeType: "text/csv",
      buffer: Buffer.from(["A,B,C,D", ...rows.map(row => row.join(","))].join("\r\n") + "\r\n"),
    });
    const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    await expect(grid).toHaveAttribute("aria-rowcount", "452");
    await pointerClick(anchor);
    await expect(anchor).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Name Box", exact: true })).toHaveValue("B2");
    const unrelatedRow = cell(12, 1);
    await expect(unrelatedRow).toBeAttached();
    await wheelTo(400);
    await expect(unrelatedRow).toHaveCount(0);
    await expect(anchor).toBeAttached(); // Focus pins it in the DOM, outside the visible window.
    await expect(anchor).not.toBeInViewport();
    await expect(anchor).toBeFocused();

    const lastRow = extension === "Shift+click" ? 400 : 451;
    if (extension === "Shift+click") await pointerClick(cell(400, 4), true);
    else await page.keyboard.press(`${commandKey}+Shift+End`);
    await expect(anchor).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Name Box", exact: true })).toHaveValue("B2");
    await wheelTo(lastRow);
    await expect(cell(lastRow, 4)).toHaveAttribute("aria-selected", "true");
    await expectHighlights(lastRow);

    // Real Copy must include every row, including the unmounted middle rows.
    await page.keyboard.press(`${commandKey}+c`);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      rows.slice(0, lastRow - 1).map(row => row.slice(1).join("\t")).join("\n"),
      `${extension}: exact B2:D${lastRow} clipboard rectangle`);
    await wheelTo(2);
    await expectHighlights(lastRow);
    await expect(anchor).toBeFocused();
    console.log(`PASS ${extension}: B2:D${lastRow}, full Copy and highlights after scrolling back; anchor bug not reproduced`);
  }
  assert.deepEqual(errors, [], "no browser errors");
  console.log("PASS #563: 2 real-input windowed range-anchor cases; product bug not reproduced");
} finally {
  await browser.close();
}

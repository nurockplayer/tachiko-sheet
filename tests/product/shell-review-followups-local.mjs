// R9a: production UI and real Worker/WASM; no manufactured command replies.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const work = await mkdtemp(path.join(tmpdir(), "sheet-r9a-"));
const csv = path.join(work, "focus.csv");
await writeFile(csv, ["name,note,code", ...Array.from({ length: 320 }, (_, i) => `item-${i},note-${i},${i === 0 ? "needle" : `code-${i}`}`)].join("\r\n"));
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const failures = [];
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const row = (page, index) => page.locator(`tbody tr.ts-row[aria-rowindex="${index + 2}"]`);
async function check(name, test) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let page;
  try {
    await installDistRoutes(context, process.env.WORK_DIST ?? "dist-acceptance");
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
    await test(page);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(error);
    console.error(`FAIL ${name}: ${error.stack}`);
    if (page) console.error("Focus diagnostics:", await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), tabs: document.querySelector('[aria-label="Sheets"]')?.outerHTML, trace: window.__deleteFocusTrace })));
  }
  finally { await context.close(); }
}
async function importRows(page) {
  await (await homeImportInput(page)).setInputFiles(csv);
  await page.getByRole("dialog", { name: "Review import preview", exact: true }).getByRole("button", { name: "Import file", exact: true }).click();
  await ready(page);
}
async function activeCell(page, index, column) {
  await page.waitForFunction(({ index, column }) => document.querySelector(`tbody tr.ts-row[aria-rowindex="${index + 2}"]`)?.querySelectorAll("td")[column] === document.activeElement, { index, column });
}
try {
  await check("#394/#395: header focuses the first visible cell after scrolling", async page => {
    await importRows(page);
    await row(page, 0).locator("td").first().focus();
    const scroller = page.locator(".ts-grid-scroll");
    await scroller.evaluate(node => { node.scrollTop = 150 * node.querySelector("tr.ts-row").offsetHeight; });
    await row(page, 150).waitFor();
    const before = await scroller.evaluate(node => node.scrollTop);
    await page.locator("th.ts-column-header").nth(1).locator(".ts-col-head").click();
    const result = await page.evaluate(() => {
      const port = document.querySelector(".ts-grid-scroll").getBoundingClientRect();
      const active = document.activeElement;
      const visible = [...document.querySelectorAll('tbody tr.ts-row td:nth-of-type(2)')].find(cell => {
        const r = cell.getBoundingClientRect(); return r.bottom > port.top && r.top < port.bottom;
      });
      return { visible: active === visible, field: active?.getAttribute("data-work-field"), expected: visible?.getAttribute("data-work-field") };
    });
    assert.equal(result.visible, true, "active cell is the first visible row, not pinned row 1");
    assert.equal(result.field, result.expected);
    assert.equal(await scroller.evaluate(node => node.scrollTop), before, "header selection preserves scroll position");
  });
  for (const navigate of [false, true]) await check(`#389/#390: Find resets Tab origin (${navigate ? "Next match" : "Enter match"})`, async page => {
    await importRows(page);
    await row(page, 0).locator("td").first().focus();
    await page.keyboard.press("Tab"); await activeCell(page, 0, 1);
    await page.keyboard.press("Control+f");
    await page.getByRole("searchbox", { name: "Find in table" }).fill("needle");
    if (navigate) await page.getByRole("button", { name: "Next match", exact: true }).click();
    else await page.getByRole("searchbox", { name: "Find in table" }).press("Enter");
    await page.getByTestId("find-bar").getByRole("button", { name: "Close", exact: true }).click();
    await activeCell(page, 0, 2);
    await page.keyboard.press("F2");
    await page.getByTestId("cell-editor").fill("edited needle");
    await page.keyboard.press("Enter"); await ready(page);
    await activeCell(page, 1, 2);
    assert.equal(await row(page, 0).locator("td").nth(2).innerText(), "edited needle");
  });
  await check("#387.2: cancel restores origin; confirmed delete focuses surviving active tab", async page => {
    await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready(page);
    const tabs = page.getByRole("tablist", { name: "Sheets", exact: true }).getByRole("tab");
    await tabs.nth(1).click(); await ready(page);
    const deletedId = await tabs.nth(1).getAttribute("id");
    await tabs.nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete sheet…" }).click();
    let dialog = page.getByRole("dialog", { name: "Delete sheet", exact: true });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(id => document.activeElement?.id === id, deletedId);
    await tabs.nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete sheet…" }).click();
    dialog = page.getByRole("dialog", { name: "Delete sheet", exact: true });
    await page.evaluate(() => {
      window.__deleteFocusTrace = [];
      document.addEventListener("focusin", event => window.__deleteFocusTrace.push(event.target.outerHTML.slice(0, 300)));
    });
    await dialog.getByRole("button", { name: "Delete sheet", exact: true }).click();
    await ready(page);
    await page.waitForFunction(() => {
      const active = document.querySelector('[aria-label="Sheets"] [aria-selected="true"]');
      return active && active === document.activeElement;
    });
    assert.equal(await tabs.count(), 1);
    assert.notEqual(await tabs.first().getAttribute("id"), deletedId);
  });
  assert.equal(failures.length, 0, failures.map(error => error.message).join("\n"));
  console.log("PASS shell review follow-ups: header, Find/Tab and deleted-tab focus");
} finally { await browser.close(); await rm(work, { recursive: true, force: true }); }

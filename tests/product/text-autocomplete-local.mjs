// #292 / N15: real Work distinct values and ordinary cell-editor key events.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";
import { observeTableProjections, observedTable } from "./table-projection-observer.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installDistRoutes(context, dist);
  await observeTableProjections(context);
  await context.addInitScript(() => {
    window.__completionQueries = 0;
    const Original = window.Worker;
    window.Worker = class extends Original {
      postMessage(message, ...args) {
        if (message.request?.type === "query_distinct_values") window.__completionQueries++;
        return super.postMessage(message, ...args);
      }
    };
  });
  const page = await context.newPage();
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const editor = page.getByTestId("cell-editor");
  const queryCount = () => page.evaluate(() => window.__completionQueries);
  const selection = () => editor.evaluate(node => [node.selectionStart, node.selectionEnd]);
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles({ name: "autocomplete.csv", mimeType: "text/csv", buffer: Buffer.from(
    "City,Ambiguous,Amount,Day,Other\nTokyo,Osaka,1234,2026-11-22,12345\nOsaka,Okinawa,12,2026-11-23,2026-11-22\n,,,,\n",
  ) });
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  for (const [i, type] of ["text", "text", "number", "date", "text"].entries()) await preview.locator(".ts-import-column select").nth(i).selectOption(type);
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await preview.waitFor({ state: "detached" }); await ready();
  const table = await observedTable(page);
  const cell = (column, row = 2) => page.getByTestId(`cell:${table.rows[row].id}:${table.columns[column].id}`);
  const begin = async column => { await cell(column).focus(); await page.keyboard.press("F2"); await editor.waitFor(); };
  const propose = async () => {
    await begin(0);
    await editor.pressSequentially("to");
    await expect(editor).toHaveValue("Tokyo");
    await expect.poll(selection).toEqual([2, 5]);
  };
  await propose();
  await editor.press("Enter"); await ready();
  await expect(cell(0)).toHaveText("Tokyo");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();

  for (const key of ["Backspace", "Delete"]) {
    await propose(); await editor.press(key);
    await expect(editor).toHaveValue("to");
    await editor.press("Enter"); await ready();
    await expect(cell(0)).toHaveText("to");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  }
  await propose(); await editor.press("n");
  await expect(editor).toHaveValue("ton");
  await editor.press("Enter"); await ready(); await expect(cell(0)).toHaveText("ton");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();

  await propose(); await editor.press("Tab"); await ready(); await expect(cell(0)).toHaveText("Tokyo");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  await propose(); await editor.press("Escape"); await expect(cell(0)).toHaveText("");

  await begin(1); await editor.pressSequentially("o"); await expect(editor).toHaveValue("o");
  await editor.press("Enter"); await ready(); await expect(cell(1)).toHaveText("o");
  await begin(0); await editor.pressSequentially("="); await expect(editor).toHaveValue("="); await editor.press("Escape");

  // One cached list per edit, regardless of the number of input events.
  const before = await queryCount();
  await begin(0);
  await expect.poll(queryCount).toBe(before + 1);
  await editor.pressSequentially("totototototo");
  await expect(editor).toHaveValue("totototototo");
  assert.equal(await queryCount(), before + 1);
  await editor.press("Escape");
  for (const [column, prefix] of [[2, "12"], [3, "2026-11-2"], [4, "123"], [4, "2026-11-"]]) {
    const before = await queryCount();
    await begin(column); await editor.pressSequentially(prefix);
    await expect(editor).toHaveValue(prefix);
    if (column === 2 || column === 3) assert.equal(await queryCount(), before, "number/date editors do not query completions");
    await editor.press("Escape");
  }
  // Other-cell edits retain their normal commit path.
  await begin(2); await editor.pressSequentially("42"); await editor.press("Enter"); await ready();
  await expect(cell(2)).toHaveText("42");
  console.log("PASS N15: inline selection, Enter/Tab, rejection, ambiguity, exclusions, cached query, other-cell edit");
} finally {
  await browser.close();
}

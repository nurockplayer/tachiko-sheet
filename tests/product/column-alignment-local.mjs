import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "sheet-alignment-"));
let context;
try {
  context = await chromium.launchPersistentContext(path.join(dir, "profile"), { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, process.env.WORK_DIST ?? "dist-acceptance");
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.setViewportSize({ width: 1600, height: 900 }); await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New table", exact: true });
  await create.getByLabel("Table name", { exact: true }).fill("Alignment");
  for (const [i, name, type] of [[1,"Text","text"],[2,"Number","number"],[3,"Date","date"],[4,"YesNo","boolean"]]) {
    if (i > 1) await create.getByRole("button", { name: "Add column", exact: true }).click();
    await create.getByLabel(`Column ${i} name`, { exact: true }).fill(name);
    await create.getByLabel(`Column ${i} type`, { exact: true }).selectOption(type);
  }
  await create.getByRole("button", { name: "Create table", exact: true }).click(); await ready();
  const draft = page.locator('.ts-entry-row [data-entry-field]').first(); await draft.focus();
  await draft.evaluate(node => { const data = new DataTransfer(); data.setData("text/plain", "hello\t123\t2026-11-07\ttrue"); node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  await draft.press("Enter"); await ready();
  const cells = () => page.locator('tbody tr.ts-row').first().locator('.ts-cell');
  const check = async expected => assert.deepEqual(await cells().evaluateAll(nodes => nodes.map(node => getComputedStyle(node).textAlign)), expected);
  const choose = async (column, value) => {
    await page.getByRole("columnheader", { name: column, exact: true }).hover();
    await page.getByRole("button", { name: `Column actions for ${column}`, exact: true }).click();
    await page.getByRole("button", { name: "Alignment…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Column alignment", exact: true });
    await dialog.getByRole("radio", { name: value, exact: true }).check();
    await dialog.getByRole("button", { name: "Save alignment", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await ready();
  };
  await check(["left", "right", "right", "center"]);
  await choose("Text", "Right"); await choose("Number", "Left"); await choose("Date", "Center");
  await check(["right", "left", "center", "center"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(); await check(["right", "left", "right", "center"]);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(); await check(["right", "left", "center", "center"]);
  await cells().first().dblclick(); assert.equal(await page.getByTestId("cell-editor").evaluate(node => getComputedStyle(node).textAlign), "right"); await page.keyboard.press("Escape");
  await choose("Date", "Default (by type)"); await check(["right", "left", "right", "center"]);
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Aligned"); await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click(); await waitForColdHome(page);
  await page.getByRole("button", { name: "Open saved Aligned", exact: true }).click(); await ready(); await check(["right", "left", "right", "center"]);
  await page.getByRole("tab", { name: "Import & export", exact: true }).click(); await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(dir, "alignment.xlsx"); await (await download).saveAs(file);
  await page.getByRole("button", { name: "Close project", exact: true }).click(); await waitForColdHome(page); await (await homeImportInput(page)).setInputFiles(file);
  await page.getByRole("dialog", { name: "Review import preview", exact: true }).getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  console.log("XLSX imported alignment:", await cells().evaluateAll(nodes => nodes.map(node => getComputedStyle(node).textAlign)));
  console.log("PASS: column alignment defaults, overrides, history, editor and save/reopen");
} finally { if (context) await context.close(); await rm(dir, { recursive: true, force: true }); }

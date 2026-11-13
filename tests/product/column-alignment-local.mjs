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
  await context.addInitScript(() => {
    window.alignmentEvidence = { requests: [], widthRequests: [], hold: false, held: null, worker: null };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          const evidence = window.alignmentEvidence;
          if (evidence.hold && evidence.requests.some(request => request.id === event.data.id) && event.data.response?.type === "published") {
            evidence.hold = false; evidence.held = event.data; evidence.worker = this; event.stopImmediatePropagation();
          }
        });
      }
      postMessage(message, ...args) {
        if (message.request?.type === "set_column_alignment") window.alignmentEvidence.requests.push(structuredClone(message));
        if (message.request?.type === "set_column_width") window.alignmentEvidence.widthRequests.push(structuredClone(message));
        return super.postMessage(message, ...args);
      }
    };
  });
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
  await page.getByRole("columnheader", { name: "Text", exact: true }).hover();
  await page.getByRole("button", { name: "Column actions for Text", exact: true }).click();
  await page.getByRole("button", { name: "Alignment…", exact: true }).click();
  const pendingDialog = page.getByRole("dialog", { name: "Column alignment", exact: true });
  await pendingDialog.getByRole("radio", { name: "Right", exact: true }).check();
  await page.evaluate(() => { window.alignmentEvidence.hold = true; });
  await pendingDialog.getByRole("button", { name: "Save alignment", exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.alignmentEvidence.held !== null);
  assert.equal(await page.evaluate(() => window.alignmentEvidence.requests.length), 1);
  for (const key of ["Tab", "Shift+Tab", "Tab"]) {
    await page.keyboard.press(key);
    assert.equal(await pendingDialog.evaluate(node => node.contains(document.activeElement)), true);
  }
  await page.evaluate(() => { const evidence = window.alignmentEvidence; evidence.worker.dispatchEvent(new MessageEvent("message", { data: evidence.held })); });
  await pendingDialog.waitFor({ state: "hidden" }); await ready();
  await check(["right", "right", "right", "center"]);
  await choose("Text", "Default (by type)");
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
  // An active draft must survive a resize attempt without publishing a revision.
  await cells().first().dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("unfinished draft");
  const revisionBeforeResize = await cells().first().getAttribute("data-work-revision");
  const requestsBeforeResize = await page.evaluate(() => window.alignmentEvidence.widthRequests.length);
  const blockedResize = page.getByRole("separator", { name: "Resize Text", exact: true });
  await blockedResize.dispatchEvent("keydown", { key: "ArrowRight" });
  await blockedResize.dispatchEvent("keyup", { key: "ArrowRight" });
  await blockedResize.dispatchEvent("blur");
  assert.equal(await editor.inputValue(), "unfinished draft");
  await page.keyboard.press("Escape"); await ready();
  assert.equal(await cells().first().getAttribute("data-work-revision"), revisionBeforeResize);
  assert.equal(await page.evaluate(() => window.alignmentEvidence.widthRequests.length), requestsBeforeResize);
  const widthsBeforeFirst = await page.locator("thead th.ts-column-header").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  const resize = page.getByRole("separator", { name: "Resize Text", exact: true });
  const box = await resize.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2); await page.mouse.up(); await ready();
  const widthsAfterFirst = await page.locator("thead th.ts-column-header").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  assert.ok(Math.abs(widthsAfterFirst[1] - widthsBeforeFirst[1]) <= 2, `next width: ${widthsBeforeFirst[1]} → ${widthsAfterFirst[1]}`);
  const beforeCombined = widthsAfterFirst[0];
  const requestsBeforeCombined = await page.evaluate(() => window.alignmentEvidence.widthRequests.length);
  const combinedBox = await resize.boundingBox();
  await page.mouse.move(combinedBox.x + combinedBox.width / 2, combinedBox.y + combinedBox.height / 2);
  await page.mouse.down(); await page.mouse.move(combinedBox.x + combinedBox.width / 2 + 60, combinedBox.y + combinedBox.height / 2); await page.mouse.up();
  await resize.focus(); await page.keyboard.press("ArrowRight"); await resize.blur();
  await page.waitForFunction(count => window.alignmentEvidence.widthRequests.length === count + 2, requestsBeforeCombined);
  await ready();
  const combinedWidth = await page.getByRole("columnheader", { name: "Text", exact: true }).evaluate(node => node.getBoundingClientRect().width);
  assert.ok(Math.abs(combinedWidth - beforeCombined - 76) <= 2, `combined width: ${beforeCombined} → ${combinedWidth}`);
  assert.equal(await page.evaluate(() => window.alignmentEvidence.widthRequests.length), requestsBeforeCombined + 2);
  const secondResize = page.getByRole("separator", { name: "Resize Number", exact: true });
  const secondBox = await secondResize.boundingBox();
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.mouse.down(); await page.mouse.move(secondBox.x + secondBox.width / 2 + 40, secondBox.y + secondBox.height / 2); await page.mouse.up(); await ready();
  const widthsAfterSecond = await page.locator("thead th.ts-column-header").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  assert.ok(widthsAfterSecond.every((width, i) => i === 0 || i === 1 || Math.abs(width - widthsAfterFirst[i]) <= 1), `widths after second resize: ${widthsAfterFirst} → ${widthsAfterSecond}`);
  assert.ok(Math.abs(widthsAfterSecond[1] - widthsAfterFirst[1] - 40) <= 1, `second width: ${widthsAfterFirst[1]} → ${widthsAfterSecond[1]}`);
  const otherWidthsAfter = widthsAfterSecond.slice(1);
  const widthBeforeExport = await page.getByRole("columnheader", { name: "Text", exact: true }).evaluate(node => node.getBoundingClientRect().width);
  await page.getByRole("tab", { name: "Import & export", exact: true }).click(); await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(dir, "alignment.xlsx"); await (await download).saveAs(file);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page); await (await homeImportInput(page)).setInputFiles(file);
  await page.getByRole("dialog", { name: "Review import preview", exact: true }).getByRole("button", { name: "Import file", exact: true }).click(); await ready();
  const importedWidth = await page.getByRole("columnheader", { name: "Text", exact: true }).evaluate(node => node.getBoundingClientRect().width);
  assert.ok(Math.abs(importedWidth - widthBeforeExport) <= 1, `width: ${widthBeforeExport} → ${importedWidth}`);
  const importedOtherWidths = await page.locator("thead th.ts-column-header").evaluateAll(nodes => nodes.slice(1).map(node => node.getBoundingClientRect().width));
  assert.ok(Math.abs(importedOtherWidths[0] - otherWidthsAfter[0]) <= 1, `resized width after import: ${otherWidthsAfter[0]} → ${importedOtherWidths[0]}`);
  assert.ok(importedOtherWidths.slice(1).every(width => Math.abs(width - 160) <= 1), `default widths after import: ${importedOtherWidths.slice(1)}`);
  const importedAlignment = await cells().evaluateAll(nodes => nodes.map(node => getComputedStyle(node).textAlign));
  console.log("XLSX imported alignment:", importedAlignment.join(", "));
  console.log("PASS: column alignment defaults, overrides, history, editor and save/reopen");
} finally { if (context) await context.close(); await rm(dir, { recursive: true, force: true }); }

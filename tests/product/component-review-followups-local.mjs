// R3: real built UI and pinned Worker/WASM; only transport timing and a stale
// request witness are controlled. No replacement runtime replies or UI state.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";
import { tabToDialogAction } from "./pending-dialog-focus.mjs";

const browser = await chromium.launch({ headless: true,
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const errors = [];
const schemas = JSON.parse(await readFile(new URL("../fixtures/release-plan.roproj/schemas.json", import.meta.url), "utf8"));
const fields = Object.fromEntries(schemas[0].fields.map(field => [field.key, field.id]));
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
try {
  await installDistRoutes(context, process.env.WORK_DIST ?? "dist-acceptance");
  await context.addInitScript(() => {
    const evidence = window.__r3 = { requests: [], replies: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          evidence.replies.push(structuredClone(event.data));
          if (event.data.id === evidence.holdId) {
            event.stopImmediatePropagation();
            evidence.held = event.data;
            evidence.worker = this;
            evidence.holdId = null;
          }
        });
      }
      postMessage(message, ...args) {
        if (message.request?.type === "set_column_date_format" && evidence.arm) {
          message = structuredClone(message);
          if (evidence.arm === "stale") message.request.expected_revision = "r3-stale-witness";
          evidence.arm = null;
          evidence.holdId = message.id;
        }
        evidence.requests.push(structuredClone(message));
        return super.postMessage(message, ...args);
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(LOCAL_ORIGIN);
  await openReleasePlanExample(page);
  const rows = page.getByRole("grid", { name: "Table", exact: true }).locator("tbody tr.ts-row");
  const cell = (row, key) => rows.nth(row).locator(`td[data-work-field="${fields[key]}"]`);
  const bar = page.getByTestId("formula-bar-input");
  const reason = page.getByTestId("formula-bar-reason");

  // A real cross-row A1 formula produces Work's copy warning. A Boolean cell
  // supplies the simultaneous non-editable reason that used to hide it.
  await page.setViewportSize({ width: 390, height: 900 });
  const gridTop = (await rows.first().boundingBox()).y;
  await cell(1, "priority").click();
  await bar.fill("=C3*D2");
  await bar.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="formula-bar-reason"]')?.textContent.includes("Copying this formula"));
  await cell(0, "confirmed").click();
  const full = await reason.textContent();
  assert.match(full, /This column cannot hold a formula/);
  assert.match(full, /Copying this formula/);
  assert.equal(await reason.getAttribute("title"), full);
  assert.equal(await reason.getAttribute("aria-label"), full);
  assert.ok((await bar.getAttribute("aria-describedby")).split(" ").includes(await reason.getAttribute("id")));
  assert.equal((await reason.boundingBox()).height, 18);
  assert.equal(await reason.evaluate(node => node.scrollWidth > node.clientWidth), true, "long combined message is ellipsized");
  assert.ok(Math.abs((await rows.first().boundingBox()).y - gridTop) < 1, "warning appearance keeps grid geometry");
  await cell(0, "impact").click();
  await bar.fill("=1+2");
  assert.equal(await reason.textContent(), "");
  assert.ok(Math.abs((await rows.first().boundingBox()).y - gridTop) < 1, "warning clearing keeps grid geometry");
  await bar.press("Escape");
  console.log("PASS: reason and translation warning share an accessible fixed-height line; grid stays still");

  await page.setViewportSize({ width: 1200, height: 900 });
  await cell(0, "impact").dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("=SUM(");
  const hint = page.locator(".ts-formula-hint");
  await hint.waitFor();
  // Move the real editing cell to each viewport edge without replacing its
  // anchor or hint. Resizing and scrolling exercise the placement listeners.
  for (const [width, height] of [[1200, 900], [250, 700]]) {
    await page.setViewportSize({ width, height });
    await cell(0, "impact").evaluate(node => {
      node.style.cssText = "position:fixed;right:0;bottom:0;width:120px;height:30px;z-index:30";
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForFunction(() => {
      const box = document.querySelector(".ts-formula-hint")?.getBoundingClientRect();
      return box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    });
    const anchor = await cell(0, "impact").boundingBox();
    const placed = await hint.boundingBox();
    assert.ok(placed.y + placed.height <= anchor.y + 1, "bottom-edge hint flips above its cell");
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  }
  await editor.press("Escape");
  await cell(0, "impact").evaluate(node => node.style.removeProperty("position"));
  console.log("PASS: real formula hint fits bottom/right edges and a viewport narrower than its text");

  const dates = await context.newPage();
  dates.setDefaultTimeout(30000);
  dates.on("pageerror", error => errors.push(error.message));
  await dates.goto(LOCAL_ORIGIN); await waitForColdHome(dates);
  await dates.getByRole("button", { name: "New table", exact: true }).click();
  const create = dates.getByRole("dialog", { name: "New table", exact: true });
  await create.getByLabel("Table name", { exact: true }).fill("R3 dates");
  await create.getByLabel("Column 1 name", { exact: true }).fill("When");
  await create.getByLabel("Column 1 type", { exact: true }).selectOption("date");
  await create.getByRole("button", { name: "Create table", exact: true }).click(); await ready(dates);
  await dates.getByRole("columnheader", { name: "When", exact: true }).hover();
  await dates.getByRole("button", { name: "Column actions for When", exact: true }).click();
  await dates.getByRole("button", { name: "Date format…", exact: true }).click();
  const dialog = dates.getByRole("dialog", { name: "Date format", exact: true });
  const selected = dialog.getByRole("radio", { name: "7/11/2026", exact: true });
  await selected.check();
  const save = dialog.getByRole("button", { name: "Save format", exact: true });
  const inside = async () => assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
  await dates.evaluate(() => { window.__r3.arm = "stale"; });
  await tabToDialogAction(dates, dialog, save);
  await dates.keyboard.press("Enter");
  await dates.waitForFunction(() => Boolean(window.__r3.held));
  await inside();
  assert.equal(await save.isDisabled(), true);
  assert.equal(await dialog.getByRole("radio").evaluateAll(nodes => nodes.every(node => node.disabled)), true);
  for (const key of ["Tab", "Shift+Tab", "Tab", "Escape"]) { await dates.keyboard.press(key); await inside(); }
  const held = await dates.evaluate(() => window.__r3.held);
  assert.equal(held.status, "error", "the pinned runtime really refuses the stale request");
  assert.match(JSON.stringify(held.error), /stale|revision/i);
  await dates.evaluate(() => { const e = window.__r3; e.worker.dispatchEvent(new MessageEvent("message", { data: e.held })); e.held = null; });
  await dialog.getByRole("alert").waitFor();
  await dates.waitForFunction(() => document.activeElement?.matches('input[type="radio"]:checked'));
  assert.equal(await selected.isChecked(), true);
  assert.equal(await selected.evaluate(node => node === document.activeElement), true);
  console.log("PASS: Date pending Tab/Shift+Tab/Escape stay inside; real refusal restores selected radio");

  // The same kept draft succeeds on retry through the unmodified runtime.
  await save.click(); await dialog.waitFor({ state: "hidden" }); await ready(dates);
  await dates.getByRole("columnheader", { name: "When", exact: true }).hover();
  await dates.getByRole("button", { name: "Column actions for When", exact: true }).click();
  await dates.getByRole("button", { name: "Date format…", exact: true }).click();
  assert.equal(await selected.isChecked(), true, "successful retry stores the kept Date format");
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("PASS: kept Date format succeeds on retry and is selected when reopened");
} finally { await context.close(); await browser.close(); }

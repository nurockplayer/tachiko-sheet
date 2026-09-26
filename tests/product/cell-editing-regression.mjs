// #105 Steward outcomes: real key events against the unchanged real kit/seed.
// Added by the lead before production implementation; no scalar/formula mocks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : null);
if (!url) { console.error("BLOCKED: WORK_CLIENT_URL or WORK_DIST is required."); process.exit(78); }
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const schemas = JSON.parse(await readFile(new URL("../fixtures/release-plan.roproj/schemas.json", import.meta.url), "utf8"));
const fields = Object.fromEntries(schemas[0].fields.map((field) => [field.key, field.id]));
const fixture = fileURLToPath(new URL("../fixtures/release-plan.roproj", import.meta.url));
const cell = (page, key) => page.getByTestId(`cell:${expected.entity}:${fields[key]}`);
const editor = (page) => page.getByRole("textbox", { name: "Edit cell", exact: true });
const state = (page) => page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
const dispatches = (page) => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
const focused = (target) => target.evaluate((node) => node === document.activeElement);
async function open(page) {
  await page.goto(url);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();
}
async function entry(page, key, mode = "double-click") {
  const target = cell(page, key);
  if (mode === "double-click") await target.dblclick();
  else { await target.focus(); await page.keyboard.press(mode); }
  await editor(page).waitFor();
  return editor(page);
}
async function keys(input, text, prefix = "") {
  let buffer = prefix;
  for (const character of text) {
    await input.press(character === " " ? "Space" : character);
    buffer += character;
    assert.equal(await input.inputValue(), buffer, `complete buffer after key ${JSON.stringify(character)}`);
    assert.equal(await focused(input), true, "typing keeps focus in the same editor");
  }
}
async function replace(input, text) {
  await input.press("ControlOrMeta+A");
  await keys(input, text);
}
async function published(page, input, key, value, commitKey = "Enter") {
  const count = await dispatches(page);
  const previousReceipt = await page.evaluate(() => window.__tachikoAcceptance.lastReceipt());
  if (commitKey === "Tab" || commitKey === "Shift+Tab") {
    await page.evaluate(() => {
      window.__cellEditFocusEvents = [];
      window.__cellEditFocusListener = (event) => {
        if (event.target.matches('[data-testid^="cell:"]')) {
          window.__cellEditFocusEvents.push({ id: event.target.dataset.testid, receipt: window.__tachikoAcceptance.lastReceipt() });
        }
      };
      document.addEventListener("focusin", window.__cellEditFocusListener);
    });
  }
  await input.press(commitKey);
  await input.waitFor({ state: "hidden" });
  assert.equal((await cell(page, key).textContent()).trim(), String(value));
  assert.equal(await dispatches(page), count + 1, "accepted scalar dispatched exactly once");
  if (commitKey === "Tab" || commitKey === "Shift+Tab") {
    const receipt = await page.evaluate(() => window.__tachikoAcceptance.lastReceipt());
    const events = await page.evaluate(() => {
      document.removeEventListener("focusin", window.__cellEditFocusListener);
      return window.__cellEditFocusEvents;
    });
    assert.ok(events.length > 0, "accepted Tab returns to grid focus");
    assert.notDeepEqual(receipt, previousReceipt, "a fresh publication receipt exists");
    for (const event of events) assert.deepEqual(event.receipt, receipt, "every grid focus event follows the accepted publication receipt");
  }
}
const cases = [
  ["continuous boolean, numeric and Text typing; exact Enter publication", async (page) => {
    for (const [key, value] of [["confirmed", "false"], ["impact", "12345"], ["title", "Release plan"]]) {
      const before = await state(page); const count = await dispatches(page);
      const input = await entry(page, key); await replace(input, value);
      assert.equal(await dispatches(page), count, "draft typing dispatches no Execute");
      assert.deepEqual(await state(page), before, "draft leaves authoritative revision/bytes unchanged");
      await published(page, input, key, value);
      assert.equal(await focused(cell(page, key)), true, "Enter returns focus to originating cell");
      assert.notEqual((await state(page)).revision, before.revision);
    }
  }],
  ["Enter, F2 and type-to-start preserve editor caret, selection and deletion", async (page) => {
    const before = await state(page); const count = await dispatches(page);
    for (const mode of ["Enter", "F2", "a"]) {
      const input = await entry(page, "title", mode);
      if (mode === "a") { assert.equal(await input.inputValue(), "a"); await keys(input, "bcde", "a"); }
      else await replace(input, "abcde");
      await input.press("ArrowLeft");
      assert.equal(await input.inputValue(), "abcde");
      assert.equal(await input.evaluate((node) => node.selectionStart), 4);
      await input.press("ArrowLeft");
      await input.press("ArrowRight");
      assert.equal(await input.evaluate((node) => node.selectionStart), 4);
      await input.press("Shift+ArrowLeft");
      assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd]), [3, 4]);
      await input.press("Backspace"); assert.equal(await input.inputValue(), "abce");
      await input.press("Delete"); assert.equal(await input.inputValue(), "abc");
      await input.press("Escape");
      assert.equal(await focused(cell(page, "title")), true);
      assert.deepEqual(await state(page), before);
      assert.equal(await dispatches(page), count, "Escape never publishes");
    }
    const target = cell(page, "impact"); await target.focus();
    await page.keyboard.press("ArrowRight"); assert.equal(await focused(cell(page, "friction")), true);
    await page.keyboard.press("ArrowLeft"); assert.equal(await focused(target), true);
    await page.keyboard.press("Tab"); assert.equal(await focused(cell(page, "friction")), true);
    await page.keyboard.press("Shift+Tab"); assert.equal(await focused(target), true);
    await page.keyboard.press("ArrowDown");
    assert.match(await page.evaluate(() => document.activeElement.dataset.testid), new RegExp(`:${fields.impact}$`));
    assert.equal(await focused(target), false);
    await page.keyboard.press("ArrowUp"); assert.equal(await focused(target), true);
  }],
  ["Tab and Shift+Tab publish complete scalars once before moving grid focus", async (page) => {
    let input = await entry(page, "impact", "F2"); await replace(input, "12345");
    await published(page, input, "impact", "12345", "Tab");
    assert.equal(await focused(cell(page, "friction")), true);
    input = await entry(page, "friction", "Enter"); await replace(input, "12");
    await published(page, input, "friction", "12", "Shift+Tab");
    assert.equal(await focused(cell(page, "impact")), true);
  }],
  ["invalid numeric/boolean retain full drafts and never move focus or publish", async (page) => {
    for (const [key, value] of [["impact", "not a number"], ["confirmed", "maybe"]]) {
      const before = await state(page); const count = await dispatches(page);
      const input = await entry(page, key); await replace(input, value);
      await input.press("Tab"); await page.getByRole("alert").waitFor();
      assert.equal(await input.inputValue(), value); assert.equal(await focused(input), true);
      assert.deepEqual(await state(page), before);
      // Numeric validation is core-owned and rejects one dispatch; boolean parse rejects locally.
      assert.equal(await dispatches(page), count + (key === "impact" ? 1 : 0));
      await input.press("Escape"); assert.equal(await focused(cell(page, key)), true);
    }
  }],
  ["scalar edit keeps fixed impact=3 / priority=8 Table and Brief oracles", async (page) => {
    const input = await entry(page, "impact"); await replace(input, "3");
    await published(page, input, "impact", "3");
    assert.equal((await cell(page, "priority").textContent()).trim(), "8");
    const observation = await page.evaluate(() => window.__tachikoAcceptance.observe());
    assert.equal(observation.impact, 3); assert.equal(observation.priority, 8);
    assert.equal(await cell(page, "priority").getAttribute("aria-readonly"), "true");
    for (const mode of ["Enter", "F2", "a"]) {
      await cell(page, "priority").focus(); await page.keyboard.press(mode);
      assert.equal(await editor(page).count(), 0, "computed cell remains read-only");
    }
    await cell(page, "priority").dblclick(); assert.equal(await editor(page).count(), 0);
    for (const key of ["impact", "priority"]) {
      const fact = cell(page, key);
      assert.equal(await fact.getAttribute("data-work-occurrence"), observation.occurrence);
      assert.equal(await fact.getAttribute("data-work-revision"), observation.revision);
      assert.equal(await fact.getAttribute("data-work-currentness"), "current");
    }
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    for (const [key, value] of [["impact", "3"], ["priority", "8"]]) {
      const fact = page.getByTestId(`brief:${expected.entity}:${fields[key]}`);
      assert.equal((await fact.textContent()).trim(), value);
      assert.equal(await fact.getAttribute("data-work-occurrence"), observation.occurrence);
      assert.equal(await fact.getAttribute("data-work-revision"), observation.revision);
      assert.equal(await fact.getAttribute("data-work-currentness"), "current");
    }
  }],
  ["synthetic composing keys do not publish, restart, cancel or navigate", async (page) => {
    const before = await state(page); const count = await dispatches(page);
    const input = await entry(page, "title"); await replace(input, "abc");
    for (const key of ["x", "ArrowLeft", "ArrowRight", "Enter", "Tab", "Escape", "F2"]) {
      for (const legacy of [false, true]) {
        await input.evaluate((node, { key, legacy }) => node.dispatchEvent(new KeyboardEvent("keydown", {
          key, bubbles: true, isComposing: !legacy, keyCode: legacy ? 229 : 0,
        })), { key, legacy });
        assert.equal(await input.inputValue(), "abc"); assert.equal(await focused(input), true);
        assert.equal(await dispatches(page), count);
      }
    }
    assert.deepEqual(await state(page), before);
    await input.press("Escape");
  }],
  ["blur retains draft without publishing; unknown reply is never replayed", async (page) => {
    const before = await state(page); const count = await dispatches(page);
    const input = await entry(page, "impact"); await replace(input, "12345");
    await cell(page, "friction").click();
    assert.equal(await input.inputValue(), "12345"); assert.deepEqual(await state(page), before);
    assert.equal(await dispatches(page), count, "click-away does not auto-publish");
    await input.focus(); await input.press("Escape");
    const retry = await entry(page, "impact"); await replace(retry, "3");
    await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
    await retry.press("Enter");
    await page.getByTestId("operation-outcome").filter({ hasText: "Outcome needs review" }).waitFor();
    await page.evaluate(() => window.__tachikoAcceptance.settleFaultWindow());
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    assert.equal(await dispatches(page), count + 1, "unknown outcome has no automatic replay");
    assert.equal((await page.evaluate(() => window.__tachikoAcceptance.unknownObservation())).staleValuesPresentedAsCurrent, false);
  }],
  ["copy name, notes and report text accept real keys without the grid defect", async (page) => {
    await page.getByRole("button", { name: "Save a copy", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Copy name", exact: true });
    await replace(name, "typed-copy");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    const notes = page.getByRole("textbox", { name: "Decision notes", exact: true });
    const before = await state(page); const count = await dispatches(page);
    await replace(notes, "Typed notes");
    assert.equal(await dispatches(page), count); assert.deepEqual(await state(page), before);
    await page.getByRole("button", { name: "Apply notes", exact: true }).click();
    await page.waitForFunction(() => window.__tachikoAcceptance.observe().then((s) => s.notes === "Typed notes"));
    assert.equal(await dispatches(page), count + 1);
    // Fresh normal entry for the existing Catalog/Sales report fixture.
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("button", { name: "Close without saving", exact: true }).click();
    await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
    await page.getByTestId("project-ready").waitFor();
    await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
    await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
    for (const [label, value] of [["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"], ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"]]) {
      await page.getByLabel(label, { exact: true }).selectOption(value);
    }
    await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
    await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Create bar report", exact: true }).click();
    for (const label of ["Title", "Category label", "Value label"]) {
      const control = page.getByRole("textbox", { name: label, exact: true });
      await replace(control, `Typed ${label}`);
    }
    await page.locator('.ts-report-canvas[data-report-ready="true"]').waitFor();
  }],
];
let browser;
try { browser = await chromium.launch({ headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
}); } catch (error) { console.error("BLOCKED: Chromium launch failed.", error.message); process.exit(78); }
let failures = 0;
let blocked = 0;
try {
  for (const [name, run] of cases) {
    const context = await browser.newContext();
    let fixtureReady = false;
    try {
      if (!process.env.WORK_CLIENT_URL) await installDistRoutes(context, process.env.WORK_DIST);
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      await open(page);
      fixtureReady = true;
      await run(page);
      console.log(JSON.stringify({ case: name, status: "PASS" }));
    } catch (error) {
      if (fixtureReady) failures++; else blocked++;
      console.error(JSON.stringify({ case: name, status: fixtureReady ? "FAIL" : "BLOCKED", error: error.message }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ suite: "cell-editing-regression", cases: cases.length, failures, blocked }));
process.exitCode = blocked ? 78 : failures ? 1 : 0;

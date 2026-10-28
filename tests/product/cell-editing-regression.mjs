// #105 Steward outcomes: real key events against the unchanged real kit/seed.
// Added by the lead before production implementation; no scalar/formula mocks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, openFolder, openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : null);
if (!url) { console.error("BLOCKED: WORK_CLIENT_URL or WORK_DIST is required."); process.exit(78); }
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const schemas = JSON.parse(await readFile(new URL("../fixtures/release-plan.roproj/schemas.json", import.meta.url), "utf8"));
const fields = Object.fromEntries(schemas[0].fields.map((field) => [field.key, field.id]));
const fixture = fileURLToPath(new URL("../fixtures/release-plan.roproj", import.meta.url));
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const messyCsv = path.join(root, "acceptance", "j3-interop", "fixtures", "messy.csv");
const j4CanaryFolder = path.join(process.env.WORK_DIST ?? path.join(root, "dist-acceptance"), "examples", "j4-catalog-sales");
const cell = (page, key) => page.getByTestId(`cell:${expected.entity}:${fields[key]}`);
const editor = (page) => page.getByRole("textbox", { name: "Edit cell", exact: true });
const state = (page) => page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
const dispatches = (page) => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
const focused = (target) => target.evaluate((node) => node === document.activeElement);
async function open(page) {
  await page.goto(url);
  await openReleasePlanExample(page);
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
  await input.click();
  await input.press("ControlOrMeta+A");
  const value = await input.inputValue();
  assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd]), [0, value.length], "real Select All selects the complete enabled input");
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
      const destination = await cell(page, key).evaluate(node => {
        const field = node.dataset.testid.split(":").at(-1);
        return [...(node.parentElement.nextElementSibling?.querySelectorAll("td") ?? [])].find(cell => cell.dataset.testid?.endsWith(":" + field))?.dataset.testid ?? node.dataset.testid;
      });
      await published(page, input, key, value);
      await page.waitForFunction(id => document.activeElement?.dataset.testid === id, destination);
      assert.equal(await page.getByTestId(destination).evaluate(node => node === document.activeElement), true, "Enter accepts and moves down in the same column");
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
  ["double-click inside a dirty editor selects a word without restarting the draft", async (page) => {
    const before = await state(page); const count = await dispatches(page);
    const input = await entry(page, "title", "F2");
    await replace(input, "abc def");
    const sameInput = await input.elementHandle();
    const position = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      const context = document.createElement("canvas").getContext("2d");
      // Computed font shorthand may be empty with font-variant-numeric.
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return { x: parseFloat(style.paddingLeft) + context.measureText("abc d").width, y: node.clientHeight / 2 };
    });
    await input.dblclick({ position });
    assert.equal(await input.inputValue(), "abc def", "word selection keeps the full unpublished draft");
    assert.equal(await focused(input), true, "word selection keeps editor focus");
    assert.equal(await sameInput.evaluate((node) => node.isConnected && node === document.querySelector('[data-testid="cell-editor"]')), true, "word selection retains the same input");
    assert.equal(await input.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "def", "native double-click selects the word");
    assert.deepEqual(await state(page), before, "word selection leaves authoritative state unchanged");
    assert.equal(await dispatches(page), count, "word selection never executes");
    await input.press("Escape");
    assert.deepEqual(await state(page), before);
    assert.equal(await dispatches(page), count);
  }],
  ["Tab and Shift+Tab publish complete scalars once before moving grid focus", async (page) => {
    let input = await entry(page, "impact", "F2"); await replace(input, "12345");
    await published(page, input, "impact", "12345", "Tab");
    assert.equal(await focused(cell(page, "friction")), true);
    input = await entry(page, "friction", "Enter"); await replace(input, "12");
    await published(page, input, "friction", "12", "Shift+Tab");
    assert.equal(await focused(cell(page, "impact")), true);
  }],
  ["accepted and unchanged boundary edits keep the originating cell when no move exists", async (page) => {
    const rows = page.getByRole("grid", { name: "Table", exact: true }).locator("tbody tr.ts-row");
    // Work #576: the formula-bearing fixture is native, so its entry row is the
    // destination after the last stored cell. Only the top edge has no move.
    const entryRow = page.locator(".ts-entry-row");
    assert.equal(await entryRow.count(), 1, "native fixture shows its entry row");
    const edges = [
      ["Shift+Enter", rows.first().locator("td").first(), null],
      ["Shift+Tab", rows.first().locator("td").first(), null],
      ["Enter", rows.last().locator("td").last(), entryRow.locator("[data-entry-field]").last()],
      ["Tab", rows.last().locator("td").last(), entryRow.locator("[data-entry-field]").first()],
    ];
    for (const [index, [key, target, destination]] of edges.entries()) {
      const before = await state(page), count = await dispatches(page), storedRows = await rows.count();
      const value = `Boundary ${index}`;
      const landing = destination ?? target;
      await target.dblclick(); await editor(page).fill(value); await editor(page).press(key);
      await editor(page).waitFor({ state: "hidden" });
      await page.waitForFunction(element => document.activeElement === element, await landing.elementHandle());
      assert.equal(await focused(landing), true, destination ? `${key} after the last stored cell moves into the entry row` : `${key} at the boundary keeps origin focus`);
      assert.equal((await target.textContent()).trim(), value);
      assert.equal(await dispatches(page), count + 1, "boundary edit publishes exactly once");
      assert.notEqual((await state(page)).revision, before.revision);
      assert.equal(await rows.count(), storedRows, "moving into the entry row creates no stored row");
      assert.equal(await entryRow.count(), 1, "the entry row stays a single unpublished draft");
      await target.focus(); await target.press("F2"); await editor(page).press(key);
      await editor(page).waitFor({ state: "hidden" });
      await page.waitForFunction(element => document.activeElement === element, await landing.elementHandle());
      assert.equal(await focused(landing), true, "unchanged boundary edit moves the same way");
      assert.equal(await dispatches(page), count + 1, "unchanged edit dispatches nothing");
    }
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
  ["J2 R2: IF/AND/NOT/ISBLANK/ROUND/percent formula recalculates; a Text operand refuses verbatim", async (page) => {
    const bar = page.getByTestId("formula-bar-input");
    const commitFormula = async (source) => {
      await cell(page, "priority").click();
      await bar.fill(source);
      await bar.press("Enter");
    };
    // (5 + 5) * 62.5% = 6.25, rounded half away from zero to one decimal.
    let count = await dispatches(page);
    await commitFormula("IF(AND([.impact] >= 4, NOT(ISBLANK([.friction]))), ROUND(([.impact] + [.friction]) * 62.5%, 1), 0)");
    // Work stores the canonical source; the computed value is what the grid shows.
    const priorityText = (value) => page.waitForFunction(([id, text]) => document.querySelector(`[data-testid="${id}"]`)?.textContent.trim() === text,
      [`cell:${expected.entity}:${fields.priority}`, value]);
    await priorityText("6.3");
    assert.equal(await dispatches(page), count + 1, "the formula publishes exactly once");
    assert.equal((await cell(page, "priority").textContent()).trim(), "6.3");
    // Work recalculates the dependant after a scalar edit: the condition is now false.
    const input = await entry(page, "impact"); await replace(input, "3");
    await published(page, input, "impact", "3");
    await priorityText("0");
    // Arithmetic on a Text field is Work's typed formula_type_mismatch refusal:
    // the bar keeps the draft and shows Work's words; nothing is published.
    const before = await state(page); count = await dispatches(page);
    await commitFormula("[.title] * 2");
    const error = page.locator(".ts-formula-bar-error");
    await error.waitFor();
    assert.match((await error.textContent()).trim(), /title.*not a Number field/);
    assert.equal(await bar.inputValue(), "[.title] * 2", "the refused draft stays in the bar");
    assert.equal(await dispatches(page), count + 1, "the refused formula was sent once");
    assert.deepEqual(await state(page), before, "a refusal leaves the authoritative state unchanged");
    assert.equal((await cell(page, "priority").textContent()).trim(), "0");
  }],
  ["typing = in a Number cell publishes a formula; Work's refusal keeps the draft", async (page) => {
    // As in other spreadsheets, a leading "=" makes the entry a formula. Sheet
    // strips only the "="; Work parses, stores and calculates the source.
    let count = await dispatches(page);
    let input = await entry(page, "impact"); await replace(input, "=[.friction] + 2");
    await input.press("Enter"); await editor(page).waitFor({ state: "hidden" });
    const friction = Number((await cell(page, "friction").textContent()).trim());
    await page.waitForFunction(([id, text]) => document.querySelector(`[data-testid="${id}"]`)?.textContent.trim() === text,
      [`cell:${expected.entity}:${fields.impact}`, String(friction + 2)]);
    assert.equal(await dispatches(page), count + 1, "the in-cell formula publishes exactly once");
    await cell(page, "impact").click();
    assert.match(await page.getByTestId("formula-bar-input").inputValue(), /\[\.friction\]/, "the bar shows the stored formula");
    // A Text operand is Work's typed refusal: the editor keeps the draft and the
    // alert shows Work's words; nothing new is published.
    const before = await state(page); count = await dispatches(page);
    input = await entry(page, "friction"); await replace(input, "=[.title] * 2");
    await input.press("Enter"); await page.getByRole("alert").filter({ hasText: /not a Number field/ }).waitFor();
    assert.equal(await input.inputValue(), "=[.title] * 2", "the refused draft stays in the cell editor");
    assert.equal(await dispatches(page), count + 1, "the refused formula was sent once");
    assert.deepEqual(await state(page), before, "a refusal leaves the authoritative state unchanged");
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
  ["#151 unapplied cell draft survives notes, cleanup and Refresh requests", async (page) => {
    let before = await state(page); let count = await dispatches(page); let draft = "12345";
    const refused = async (action) => {
      await page.getByText(`Apply or cancel the value you are editing before ${action}.`, { exact: true }).waitFor();
      assert.equal(await page.getByRole("tab", { name: "Table", exact: true }).getAttribute("aria-selected"), "true");
      assert.equal(await editor(page).inputValue(), draft, `${action} keeps the unapplied draft`);
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Edit cell");
      assert.equal(await dispatches(page), count, `${action} publishes nothing`);
      assert.deepEqual(await state(page), before);
    };
    await replace(await entry(page, "impact"), draft);
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    await replace(page.getByRole("textbox", { name: "Decision notes", exact: true }), "Other notes");
    await page.getByRole("button", { name: "Apply notes", exact: true }).click();
    await refused("applying notes");
    await page.locator(".ts-refresh-command").click();
    await refused("refreshing");
    await page.keyboard.press("Enter");
    await editor(page).waitFor({ state: "hidden" });
    assert.equal(await dispatches(page), count + 1, "the retained draft still publishes exactly once");
    // #158: the notes draft kept through that refusal is rebound to the new
    // revision (its notes did not change) and applies. Enter now selects the
    // next row, so explicitly return to the notes draft's owning row.
    await cell(page, "impact").focus();
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Decision notes", exact: true }).inputValue(), "Other notes");
    await page.getByRole("button", { name: "Apply notes", exact: true }).click();
    await page.waitForFunction(() => window.__tachikoAcceptance.observe().then((s) => s.notes === "Other notes"));
    assert.equal(await dispatches(page), count + 2, "the notes draft publishes once after the cell edit");
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    // Issue reproduction: imported CSV, unapplied Number 3 -> 4, then a trim
    // preview with real whitespace changes is committed from another tab.
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("button", { name: "Close without saving", exact: true }).click();
    const input = await homeImportInput(page);
    await input.setInputFiles(messyCsv);
    const dialog = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await dialog.locator("select").nth(1).selectOption("number");
    await dialog.getByRole("button", { name: "Import file", exact: true }).click();
    await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
    before = await state(page); count = await dispatches(page); draft = "4";
    await page.locator("[role=grid] tbody tr").first().locator("td").nth(1).dblclick();
    await editor(page).fill(draft);
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    await page.getByRole("button", { name: "Preview trimming spaces", exact: true }).click();
    await page.getByTestId("cleanup-preview").waitFor();
    count = await dispatches(page);
    await page.getByRole("button", { name: "Apply preview", exact: true }).click();
    await refused("applying a cleanup preview");
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
    await waitForColdHome(page);
    await openFolder(page, j4CanaryFolder);
    await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
    await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
    for (const [label, value] of [["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"], ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"]]) {
      await page.getByLabel(label, { exact: true }).selectOption(value);
    }
    await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
    await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Create bar report", exact: true }).click();
    // selectTab queues focus to the Report tab; finish that transition before
    // selecting input text so the next key cannot refocus and reset selection.
    const reportTabId = await page.getByRole("tab", { name: "Report", exact: true }).getAttribute("id");
    await page.waitForFunction((id) => document.getElementById(id) === document.activeElement, reportTabId);
    for (const label of ["Title", "Category label", "Value label"]) {
      const control = page.getByRole("textbox", { name: label, exact: true });
      await replace(control, `Typed ${label}`);
    }
    await page.locator('.ts-report-canvas[data-report-ready="true"]').waitFor();
  }],
];
const launchOptions = { headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};
let failures = 0;
let blocked = 0;
for (const [name, run] of cases) {
    // Single-process Chromium exits with its final context; own one browser per case.
    let browser;
    try { browser = await chromium.launch(launchOptions); }
    catch (error) { console.error("BLOCKED: Chromium launch failed.", error.message); process.exit(78); }
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
    } finally { await context.close(); await browser.close(); }
}
console.log(JSON.stringify({ suite: "cell-editing-regression", cases: cases.length, failures, blocked }));
process.exitCode = blocked ? 78 : failures ? 1 : 0;

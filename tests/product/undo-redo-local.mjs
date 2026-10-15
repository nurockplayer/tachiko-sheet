// Real built acceptance product journey for occurrence-local, core-owned history.
// Keyboard composition below is explicitly a synthetic DOM event, not device IME evidence.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";
import { openFolder, openReleasePlanExample } from "./home-entry.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const browser = await chromium.launch({ headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext();
await installDistRoutes(context, dist);
const page = await context.newPage();
page.setDefaultTimeout(8000);
const cell = (testId) => page.getByTestId(testId);
const editor = () => page.getByRole("textbox", { name: "Edit cell", exact: true });
const methodCount = async () => page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0);
const publicationCount = async () => page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
async function edit(testId, value) {
  return editForPage(page, testId, value);
}
async function editForPage(targetPage, testId, value) {
  const target = targetPage.getByTestId(testId);
  await target.dblclick();
  const input = targetPage.getByRole("textbox", { name: "Edit cell", exact: true });
  await input.fill(value);
  await input.press("Enter");
  await input.waitFor({ state: "detached" });
}
async function waitCell(testId, value) {
  const tableTab = page.getByRole("tab", { name: "Table", exact: true });
  if (await tableTab.getAttribute("aria-selected") !== "true") await tableTab.click();
  await page.waitForFunction(({ testId, value: expectedValue }) => {
    const content = document.querySelector(`[data-testid="${testId}"] .ts-cell-value`);
    return content?.textContent?.trim() === expectedValue;
  }, { testId, value: String(value) });
}
// Check the completed value and both controls in one frame. Waiting separately
// for an enabled control would hide stale completion and delay the next key.
async function historyStep(shortcut, testId, value, undoEnabled, redoEnabled) {
  await page.keyboard.press(shortcut);
  await page.waitForFunction(({ testId, value, undoEnabled, redoEnabled }) => {
    const content = document.querySelector(`[data-testid="${testId}"] .ts-cell-value`);
    if (content?.textContent?.trim() !== value) return false;
    // Base renders the projection while the authoritative summary re-read is
    // pending. Completion begins only when that read has become current.
    if (document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness') !== 'current') return false;
    const controls = [...document.querySelectorAll('.ts-history-command')];
    const undo = controls.find(node => node.textContent.trim() === 'Undo');
    const redo = controls.find(node => node.textContent.trim() === 'Redo');
    const first = window.__completedHistoryFrames[content.closest('[data-work-revision]').getAttribute('data-work-revision')];
    if (!first) return false;
    if (!(undo instanceof HTMLButtonElement) || !(redo instanceof HTMLButtonElement) ||
        undo.disabled === undoEnabled || redo.disabled === redoEnabled ||
        first.undoDisabled === undoEnabled || first.redoDisabled === redoEnabled) {
      throw new Error(`History is stale at completion for ${value}: Undo disabled=${undo?.disabled}, Redo disabled=${redo?.disabled}, completion frame=${JSON.stringify(first)}`);
    }
    return true;
  }, { testId, value: String(value), undoEnabled, redoEnabled });
}
async function waitForJ4Current() {
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
}
async function j4Rows(index) {
  const summaryTab = page.getByRole("tab", { name: "Cross-table summary", exact: true });
  if (await summaryTab.getAttribute("aria-selected") !== "true") await summaryTab.click();
  await page.getByTestId(`j4-result-${index}`).waitFor({ state: "visible" });
  return page.getByTestId(`j4-result-${index}`).getByLabel("Cross-table groups", { exact: true })
    .locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      return `${cells[0]?.textContent?.trim() ?? ""}: ${cells[1]?.textContent?.trim() ?? ""}`;
    }));
}
async function createSalesSummary(productCategory) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("quantity");
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption(productCategory);
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
  const previousCount = await page.locator('[data-testid^="j4-result-"]').count();
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.waitForFunction(({ previousCount }) =>
    document.querySelectorAll('[data-testid^="j4-result-"]').length > previousCount &&
    document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current",
  { previousCount });
  const lastResult = page.locator('[data-testid^="j4-result-"]').last();
  await lastResult.waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const last = document.querySelector('[data-testid^="j4-result-"]:last-of-type');
    return Boolean(last?.querySelector('table[aria-label="Cross-table groups"]') || last?.querySelector('[aria-label="Summary problems"]'));
  });
  const groupsTable = lastResult.getByLabel("Cross-table groups", { exact: true });
  assert.equal(await groupsTable.count(), 1, `new Sales result should include visible groups: ${await lastResult.innerText()}`);
}
try {
  await page.goto(LOCAL_ORIGIN);
  await openFolder(page, path.join(dist, "examples", "j4-catalog-sales"));

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  assert.equal(await undo.isDisabled(), true, "fresh occurrence begins without exposed history");
  assert.equal(await redo.isDisabled(), true, "fresh occurrence begins without exposed history");
  const emptyHistoryTrackerCount = await methodCount();
  const emptyHistoryPublicationCount = await publicationCount();
  await page.keyboard.press("Meta+Z");
  await page.keyboard.press("Control+Y");
  assert.equal(await methodCount(), emptyHistoryTrackerCount, "platform shortcuts dispatch nothing while history is empty");
  assert.equal(await publicationCount(), emptyHistoryPublicationCount);

  // Use the known Sales table field whose direct stable target is in the first row.
  const productCode = await page.locator('table[aria-label="Table"] tbody tr').first().locator("td").first().getAttribute("data-testid");
  assert.ok(productCode?.startsWith("cell:"), "the real product renders a direct field cell");
  const initialValue = (await page.getByTestId(productCode).locator(".ts-cell-value").textContent()).trim();
  await edit(productCode, "UNDO-A");
  await waitCell(productCode, "UNDO-A");
  assert.equal(await undo.isDisabled(), false, "confirmed ordinary scalar publication enables Undo");
  await edit(productCode, "UNDO-B");
  await waitCell(productCode, "UNDO-B");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0), 0, "ordinary edits never call trackerCommand");

  // Native editor undo remains owned by the focused text editor.
  await page.getByTestId(productCode).dblclick();
  const input = editor();
  assert.equal(await undo.isDisabled(), true, "an open cell editor locks visible history controls");
  await input.pressSequentially("X");
  const commandsBeforeEditorUndo = await methodCount();
  await input.press("Control+Z");
  assert.equal(await methodCount(), commandsBeforeEditorUndo, "active cell editor never dispatches Sheet history");
  await input.press("Escape");
  assert.equal(await undo.isDisabled(), false, "cancelling the editor releases the history lock");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const copyName = page.getByRole("textbox", { name: "Copy name", exact: true });
  assert.equal(await undo.isDisabled(), true, "an open modal locks visible history controls");
  await copyName.fill("undo-redo-modal");
  const commandsBeforeModalUndo = await methodCount();
  await copyName.press("Control+Z");
  assert.equal(await methodCount(), commandsBeforeModalUndo, "modal text controls keep native text undo");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Save a copy", exact: true }).waitFor({ state: "detached" });

  // A synthetic composition marker checks dispatch exclusion only; physical IME remains a Sol-owned host observation.
  const commandsBeforeComposition = await methodCount();
  const compositionPrevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true, isComposing: true });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(compositionPrevented, false, "synthetic IME composition key is not intercepted");
  assert.equal(await methodCount(), commandsBeforeComposition, "composition marker dispatches no tracker command");

  // Two known edits unwind/redo in order; a NoChange rejection preserves Redo.
  await page.getByTestId(productCode).focus();
  await page.evaluate(testId => {
    const frames = window.__completedHistoryFrames = {};
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="currentness"]')?.getAttribute('data-currentness') !== 'current') return;
      const target = document.querySelector(`[data-testid="${testId}"]`);
      const revision = target?.getAttribute('data-work-revision');
      if (!revision || frames[revision]) return;
      const controls = [...document.querySelectorAll('.ts-history-command')];
      frames[revision] = {
        undoDisabled: controls.find(node => node.textContent.trim() === 'Undo')?.disabled,
        redoDisabled: controls.find(node => node.textContent.trim() === 'Redo')?.disabled,
      };
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }, productCode);
  const historyTiming = await context.newCDPSession(page);
  // Exercise the same real publications on a slower CPU; pending summary
  // observation remains allowed, but a current completion must be coherent.
  await historyTiming.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  try {
    for (let iteration = 0; iteration < 20; iteration++) {
      await historyStep("Control+Z", productCode, "UNDO-A", true, true);
      await historyStep("Control+Z", productCode, initialValue, false, true);
      await historyStep("Control+Shift+Z", productCode, "UNDO-A", true, true);
      await historyStep("Control+Y", productCode, "UNDO-B", true, false);
    }
  } finally {
    await historyTiming.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await historyTiming.detach();
  }
  console.log("PASS: 20 immediate Undo/Redo loops with value/control consistency in the same frame (6x CPU slowdown)");
  await page.keyboard.press("Control+Z");
  await waitCell(productCode, "UNDO-A");
  assert.equal(await redo.isDisabled(), false);
  await page.keyboard.press("Control+Z");
  await waitCell(productCode, initialValue);
  await page.keyboard.press("Control+Shift+Z");
  await waitCell(productCode, "UNDO-A");
  await page.keyboard.press("Control+Y");
  await waitCell(productCode, "UNDO-B");
  await undo.click();
  await waitCell(productCode, "UNDO-A");
  await page.getByTestId(productCode).dblclick();
  await editor().fill("UNDO-A");
  await editor().press("Enter");
  await page.getByRole("alert").waitFor();
  await editor().press("Escape");
  assert.equal(await redo.isDisabled(), false, "known NoChange rejection preserves the existing Redo tail after the editor closes");
  await redo.click();
  await waitCell(productCode, "UNDO-B");

  // A new admitted edit after Undo clears Redo, and focus returns only to the direct target.
  await undo.click();
  await waitCell(productCode, "UNDO-A");
  await page.getByTestId(productCode).dblclick();
  await editor().fill("UNDO-C");
  await editor().press("Enter");
  await waitCell(productCode, "UNDO-C");
  assert.equal(await redo.isDisabled(), true, "new scalar edit after Undo invalidates Redo");
  await undo.click();
  await waitCell(productCode, "UNDO-A");
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, productCode);
  const exactCellIdentity = await cell(productCode).evaluate((node) => ({
    entity: node.getAttribute("data-work-entity"),
    testId: node.getAttribute("data-testid"),
  }));
  assert.ok(exactCellIdentity.entity && exactCellIdentity.testId === productCode, "the direct focus target exposes its stable rendered identity");
  assert.equal(
    await page.locator(`[data-work-entity="${exactCellIdentity.entity}"][data-testid="${exactCellIdentity.testId}"]`).count(),
    1,
    "focus restoration only has one direct rendered match for the publication target",
  );
  const beforeRefresh = {
    occurrence: await cell(productCode).getAttribute("data-work-occurrence"),
    revision: await cell(productCode).getAttribute("data-work-revision"),
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  const afterRefresh = {
    occurrence: await cell(productCode).getAttribute("data-work-occurrence"),
    revision: await cell(productCode).getAttribute("data-work-revision"),
    currentness: await cell(productCode).getAttribute("data-work-currentness"),
  };
  assert.equal(afterRefresh.occurrence, beforeRefresh.occurrence, "Refresh reobserves the same resident occurrence");
  assert.equal(afterRefresh.revision, beforeRefresh.revision, "Refresh reobserves the same resident revision");
  assert.equal(afterRefresh.currentness, "current");
  assert.equal(await undo.isDisabled(), false, "same-occurrence same-revision Refresh preserves existing knowledge without rebuilding it");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("undo-redo-presave");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal(await undo.isDisabled(), false, "Save alone does not create a history barrier");

  // Saved definitions participate in Work's tracker history. Sheet re-reads
  // the complete resident inventory, including removals and restorations.
  await edit(productCode, initialValue);
  await waitCell(productCode, initialValue);
  await createSalesSummary("category");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const firstSummaryCard = await page.locator('[data-testid^="result-card:"]').getAttribute("data-testid");
  assert.ok(firstSummaryCard);
  await createSalesSummary("code");
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "two distinct Sales grouped definitions are resident");
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 800"]);
  assert.equal(await undo.isDisabled(), false, "summary creation remains available to Undo");
  assert.equal(await redo.isDisabled(), true);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const summaryCards = await page.locator('[data-testid^="result-card:"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")));
  assert.equal(summaryCards.length, 2);
  // Discovery order follows opaque definition IDs, not creation time.
  const latestSummaryIndex = summaryCards.findIndex(id => id !== firstSummaryCard);
  assert.ok(latestSummaryIndex >= 0);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId(`j4-result-${latestSummaryIndex}`).getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).waitFor();
  const authoredReport = [["Title", "Summary history"], ["Category label", "Product code"], ["Value label", "Value ¥"]];
  for (const [label, value] of authoredReport) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Show legend", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("undo-summary-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "false");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const summarySavedRevision = await cell(productCode).getAttribute("data-work-revision");
  assert.ok(summarySavedRevision);
  await page.getByRole("tab", { name: "Report", exact: true }).click();

  async function definitionHistoryStep(direction, count) {
    const commands = await methodCount(), publications = await publicationCount();
    const control = direction === "undo" ? undo : redo;
    await control.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false" &&
      document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
    assert.equal(await methodCount(), commands + 1, "one real tracker command per definition history step");
    assert.equal(await publicationCount(), publications + 1, "one real publication per definition history step");
    const expectedFocus = await control.isDisabled() ? page.locator(".ts-refresh-command") : control;
    const expectedFocusText = (await expectedFocus.textContent()).trim();
    await page.waitForFunction(text => document.activeElement?.textContent?.trim() === text, expectedFocusText);
    assert.equal(await expectedFocus.evaluate(node => node === document.activeElement), true, "definition history uses its command origin or Refresh when exhausted");
    assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "true", "definition history changes the saved revision");
    assert.equal(await page.getByTestId("save-status").textContent(), "Not saved yet");
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    const revision = await cell(productCode).getAttribute("data-work-revision");
    assert.deepEqual(await page.locator('[data-testid^="result-card:"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid"))), count === 2 ? summaryCards : count === 1 ? [firstSummaryCard] : [], "the J4 pane removes the latest definition and restores its original identity");
    assert.equal(await page.getByTestId("results-pane").count(), count ? 1 : 0, "no orphaned results pane remains after the final definition is removed");
    await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
    assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), count, "authoritative summary inventory follows definition history");
    for (let index = 0; index < count; index++) {
      assert.deepEqual(await j4Rows(index), ["NOTE: 1000", "PEN: 800"], "every resident summary is freshly authoritative");
    }
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    const facts = page.locator('[data-testid^="brief:"]');
    assert.ok(await facts.count() > 0, "Brief retains the selected table record, without summary cards");
    const factWitnesses = await facts.evaluateAll(nodes => nodes.map(node => ({ revision: node.getAttribute("data-work-revision"), currentness: node.getAttribute("data-work-currentness") })));
    assert.ok(factWitnesses.every(fact => fact.currentness === "current" && fact.revision === revision), "every Brief fact matches the authoritative table publication");
    assert.notEqual(factWitnesses[0].revision, summarySavedRevision, "Brief observes the new history publication");
    assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "Brief shows no stale summary card");
  }
  await definitionHistoryStep("undo", 1);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).count(), 0, "Undo detaches the presentation bound to the absent summary");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 0, "the deleted source leaves no stale chart");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "the deleted source cannot be exported");
  // A dangling report would refuse this Save while a sibling summary remains.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await definitionHistoryStep("undo", 0);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByText("No current cross-table result is available. Create a summary after choosing its fields.", { exact: true }).waitFor();
  assert.equal(await undo.isDisabled(), false, "earlier scalar history survives definition removals");
  await definitionHistoryStep("redo", 1);
  await definitionHistoryStep("redo", 2);
  assert.equal(await redo.isDisabled(), true, "both definitions have been restored by Work");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  for (const [label, value] of authoredReport) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value, "Redo restores settings after Save while detached, with a sibling summary resident");
  assert.equal(await page.getByLabel("Show legend", { exact: true }).isChecked(), false);
  assert.match(await page.locator(".ts-report-output-note").textContent(), /This bar report/);

  // Both resident grouped results follow a real Catalog price scalar edit and
  // authoritative tracker history without an intervening Refresh.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const catalogPicker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await catalogPicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const catalogHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = catalogHeaders.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Sales Catalog exposes its price field");
  const penRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  const priceCell = penRow.locator("td").nth(priceIndex);
  const priceTestId = await priceCell.getAttribute("data-testid");
  assert.ok(priceTestId?.startsWith("cell:"));
  await edit(priceTestId, "250");
  await waitCell(priceTestId, "250");
  await waitForJ4Current();
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 1000"]);
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 1000"]);
  await undo.click();
  await waitCell(priceTestId, "200");
  await waitForJ4Current();
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"], "Undo restores the authoritative old Work totals");
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 800"]);
  await undo.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current" &&
    document.querySelectorAll('[data-testid^="j4-result-"]').length === 1);
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"], "Undo across the interleaved scalar edit removes only the latest definition");
  await redo.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current" &&
    document.querySelectorAll('[data-testid^="j4-result-"]').length === 2);
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 800"], "Redo discovers the restored definition before redoing the scalar edit");
  await redo.click();
  await waitCell(priceTestId, "250");
  await waitForJ4Current();
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 1000"], "Redo restores the edited Work totals without Refresh");
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 1000"]);

  const foreignFocusCounts = { tracker: await methodCount(), publications: await publicationCount() };
  const foreignFocusProbe = await page.evaluate(() => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "External control";
    document.body.append(input, textarea, editable, button);
    const dispatch = (target) => {
      target.focus();
      const event = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const results = [dispatch(input), dispatch(textarea), dispatch(editable), dispatch(button)];
    input.focus();
    const documentTarget = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(documentTarget);
    results.push(documentTarget.defaultPrevented);
    input.blur();
    input.remove();
    document.body.focus();
    const neutralBody = document.activeElement === document.body;
    document.body.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    const handled = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(handled);
    results.push(handled.defaultPrevented);
    textarea.remove(); editable.remove(); button.remove();
    return { results, neutralBody };
  });
  assert.equal(await undo.isDisabled(), false, "the prevented shortcut is probed while history is available");
  assert.equal(foreignFocusProbe.neutralBody, true, "the prevented shortcut probe has neutral BODY focus");
  assert.deepEqual(foreignFocusProbe.results, [false, false, false, false, false, true], "foreign and previously handled shortcuts are left to their owner");
  assert.equal(await methodCount(), foreignFocusCounts.tracker, "foreign focus does not dispatch Sheet history");
  assert.equal(await publicationCount(), foreignFocusCounts.publications);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const sameWitnessBeforeKeyboardRefresh = await cell(priceTestId).getAttribute("data-work-revision");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "ordinary same-witness Refresh naturally leaves document focus on BODY");
  assert.equal(await cell(priceTestId).getAttribute("data-work-revision"), sameWitnessBeforeKeyboardRefresh);
  assert.equal(await undo.isDisabled(), false, "same-witness Refresh retains known Undo history");
  const metaUndoTrackerCount = await methodCount();
  const metaUndoPublicationCount = await publicationCount();
  await page.keyboard.press("Meta+Z");
  await waitCell(priceTestId, "200");
  await waitForJ4Current();
  assert.equal(await methodCount(), metaUndoTrackerCount + 1, "Meta+Z from natural BODY focus dispatches one Undo");
  assert.equal(await publicationCount(), metaUndoPublicationCount + 1);
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"], "BODY-origin Undo refreshes authoritative grouped results");
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 800"]);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "Refresh naturally restores neutral BODY focus before Redo");
  const metaRedoTrackerCount = await methodCount();
  const metaRedoPublicationCount = await publicationCount();
  await page.keyboard.press("Meta+Shift+Z");
  await waitCell(priceTestId, "250");
  await waitForJ4Current();
  assert.equal(await methodCount(), metaRedoTrackerCount + 1, "Meta+Shift+Z from BODY dispatches one Redo");
  assert.equal(await publicationCount(), metaRedoPublicationCount + 1);
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 1000"]);
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 1000"]);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("undo-redo-post-keyboard-save");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const savedRevisionForKeyboard = await cell(priceTestId).getAttribute("data-work-revision");
  assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "false", "successful Save retains the clean saved-revision state");
  assert.equal(await undo.isDisabled(), false, "successful Save retains directional history counts");
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "successful Save naturally leaves document focus on BODY");
  const controlUndoTrackerCount = await methodCount();
  const controlUndoPublicationCount = await publicationCount();
  await page.keyboard.press("Control+Z");
  await waitCell(priceTestId, "200");
  await waitForJ4Current();
  assert.equal(await methodCount(), controlUndoTrackerCount + 1, "Control+Z after Save dispatches one Undo");
  assert.equal(await publicationCount(), controlUndoPublicationCount + 1);
  assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "true", "Undo after Save marks the changed saved revision dirty");
  assert.equal(await page.getByTestId("save-status").textContent(), "Not saved yet");
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"]);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "post-Undo Refresh returns to neutral BODY focus");
  const controlRedoTrackerCount = await methodCount();
  const controlRedoPublicationCount = await publicationCount();
  await page.keyboard.press("Control+Shift+Z");
  await waitCell(priceTestId, "250");
  await waitForJ4Current();
  assert.equal(await methodCount(), controlRedoTrackerCount + 1, "Control+Shift+Z after Save dispatches one Redo");
  assert.equal(await publicationCount(), controlRedoPublicationCount + 1);
  assert.notEqual(await cell(priceTestId).getAttribute("data-work-revision"), savedRevisionForKeyboard, "Redo publishes a new opaque semantic revision even when the value returns to its saved content");
  assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "true", "history after Save remains dirty until a later Save acknowledges the new publication revision");
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 1000"]);
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 1000"]);

  await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const retainedReportTitle = page.getByLabel("Title", { exact: true });
  await retainedReportTitle.waitFor();
  const reportTitleBeforeRecovery = await retainedReportTitle.inputValue();

  // Bind the acceptance fault to this real current witness. The harness learns
  // the result revision from the genuine tracker acknowledgement.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const currentHistoryWitness = {
    occurrence: await cell(priceTestId).getAttribute("data-work-occurrence"),
    revision: await cell(priceTestId).getAttribute("data-work-revision"),
  };
  assert.ok(currentHistoryWitness.occurrence && currentHistoryWitness.revision, "the real edited cell exposes its current history witness");
  const historyCommandsBeforeFault = await methodCount();
  const publicationsBeforeFault = await publicationCount();
  await page.evaluate((witness) => window.__tachikoAcceptance.failSecondHistoryRequeryReplyAfterFirst("undo", witness), currentHistoryWitness);
  await page.evaluate(() => window.__tachikoAcceptance.deferSecondHistoryRequeryReply());
  try {
    await undo.click();
    await page.waitForFunction(() => window.__tachikoAcceptance.historyRequeryFaultProbe().secondReplyHeld === true);
    assert.equal(await page.locator('[data-testid="currentness"]').getAttribute("data-currentness"), "pending", "the held second history query keeps the previous snapshot explicitly pending");
    assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 1000"], "pending history observation retains the truthful previous summary snapshot");
    assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 1000"]);
    assert.equal(await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).isDisabled(), true, "result actions stay locked while history projections are pending");
    assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isDisabled(), true, "Save stays locked while history projections are pending");
  } finally {
    await page.evaluate(() => window.__tachikoAcceptance.releaseSecondHistoryRequeryReply());
  }
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "unknown");
  assert.equal(await page.locator('[data-testid^="cell:"]').count(), 0, "known-publication recovery withholds the stale grid");
  assert.equal((await page.getByTestId("persistence-status").textContent())?.trim(), "Not saved yet", "known history publication preserves the unsaved persistence obligation");
  assert.equal(await undo.count(), 0, "recovery exposes no Undo control or history");
  assert.equal(await redo.count(), 0, "recovery exposes no Redo control or history");
  assert.equal(await methodCount(), historyCommandsBeforeFault + 1, "the failed observation never replays trackerHistory");
  assert.equal(await publicationCount(), publicationsBeforeFault + 1, "one genuine history publication was dispatched");
  const failedHistoryProbe = await page.evaluate(() => window.__tachikoAcceptance.historyRequeryFaultProbe());
  const failedHistoryReceipt = await page.evaluate(() => window.__tachikoAcceptance.lastReceipt());
  assert.equal(failedHistoryProbe.consumed, true, "the fault was consumed only after the second real result query");
  assert.equal(failedHistoryProbe.baseRevision, currentHistoryWitness.revision);
  assert.equal(failedHistoryProbe.dispatchedResultRevision, failedHistoryReceipt?.resulting_revision);
  assert.equal(failedHistoryProbe.resultRevision, failedHistoryReceipt?.resulting_revision);
  assert.equal(failedHistoryProbe.queryCallIds.length, 2);
  assert.equal(new Set(failedHistoryProbe.queriedDefinitionIds).size, 2, "two distinct result definitions were queried");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0, "Save is withheld until resident projections are confirmed");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "PNG export is withheld without current results");

  const trackerCommandsBeforeRecoveryRefresh = await methodCount();
  const historyRecoveryRefresh = page.getByRole("button", { name: "Refresh", exact: true });
  await historyRecoveryRefresh.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  await waitCell(priceTestId, "200");
  await waitForJ4Current();
  assert.deepEqual(await j4Rows(0), ["NOTE: 1000", "PEN: 800"], "one ordinary Refresh observes resident post-Undo totals");
  assert.deepEqual(await j4Rows(1), ["NOTE: 1000", "PEN: 800"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), reportTitleBeforeRecovery, "the report configuration remains resident through recovery");
  assert.equal(await methodCount(), trackerCommandsBeforeRecoveryRefresh, "ordinary recovery Refresh does not issue history commands");
  assert.equal(await undo.isDisabled(), true, "Refresh restores result values but does not reconstruct Undo history");
  assert.equal(await redo.isDisabled(), true, "Refresh restores result values but does not reconstruct Redo history");

  // Unknown history reply must not retry; refresh observes the resident core and never rebuilds counts.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await catalogPicker.selectOption("sales");
  await page.getByRole("columnheader", { name: "quantity", exact: true }).waitFor();
  const rowCell = page.locator('table[aria-label="Table"] tbody tr').first().locator("td").nth(1);
  const rowTestId = await rowCell.getAttribute("data-testid");
  assert.ok(rowTestId);
  const rowInitialValue = (await rowCell.locator(".ts-cell-value").textContent())?.trim() ?? "";
  assert.ok(rowInitialValue, "fresh Sales row exposes its baseline before the ordinary history cases");
  await edit(rowTestId, "7");
  await waitCell(rowTestId, "7");
  const deliberateFocusCell = page.locator('table[aria-label="Table"] tbody tr').nth(1).locator("td").first();
  const deliberateFocusTestId = await deliberateFocusCell.getAttribute("data-testid");
  assert.ok(deliberateFocusTestId && deliberateFocusTestId !== rowTestId, "a separate visible cell can receive deliberate pending focus");
  const heldTrackerCount = await methodCount();
  const heldPublicationCount = await publicationCount();
  await page.evaluate(() => window.__tachikoAcceptance.deferNextTrackerReply());
  try {
    await undo.click();
    await page.waitForFunction((previousCount) =>
      document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "true" &&
      (window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0) === previousCount + 1,
    heldTrackerCount);
    await deliberateFocusCell.focus();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), deliberateFocusTestId);
    const busyTrackerCount = await methodCount();
    const busyPublicationCount = await publicationCount();
    await page.keyboard.press("Meta+Z");
    assert.equal(await methodCount(), busyTrackerCount, "busy history ignores another keyboard shortcut");
    assert.equal(await publicationCount(), busyPublicationCount);
  } finally {
    await page.evaluate(() => window.__tachikoAcceptance.releaseTrackerReply());
  }
  await waitCell(rowTestId, rowInitialValue);
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), deliberateFocusTestId, "history completion does not steal a different usable focus destination chosen while pending");
  assert.equal(await methodCount(), heldTrackerCount + 1, "held real history reply dispatches exactly once");
  assert.equal(await publicationCount(), heldPublicationCount + 1, "held real reply contains one actual publication");
  const heldReceipt = await page.evaluate(() => window.__tachikoAcceptance.lastReceipt());
  assert.equal(heldReceipt?.resulting_revision, await cell(rowTestId).getAttribute("data-work-revision"), "the held operation returns the genuine core receipt after release");
  await redo.click();
  await waitCell(rowTestId, "7");

  await edit(rowTestId, "8");
  await waitCell(rowTestId, "8");
  const dispatchesBeforeLostReply = await publicationCount();
  const commandsBeforeLostReply = await methodCount();
  await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
  await undo.click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal((await page.getByTestId("operation-outcome").textContent())?.trim(), "Outcome needs review", "lost history reply remains an unknown outcome, not confirmed publication");
  assert.equal((await page.getByTestId("persistence-status").textContent())?.trim(), "Not saved yet", "unknown history recovery keeps its known unsaved obligation visible");
  await page.evaluate(() => window.__tachikoAcceptance.settleFaultWindow());
  const recoveryTrackerCount = await methodCount();
  const recoveryPublicationCount = await publicationCount();
  await page.keyboard.press("Meta+Z");
  assert.equal(await methodCount(), recoveryTrackerCount, "recovery state rejects history keyboard input");
  assert.equal(await publicationCount(), recoveryPublicationCount);
  const recoveryRefresh = page.locator(".ts-home").getByRole("button", { name: "Refresh", exact: true });
  await recoveryRefresh.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = document.querySelector(".ts-home button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Refresh");
  assert.equal(await recoveryRefresh.evaluate((node) => node === document.activeElement), true, "unknown history recovery restores focus to the recovery Refresh action");
  assert.equal(await methodCount(), commandsBeforeLostReply + 1, "lost history reply dispatches exactly once");
  assert.equal(await publicationCount(), dispatchesBeforeLostReply + 1, "history is never blindly replayed");
  await recoveryRefresh.click();
  await page.getByTestId("project-ready").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await undo.isDisabled(), true, "Refresh does not reconstruct local history knowledge");
  assert.equal(await redo.isDisabled(), true);

  // Save/close/open creates a new UI history lifetime.
  await edit(rowTestId, "9");
  await waitCell(rowTestId, "9");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("undo-redo-reopen");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Open saved undo-redo-reopen", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await undo.isDisabled(), true, "saved/opened occurrence starts with Undo disabled");
  assert.equal(await redo.isDisabled(), true, "saved/opened occurrence starts with Redo disabled");

  // The release-plan product fixture exposes editable Brief notes for draft-lock behavior.
  const notesPage = await context.newPage();
  await notesPage.goto(LOCAL_ORIGIN);
  await openReleasePlanExample(notesPage);
  const notesUndo = notesPage.getByRole("button", { name: "Undo", exact: true });
  const notesCell = notesPage.locator('table[aria-label="Table"] tbody tr').first().locator("td").first();
  await editForPage(notesPage, await notesCell.getAttribute("data-testid"), "UNDO-NOTES-BASE");
  await notesPage.getByRole("tab", { name: "Brief", exact: true }).click();
  const notes = notesPage.getByTestId("notes-input");
  const originalNotes = await notes.inputValue();
  await notes.fill("UNDO-NOTE-DRAFT");
  assert.equal(await notesUndo.isDisabled(), true, "a notes draft locks visible history controls");
  const noteCommands = await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0);
  const nativeUndoModifier = process.platform === "darwin" ? "Meta" : "Control";
  await notes.press(`${nativeUndoModifier}+Z`);
  assert.equal(await notes.inputValue(), originalNotes, "native notes undo restores the committed text value");
  assert.equal(await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0), noteCommands, "native notes text undo never dispatches Sheet history");
  await notes.fill("UNDO-NOTE-DRAFT-RETAINED");
  assert.notEqual(await notes.inputValue(), originalNotes, "a fresh dirty notes draft is established after native text undo");
  assert.equal(await notesUndo.isDisabled(), true, "the re-established notes draft locks history independently of native undo");
  await notesPage.getByRole("tab", { name: "Table", exact: true }).click();
  assert.equal(await notesUndo.isDisabled(), true, "a notes draft stays locked when another tab is selected");
  const retainedDraftCommands = await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0);
  await notesPage.keyboard.press("Meta+Z");
  assert.equal(await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0), retainedDraftCommands, "a retained Brief draft blocks Sheet keyboard history from another tab");
  await notesPage.getByRole("tab", { name: "Brief", exact: true }).click();
  await notes.fill(originalNotes);
  assert.equal(await notesUndo.isDisabled(), false, "restoring the committed notes value releases the draft lock");
  await notes.fill("UNDO-NOTE-APPLIED");
  assert.equal(await notesUndo.isDisabled(), true);
  await notesPage.getByRole("button", { name: "Apply notes", exact: true }).click();
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await notesUndo.isDisabled(), false, "applying notes releases the history lock and counts as an admitted edit");

  // Brief hides the table publication target; restore the usable command origin,
  // then keep keyboard commands on that same visible surface.
  await notesUndo.click();
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await notesPage.evaluate(() => document.activeElement?.textContent?.trim()), "Undo", "Brief Undo returns focus to its still-usable initiating command");
  await notesPage.keyboard.press("Control+Shift+Z");
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await notesPage.evaluate(() => document.activeElement?.textContent?.trim()), "Undo", "the next keyboard Redo preserves its usable focused origin");

  const briefTab = notesPage.getByRole("tab", { name: "Brief", exact: true });
  await briefTab.focus();
  await notesPage.keyboard.press("Control+Z");
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await briefTab.evaluate((node) => node === document.activeElement), true, "keyboard history with an invisible cell target returns to its usable Brief-tab origin");

  // Exhaust the command origin on the Brief tab: focus falls back to desktop Refresh.
  await notesUndo.click();
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  const desktopRefresh = notesPage.locator(".ts-refresh-command");
  await notesPage.waitForFunction(() => document.activeElement?.textContent?.trim() === "Refresh");
  assert.equal(await desktopRefresh.evaluate((node) => node === document.activeElement), true, "an exhausted desktop Undo origin falls back to the visible Refresh command");

  // On compact layout, use the overflow menu origin while enabled; when the
  // final Undo disables it, use the visible More summary and never hidden Refresh.
  await notesPage.setViewportSize({ width: 320, height: 640 });
  const moreSummary = notesPage.getByLabel("More document commands");
  await moreSummary.click();
  const compactRedo = notesPage.locator(".ts-command-overflow .ts-command-menu").getByRole("button", { name: "Redo", exact: true });
  await compactRedo.click();
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await compactRedo.evaluate((node) => node === document.activeElement), true, "compact history keeps focus on a still-usable menu command");
  await compactRedo.click();
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await compactRedo.isDisabled(), true);
  assert.equal(await moreSummary.evaluate((node) => node === document.activeElement), true, "compact exhausted history falls back to More, not the hidden desktop Refresh");
  assert.notEqual(await desktopRefresh.evaluate((node) => node === document.activeElement), true, "compact fallback never steals focus to the desktop Refresh command");
  await notesPage.setViewportSize({ width: 1280, height: 800 });
  await notesPage.close();
  console.log("PASS: real acceptance-build Undo/Redo scalar, saved definitions, report detachment/restoration, recovery, reopen and notes-lock journey");
} finally {
  await context.close();
  await browser.close();
}

// Include durable report history and occurrence boundaries in this lane's gates.
await import("./report-history-local.mjs");

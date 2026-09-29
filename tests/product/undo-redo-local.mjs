// Real built acceptance product journey for occurrence-local, core-owned history.
// Keyboard composition below is explicitly a synthetic DOM event, not device IME evidence.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";

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
  await page.waitForFunction(({ testId, value: expectedValue }) => {
    const content = document.querySelector(`[data-testid="${testId}"] .ts-cell-value`);
    return content?.textContent?.trim() === expectedValue;
  }, { testId, value: String(value) });
}
try {
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Try sales example", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  assert.equal(await undo.isDisabled(), true, "fresh occurrence begins without exposed history");
  assert.equal(await redo.isDisabled(), true, "fresh occurrence begins without exposed history");

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

  // A successful grouped-definition publication is outside scalar history and forms a barrier.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("quantity");
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption("category");
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-0").waitFor();
  assert.equal(await undo.isDisabled(), true, "successful non-admitted semantic definition clears exposed history");
  assert.equal(await redo.isDisabled(), true);

  // Unknown history reply must not retry; refresh observes the resident core and never rebuilds counts.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const rowCell = page.locator('table[aria-label="Table"] tbody tr').first().locator("td").first();
  const rowTestId = await rowCell.getAttribute("data-testid");
  assert.ok(rowTestId);
  await edit(rowTestId, "UNDO-D");
  await waitCell(rowTestId, "UNDO-D");
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
  } finally {
    await page.evaluate(() => window.__tachikoAcceptance.releaseTrackerReply());
  }
  await waitCell(rowTestId, "UNDO-A");
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), deliberateFocusTestId, "history completion does not steal a different usable focus destination chosen while pending");
  assert.equal(await methodCount(), heldTrackerCount + 1, "held real history reply dispatches exactly once");
  assert.equal(await publicationCount(), heldPublicationCount + 1, "held real reply contains one actual publication");
  const heldReceipt = await page.evaluate(() => window.__tachikoAcceptance.lastReceipt());
  assert.equal(heldReceipt?.resulting_revision, await cell(rowTestId).getAttribute("data-work-revision"), "the held operation returns the genuine core receipt after release");
  await redo.click();
  await waitCell(rowTestId, "UNDO-D");

  await edit(rowTestId, "UNDO-E");
  await waitCell(rowTestId, "UNDO-E");
  const dispatchesBeforeLostReply = await publicationCount();
  const commandsBeforeLostReply = await methodCount();
  await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
  await undo.click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  await page.evaluate(() => window.__tachikoAcceptance.settleFaultWindow());
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
  await edit(rowTestId, "UNDO-SAVED");
  await waitCell(rowTestId, "UNDO-SAVED");
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
  await notesPage.getByTestId("project-ready").waitFor();
  await notesPage.getByRole("button", { name: "Close project", exact: true }).click();
  await notesPage.getByTestId("open-project").setInputFiles(path.join(root, "tests/fixtures/release-plan.roproj"));
  await notesPage.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
  const notesUndo = notesPage.getByRole("button", { name: "Undo", exact: true });
  const notesCell = notesPage.locator('table[aria-label="Table"] tbody tr').first().locator("td").first();
  await editForPage(notesPage, await notesCell.getAttribute("data-testid"), "UNDO-NOTES-BASE");
  await notesPage.getByRole("tab", { name: "Brief", exact: true }).click();
  const notes = notesPage.getByTestId("notes-input");
  const originalNotes = await notes.inputValue();
  await notes.fill("UNDO-NOTE-DRAFT");
  assert.equal(await notesUndo.isDisabled(), true, "a notes draft locks visible history controls");
  const noteCommands = await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0);
  await notes.press("Control+Z");
  assert.equal(await notesPage.evaluate(() => window.__tachikoAcceptance.workMethodCounts().trackerCommand ?? 0), noteCommands, "native notes text undo never dispatches Sheet history");
  await notesPage.getByRole("tab", { name: "Table", exact: true }).click();
  assert.equal(await notesUndo.isDisabled(), true, "a notes draft stays locked when another tab is selected");
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
  console.log("PASS: real acceptance-build Undo/Redo scalar, barrier, recovery, reopen and notes-lock journey");
} finally {
  await context.close();
  await browser.close();
}

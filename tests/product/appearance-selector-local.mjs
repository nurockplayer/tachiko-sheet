// Real-entry #69 appearance selector probe; this does not use hooks to select profiles.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-appearance-product-"));
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const key = "tachiko-sheet:appearance-preference:v1";
const profiles = [
  { id: "tachiko", label: "Tachiko", chrome: "porcelain", typography: "tachiko-local" },
  { id: "familiar-spreadsheet", label: "Familiar Spreadsheet", chrome: "structured", typography: "system-local" },
  { id: "minimal-focus", label: "Minimal-Focus", chrome: "quiet", typography: "tachiko-local" },
];
const densities = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
];
let context;

async function openApp(page) {
  await installDistRoutes(context, dist);
  page.setDefaultTimeout(10000);
  await page.goto(LOCAL_ORIGIN);
  await page.locator(".ts-app").waitFor();
}

async function setAppearance(page, profileId, density, { compositionInput = null, axisOrder = "profile-first" } = {}) {
  const profile = profiles.find((item) => item.id === profileId);
  const densityOption = densities.find((item) => item.id === density);
  assert.ok(profile && densityOption, "probe only selects a closed built-in profile/density");
  const previousPreference = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  const beforeComposition = compositionInput
    ? await page.evaluate(() => ({
      profile: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
    }))
    : null;
  if (compositionInput) {
    assert.notDeepEqual(beforeComposition, { profile: profile.chrome, density }, "queued target must differ from pre-composition appearance");
    await compositionInput.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  }
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const selectProfile = () => page.locator(".ts-appearance-profile-option").filter({ hasText: profile.label }).click();
  const selectDensity = () => page.locator(".ts-appearance-density-option").filter({ hasText: densityOption.label }).click();
  if (axisOrder === "density-first") {
    await selectDensity();
    await selectProfile();
  } else {
    await selectProfile();
    await selectDensity();
  }

  if (compositionInput) {
    const queued = await page.evaluate(() => ({
      profile: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
    }));
    assert.deepEqual(queued, beforeComposition, "profile CSS must stay at its pre-choice value while composition is active");
    assert.equal(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
      previousPreference,
      "queued composition selection must not persist before compositionend",
    );
    await compositionInput.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: input.value })));
    await page.waitForFunction(({ chrome, density: expectedDensity }) =>
      document.documentElement.getAttribute("data-ts-profile-chrome") === chrome &&
      document.documentElement.getAttribute("data-ts-profile-density") === expectedDensity,
    { chrome: profile.chrome, density });
  } else {
    await page.waitForFunction(({ chrome, density: expectedDensity }) =>
      document.documentElement.getAttribute("data-ts-profile-chrome") === chrome &&
      document.documentElement.getAttribute("data-ts-profile-density") === expectedDensity,
    { chrome: profile.chrome, density });
  }

  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  assert.equal(raw, JSON.stringify({ schemaVersion: 1, profileId, density }), "preference is the exact namespaced v1 record");
  const rootState = await page.evaluate(() => {
    const rootElement = document.documentElement;
    const style = getComputedStyle(rootElement);
    return {
      chrome: rootElement.getAttribute("data-ts-profile-chrome"),
      density: rootElement.getAttribute("data-ts-profile-density"),
      typography: rootElement.getAttribute("data-ts-profile-typography"),
      surface: style.getPropertyValue("--ts-profile-surface-chrome").trim(),
    };
  });
  assert.equal(rootState.chrome, profile.chrome);
  assert.equal(rootState.density, density);
  assert.equal(rootState.typography, profile.typography);
  assert.ok(rootState.surface.startsWith("#"), "built-in profile must apply its root color recipe");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  return rootState;
}

async function headerInventory(page) {
  return page.evaluate(() => ({
    commands: [...document.querySelectorAll(".ts-header-actions button")].map((button) => button.textContent.trim()),
    views: [...document.querySelectorAll('[role="tablist"][aria-label="Workbook views"] [role="tab"]')]
      .map((button) => button.textContent.trim().replace(/\s+/g, " ")),
  }));
}

async function reportPng(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current PNG", exact: true }).click();
  const download = await pending;
  const bytes = await readFile(await download.path());
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
}

async function bindReport(page) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  for (const [label, value] of [
    ["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"],
    ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"],
  ]) await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Appearance-independent report");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.locator('.ts-report-canvas[data-report-ready="true"]').waitFor();
}

try {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const page = await context.newPage();
  await openApp(page);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const homeSelector = page.locator(".ts-home-head .ts-appearance-selector");
  await homeSelector.waitFor({ state: "visible" });
  assert.equal(await homeSelector.count(), 1, "Home owns the application selector");

  const homeTrigger = page.getByRole("button", { name: "Appearance", exact: true });
  await homeTrigger.focus();
  await page.keyboard.press("Enter");
  assert.equal(await homeTrigger.getAttribute("aria-expanded"), "true");
  const tachikoRadio = page.getByRole("radio", { name: "Tachiko", exact: true });
  await tachikoRadio.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ts-profile-chrome") === "structured");
  await page.keyboard.press("Escape");
  assert.equal(await homeTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await homeTrigger.evaluate((button) => document.activeElement === button), true, "Escape returns focus to Appearance");

  const secondTab = await context.newPage();
  await openApp(secondTab);
  await secondTab.getByTestId("project-ready").waitFor();
  assert.equal(await secondTab.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "structured");
  await setAppearance(page, "minimal-focus", "comfortable");
  assert.equal(await secondTab.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "structured", "another tab does not live-swap appearance");
  await secondTab.reload();
  await secondTab.locator(".ts-app").waitFor();
  await secondTab.waitForFunction(() =>
    document.documentElement.getAttribute("data-ts-profile-chrome") === "quiet" &&
    document.documentElement.getAttribute("data-ts-profile-density") === "comfortable",
  );
  await setAppearance(page, "tachiko", "compact");

  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-workbook-head > .ts-appearance-selector").count(), 1, "workbook application header owns the selector");
  const selectorPosition = await page.evaluate(() => {
    const selector = document.querySelector(".ts-workbook-head > .ts-appearance-selector");
    const commands = document.querySelector(".ts-workbook-head .ts-header-actions");
    const views = document.querySelector('[aria-label="Workbook views"]');
    return selector.compareDocumentPosition(commands) & Node.DOCUMENT_POSITION_FOLLOWING &&
      commands.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  assert.ok(selectorPosition, "Appearance precedes Document commands and remains outside Views");
  await bindReport(page);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const tablePicker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0);
  const cell = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex);
  await cell.focus();
  await cell.press("Enter");
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("not a number");
  await editor.evaluate((input) => input.setSelectionRange(3, 7));
  await editor.press("Enter");
  const editError = page.getByRole("alert");
  await editError.waitFor();
  assert.equal(
    await editError.textContent(),
    "The work did not accept this value. The draft was kept so you can correct it.",
    "invalid numeric edit reports a retained-draft error before appearance changes",
  );

  const shellHandle = await page.locator(".ts-app").elementHandle();
  const editorHandle = await editor.elementHandle();
  const cellHandle = await page.locator(".ts-cell--focused").elementHandle();
  assert.ok(shellHandle && editorHandle && cellHandle);
  const draftBefore = await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]);
  assert.deepEqual(draftBefore.slice(0, 3), ["not a number", 3, 7], "rejected numeric draft and selection remain in the editor");
  let runtimeBefore = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  let methodsBefore = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  let writesBefore = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  let saveBefore = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
  const inventory = await headerInventory(page);

  async function assertCompositionAxisMerge(axisOrder) {
    const runtimeAtStart = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
    const methodsAtStart = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
    const writesAtStart = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
    const saveAtStart = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
    const before = await page.evaluate((storageKey) => ({
      chrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
      preference: localStorage.getItem(storageKey),
    }), key);
    assert.deepEqual({ chrome: before.chrome, density: before.density }, { chrome: "porcelain", density: "compact" });
    assert.equal(before.preference, JSON.stringify({ schemaVersion: 1, profileId: "tachiko", density: "compact" }));

    await setAppearance(page, "familiar-spreadsheet", "comfortable", { compositionInput: editor, axisOrder });
    assert.equal(await shellHandle.evaluate((node) => node.isConnected && node === document.querySelector(".ts-app")), true, `${axisOrder} keeps the same SheetShell mounted`);
    assert.equal(await editorHandle.evaluate((node) => node.isConnected && node === document.querySelector('[aria-label="Edit cell"]')), true, `${axisOrder} keeps the editor mounted`);
    assert.equal(await cellHandle.evaluate((node) => node.isConnected && node.classList.contains("ts-cell--focused")), true, `${axisOrder} keeps the selected cell`);
    assert.deepEqual(await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), draftBefore, `${axisOrder} preserves editor draft and selection`);
    assert.equal(await editError.textContent(), "The work did not accept this value. The draft was kept so you can correct it.", `${axisOrder} preserves the rejected-edit alert`);
    assert.deepEqual(await headerInventory(page), inventory, `${axisOrder} leaves commands and views unchanged`);
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts()), methodsAtStart, `${axisOrder} dispatches no Work method`);
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), writesAtStart, `${axisOrder} dispatches no copy write`);
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.saveObservation()), saveAtStart, `${axisOrder} leaves save observation unchanged`);
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()), runtimeAtStart, `${axisOrder} leaves runtime revision and opaque bytes unchanged`);
  }

  await setAppearance(page, "tachiko", "compact");
  {
    const runtimeAtStart = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
    const methodsAtStart = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
    const writesAtStart = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
    const saveAtStart = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
    const before = await page.evaluate((storageKey) => ({
      chrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
      preference: localStorage.getItem(storageKey),
    }), key);
    assert.deepEqual({ chrome: before.chrome, density: before.density }, { chrome: "porcelain", density: "compact" });
    assert.equal(before.preference, JSON.stringify({ schemaVersion: 1, profileId: "tachiko", density: "compact" }));

    await editor.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const familiar = page.getByRole("radio", { name: "Familiar Spreadsheet" });
    const tachiko = page.getByRole("radio", { name: "Tachiko" });
    const comfortable = page.getByRole("radio", { name: "Comfortable" });
    const compact = page.getByRole("radio", { name: "Compact" });

    await page.locator(".ts-appearance-profile-option").filter({ hasText: "Familiar Spreadsheet" }).click();
    assert.equal(await familiar.isChecked(), true, "queued profile is shown as the selected radio during composition");
    await page.locator(".ts-appearance-density-option").filter({ hasText: "Comfortable" }).click();
    assert.equal(await comfortable.isChecked(), true, "queued density is shown as the selected radio during composition");
    await page.locator(".ts-appearance-density-option").filter({ hasText: "Compact" }).click();
    assert.equal(await compact.isChecked(), true, "density can be reverted to the applied value during composition");
    await page.locator(".ts-appearance-profile-option").filter({ hasText: "Tachiko" }).click();
    assert.equal(await tachiko.isChecked(), true, "profile can be reverted to the applied value during composition");

    const queued = await page.evaluate((storageKey) => ({
      chrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
      preference: localStorage.getItem(storageKey),
    }), key);
    assert.deepEqual(queued, before, "reverted pending choices leave applied CSS and preference unchanged before compositionend");
    await editor.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: input.value })));
    await page.waitForTimeout(0);
    assert.deepEqual(await page.evaluate((storageKey) => ({
      chrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
      density: document.documentElement.getAttribute("data-ts-profile-density"),
      preference: localStorage.getItem(storageKey),
    }), key), before, "cancelled composition choices remain unapplied and unpersisted after compositionend");
    assert.equal(await shellHandle.evaluate((node) => node.isConnected && node === document.querySelector(".ts-app")), true, "cancel keeps the same SheetShell mounted");
    assert.equal(await editorHandle.evaluate((node) => node.isConnected && node === document.querySelector('[aria-label="Edit cell"]')), true, "cancel keeps the editor mounted");
    assert.equal(await cellHandle.evaluate((node) => node.isConnected && node.classList.contains("ts-cell--focused")), true, "cancel keeps the selected cell");
    assert.deepEqual(await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), draftBefore, "cancel preserves editor draft and selection");
    assert.equal(await editError.textContent(), "The work did not accept this value. The draft was kept so you can correct it.", "cancel preserves the rejected-edit alert");
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts()), methodsAtStart, "cancel dispatches no Work method");
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), writesAtStart, "cancel dispatches no copy write");
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.saveObservation()), saveAtStart, "cancel leaves save observation unchanged");
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()), runtimeAtStart, "cancel leaves runtime revision and opaque bytes unchanged");
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await assertCompositionAxisMerge("profile-first");
  await setAppearance(page, "tachiko", "compact");
  await assertCompositionAxisMerge("density-first");
  await setAppearance(page, "tachiko", "compact");
  runtimeBefore = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  methodsBefore = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  writesBefore = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  saveBefore = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());

  const combos = profiles.flatMap((profileOption) => densities.map((densityOption) => ({ profile: profileOption.id, density: densityOption.id })));
  const profileSurfaces = new Map();
  for (const combo of combos) {
    const rootState = await setAppearance(page, combo.profile, combo.density);
    profileSurfaces.set(combo.profile, rootState.surface);
    assert.equal(await shellHandle.evaluate((node) => node.isConnected && node === document.querySelector(".ts-app")), true, "SheetShell root remains mounted");
    assert.equal(await editorHandle.evaluate((node) => node.isConnected && node === document.querySelector('[aria-label="Edit cell"]')), true, "editor remains mounted");
    assert.equal(await cellHandle.evaluate((node) => node.isConnected && node.classList.contains("ts-cell--focused")), true, "selected cell remains mounted and selected");
    assert.deepEqual(await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), draftBefore, "editor draft and selection survive profile changes");
    assert.equal(await editError.textContent(), "The work did not accept this value. The draft was kept so you can correct it.", "edit error survives profile changes");
    assert.deepEqual(await headerInventory(page), inventory, "commands and views remain unchanged");
  }
  assert.equal(new Set(profileSurfaces.values()).size, 3, "each built-in applies a distinct root chrome color");

  const methodsAfter = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  const writesAfter = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  const saveAfter = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
  assert.deepEqual(methodsAfter, methodsBefore, "appearance selection dispatches no Work/runtime method");
  assert.deepEqual(writesAfter, writesBefore, "appearance selection dispatches no copy write");
  assert.deepEqual(saveAfter, saveBefore, "appearance selection does not change save/work observation");
  const runtimeAfter = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  assert.deepEqual(runtimeAfter, runtimeBefore, "runtime revision and opaque bytes remain unchanged");

  const preferenceBeforeRestart = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  assert.equal(preferenceBeforeRestart, JSON.stringify({ schemaVersion: 1, profileId: "minimal-focus", density: "comfortable" }));
  await editor.press("Escape");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await setAppearance(page, "tachiko", "compact");
  const reportPngBaseline = await reportPng(page);
  for (const combo of combos) {
    await setAppearance(page, combo.profile, combo.density);
    const renderedPng = await reportPng(page);
    assert.deepEqual(
      renderedPng,
      reportPngBaseline,
      `report PNG download is byte-identical for ${combo.profile}/${combo.density}`,
    );
  }
  assert.equal(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
    JSON.stringify({ schemaVersion: 1, profileId: "minimal-focus", density: "comfortable" }),
    "the six-recipe report check leaves Minimal-Focus/comfortable stored for restart",
  );

  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const restarted = await context.newPage();
  await openApp(restarted);
  await restarted.locator(".ts-app").waitFor();
  await restarted.waitForFunction(() =>
    document.documentElement.getAttribute("data-ts-profile-chrome") === "quiet" &&
    document.documentElement.getAttribute("data-ts-profile-density") === "comfortable",
  );
  assert.equal(await restarted.evaluate((storageKey) => localStorage.getItem(storageKey), key), preferenceBeforeRestart, "restart restores exact local preference");

  const corrupt = await context.newPage();
  await corrupt.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "{broken");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === storageKey) throw new Error("blocked write after corrupt preference");
      return original.call(this, itemKey, value);
    };
  }, key);
  await openApp(corrupt);
  await corrupt.getByTestId("project-ready").waitFor();
  assert.equal(await corrupt.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "porcelain");
  assert.equal(await corrupt.evaluate(() => document.documentElement.getAttribute("data-ts-profile-density")), "compact");
  await corrupt.getByRole("button", { name: "Appearance", exact: true }).click();
  const corruptNotice = corrupt.getByText("Saved appearance could not be loaded. Using Tachiko for this session.", { exact: true });
  await corruptNotice.waitFor();
  assert.equal(await corruptNotice.getAttribute("role"), "status");
  await corrupt.locator(".ts-appearance-profile-option").filter({ hasText: "Familiar Spreadsheet" }).click();
  const corruptWriteNotice = corrupt.getByText("Appearance changed for this session, but could not be saved.", { exact: true });
  await corruptWriteNotice.waitFor();
  assert.equal(await corruptWriteNotice.getAttribute("role"), "status");
  assert.equal(await corruptNotice.count(), 0, "a different session choice removes the stale Tachiko fallback claim");
  assert.equal(await corrupt.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "structured", "the selected profile remains active after the failed write");
  assert.equal(await corrupt.evaluate((storageKey) => localStorage.getItem(storageKey), key), "{broken", "failed persistence leaves the malformed stored value unchanged");
  assert.equal(await corrupt.getByRole("radio", { name: "Familiar Spreadsheet", exact: true }).isChecked(), true);

  const readFailure = await context.newPage();
  await readFailure.addInitScript((storageKey) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (itemKey) {
      if (itemKey === storageKey) throw new Error("blocked preference read");
      return original.call(this, itemKey);
    };
  }, key);
  await openApp(readFailure);
  await readFailure.getByTestId("project-ready").waitFor();
  assert.equal(await readFailure.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "porcelain");
  await readFailure.getByRole("button", { name: "Appearance", exact: true }).click();
  const readFailureNotice = readFailure.getByText("Saved appearance could not be loaded. Using Tachiko for this session.", { exact: true });
  await readFailureNotice.waitFor();
  assert.equal(await readFailureNotice.getAttribute("role"), "status");

  const writeFailure = await context.newPage();
  await writeFailure.addInitScript((storageKey) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === storageKey) throw new Error("blocked preference write");
      return original.call(this, itemKey, value);
    };
  }, key);
  await openApp(writeFailure);
  await writeFailure.getByTestId("project-ready").waitFor();
  const unsavedPreference = await writeFailure.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  await writeFailure.getByRole("button", { name: "Appearance", exact: true }).click();
  await writeFailure.locator(".ts-appearance-profile-option").filter({ hasText: "Familiar Spreadsheet" }).click();
  await writeFailure.locator(".ts-appearance-density-option").filter({ hasText: "Compact" }).click();
  await writeFailure.getByText("Appearance changed for this session, but could not be saved.", { exact: true }).waitFor();
  assert.equal(await writeFailure.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "structured", "failed persistence keeps the session choice applied");
  assert.equal(await writeFailure.evaluate((storageKey) => localStorage.getItem(storageKey), key), unsavedPreference, "failed persistence leaves the prior record untouched");

  console.log(JSON.stringify({
    case: "real-entry Appearance selector",
    status: "PASS",
    combinations: combos.length,
    workMethodDelta: Object.entries(methodsAfter).reduce((sum, [name, count]) => sum + count - (methodsBefore[name] ?? 0), 0),
    reportPngBytes: reportPngBaseline.length,
    reportAppearanceMatrix: combos.map(({ profile: profileId, density }) => `${profileId}/${density}`),
    composition: "queued radio presentation, two-axis revert/cancel, and both-axis profile-first/density-first synthetic regressions; no physical IME claim",
    storageCases: ["exact record", "restart restore", "corrupt read", "corrupt read + blocked write", "blocked read", "blocked write", "cross-tab no live swap"],
  }));
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

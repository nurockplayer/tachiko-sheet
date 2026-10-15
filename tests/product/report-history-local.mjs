// Report presentation follows Work's definition history only within this occurrence.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";
import { openFolder, waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST ?? "dist-acceptance";
const profile = await mkdtemp(path.join(tmpdir(), "sheet-report-history-"));
let context, page, browserPid;
const settings = { title: "売上 — authored report", categoryLabel: "商品区分", valueLabel: "Revenue €", type: "line", legendVisible: false };
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const reportTab = () => page.getByRole("tab", { name: "Report", exact: true }).click();
const summaryTab = () => page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }
async function stop() {
  if (!context) return;
  await context.close();
  context = undefined;
  const deadline = Date.now() + 10000;
  while (alive(browserPid) && Date.now() < deadline) await delay(50);
  assert.equal(alive(browserPid), false, "full browser process exit before restart");
}
async function start() {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send("SystemInfo.getProcessInfo")).processInfo.find(row => row.type === "browser")?.id;
  await cdp.detach();
  assert.ok(browserPid > 0);
  await installDistRoutes(context, dist);
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
}
async function saveCopy(name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await saved();
}
async function saved() {
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal(await page.locator(".ts-app-root").getAttribute("data-work-dirty"), "false");
}
async function save() {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved();
}
async function createSummary(category = "category") {
  await summaryTab();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  for (const [label, value] of [["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"], ["Products table", "catalog"], ["Product key", "code"], ["Product category", category], ["Product price", "price"]]) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
  }
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await ready();
}
async function customize(index = 0) {
  await summaryTab();
  await page.getByTestId(`j4-result-${index}`).getByRole("button", { name: "Create line report", exact: true }).click();
  await reportTab();
  for (const [label, value] of [["Title", settings.title], ["Category label", settings.categoryLabel], ["Value label", settings.valueLabel]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel("Show legend", { exact: true }).uncheck();
}
async function assertSettings() {
  await reportTab();
  assert.equal(await page.getByLabel("Title", { exact: true }).count(), 1, "Redo restores the authored presentation rather than losing it");
  for (const [label, value] of [["Title", settings.title], ["Category label", settings.categoryLabel], ["Value label", settings.valueLabel]]) {
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
  }
  assert.equal(await page.getByLabel("Show legend", { exact: true }).isChecked(), settings.legendVisible);
  assert.match(await page.locator(".ts-report-output-note").textContent(), /This line report/);
  await page.getByRole("button", { name: "Export current PNG", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).isEnabled(), true);
}
async function assertHidden() {
  await reportTab();
  for (const locator of [page.getByLabel("Title", { exact: true }), page.getByRole("region", { name: "Report chart", exact: true }), page.getByRole("button", { name: "Export current PNG", exact: true })]) {
    assert.equal(await locator.count(), 0, "a detached presentation is neither current nor exportable");
  }
}
async function cards() {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  return page.locator('[data-testid^="result-card:"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")));
}
async function occurrence() {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const id = await page.locator("[data-work-occurrence]").first().getAttribute("data-work-occurrence");
  assert.ok(id);
  return id;
}
async function history(direction) {
  await page.getByRole("button", { name: direction, exact: true }).click();
  await ready();
}
async function close() {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await waitForColdHome(page);
}
async function open(name) {
  await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
  await ready();
}

try {
  // Both with and without an intervening Save: same identity, presentation,
  // authoritative groups, then a complete browser exit and durable reopen.
  for (const saveWhileDetached of [false, true]) {
    await start();
    await openFolder(page, path.join(dist, "examples", "j4-catalog-sales"));
    await createSummary();
    const originalCards = await cards();
    const originalOccurrence = await occurrence();
    await customize();
    const name = `history-report-${saveWhileDetached}`;
    await saveCopy(name);
    await history("Undo");
    assert.equal((await cards()).length, 0);
    await assertHidden();
    if (saveWhileDetached) await save();
    await history("Redo");
    assert.equal(await occurrence(), originalOccurrence, "Redo stays in the same occurrence");
    assert.deepEqual(await cards(), originalCards, "Work restores the identical definition IDs");
    await summaryTab();
    for (const table of await page.getByLabel("Cross-table groups", { exact: true }).all()) {
      assert.deepEqual(await table.locator("tbody tr").allTextContents(), ["NOTE1000", "PEN800"]);
    }
    await assertSettings();
    await save();
    await stop();
    await start();
    await open(name);
    assert.notEqual(await occurrence(), originalOccurrence, "restart/reopen creates a fresh occurrence");
    assert.deepEqual(await cards(), originalCards);
    await assertSettings();
    await close();
    await stop();
    console.log(`PASS: authored report Undo/Redo, Save while detached=${saveWhileDetached}, full browser restart/reopen`);
  }

  // Save while detached persists only the current state. Reopening a copy
  // containing the SAME definition IDs in a new occurrence cannot recover
  // the old occurrence's unsaved presentation, either by replacement or Close.
  await start();
  for (const boundary of ["replace", "close"]) {
    await openFolder(page, path.join(dist, "examples", "j4-catalog-sales"));
    await createSummary();
    const originalCards = await cards();
    const oldOccurrence = await occurrence();
    // Keep a separate reportless snapshot with this exact definition ID.
    await saveCopy(`occurrence-target-${boundary}`);
    await customize();
    await saveCopy(`detached-current-${boundary}`);
    await history("Undo");
    assert.deepEqual(await cards(), []);
    await assertHidden();
    await save();
    if (boundary === "close") {
      await close();
      await open(`occurrence-target-${boundary}`);
    } else {
      // Home owns the normal Open UI. This existing acceptance-only event
      // exercises its identical saved-copy handler with a resident occurrence.
      await page.evaluate(name => new Promise(resolve => {
        const detail = { name, handled: false, complete: resolve };
        window.dispatchEvent(new CustomEvent("tachiko-acceptance-open-saved-copy", { detail }));
        if (!detail.handled) throw new Error("Acceptance saved-copy handler unavailable");
      }), `occurrence-target-${boundary}`);
      await ready();
    }
    assert.notEqual(await occurrence(), oldOccurrence, `${boundary} establishes a different occurrence`);
    assert.deepEqual(await cards(), originalCards, "same definition ID, different occurrence");
    await assertHidden();
    await close();
    await open(`detached-current-${boundary}`);
    assert.deepEqual(await cards(), [], "Save while detached stores no removed summary");
    await assertHidden();
    await close();
    console.log(`PASS: ${boundary} clears detached presentation; detached Save reopens truthfully without a report`);
  }
} finally {
  await stop();
  await rm(profile, { recursive: true, force: true });
}

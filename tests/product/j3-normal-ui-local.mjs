// J3 normal-product exercise. It uses the built app's file inputs, dialogs,
// IndexedDB and browser download path only; no acceptance hook installs source
// data or invokes an import/cleanup/export capability on the app's behalf.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { leaveFirstEntryAtHome } from "./first-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name an acceptance build.");
  process.exit(78);
}
let chromium;
try { ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core")); }
catch { console.error("BLOCKED: pinned Playwright is unavailable."); process.exit(78); }

const root = fileURLToPath(new URL("../..", import.meta.url));
const corpus = path.join(root, "acceptance/j3-interop");
const messyCsv = path.join(corpus, "fixtures/messy.csv");
const messyXlsx = path.join(corpus, "fixtures/messy.xlsx");
const mergedXlsx = path.join(corpus, "fixtures/merged-note.xlsx");
const textSentinels = path.join(corpus, "fixtures/text-sentinels.csv");
const launch = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };

async function choose(page, file) {
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(file);
  return page.getByRole("dialog", { name: "Review import candidate", exact: true });
}

async function importWithTypes(page, file, { numbers = true } = {}) {
  const dialog = await choose(page, file);
  await dialog.waitFor();
  assert.ok(await dialog.locator(".ts-import-column").count() > 0, "candidate must expose per-column type selection");
  if (numbers) {
    const selectors = dialog.locator("select");
    const count = await selectors.count();
    console.log(`J3 candidate type controls: ${count}`);
    assert.ok(count >= 2, "candidate must expose explicit types for quantity and price");
    await selectors.nth(count - 1).selectOption("number");
    await dialog.locator("select").nth(count - 2).selectOption("number");
  }
  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
}

async function preview(page, name) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
}

async function download(page, format, destination) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const cancelledDownload = page.waitForEvent("download", { timeout: 250 }).then(() => false).catch(() => true);
  const trigger = page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /actual exporter|exporter produced/i);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const triggerHandle = await trigger.elementHandle();
  assert.ok(triggerHandle, `Prepare ${format.toUpperCase()} trigger must remain mounted after cancellation`);
  await page.waitForFunction((element) => element === document.activeElement, triggerHandle);
  await assert.doesNotReject(async () => trigger.waitFor());
  // The first consent was explicitly cancelled: there must not be a download.
  const noDownload = await cancelledDownload;
  assert.equal(noDownload, true, "cancelled export must not download");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), `Prepare ${format.toUpperCase()}`);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  await (await downloaded).saveAs(destination);
}

const profile = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-j3-profile-"));
const output = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-j3-output-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, launch);
  await installDistRoutes(context, dist);
  let page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8_000);
  console.log("J3 normal UI: open CSV");
  await page.goto(LOCAL_ORIGIN);
  await leaveFirstEntryAtHome(page);

  // I02: cancellation has no resident workbook or semantic side effect.
  let dialog = await choose(page, messyCsv);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement === document.querySelector('input[type="file"][accept*=".csv"]'));
  assert.equal(await page.getByLabel("Choose CSV or XLSX", { exact: true }).evaluate((input) => document.activeElement === input), true, "cancel must restore focus to the spreadsheet trigger");
  // Invalid typing stays a rejected import candidate; it never opens or replaces work.
  dialog = await choose(page, messyCsv);
  await dialog.locator("select").first().selectOption("number");
  await dialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  const importAlert = dialog.getByRole("alert");
  await importAlert.waitFor();
  assert.match(await importAlert.textContent(), /import was not applied/i);
  assert.equal(await importAlert.evaluate((alert) => alert.closest('[role="dialog"]')?.getAttribute("aria-modal")), "true", "rejection alert must remain inside the active modal");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('input[type="file"][accept*=".csv"]'));

  // I01/I07: normal CSV selection, visible candidate and explicit choices.
  await importWithTypes(page, messyCsv);
  console.log("J3 normal UI: imported CSV");
  assert.match(await page.locator("[role=grid]").textContent(), /001?PEN|PEN/);
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.match(await page.locator("body").textContent(), /Source fidelity ledger/);
  // The imported workbook is dirty until saved; replacement/close asks rather than discarding it.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const dirtyDialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await dirtyDialog.waitFor();
  await dirtyDialog.getByRole("button", { name: "Keep editing", exact: true }).click();

  // I03/I04: cancelling is inert; an old preview cannot be committed after a real edit.
  await preview(page, "Preview trim");
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  await preview(page, "Preview trim");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const first = page.locator("[role=grid] tbody tr").first().locator("td").first();
  await first.dblclick();
  const edit = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await edit.fill("PEN!");
  await edit.press("Enter");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.equal(await page.getByTestId("cleanup-preview").count(), 0, "an intervening publication must clear the stale preview");
  assert.equal(await page.getByRole("button", { name: "Commit preview", exact: true }).count(), 0, "a stale preview must not remain dispatchable");
  // The intervening edit is retained; explicitly correct it before making a
  // new preview, rather than treating a stale preview as a retry.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await first.dblclick();
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).fill(" PEN ");
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).press("Enter");
  await preview(page, "Preview trim");
  assert.ok(await page.getByLabel("Cleanup targets", { exact: true }).locator("li").count() > 0, "preview must identify concrete row/column targets");
  // This declared acceptance transport fault reaches the actual cleanup
  // commit once, then loses its reply. It must not be mistaken for a failed
  // cleanup or retried by the UI.
  const cleanupDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
  await page.getByRole("button", { name: "Commit preview", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator("[data-work-dirty]").getAttribute("data-work-dirty"), "true");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.equal(await page.getByTestId("operation-outcome").textContent(), "Outcome needs review");
  assert.equal(await page.getByTestId("project-ready").count(), 0, "unknown cleanup retained the old view");
  assert.equal(await page.locator("[role=grid]").count(), 0, "unknown cleanup retained a stale grid");
  assert.equal(await page.getByTestId("cleanup-preview").count(), 0, "unknown cleanup retained the old preview");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), cleanupDispatches + 1, "unknown cleanup was retried");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.equal(await page.getByTestId("cleanup-preview").count(), 0, "published recovery retained a stale cleanup preview");
  assert.ok(await page.getByRole("button", { name: "Preview whole-row deduplication", exact: true }).isEnabled(), "re-observe did not restore an eligible cleanup action");
  // Continue from the re-observed revision with a new, explicit preview.
  await preview(page, "Preview whole-row deduplication");
  await page.getByRole("button", { name: "Commit preview", exact: true }).click();

  // The trim/dedup commit produces the fixed corpus values for independent checks.
  const csvOut = path.join(output, "normal-ui.csv");
  const xlsxOut = path.join(output, "normal-ui.xlsx");
  await download(page, "csv", csvOut);
  console.log("J3 normal UI: downloaded CSV");
  await download(page, "xlsx", xlsxOut);
  execFileSync("python3", [path.join(corpus, "check.py"), "--export", csvOut], { stdio: "inherit" });
  execFileSync("python3", [path.join(corpus, "check.py"), "--export", xlsxOut], { stdio: "inherit" });

  // I08: strict local copy, terminate the browser process, reopen and export.
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j3-normal-copy");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  console.log("J3 normal UI: saved local copy");
  await context.close();
  context = await chromium.launchPersistentContext(profile, launch);
  await installDistRoutes(context, dist);
  page = context.pages()[0] ?? await context.newPage();
  await page.goto(LOCAL_ORIGIN);
  await leaveFirstEntryAtHome(page);
  await page.getByRole("button", { name: "Open saved j3-normal-copy", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  console.log("J3 normal UI: reopened local copy");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const restartOut = path.join(output, "normal-ui-restart.xlsx");
  await download(page, "xlsx", restartOut);
  execFileSync("python3", [path.join(corpus, "check.py"), "--export", restartOut], { stdio: "inherit" });

  // I01/I06: real XLSX follows the normal import path, not merely inspection.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await importWithTypes(page, messyXlsx);
  assert.match(await page.locator("[role=grid]").textContent(), /PEN/);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();

  // Text-looking sentinel values are imported and preserved through host save,
  // actual browser restart, reopen, and the exporter.
  await importWithTypes(page, textSentinels, { numbers: false });
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j3-sentinel-copy");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = await chromium.launchPersistentContext(profile, launch);
  await installDistRoutes(context, dist);
  page = context.pages()[0] ?? await context.newPage();
  await page.goto(LOCAL_ORIGIN);
  await leaveFirstEntryAtHome(page);
  await page.getByRole("button", { name: "Open saved j3-sentinel-copy", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const sentinelOut = path.join(output, "normal-ui-sentinels.csv");
  await download(page, "csv", sentinelOut);
  const sentinelText = await readFile(sentinelOut, "utf8");
  assert.match(sentinelText, /0012/);
  assert.match(sentinelText, /03\/04\/2026/);

  // Construct-specific merged-cells disposition remains visible at candidate
  // review and cannot be mistaken for generic XLSX support.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  dialog = await choose(page, mergedXlsx);
  assert.match(await dialog.getByLabel("Candidate source fidelity ledger", { exact: true }).textContent(), /merged/i);
  await dialog.press("Escape");
  console.log(JSON.stringify({ case: "J3 normal UI CSV/XLSX, cleanup, consent, restart", status: "PASS", manualBoundary: "Real CJK IME and assistive-technology walkthrough remain manual." }));
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
}

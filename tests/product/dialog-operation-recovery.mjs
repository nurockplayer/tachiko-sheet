// Focused real-browser coverage for failure ownership, retry and non-abortable
// pending dismissal. Acceptance timing hooks wait only after real operations.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name an acceptance build.");
  process.exit(78);
}
let chromium;
try { ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core")); }
catch { console.error("BLOCKED: pinned Playwright is unavailable."); process.exit(78); }

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixture = path.join(root, "acceptance/j3-interop/fixtures/messy.csv");
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-dialog-recovery-profile-"));
const output = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-dialog-recovery-output-"));
let context;

try {
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await installDistRoutes(context, dist);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  const input = page.getByLabel("Choose CSV or XLSX", { exact: true });

  // One invalid inspection owns one alert; retry clears it before the delayed
  // valid inspection has completed.
  const malformed = path.join(output, "malformed.xlsx");
  await writeFile(malformed, "not an xlsx workbook", "utf8");
  await input.setInputFiles(malformed);
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("alert").count(), 1, "inspection failure has one alert owner");
  await page.evaluate(() => window.__tachikoAcceptance.deferNextImportInspection());
  await input.setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('input[type="file"][accept*=".csv"]')?.disabled === true);
  assert.equal(await page.getByRole("alert").count(), 0, "retry clears the previous inspection failure while new inspection is pending");
  await page.evaluate(() => window.__tachikoAcceptance.releaseImportInspection());
  const importDialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await importDialog.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0, "valid inspection opens a clean candidate dialog");

  // The real import resolves before the acceptance gate releases its reply.
  // During that pending interval every user dismissal route stays blocked.
  await page.evaluate(() => window.__tachikoAcceptance.deferNextImportApplication());
  const importAction = importDialog.getByRole("button", { name: "Import candidate", exact: true });
  await importAction.click();
  await page.waitForFunction(() => window.__tachikoAcceptance.importSpreadsheetRequestCount() > 0);
  await importDialog.locator("select").first().focus();
  assert.equal(await importAction.isDisabled(), true, "dispatched Import disables its action");
  assert.equal(await importDialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true, "dispatched Import disables Cancel");
  await page.keyboard.press("Escape");
  assert.equal(await importDialog.count(), 1, "Escape cannot dismiss dispatched Import");
  await page.locator(".ts-modal-backdrop").click({ position: { x: 1, y: 1 } });
  assert.equal(await importDialog.count(), 1, "backdrop cannot dismiss dispatched Import");
  await page.evaluate(() => window.__tachikoAcceptance.releaseImportApplication());
  await importDialog.waitFor({ state: "detached" });
  await page.getByTestId("project-ready").waitFor();

  // A failed Save can be retried with the same name. The old error disappears
  // before Working, and Escape/backdrop cannot imply the durable write aborted.
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const saveDialog = page.getByRole("dialog", { name: "Save a copy", exact: true });
  const name = `dialog-retry-${Date.now()}`;
  const nameInput = saveDialog.getByRole("textbox", { name: "Copy name", exact: true });
  await nameInput.fill(name);
  await page.evaluate(() => window.__tachikoAcceptance.failNextSave());
  await saveDialog.getByRole("button", { name: "Create copy", exact: true }).click();
  const saveFailure = saveDialog.getByRole("alert");
  await saveFailure.waitFor();
  assert.equal(await page.getByRole("alert").count(), 1, "failed Save has one accessible alert");
  await page.evaluate(() => window.__tachikoAcceptance.deferNextCopyWrite());
  await saveDialog.getByRole("button", { name: "Create copy", exact: true }).click();
  const workingSave = saveDialog.getByRole("button", { name: "Working…", exact: true });
  await workingSave.waitFor();
  assert.equal(await saveDialog.getByRole("alert").count(), 0, "same-name retry clears the previous failure before Working");
  assert.equal(await page.getByRole("alert").count(), 0, "same-name retry has no stale parent failure");
  assert.equal(await saveDialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true, "pending Save disables Cancel");
  await page.keyboard.press("Escape");
  assert.equal(await saveDialog.count(), 1, "Escape cannot dismiss pending Save");
  await page.locator(".ts-modal-backdrop").click({ position: { x: 1, y: 1 } });
  assert.equal(await saveDialog.count(), 1, "backdrop cannot dismiss pending Save");
  await page.evaluate(() => window.__tachikoAcceptance.releaseCopyWrite());
  await saveDialog.waitFor({ state: "detached" });
  assert.ok(await page.evaluate((copyName) => window.__tachikoAcceptance.savedSnapshot(copyName), name), "released real copy write completes");

  // Prepare failure is reported once in the active Download panel. A retry
  // removes that failure before consent, and a handoff failure returns to the
  // panel so the user can Prepare again and complete a real browser download.
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const downloadPanel = page.getByRole("region", { name: "Download spreadsheet", exact: true });
  const prepare = downloadPanel.getByRole("button", { name: "Prepare XLSX", exact: true });
  await page.evaluate(() => window.__tachikoAcceptance.failNextSpreadsheetExport());
  await prepare.click();
  const prepareFailure = page.getByRole("alert");
  await prepareFailure.waitFor();
  assert.equal(await page.getByRole("alert").count(), 1, "Prepare failure has one alert owner");
  assert.equal(await downloadPanel.getByRole("alert").count(), 1, "Prepare failure is actionable in the Download panel");
  assert.match(await prepareFailure.textContent(), /export could not be prepared/i);
  await page.evaluate(() => window.__tachikoAcceptance.failNextCleanupPreview());
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  const alerts = page.getByRole("alert");
  await alerts.filter({ hasText: "A cleanup preview could not be created." }).waitFor();
  assert.equal(await alerts.count(), 2, "cleanup failure keeps its global alert while the prior Download failure remains actionable");
  assert.match(await downloadPanel.getByRole("alert").textContent(), /export could not be prepared/i, "Download retains its own failure detail");
  assert.match(await alerts.nth(0).textContent(), /cleanup preview could not be created/i, "cleanup failure remains owned by the global alert");
  await prepare.click();
  const downloadDialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await downloadDialog.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0, "successful Prepare retry clears the stale failure");

  await page.evaluate(() => {
    window.__issue97OriginalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error("The acceptance probe rejected browser download handoff once."); };
  });
  await downloadDialog.getByRole("button", { name: "Download", exact: true }).click();
  await downloadDialog.waitFor({ state: "detached" });
  const handoffFailure = page.getByRole("alert");
  await handoffFailure.waitFor();
  assert.equal(await page.getByRole("alert").count(), 1, "handoff failure has one alert owner");
  assert.equal(await downloadPanel.getByRole("alert").count(), 1, "handoff failure returns to an actionable panel alert");
  assert.match(await handoffFailure.textContent(), /rejected browser download handoff once/i);
  assert.equal(await prepare.evaluate((element) => element === document.activeElement), true, "handoff failure restores focus to Prepare");
  await page.evaluate(() => {
    URL.createObjectURL = window.__issue97OriginalCreateObjectURL;
    delete window.__issue97OriginalCreateObjectURL;
  });
  await prepare.click();
  await downloadDialog.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0, "re-Prepare clears the handoff failure");
  const downloaded = page.waitForEvent("download");
  await downloadDialog.getByRole("button", { name: "Download", exact: true }).click();
  await downloadDialog.waitFor({ state: "detached" });
  await downloaded;
  assert.equal(await page.getByRole("alert").count(), 0, "successful handoff leaves no stale failure");

  console.log(JSON.stringify({ case: "dialog operation failures, retries and pending dismissal", status: "PASS" }));
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
}

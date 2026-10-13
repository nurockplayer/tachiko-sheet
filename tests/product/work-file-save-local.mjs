// #131 carrier option a: real-kit local Save, actual process termination,
// independent source/arithmetic/Work oracle and nondestructive failure cases.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";
import { independentOracle, releaseSourceFiles } from "./work-file-oracle.mjs";
import { salesCatalogText } from "../../scripts/sales-catalog-source.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name an acceptance build."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet-work-file-save-"));
const profile = path.join(work, "profile");
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const impactId = `cell:${expected.entity}:${expected.impact}`;
const priceId = "cell:30000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000203";
const results = [];
const processes = [];
let pid, browser, context;
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function start() {
  assert.equal(context, undefined, "the previous full Chromium process must exit before restart");
  assert.equal(pid, undefined);
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.WORK_CHROMIUM ? {executablePath: process.env.WORK_CHROMIUM} : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? {args: ["--single-process"]} : {}),
  });
  browser = context.browser();
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send("SystemInfo.getProcessInfo");
  await cdp.detach();
  pid = info.processInfo.find(entry => entry.type === "browser")?.id;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("BLOCKED: Chromium did not expose its browser process PID");
  processes.push({pid, profile});
  await installDistRoutes(context, dist);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  processes.at(-1).coldHome = true;
  return page;
}
function processExists(processId) {
  try { process.kill(processId, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
async function terminate() {
  if (!context) return;
  const ownedPid = pid;
  let timeout;
  try {
    await Promise.race([context.close(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("BLOCKED: Chromium close timed out")), 10_000);
    })]);
  } finally { clearTimeout(timeout); }
  const deadline = Date.now() + 5000;
  while (ownedPid && processExists(ownedPid) && Date.now() < deadline) await delay(50);
  if (ownedPid && processExists(ownedPid)) throw new Error(`BLOCKED: owned Chromium PID ${ownedPid} did not terminate`);
  if (processes.at(-1)?.pid === ownedPid) processes.at(-1).exit = {observed: true, pid: ownedPid, processAbsent: true};
  pid = browser = context = undefined;
}
async function edit(page, id, value) {
  await page.getByRole("tab", {name: "Table", exact: true}).click();
  await page.getByTestId(id).dblclick();
  const input = page.getByRole("textbox", {name: "Edit cell", exact: true});
  await input.fill(String(value)); await input.press("Enter"); await ready(page);
  assert.equal((await page.getByTestId(id).textContent()).trim(), String(value));
}
async function download(page, label, report = false) {
  await page.getByRole("tab", {name: "Import & export", exact: true}).click();
  await page.getByRole("button", {name: "Download work file (.ro)", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Confirm download", exact: true});
  await dialog.waitFor();
  if (report) assert.match(await dialog.getByRole("list", {name: "Not included in this file"}).textContent(), /Report settings/);
  else assert.equal(await dialog.getByRole("list", {name: "Not included in this file"}).count(), 0);
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", {name: "Download", exact: true}).click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  const filename = path.join(work, `${label}.ro`);
  await file.saveAs(filename); await dialog.waitFor({state: "detached"});
  return {path: filename, bytes: await readFile(filename)};
}
async function openFile(page, file) {
  await page.getByTestId("open-work-file").setInputFiles(file.path); await ready(page);
}
async function openSaved(page, name) {
  await page.getByRole("button", {name: `Open saved ${name}`, exact: true}).click(); await ready(page);
  await page.getByTestId("save-status").filter({hasText: "Saved on this device"}).waitFor();
}
async function saveDialog(page, name) {
  await page.getByRole("button", {name: "Save a copy", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Save a copy", exact: true});
  await dialog.getByRole("textbox", {name: "Copy name", exact: true}).fill(name);
  return dialog;
}
async function save(page, name) {
  const dialog = await saveDialog(page, name);
  await dialog.getByRole("button", {name: "Create copy", exact: true}).click();
  await dialog.waitFor({state: "detached"});
  await page.getByTestId("save-status").filter({hasText: "Saved on this device"}).waitFor();
  assert.equal(await page.locator('[data-work-dirty="false"]').count(), 1);
}
async function raw(page, name) {
  return page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("tachiko-sheet-local-copies", 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      for (const store of ["copies", "opaque-copies"]) {
        const row = await new Promise((resolve, reject) => {
          const r = db.transaction(store, "readonly").objectStore(store).get(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        if (row) return {...row, ...(row.bytes ? {bytes: [...new Uint8Array(row.bytes)]} : {}),
          ...(row.files ? {files: row.files.map(file => ({...file, bytes: [...new Uint8Array(file.bytes)]}))} : {})};
      }
      return null;
    } finally { db.close(); }
  }, name);
}
async function mutateStored(page, name, replacementName, fault) {
  await page.evaluate(async ({name, replacementName, fault}) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("tachiko-sheet-local-copies", 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      const storeName = fault === "legacy" ? "copies" : "opaque-copies";
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite"); const store = tx.objectStore(storeName); const request = store.get(name);
        request.onsuccess = () => {
          const row = request.result; row.name = replacementName;
          if (fault === "legacy") delete row.kind;
          if (fault === "corrupt") { row.bytes = row.bytes.slice(0); new Uint8Array(row.bytes)[0] ^= 255; delete row.presentation; }
          if (fault === "digest") row.presentation.snapshotDigest = "0".repeat(64);
          if (fault === "revision") row.presentation.snapshotRevision = "different-revision";
          if (fault === "invalid-import") row.importedSource = {metadata: null, ledger: null};
          if (fault === "foreign-import") row.importedSource = {
            name: "foreign.csv", format: "csv", bytes: new TextEncoder().encode("foreign\nvalue\n").buffer,
            metadata: {version: 1, sheets: []}, ledger: [],
          };
          if (fault === "invalid-presentation") row.presentation.report.legendVisible = null;
          if (fault === "unknown") row.kind = "future";
          store.add(row);
        };
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, {name, replacementName, fault});
}
async function assertUnsaved(page) {
  assert.doesNotMatch(await page.getByTestId("save-status").textContent(), /Saved on this device/);
  assert.equal(await page.locator('[data-work-dirty="true"]').count(), 1);
  assert.equal(await page.getByTestId("project-ready").count(), 1);
}
async function assertCloseProtected(page) {
  await page.getByRole("button", {name: "Close project", exact: true}).click();
  const close = page.getByRole("dialog", {name: "Unsaved work", exact: true}); await close.waitFor();
  assert.equal(await close.getByRole("button", {name: "Save a copy…", exact: true}).isEnabled(), true);
  await close.getByRole("button", {name: "Keep editing", exact: true}).click();
}
async function coldHome(page) { await page.reload(); await waitForColdHome(page); }
try {
  let page = await start();
  await openReleasePlanExample(page); await edit(page, impactId, 4);
  await save(page, "Existing canonical");
  await mutateStored(page, "Existing canonical", "Existing legacy", "legacy");
  const oldCanonical = await raw(page, "Existing canonical"); const oldLegacy = await raw(page, "Existing legacy");
  const initial = await download(page, "release-initial");
  await independentOracle(page, initial, releaseSourceFiles, {entity: expected.entity, field: expected.impact, value: 4});
  await coldHome(page); await openFile(page, initial); await edit(page, impactId, 2);
  const occurrenceBefore = await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot());
  let dialog = await saveDialog(page, "Cancelled");
  await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
  await assertUnsaved(page); assert.equal(await raw(page, "Cancelled"), null); await assertCloseProtected(page);
  results.push("portable-Save-cancel-keeps-unsaved-Close-protection");

  for (const fault of ["conflict", "quota", "abort", "unknown"]) {
    const name = fault === "conflict" ? "Existing canonical" : `Failed ${fault}`;
    dialog = await saveDialog(page, name);
    if (fault === "quota") await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        if (this.name === "tachiko-sheet-local-copies" && mode === "readwrite") {
          IDBDatabase.prototype.transaction = original;
          throw new DOMException("Controlled quota failure", "QuotaExceededError");
        }
        return original.call(this, stores, mode, options);
      };
    });
    if (fault === "abort") await page.evaluate(() => window.__tachikoAcceptance.failNextSave());
    if (fault === "unknown") await page.evaluate(() => window.__tachikoAcceptance.faultNextWorkFileCopyReply("unknown"));
    await dialog.getByRole("button", {name: "Create copy", exact: true}).click(); await dialog.getByRole("alert").waitFor();
    await assertUnsaved(page);
    assert.equal(await dialog.getByRole("textbox", {name: "Copy name", exact: true}).inputValue(), name);
    if (fault === "quota" || fault === "abort") assert.equal(await raw(page, name), null);
    if (fault === "unknown") assert.equal((await raw(page, name)).kind, "work-file", "a lost committed reply is uncertain, never Saved");
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot()), occurrenceBefore);
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click(); await assertCloseProtected(page);
    results.push(`${fault}-never-Saved-or-Close-permission`);
  }
  dialog = await saveDialog(page, "Stale receipt");
  await page.evaluate(() => window.__tachikoAcceptance.faultNextWorkFileCopyReply("stale"));
  await dialog.getByRole("button", {name: "Create copy", exact: true}).click(); await dialog.waitFor({state: "detached"});
  await assertUnsaved(page); await assertCloseProtected(page);
  results.push("stale-receipt-never-Saved-or-Close-permission");

  dialog = await saveDialog(page, "Portable first");
  await page.evaluate(() => window.__tachikoAcceptance.deferNextCopyWrite());
  await dialog.getByRole("button", {name: "Create copy", exact: true}).click();
  await dialog.getByRole("button", {name: "Working…", exact: true}).waitFor();
  await page.waitForFunction(async () => (await window.__tachikoAcceptance.savedSnapshot("Portable first")) !== null);
  await assertUnsaved(page);
  assert.equal(await dialog.getByRole("button", {name: "Cancel", exact: true}).isDisabled(), true);
  await page.evaluate(() => window.__tachikoAcceptance.releaseCopyWrite());
  await dialog.waitFor({state: "detached"}); await page.getByTestId("save-status").filter({hasText: "Saved on this device"}).waitFor();
  const first = await raw(page, "Portable first");
  assert.equal(first.kind, "work-file"); assert.equal(first.formatVersion, 1);
  assert.equal("importedSource" in first, false); assert.equal("presentation" in first, false);
  const firstDownload = await download(page, "release-first");
  assert.deepEqual(firstDownload.bytes, Buffer.from(first.bytes), "local payload is unchanged Work export, recoverable through Download");
  await independentOracle(page, firstDownload, releaseSourceFiles, {entity: expected.entity, field: expected.impact, value: 2});
  await terminate(); page = await start(); await openSaved(page, "Portable first");
  const reopened = await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot());
  assert.notEqual(reopened.occurrence, occurrenceBefore.occurrence, "local .ro reopen creates a fresh Work occurrence");
  const reopenedDownload = await download(page, "release-first-reopened");
  assert.deepEqual(reopenedDownload.bytes, firstDownload.bytes);
  await independentOracle(page, reopenedDownload, releaseSourceFiles, {entity: expected.entity, field: expected.impact, value: 2});
  await edit(page, impactId, 1); await save(page, "Portable second");
  const second = await raw(page, "Portable second");
  assert.deepEqual(await raw(page, "Portable first"), first, "second Save never updates the first copy");
  await terminate(); page = await start(); await openSaved(page, "Portable second");
  const secondDownload = await download(page, "release-second-reopened");
  assert.deepEqual(secondDownload.bytes, Buffer.from(second.bytes));
  await independentOracle(page, secondDownload, releaseSourceFiles, {entity: expected.entity, field: expected.impact, value: 1});
  results.push("Open-edit-local-Save-process-exit-same-profile-Home-fresh-occurrence-independent-full-formula-oracle-edit-Save-reopen");

  await mutateStored(page, "Portable first", "Corrupt portable", "corrupt");
  await mutateStored(page, "Portable first", "Unknown portable", "unknown");
  await coldHome(page);
  for (const name of ["Corrupt portable", "Unknown portable"]) {
    const before = await raw(page, name);
    await page.getByRole("button", {name: `Open saved ${name}`, exact: true}).click();
    await page.getByRole("alert").filter({hasText: /could not be opened/}).waitFor();
    assert.equal(await page.getByTestId("project-ready").count(), 0);
    assert.deepEqual(await raw(page, name), before, "refusal never rewrites or deletes stored bytes");
  }
  await openSaved(page, "Portable first");
  assert.deepEqual(await raw(page, "Portable first"), first);
  for (const [name, original] of [["Existing canonical", oldCanonical], ["Existing legacy", oldLegacy]]) {
    await coldHome(page); await openSaved(page, name);
    assert.equal((await page.getByTestId(impactId).textContent()).trim(), "4");
    assert.deepEqual(await raw(page, name), original);
  }
  results.push("corrupt-and-unknown-refuse-without-affecting-other-copies-old-canonical-legacy-byte-unchanged");

  await coldHome(page); await page.getByRole("button", {name: "Open sales example", exact: true}).click(); await ready(page);
  await save(page, "Existing opaque"); const oldOpaque = await raw(page, "Existing opaque");
  assert.equal(oldOpaque.kind, "opaque"); assert.equal(oldOpaque.formatVersion, 2);
  const sales = await download(page, "sales-initial", true);
  await independentOracle(page, sales, salesCatalogText, null, true);
  await coldHome(page); await openFile(page, sales);
  await page.getByRole("tab", {name: "Report", exact: true}).click();
  assert.equal(await page.getByLabel("Title", {exact: true}).count(), 0, "a core .ro has no invented report settings");
  await page.getByRole("tab", {name: "Cross-table summary", exact: true}).click();
  await page.getByLabel("Cross-table groups", {exact: true}).waitFor();
  await page.getByRole("button", {name: "Create line report", exact: true}).click();
  await page.getByRole("tab", {name: "Report", exact: true}).click();
  for (const [label, value] of [["Title", "Locally authored 雪"], ["Category label", "Products"], ["Value label", "Sales"]]) {
    await page.getByLabel(label, {exact: true}).fill(value);
  }
  await page.getByLabel("Show legend", {exact: true}).uncheck();
  await page.getByRole("tab", {name: "Table", exact: true}).click();
  await page.getByRole("navigation", {name: "Workbook actions", exact: true}).getByLabel("Table", {exact: true}).selectOption("catalog");
  await ready(page); await edit(page, priceId, 250); await save(page, "Portable report");
  const reportCopy = await raw(page, "Portable report");
  assert.equal(reportCopy.presentation.snapshotRevision, reportCopy.revision);
  assert.equal(reportCopy.presentation.snapshotDigest, sha256(Buffer.from(reportCopy.bytes)));
  assert.equal("importedSource" in reportCopy, false);
  const reportFile = await download(page, "sales-local-report", true);
  assert.deepEqual(reportFile.bytes, Buffer.from(reportCopy.bytes));
  const definitions = await independentOracle(page, reportFile, salesCatalogText,
    {entity: "30000000-0000-4000-8000-000000000001", field: "20000000-0000-4000-8000-000000000203", value: 250}, true);
  await terminate(); page = await start(); await openSaved(page, "Portable report");
  await page.getByRole("tab", {name: "Report", exact: true}).click();
  for (const [label, value] of [["Title", "Locally authored 雪"], ["Category label", "Products"], ["Value label", "Sales"]]) {
    assert.equal(await page.getByLabel(label, {exact: true}).inputValue(), value);
  }
  assert.equal(await page.getByLabel("Show legend", {exact: true}).isChecked(), false);
  assert.match(await page.getByLabel("Current report data", {exact: true}).textContent(), /PEN\s*1000/);
  const roundTrip = await download(page, "sales-report-reopened", true);
  assert.deepEqual(roundTrip.bytes, reportFile.bytes);
  assert.deepEqual(await independentOracle(page, roundTrip, salesCatalogText,
    {entity: "30000000-0000-4000-8000-000000000001", field: "20000000-0000-4000-8000-000000000203", value: 250}, true), definitions);
  await page.getByRole("tab", {name: "Table", exact: true}).click();
  await page.getByRole("navigation", {name: "Workbook actions", exact: true}).getByLabel("Table", {exact: true}).selectOption("catalog");
  await ready(page); await edit(page, priceId, 300); await save(page, "Portable report second");
  const secondReport = await raw(page, "Portable report second");
  assert.deepEqual(secondReport.presentation.report, reportCopy.presentation.report);
  assert.equal(secondReport.presentation.snapshotDigest, sha256(Buffer.from(secondReport.bytes)));
  assert.notEqual(secondReport.presentation.snapshotDigest, reportCopy.presentation.snapshotDigest);
  await terminate(); page = await start(); await openSaved(page, "Portable report second");
  const secondReportFile = await download(page, "sales-report-second-reopened", true);
  assert.deepEqual(await independentOracle(page, secondReportFile, salesCatalogText,
    {entity: "30000000-0000-4000-8000-000000000001", field: "20000000-0000-4000-8000-000000000203", value: 300}, true), definitions);
  await page.getByRole("tab", {name: "Report", exact: true}).click();
  assert.equal(await page.getByLabel("Title", {exact: true}).inputValue(), "Locally authored 雪");
  assert.match(await page.getByLabel("Current report data", {exact: true}).textContent(), /PEN\s*1200/);
  results.push("local-report-settings-digest-revision-bound-summary-definition-result-oracle-double-Save-process-reopen");

  const attachmentFaults = ["digest", "revision", "invalid-import", "foreign-import", "invalid-presentation"];
  for (const fault of attachmentFaults) await mutateStored(page, "Portable report", `Report ${fault} mismatch`, fault);
  // Core-only file admission is clean but has no durable Save receipt. Every
  // refusal must preserve that occurrence and must not promote it to Saved.
  await page.evaluate(async bytes => {
    await window.__tachikoAcceptance.attemptResidentWorkFileOpen(new File([new Uint8Array(bytes)], "resident.ro"));
  }, [...secondReportFile.bytes]);
  await ready(page);
  const resident = await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot());
  const residentSaveStatus = await page.getByTestId("save-status").textContent();
  assert.doesNotMatch(residentSaveStatus, /Saved on this device/);
  for (const fault of attachmentFaults) {
    const name = `Report ${fault} mismatch`;
    const before = await raw(page, name);
    await page.evaluate(name => window.__tachikoAcceptance.attemptResidentSavedCopyOpen(name), name);
    const refusal = fault.includes("import") ? /unsupported import information/
      : fault === "invalid-presentation" ? /presentation attachment is invalid/ : /saved report settings do not match/;
    await page.getByRole("alert").filter({hasText: refusal}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot()), resident);
    assert.equal(await page.getByTestId("save-status").textContent(), residentSaveStatus);
    assert.deepEqual(await raw(page, name), before);
    await page.getByRole("tab", {name: "Import & export", exact: true}).click();
    assert.equal(await page.getByTestId("project-ready").count(), 1, "refusal cannot install corrupt import UI state");
  }
  results.push("malformed-and-foreign-import-and-invalid-or-misbound-presentation-refuse-resident-unchanged-never-Saved");
  await coldHome(page);
  for (const fault of attachmentFaults) {
    await page.getByRole("button", {name: `Open saved Report ${fault} mismatch`, exact: true}).click();
    await page.getByRole("alert").filter({hasText: /could not be opened/}).waitFor();
    assert.equal(await page.getByTestId("project-ready").count(), 0);
  }
  await openSaved(page, "Existing opaque");
  assert.deepEqual(await raw(page, "Existing opaque"), oldOpaque);
  assert.deepEqual(await raw(page, "Portable report"), reportCopy);
  results.push("attachment-digest-and-revision-mismatch-refuse-before-replacement-old-opaque-v2-byte-unchanged");
  await terminate();
  assert.ok(processes.length >= 5 && processes.every(record => record.exit?.observed));
  console.log(JSON.stringify({status: "PASS", lane: "work-file-save-local", outcomes: results, processes}));
} catch (error) {
  const infrastructure = /BLOCKED:|browserType\.launch|Target page, context or browser has been closed|mach port|bootstrap_check_in|connectOverCDP/i.test(String(error?.stack ?? error));
  console.error(infrastructure ? "BLOCKED: browser infrastructure" : "FAIL: work-file-save-local", error);
  process.exitCode = infrastructure ? 78 : 1;
} finally {
  await terminate().catch(error => { console.error("BLOCKED: browser process cleanup", error); process.exitCode = 78; });
  const receipt = {outcomes: results, processes, exitCode: process.exitCode ?? 0};
  if (process.env.WORK_FILE_SAVE_EVIDENCE) await writeFile(process.env.WORK_FILE_SAVE_EVIDENCE, JSON.stringify(receipt, null, 2));
  await rm(work, {recursive: true, force: true});
}

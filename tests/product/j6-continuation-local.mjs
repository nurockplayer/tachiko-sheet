// J6 continuation regression on the hook-free production dist over real HTTP.
// One journey: Home Sales open, edit, summary/report values, Undo, Redo,
// Save a copy, owned Chromium process exit + relaunch on the same disk profile,
// saved-copy reopen, then a second edit/Save/restart/reopen. Uses ordinary UI
// only: no acceptance API, no storage seeding, no route interception.
// Run through `pnpm acceptance:j6-continuation` so the production build exists.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = path.resolve(process.env.J6_DIST ?? path.join(root, "dist"));
const timeout = Number(process.env.J6_TIMEOUT_MS ?? 20000);
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath();
const copyName = `j6-continuation-${Date.now()}-${process.pid}`;
const evidencePath = path.resolve(process.env.J6_EVIDENCE ?? path.join(os.tmpdir(), `${copyName}.json`));
const browserProfile = await mkdtemp(path.join(os.tmpdir(), "tachiko-j6-continuation-profile-"));
const caseId = "j6-continuation-production-dist-undo-redo-process-restart";
const stages = [];
const processEvidence = [];
const diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [] };
let candidateHead = null;
try { candidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
let phase = "preflight";
let pidSerial = 0;
let browser;
let context;
let page;
let child;
let childExit;
let server;
let serverExit;
let serverLog = "";
let origin;

function stage(name, facts = {}) {
  stages.push({ stage: name, pid: processEvidence.at(-1)?.pid ?? null, at: new Date().toISOString(), ...facts });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function startStaticServer() {
  const port = process.env.J6_PORT ? Number(process.env.J6_PORT) : await freePort();
  assert.ok(Number.isInteger(port) && port > 1023, "static server port is usable");
  server = spawn(process.execPath, [path.join(root, "scripts/serve-dist.mjs"), dist], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverLog = "";
  const ready = new Promise((resolve, reject) => {
    server.stdout.setEncoding("utf8");
    server.stderr.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      serverLog = (serverLog + chunk).slice(-4000);
      if (serverLog.includes(`http://127.0.0.1:${port}`)) resolve();
    });
    server.stderr.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-4000); });
    server.once("exit", (code) => reject(new Error(`BLOCKED: static server exited (${code}): ${serverLog}`)));
  });
  try {
    await Promise.race([ready, delay(timeout).then(() => { throw new Error(`BLOCKED: static server did not become ready: ${serverLog}`); })]);
  } catch (error) {
    error.code = error.code ?? "BLOCKED";
    throw error;
  }
  serverExit = new Promise((resolve) => server.once("exit", (code, signal) => resolve({ code, signal })));
  return `http://127.0.0.1:${port}`;
}

async function stopStaticServer() {
  if (!server) return;
  const current = server;
  server = undefined;
  if (current.exitCode === null && current.signalCode === null) current.kill("SIGTERM");
  await Promise.race([serverExit, delay(5000)]);
  if (current.exitCode === null && current.signalCode === null) current.kill("SIGKILL");
}

async function startOwnedPersistentChromium() {
  const remoteProfile = path.join(browserProfile, "profile");
  const portFile = path.join(remoteProfile, "DevToolsActivePort");
  await rm(portFile, { force: true });
  child = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    // Playwright's own launcher passes these; without them macOS keychain
    // access stalls the owned full Chrome so ordinary HTTP navigation never commits.
    "--use-mock-keychain", "--password-store=basic",
    "--window-size=1280,900", `--user-data-dir=${remoteProfile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const pid = child.pid;
  if (!pid) throw new Error("BLOCKED: Chromium child process did not expose its PID");
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`BLOCKED: owned Chromium exited before CDP startup; ${stderr}`);
    try {
      port = Number((await readFile(portFile, "utf8")).split("\n")[0]);
      if (Number.isInteger(port) && port > 0) break;
    } catch {}
    await delay(100);
  }
  if (!port) throw new Error(`BLOCKED: Chromium DevTools endpoint did not become ready; ${stderr}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
  context = browser.contexts()[0];
  if (!context) throw new Error("BLOCKED: Chromium process has no persistent default context");
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on("pageerror", (error) => diagnostics.pageErrors.push({ launch: pidSerial, message: String(error) }));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push({ launch: pidSerial, message: message.text(), url: message.location().url });
  });
  page.on("requestfailed", (request) => diagnostics.requestFailures.push({ launch: pidSerial, url: request.url(), error: request.failure()?.errorText }));
  processEvidence.push({ launch: ++pidSerial, pid, remoteDebuggingPort: port, profile: remoteProfile, endpointReady: true, browserVersion: browser.version() });
  return page;
}

async function stopOwnedChromium() {
  if (browser) { await browser.close().catch(() => {}); browser = undefined; }
  if (!child) return null;
  const old = child;
  const oldPid = old.pid;
  if (old.exitCode === null && old.signalCode === null) old.kill("SIGTERM");
  const exit = await Promise.race([childExit, delay(timeout).then(() => null)]);
  if (!exit) { old.kill("SIGKILL"); throw new Error(`BLOCKED: owned Chromium PID ${oldPid} did not terminate within ${timeout}ms`); }
  processEvidence.at(-1).exit = { pid: oldPid, code: exit.code, signal: exit.signal, observed: true };
  child = undefined;
  context = undefined;
  page = undefined;
  return { pid: oldPid, ...exit };
}

async function waitForColdHome(target) {
  await target.goto(origin, { waitUntil: "domcontentloaded" });
  await target.locator('.ts-app[data-view="home"]').waitFor();
  await target.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  assert.equal(await target.evaluate(() => "__tachikoAcceptance" in window), false, "production window must have no acceptance hooks");
}

async function openSalesExample(target) {
  await target.getByRole("button", { name: "Open sales example", exact: true }).click();
  await target.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await target.locator(".ts-title").innerText(), "Sales and catalog");
}

async function openSavedCopy(target, name) {
  await target.getByRole("button", { name: `Open saved ${name}`, exact: true }).click();
  await target.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
}

async function waitForCurrent(target) {
  await target.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false"
    && document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
}

async function readCatalog(target) {
  await target.getByRole("tab", { name: "Table", exact: true }).click();
  const selector = target.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await selector.selectOption("catalog");
  await target.waitForFunction(() => document.querySelector("#ts-active-table")?.value === "catalog");
  const table = target.locator('table[aria-label="Table"]');
  await table.waitFor();
  const rows = await table.locator("tbody tr").evaluateAll((elements) => elements.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())));
  const witness = await target.locator('table[aria-label="Table"] tbody tr td[data-work-occurrence]').first().evaluate((element) => ({
    occurrence: element.getAttribute("data-work-occurrence"),
    revision: element.getAttribute("data-work-revision"),
  }));
  return { rows, witness };
}

async function readSummary(target) {
  await target.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const table = target.getByRole("table", { name: "Cross-table groups", exact: true });
  await table.waitFor();
  return table.locator("tbody tr").evaluateAll((elements) => elements.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())));
}

async function readReport(target) {
  await target.getByRole("tab", { name: "Report", exact: true }).click();
  const data = target.getByLabel("Current report data", { exact: true });
  await data.waitFor();
  await target.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  // The report document only counts as observed once its chart is ready and
  // its complete dt/dd group list is present.
  await target.locator('canvas[data-report-ready="true"]').waitFor();
  const pairs = await data.evaluate((node) => [...node.querySelectorAll("dt")].map((dt) => [
    dt.textContent?.trim() ?? "",
    dt.parentElement?.querySelector("dd")?.textContent?.trim() ?? "",
  ]));
  return {
    title: await target.getByLabel("Title", { exact: true }).inputValue(),
    legendVisible: await target.getByLabel("Show legend", { exact: true }).isChecked(),
    groups: pairs.filter(([label]) => label !== "Results"),
    currentness: pairs.find(([label]) => label === "Results")?.[1] ?? null,
    data: ((await data.textContent()) ?? "").replace(/\s+/g, " ").trim(),
  };
}

async function waitForCatalogValue(target, rowName, value) {
  await target.waitForFunction(({ rowName, value }) => {
    const rows = [...document.querySelectorAll('table[aria-label="Table"] tbody tr')];
    const row = rows.find((candidate) => candidate.querySelector("td")?.textContent?.trim() === rowName);
    return [...(row?.querySelectorAll("td") ?? [])].some((cell) => cell.textContent?.trim() === value);
  }, { rowName, value: String(value) });
}

async function editCatalogPrice(target, rowName, value) {
  await target.getByRole("tab", { name: "Table", exact: true }).click();
  const selector = target.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await selector.selectOption("catalog");
  await target.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await target.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog has a visible price column");
  const row = target.locator('table[aria-label="Table"] tbody tr').filter({ hasText: rowName }).first();
  assert.ok(await row.count(), `Catalog has a ${rowName} row`);
  await row.locator("td").nth(priceIndex).dblclick();
  const editor = target.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill(String(value));
  await editor.press("Enter");
  await waitForCatalogValue(target, rowName, value);
  await waitForCurrent(target);
}

function historyButton(target, name) {
  return target.getByRole("group", { name: "Document commands", exact: true }).getByRole("button", { name, exact: true });
}

async function historyState(target) {
  return { undoDisabled: await historyButton(target, "Undo").isDisabled(), redoDisabled: await historyButton(target, "Redo").isDisabled() };
}

async function clickHistory(target, name, rowName, value) {
  await target.getByRole("tab", { name: "Table", exact: true }).click();
  await historyButton(target, name).click();
  await waitForCatalogValue(target, rowName, value);
  await waitForCurrent(target);
}

async function saveCopy(target) {
  await target.getByRole("button", { name: "Save a copy", exact: true }).click();
  await target.getByRole("textbox", { name: "Copy name", exact: true }).fill(copyName);
  await target.getByRole("button", { name: "Create copy", exact: true }).click();
  await target.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.doesNotMatch(await target.getByTestId("save-status").innerText(), /pending|failed/i);
}

async function saveInPlace(target) {
  await target.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.textContent?.trim() === "Not saved yet");
  await target.getByRole("button", { name: "Save", exact: true }).click();
  await target.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.textContent?.trim() === "Saved on this device"
    && document.querySelector(".ts-app-root")?.getAttribute("data-work-dirty") === "false");
  assert.equal(await target.getByTestId("save-status").innerText(), "Saved on this device");
}

async function snapshot(target, name, expected) {
  const catalog = await readCatalog(target);
  assert.deepEqual(catalog.rows, expected.catalogRows, `${name}: visible Catalog rows`);
  const results = await readSummary(target);
  assert.deepEqual(results, expected.results, `${name}: visible current summary rows`);
  const report = await readReport(target);
  assert.equal(report.title, expected.reportTitle, `${name}: report configuration title`);
  assert.equal(report.legendVisible, false, `${name}: Sales report keeps its legend configuration`);
  assert.deepEqual(report.groups, expected.results, `${name}: complete report group/value pairs`);
  assert.equal(report.currentness, "up to date", `${name}: report marks its values current`);
  stage(name, { witness: catalog.witness, catalogRows: catalog.rows, results, report });
  return { catalog, results, report };
}

const receipt = {
  status: "RUNNING",
  caseId,
  head: candidateHead,
  boundary: "hook-free production dist over real static HTTP, ordinary UI only, owned persistent Chromium process exit/relaunch on the same disk profile",
  environment: { node: process.version, platform: process.platform, arch: process.arch, executable, dist, copyName, profile: path.join(browserProfile, "profile"), evidencePath },
  assumptions: {
    undoHistoryAcrossReopen: "Undo/Redo unavailability after reopen is the designed per-occurrence history lifetime, not a defect.",
    salesIsJ4: "The Sales example is the J4 catalog fixture, not the J6 fixed 12000 -> 12500 input.",
  },
  stages,
  processEvidence,
  diagnostics,
};

try {
  phase = "preflight";
  const productionIndex = await readFile(path.join(dist, "index.html"));
  assert.ok(productionIndex.length, "production dist index exists");
  const builtPkg = JSON.parse(await readFile(path.join(root, "node_modules/@playwright/test/package.json"), "utf8"));
  assert.equal(builtPkg.version, "1.62.1", "locked Playwright version");
  receipt.environment.playwrightVersion = builtPkg.version;

  phase = "server";
  origin = await startStaticServer();

  phase = "home-and-sales-open";
  const firstPage = await startOwnedPersistentChromium();
  await waitForColdHome(firstPage);
  stage("home", { acceptanceHooks: false });
  await openSalesExample(firstPage);
  const undo = historyButton(firstPage, "Undo");
  const redo = historyButton(firstPage, "Redo");
  await undo.waitFor();
  assert.equal(await undo.isVisible(), true, "desktop Undo control is visible in the production build");
  assert.equal(await redo.isVisible(), true, "desktop Redo control is visible in the production build");
  const freshHistory = await historyState(firstPage);
  assert.deepEqual(freshHistory, { undoDisabled: true, redoDisabled: true }, "a fresh occurrence begins without exposed history");
  const openedCatalog = await readCatalog(firstPage);
  assert.deepEqual(openedCatalog.rows, [["PEN", "PEN", "200"], ["NOTE", "NOTE", "500"]], "complete literal Catalog input rows");
  const initialResults = await readSummary(firstPage);
  assert.deepEqual(initialResults, [["NOTE", "1000"], ["PEN", "800"]], "initial summary totals");
  const initialReport = await readReport(firstPage);
  assert.equal(initialReport.title, "Sales by product", "Sales example installs its bar report");
  assert.equal(initialReport.legendVisible, false, "Sales example report configuration is the installed default");
  assert.deepEqual(initialReport.groups, initialResults, "initial report group/value pairs follow the summary");
  assert.equal(initialReport.currentness, "up to date", "initial report marks its values current");
  stage("sales-open", { witness: openedCatalog.witness, catalogRows: openedCatalog.rows, results: initialResults, report: initialReport, history: freshHistory });

  phase = "edit-and-read-values";
  await editCatalogPrice(firstPage, "PEN", "250");
  const edited = await snapshot(firstPage, "edited-pen-250", {
    catalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]],
    results: [["NOTE", "1000"], ["PEN", "1000"]],
    reportTitle: "Sales by product",
  });
  assert.equal(edited.catalog.witness.occurrence, openedCatalog.witness.occurrence, "editing keeps the same occurrence");
  assert.notEqual(edited.catalog.witness.revision, openedCatalog.witness.revision, "editing publishes a new revision");

  phase = "undo";
  await clickHistory(firstPage, "Undo", "PEN", "200");
  const undone = await snapshot(firstPage, "undo", {
    catalogRows: [["PEN", "PEN", "200"], ["NOTE", "NOTE", "500"]],
    results: [["NOTE", "1000"], ["PEN", "800"]],
    reportTitle: "Sales by product",
  });
  const undoneHistory = await historyState(firstPage);
  assert.deepEqual(undoneHistory, { undoDisabled: true, redoDisabled: false }, "one Undo exhausts the single entry and enables Redo");
  assert.equal(undone.catalog.witness.occurrence, openedCatalog.witness.occurrence, "Undo stays on the same occurrence");

  phase = "redo";
  await clickHistory(firstPage, "Redo", "PEN", "250");
  const redone = await snapshot(firstPage, "redo", {
    catalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]],
    results: [["NOTE", "1000"], ["PEN", "1000"]],
    reportTitle: "Sales by product",
  });
  const redoneHistory = await historyState(firstPage);
  assert.deepEqual(redoneHistory, { undoDisabled: false, redoDisabled: true }, "Redo restores the edited value and its Undo entry");
  stages.at(-1).history = redoneHistory;

  phase = "save-copy";
  await saveCopy(firstPage);
  stage("saved-copy", { saveStatus: await firstPage.getByTestId("save-status").innerText(), witness: redone.catalog.witness });
  const firstPid = processEvidence.at(-1).pid;

  phase = "owned-process-restart";
  const firstExit = await stopOwnedChromium();
  assert.equal(firstExit.pid, firstPid);
  assert.ok(processEvidence.at(-1).exit?.observed, "first full Chromium process exit is observed before relaunch");

  phase = "saved-copy-reopen";
  const secondPage = await startOwnedPersistentChromium();
  assert.notEqual(processEvidence.at(-1).pid, firstPid, "full relaunch uses a distinct Chromium process");
  stage("restart-1", { previousPid: firstPid, previousExit: firstExit, pid: processEvidence.at(-1).pid });
  await waitForColdHome(secondPage);
  await openSavedCopy(secondPage, copyName);
  assert.equal(await secondPage.locator(".ts-title").innerText(), "Sales and catalog");
  assert.equal(await secondPage.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.match(await secondPage.getByTestId("save-status").innerText(), /Saved on this device/);
  const reopenedHistory = await historyState(secondPage);
  assert.deepEqual(reopenedHistory, { undoDisabled: true, redoDisabled: true }, "history does not cross a process reopen (designed)");
  const reopened = await snapshot(secondPage, "reopened", {
    catalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]],
    results: [["NOTE", "1000"], ["PEN", "1000"]],
    reportTitle: "Sales by product",
  });
  assert.notEqual(reopened.catalog.witness.occurrence, openedCatalog.witness.occurrence, "Home reopen installs a fresh occurrence after process death");
  stages.at(-1).history = reopenedHistory;

  phase = "second-edit-and-save";
  await editCatalogPrice(secondPage, "NOTE", "600");
  const secondEdited = await snapshot(secondPage, "edited-note-600", {
    catalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "600"]],
    results: [["NOTE", "1200"], ["PEN", "1000"]],
    reportTitle: "Sales by product",
  });
  assert.notEqual(secondEdited.catalog.witness.revision, reopened.catalog.witness.revision, "second edit publishes a new revision");
  await saveInPlace(secondPage);
  stage("saved-update", { saveStatus: await secondPage.getByTestId("save-status").innerText(), witness: secondEdited.catalog.witness });
  const secondPid = processEvidence.at(-1).pid;

  phase = "owned-process-restart";
  const secondExit = await stopOwnedChromium();
  assert.equal(secondExit.pid, secondPid);
  assert.ok(processEvidence.at(-1).exit?.observed, "second full Chromium process exit is observed before relaunch");

  phase = "second-reopen";
  const thirdPage = await startOwnedPersistentChromium();
  assert.notEqual(processEvidence.at(-1).pid, secondPid, "second relaunch uses a distinct Chromium process");
  stage("restart-2", { previousPid: secondPid, previousExit: secondExit, pid: processEvidence.at(-1).pid });
  await waitForColdHome(thirdPage);
  await openSavedCopy(thirdPage, copyName);
  assert.equal(await thirdPage.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.match(await thirdPage.getByTestId("save-status").innerText(), /Saved on this device/);
  const finalHistory = await historyState(thirdPage);
  assert.deepEqual(finalHistory, { undoDisabled: true, redoDisabled: true }, "history stays unavailable on the second reopen");
  const final = await snapshot(thirdPage, "reopened-second", {
    catalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "600"]],
    results: [["NOTE", "1200"], ["PEN", "1000"]],
    reportTitle: "Sales by product",
  });
  assert.notEqual(final.catalog.witness.occurrence, reopened.catalog.witness.occurrence, "second reopen installs another fresh occurrence");
  stages.at(-1).history = finalHistory;

  phase = "complete";
  const thirdExit = await stopOwnedChromium();
  assert.ok(processEvidence.at(-1).exit?.observed, "final owned Chromium process exit is observed");
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(diagnostics.requestFailures, []);
  receipt.status = "PASS";
  receipt.exits = { firstExit, secondExit, thirdExit };
  stage("complete", { catalogRows: final.catalog.rows, results: final.results, report: final.report });
  console.log(JSON.stringify({
    status: receipt.status,
    caseId,
    evidencePath,
    processEvidence: processEvidence.map(({ launch, pid, exit }) => ({ launch, pid, exit })),
  }, null, 2));
} catch (error) {
  const setupPhases = new Set(["preflight", "server", "home-and-sales-open", "owned-process-restart"]);
  receipt.status = error.code === "BLOCKED" || error.name === "TimeoutError" || setupPhases.has(phase)
    ? "BLOCKED"
    : error.code === "ERR_ASSERTION" ? "BEHAVIORAL_RED" : "BLOCKED";
  receipt.phase = phase;
  receipt.error = { name: error.name, message: error.message, stack: error.stack };
  throw error;
} finally {
  if (browser || child) { try { await stopOwnedChromium(); } catch {} }
  await stopStaticServer();
  receipt.serverLog = serverLog;
  receipt.completedAt = new Date().toISOString();
  await writeFile(evidencePath, `${JSON.stringify(receipt, null, 2)}\n`);
  await rm(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

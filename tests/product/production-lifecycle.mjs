// #146 acceptance-only seed: hook-free production dist over real HTTP.
// Direct invocation (server must already be running from the two immutable build directories):
//   SAVE_CLOSURE_DIST=/absolute/checkout/dist SAVE_CLOSURE_ACCEPTANCE_DIST=/absolute/checkout/dist-acceptance SAVE_CLOSURE_ORIGIN=http://127.0.0.1:4197 SAVE_CLOSURE_RECEIPT=/tmp/146-production.json SAVE_CLOSURE_ARTIFACT_DIR=/tmp/146-artifacts node tests/product/production-lifecycle.mjs
// Start exact static production serving separately: PORT=4197 node scripts/serve-dist.mjs dist
// Uses ordinary Home Sales open, UI edits/Save/reopen, an owned persistent Chromium child process and its same disk profile.
// It never imports acceptance APIs, seeds storage, fulfills routes, or substitutes disk interception.
// PNG oracle is an attributed test-local copy of J5's fixed barArtifact/pngFacts/decoded-pixel assertions.
// Current-source qualification order: production build + check-dist; run this file and require PASS + blank-PNG rejection.
// M6 disposable mutant experiment: alter only production main.tsx's production kit loader to reject; prove the old
// acceptance-build journey remains green, run this production seed and require a boot/Open assertion after HTTP/browser
// setup qualifies, record mutant diff/hash, then restore source and rebuild/rerun. Never call setup failures RED.
// M7 control is executed below: a valid blank PNG must be rejected by the same oracle that accepts the downloaded PNG.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = path.resolve(process.env.SAVE_CLOSURE_DIST ?? path.join(root, "dist"));
const acceptanceDist = path.resolve(process.env.SAVE_CLOSURE_ACCEPTANCE_DIST ?? path.join(root, "dist-acceptance"));
const origin = process.env.SAVE_CLOSURE_ORIGIN;
const receiptPath = process.env.SAVE_CLOSURE_RECEIPT;
const artifactDir = path.resolve(process.env.SAVE_CLOSURE_ARTIFACT_DIR ?? path.join(os.tmpdir(), "tachiko-146-production-artifacts"));
assert.ok(origin, "BLOCKED: set SAVE_CLOSURE_ORIGIN to the existing static HTTP server");
assert.ok(receiptPath, "BLOCKED: set SAVE_CLOSURE_RECEIPT to an owned receipt path");
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath();
const timeout = Number(process.env.SAVE_CLOSURE_TIMEOUT_MS ?? 20000);
const expectedCase = "production-sales-edit-save-process-restart-reopen-edit-png";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function inventory(directory) {
  const files = [];
  async function walk(relative = "") {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`unsupported artifact entry: ${child}`);
    }
  }
  await walk();
  const sorted = await Promise.all(files.sort().map(async (file) => [file, sha256(await readFile(path.join(directory, file)))]));
  return { files: sorted, digest: sha256(JSON.stringify(sorted)) };
}
const productionInventory = await inventory(dist);
const acceptanceInventory = await inventory(acceptanceDist);
const browserProfile = await mkdtemp(path.join(os.tmpdir(), "tachiko-146-production-profile-"));
await (await import("node:fs/promises")).mkdir(artifactDir, { recursive: true });
const processEvidence = [];
const networkEvidence = [];
const diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [] };
const prefix = `sheet146-production-${Date.now()}-${process.pid}`;
const copyName = `${prefix}-saved`;
let browser;
let context;
let page;
let child;
let childExit;
let pidSerial = 0;
let phase = "preflight";

async function startOwnedPersistentChromium() {
  const remoteProfile = path.join(browserProfile, "profile");
  const portFile = path.join(remoteProfile, "DevToolsActivePort");
  await rm(portFile, { force: true });
  const spawnOptions = { stdio: ["ignore", "ignore", "pipe"] };
  child = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${remoteProfile}`, "--remote-debugging-port=0", "about:blank",
  ], spawnOptions);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const pid = child.pid;
  if (!pid) throw new Error("BLOCKED: Chromium child process did not expose its PID");
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`BLOCKED: owned Chromium exited before CDP startup; ${stderr}`);
    try { port = Number((await readFile(portFile, "utf8")).split("\n")[0]); if (Number.isInteger(port) && port > 0) break; } catch {}
    await delay(100);
  }
  if (!port) throw new Error(`BLOCKED: Chromium DevTools endpoint did not become ready; ${stderr}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
  context = browser.contexts()[0];
  if (!context) throw new Error("BLOCKED: Chromium process has no persistent default context");
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || (url.pathname !== "/" && ![".html", ".js", ".wasm", ".css"].includes(path.extname(url.pathname)))) return;
    const task = (async () => {
      try { networkEvidence.push({ launch: pidSerial, pid, path: url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname), status: response.status(), sha256: sha256(await response.body()) }); }
      catch (error) { diagnostics.responseErrors.push({ url: response.url(), message: error.message }); }
    })();
    pendingResponses.add(task);
    task.finally(() => pendingResponses.delete(task));
  });
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on("pageerror", (error) => diagnostics.pageErrors.push({ launch: pidSerial, message: String(error) }));
  page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push({ launch: pidSerial, message: message.text(), url: message.location().url }); });
  page.on("requestfailed", (request) => diagnostics.requestFailures.push({ launch: pidSerial, url: request.url(), error: request.failure()?.errorText }));
  processEvidence.push({ launch: ++pidSerial, pid, remoteDebuggingPort: port, profile: remoteProfile, endpointReady: true, browserVersion: browser.version() });
  return page;
}
const pendingResponses = new Set();
async function settleResponses() { await Promise.all([...pendingResponses]); }
async function stopOwnedChromium() {
  if (browser) { await browser.close().catch(() => {}); browser = undefined; }
  if (!child) return null;
  const old = child;
  const oldPid = old.pid;
  if (old.exitCode === null && old.signalCode === null) old.kill("SIGTERM");
  const exit = await Promise.race([childExit, delay(timeout).then(() => null)]);
  if (!exit) { old.kill("SIGKILL"); throw new Error(`BLOCKED: owned Chromium PID ${oldPid} did not terminate within ${timeout}ms`); }
  processEvidence.at(-1).exit = { pid: oldPid, code: exit.code, signal: exit.signal, observed: true };
  child = undefined; context = undefined; page = undefined;
  return { pid: oldPid, ...exit };
}
async function waitForColdHome(target) {
  const response = await target.goto(origin, { waitUntil: "domcontentloaded" });
  await target.locator('.ts-app[data-view="home"]').waitFor();
  await target.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  assert.equal(await target.getByTestId("project-ready").count(), 0, "production cold Home has no workbook before user Open");
  assert.equal(await target.getByTestId("currentness").count(), 0, "production cold Home has no workbook currentness");
  assert.equal(await target.evaluate(() => "__tachikoAcceptance" in window), false, "production window must have no acceptance hooks");
  const openSales = target.getByRole("button", { name: "Open sales example", exact: true });
  await openSales.waitFor({ state: "visible" });
  assert.equal(await openSales.isEnabled(), true, "normal Home Sales Open is enabled when the production runtime is ready");
  return response;
}
async function visibleTable(tableName) {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const selector = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await selector.selectOption(tableName);
  await page.waitForFunction((expected) => document.querySelector("#ts-active-table")?.value === expected, tableName);
  const table = page.locator('table[aria-label="Table"]');
  await table.waitFor();
  return table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())));
}
async function assertResultRows(expected) {
  const table = page.getByRole("table", { name: "Cross-table groups", exact: true });
  await table.waitFor();
  const actual = await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())));
  assert.deepEqual(actual, expected, "visible current result rows match the literal independent oracle");
}
async function editPenPrice(value) {
  const tableSelect = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  await tableSelect.selectOption("catalog");
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog has a visible price column");
  const row = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  assert.ok(await row.count(), "Catalog has its PEN row");
  await row.locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill(String(value));
  await editor.press("Enter");
  await page.waitForFunction((expected) => document.querySelector('table[aria-label="Table"] tbody tr')?.textContent?.includes(expected), String(value));
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  const rows = await visibleTable("catalog");
  assert.deepEqual(rows, [["PEN", "PEN", String(value)], ["NOTE", "NOTE", "500"]], "only the selected Catalog PEN price changes");
}
async function pngFacts(png, expected) {
  const encoded = png.toString("base64");
  return page.evaluate(async ({ encoded, expected }) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PNG pixel inspection requires a 2D context");
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colorCount = (hex, bounds) => {
      const color = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)); let count = 0;
      for (let y = bounds.top; y < Math.min(bounds.bottom, canvas.height); y++) for (let x = bounds.left; x < Math.min(bounds.right, canvas.width); x++) {
        const offset = (y * canvas.width + x) * 4;
        if (actual[offset] === color[0] && actual[offset + 1] === color[1] && actual[offset + 2] === color[2] && actual[offset + 3] === 255) count++;
      }
      return count;
    };
    const textMatches = expected.text.map((entry) => {
      const sample = new OffscreenCanvas(canvas.width, canvas.height);
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) throw new Error("PNG text inspection requires a 2D context");
      sampleContext.fillStyle = "#ffffff"; sampleContext.fillRect(0, 0, sample.width, sample.height);
      sampleContext.fillStyle = entry.color; sampleContext.font = entry.font; sampleContext.textAlign = entry.align; sampleContext.fillText(entry.value, entry.x, entry.y);
      const raster = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
      const color = [1, 3, 5].map((offset) => Number.parseInt(entry.color.slice(offset, offset + 2), 16));
      const pixels = [];
      for (let offset = 0; offset < raster.length; offset += 4) if (raster[offset] === color[0] && raster[offset + 1] === color[1] && raster[offset + 2] === color[2] && raster[offset + 3] === 255) pixels.push({ x: (offset / 4) % sample.width, y: Math.floor(offset / 4 / sample.width) });
      const shifts = entry.search ? Array.from({ length: entry.search.bottom - entry.search.top + 1 }, (_, y) => Array.from({ length: entry.search.right - entry.search.left + 1 }, (_, x) => ({ x: entry.search.left + x - entry.x, y: entry.search.top + y - entry.y }))).flat() : [{ x: 0, y: 0 }];
      let matchingPixels = 0; let completeMatches = 0;
      for (const shift of shifts) {
        let matching = 0;
        for (const pixel of pixels) { const x = pixel.x + shift.x; const y = pixel.y + shift.y; if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue; const offset = (y * canvas.width + x) * 4; if (actual[offset] === color[0] && actual[offset + 1] === color[1] && actual[offset + 2] === color[2] && actual[offset + 3] === 255) matching++; }
        matchingPixels = Math.max(matchingPixels, matching); if (matching === pixels.length) completeMatches++;
      }
      return { value: entry.value, expectedPixels: pixels.length, matchingPixels, completeMatches, minimumMatches: entry.minimumMatches ?? 1 };
    });
    return { width: canvas.width, height: canvas.height, seriesPixels: colorCount(expected.seriesColor, expected.seriesBounds), legendPixels: colorCount(expected.seriesColor, expected.legendBounds), seriesSlots: expected.seriesSlots.map((bounds) => colorCount(expected.seriesColor, bounds)), seriesAbsences: expected.seriesAbsences.map((bounds) => colorCount(expected.seriesColor, bounds)), textMatches };
  }, { encoded, expected });
}
async function assertReportPng(png, expected) {
  const facts = await pngFacts(png, expected);
  assert.ok(facts.width > 0 && facts.height > 0, "downloaded PNG decodes to a nonempty bitmap");
  assert.ok(facts.seriesPixels > 100, "downloaded report retains its expected series pixels");
  assert.ok(facts.legendPixels > 50, "downloaded report retains the configured legend swatch");
  for (const [index, pixels] of facts.seriesSlots.entries()) assert.ok(pixels > 20, `downloaded report retains expected bar geometry in slot ${index + 1}`);
  for (const [index, pixels] of facts.seriesAbsences.entries()) assert.equal(pixels, 0, `downloaded report has no unexpected series in slot ${index + 1}`);
  for (const text of facts.textMatches) { assert.ok(text.expectedPixels > 0, `fixed oracle rasterizes ${text.value}`); assert.equal(text.matchingPixels, text.expectedPixels, `downloaded PNG contains exact configured text pixels: ${text.value}`); assert.ok(text.completeMatches >= text.minimumMatches, `downloaded PNG retains all expected instances of ${text.value}`); }
  return facts;
}
const barArtifact = {
  seriesColor: "#2563eb", seriesBounds: { left: 80, top: 80, right: 250, bottom: 320 }, legendBounds: { left: 550, top: 16, right: 590, bottom: 42 },
  seriesSlots: [{ left: 95, top: 96, right: 153, bottom: 306 }, { left: 191, top: 96, right: 249, bottom: 306 }], seriesAbsences: [],
  text: [
    { value: "Initial sales report", color: "#1f2937", font: "600 20px system-ui, sans-serif", align: "start", x: 76, y: 38 },
    { value: "Initial value", color: "#475569", font: "14px system-ui, sans-serif", align: "start", x: 76, y: 62 },
    { value: "Product category", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 372, y: 358 },
    { value: "Bar series", color: "#334155", font: "14px system-ui, sans-serif", align: "start", x: 580, y: 33 },
    { value: "NOTE", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 326 },
    { value: "PEN", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 326 },
    { value: "1000", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 112, search: { left: 100, top: 96, right: 145, bottom: 145 } },
    { value: "800", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 130, search: { left: 196, top: 96, right: 244, bottom: 145 } },
  ],
};

try {
  const productionIndex = await readFile(path.join(dist, "index.html"));
  assert.ok(productionIndex.length, "production dist index exists");
  const builtPkg = JSON.parse(await readFile(path.join(root, "node_modules/@playwright/test/package.json"), "utf8"));
  assert.equal(builtPkg.version, "1.62.1", "locked Playwright version");
  const example = await import(path.join(root, "scripts/sales-catalog-source.mjs"));
  const j4 = await import(path.join(root, "tests/fixtures/j4-catalog-sales.mjs"));
  const inventoryHash = (source) => sha256(JSON.stringify(Object.entries(source).sort(([a], [b]) => a.localeCompare(b))));
  assert.equal(inventoryHash(j4.j4CanaryText), "d8ab17b0bc84f89fbc996beb730f0842ec2bf848d1ab4afd315cc34fa1195d2b", "canonical J4 source hash");
  assert.equal(inventoryHash(example.salesCatalogText), "306e33992edaa39023b5f780dcc47c3dc1d19dc69d8dae0c68b810095a4b670f", "product Sales source hash");
  assert.deepEqual(example.salesCatalogInventory, j4.j4CanaryInventory);
  for (const file of example.salesCatalogInventory) assert.deepEqual(await readFile(path.join(dist, "examples/sales-catalog", file)), Buffer.from(example.salesCatalogText[file]), `served production source file ${file} matches fixed source bytes`);

  phase = "cold-Home-and-production-runtime";
  const firstPage = await startOwnedPersistentChromium();
  const indexResponse = await waitForColdHome(firstPage);
  if (indexResponse?.status() !== 200) { const error = new Error("BLOCKED: production HTTP index response missing"); error.code = "BLOCKED"; throw error; }
  assert.equal(await firstPage.evaluate(() => "__tachikoAcceptance" in window), false);
  await firstPage.getByRole("button", { name: "Open sales example", exact: true }).click();
  await firstPage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await firstPage.evaluate(() => "__tachikoAcceptance" in window), false);
  assert.equal(await firstPage.locator(".ts-title").innerText(), "Sales and catalog");
  const salesRows = await visibleTable("sales");
  assert.deepEqual(salesRows, [["PEN", "3"], ["NOTE", "2"], ["PEN", "1"]], "complete literal Sales input rows");
  const catalogRows = await visibleTable("catalog");
  assert.deepEqual(catalogRows, [["PEN", "PEN", "200"], ["NOTE", "NOTE", "500"]], "complete literal Catalog input rows");
  await firstPage.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await assertResultRows([["NOTE", "1000"], ["PEN", "800"]]);
  assert.equal(await firstPage.getByTestId("currentness").getAttribute("data-currentness"), "current");
  await firstPage.getByRole("tab", { name: "Table", exact: true }).click();
  await editPenPrice("250");
  await firstPage.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await assertResultRows([["NOTE", "1000"], ["PEN", "1000"]]);
  await firstPage.getByRole("tab", { name: "Table", exact: true }).click();
  const firstWitness = await firstPage.locator('table[aria-label="Table"] tbody tr td[data-work-occurrence]').first().evaluate((element) => ({ occurrence: element.getAttribute("data-work-occurrence"), revision: element.getAttribute("data-work-revision") }));
  await firstPage.getByRole("tab", { name: "Report", exact: true }).click();
  const title = firstPage.getByLabel("Title", { exact: true });
  const valueLabel = firstPage.getByLabel("Value label", { exact: true });
  const categoryLabel = firstPage.getByLabel("Category label", { exact: true });
  await title.fill("Initial sales report");
  await valueLabel.fill("Initial value");
  await categoryLabel.fill("Product category");
  await firstPage.getByLabel("Show legend", { exact: true }).check();
  await firstPage.locator('canvas[data-report-ready="true"]').waitFor();
  assert.equal(await firstPage.getByLabel("Show legend", { exact: true }).isChecked(), true);
  const reportBeforeRestart = await firstPage.getByLabel("Current report data", { exact: true }).innerText();
  assert.match(reportBeforeRestart, /NOTE\s*1000/);
  assert.match(reportBeforeRestart, /PEN\s*1000/);
  await firstPage.getByRole("button", { name: "Save a copy", exact: true }).click();
  await firstPage.getByRole("textbox", { name: "Copy name", exact: true }).fill(copyName);
  await firstPage.getByRole("button", { name: "Create copy", exact: true }).click();
  await firstPage.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.doesNotMatch(await firstPage.getByTestId("save-status").innerText(), /pending|failed/i);
  await settleResponses();
  await firstPage.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await settleResponses();
  phase = "served-artifact-identity";
  const served = [...networkEvidence];
  for (const response of served) {
    const onDisk = path.resolve(dist, `.${response.path}`);
    assert.ok(onDisk.startsWith(dist + path.sep), `same-origin response path remains within dist: ${response.path}`);
    assert.equal(response.sha256, sha256(await readFile(onDisk)), `actual HTTP response bytes match built production artifact: ${response.path}`);
  }
  assert.ok(served.some((entry) => entry.path === "/index.html"), "network observed production index.html over HTTP");
  assert.ok(served.some((entry) => /^\/assets\/index-.*\.js$/.test(entry.path)), "network observed the production app JavaScript over HTTP");
  assert.ok(served.some((entry) => entry.path.endsWith("experimental-client.worker.js")), "network observed real core Worker bytes over HTTP");
  assert.ok(served.some((entry) => entry.path.endsWith("designer_runtime.wasm")), "network observed real core WASM bytes over HTTP");
  const firstPid = processEvidence.at(-1).pid;
  phase = "owned-process-restart";
  const firstExit = await stopOwnedChromium();
  assert.equal(firstExit.pid, firstPid);
  assert.ok(processEvidence.at(-1).exit?.observed, "first full Chromium process exit is observed before relaunch");

  phase = "saved-copy-process-reopen";
  const secondPage = await startOwnedPersistentChromium();
  assert.notEqual(processEvidence.at(-1).pid, firstPid, "full relaunch uses a distinct Chromium process");
  await waitForColdHome(secondPage);
  assert.equal(await secondPage.evaluate(() => "__tachikoAcceptance" in window), false);
  await secondPage.getByRole("button", { name: `Open saved ${copyName}`, exact: true }).click();
  await secondPage.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await secondPage.locator(".ts-title").innerText(), "Sales and catalog");
  assert.equal(await secondPage.evaluate(() => "__tachikoAcceptance" in window), false);
  assert.equal(await secondPage.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.match(await secondPage.getByTestId("save-status").innerText(), /Saved on this device/);
  assert.deepEqual(await visibleTable("sales"), salesRows, "all original Sales inputs survive process restart");
  const reopenedWitness = await secondPage.locator('table[aria-label="Table"] tbody tr td[data-work-occurrence]').first().evaluate((element) => ({ occurrence: element.getAttribute("data-work-occurrence"), revision: element.getAttribute("data-work-revision") }));
  assert.notEqual(reopenedWitness.occurrence, firstWitness.occurrence, "saved-copy Home reopen installs a fresh occurrence after process death");
  assert.deepEqual(await visibleTable("catalog"), [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]], "edited PEN250 and unaffected Catalog row survive process restart");
  await secondPage.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await assertResultRows([["NOTE", "1000"], ["PEN", "1000"]]);
  await secondPage.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await secondPage.getByLabel("Title", { exact: true }).inputValue(), "Initial sales report");
  assert.equal(await secondPage.getByLabel("Value label", { exact: true }).inputValue(), "Initial value");
  assert.equal(await secondPage.getByLabel("Category label", { exact: true }).inputValue(), "Product category");
  assert.equal(await secondPage.getByLabel("Show legend", { exact: true }).isChecked(), true);
  const reopenedReportData = await secondPage.getByLabel("Current report data", { exact: true }).innerText();
  assert.match(reopenedReportData, /NOTE\s*1000/);
  assert.match(reopenedReportData, /PEN\s*1000/);
  await secondPage.getByRole("tab", { name: "Table", exact: true }).click();
  await editPenPrice("200");
  await secondPage.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await assertResultRows([["NOTE", "1000"], ["PEN", "800"]]);
  await secondPage.getByRole("tab", { name: "Report", exact: true }).click();
  const finalReportData = await secondPage.getByLabel("Current report data", { exact: true }).innerText();
  assert.match(finalReportData, /NOTE\s*1000/);
  assert.match(finalReportData, /PEN\s*800/);
  const downloadPromise = secondPage.waitForEvent("download");
  await secondPage.getByRole("button", { name: "Export current PNG", exact: true }).click();
  const download = await downloadPromise;
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "browser-delivered artifact has PNG signature");
  const pngFactsResult = await assertReportPng(png, barArtifact);
  const pngPath = path.join(artifactDir, `${copyName}.png`);
  await writeFile(pngPath, png);
  const blankPng = await secondPage.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 400;
    const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, 640, 400);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await assert.rejects(() => assertReportPng(Buffer.from(blankPng, "base64"), barArtifact), /series pixels/, "M7 valid blank PNG control must fail the fixed artifact oracle");
  await settleResponses();
  const secondExit = await stopOwnedChromium();
  assert.ok(processEvidence.at(-1).exit?.observed, "second full Chromium process exit is observed during owned cleanup");
  const receipt = {
    status: "PASS", caseIds: [expectedCase], expectedCaseIds: [expectedCase], base: "375d25ea12262bec32e2303b3c63662f0b69322f", candidateDirty: true,
    boundary: "uninstrumented production dist over real static HTTP, full Chromium process exit/relaunch, same origin/disk profile, normal UI saved-copy reopen, real PNG download and fixed decoded-pixel oracle",
    environment: { node: process.version, platform: process.platform, arch: process.arch, playwrightVersion: builtPkg.version, origin, executable, browserVersion: processEvidence[0].browserVersion, profile: path.join(browserProfile, "profile"), copyName },
    artifacts: { production: productionInventory, acceptance: acceptanceInventory, productionManifestSha256: productionInventory.digest, acceptanceManifestSha256: acceptanceInventory.digest, servedResponses: served, png: { path: pngPath, sha256: sha256(png), bytes: png.byteLength, facts: pngFactsResult }, blankPngControl: "REJECTED_AS_EXPECTED" },
    processEvidence, firstExit, secondExit,
    assertions: { salesRows, catalogRows, edited250Results: [["NOTE", "1000"], ["PEN", "1000"]], reopenedSalesRows: salesRows, reopenedCatalogRows: [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]], reopenedResults: [["NOTE", "1000"], ["PEN", "1000"]], postReopenPrice200Results: [["NOTE", "1000"], ["PEN", "800"]], firstWitness, reopenedWitness, reportConfiguration: { title: "Initial sales report", valueLabel: "Initial value", categoryLabel: "Product category", type: "bar", legendVisible: true } },
    diagnostics,
  };
  assert.deepEqual(processEvidence.map((entry) => entry.launch), [1, 2]);
  assert.ok(processEvidence.every((entry) => entry.exit?.observed), "both owned Chromium processes exited cleanly before receipt completion");
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(diagnostics.requestFailures, []);
  assert.deepEqual(diagnostics.responseErrors, []);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, caseIds: receipt.caseIds, productionManifestSha256: receipt.artifacts.productionManifestSha256, acceptanceManifestSha256: receipt.artifacts.acceptanceManifestSha256, pngSha256: receipt.artifacts.png.sha256, processEvidence: receipt.processEvidence.map(({ launch, pid, exit }) => ({ launch, pid, exit })), receipt: receiptPath }, null, 2));
} catch (error) {
  const status = error.code === "BLOCKED" || error.name === "TimeoutError" || phase === "preflight" || phase === "served-artifact-identity" || phase === "owned-process-restart" ? "BLOCKED" : error.code === "ERR_ASSERTION" ? "BEHAVIORAL_RED" : "BLOCKED";
  const receipt = { status, caseIds: [], expectedCaseIds: [expectedCase], phase, base: "375d25ea12262bec32e2303b3c63662f0b69322f", boundary: "production lifecycle seed; setup/HTTP/browser errors are never mutant credit", origin, productionInventory, acceptanceInventory, processEvidence, networkEvidence, diagnostics, error: { name: error.name, message: error.message, stack: error.stack } };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  throw error;
} finally {
  if (browser || child) { try { await stopOwnedChromium(); } catch {} }
  await delay(250);
  await rm(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

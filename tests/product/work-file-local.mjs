// #131: real downloaded bytes, fresh profiles, independent Work-client/oracles,
// loss disclosure, strict refusals and truthful Save/Close behavior.
import assert from "node:assert/strict";
import { mkdtemp, open as openFileHandle, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";
import { archiveEntries, developmentalArchive } from "./work-file-archive.mjs";
import { independentOracle, releaseSourceFiles as sourceFiles } from "./work-file-oracle.mjs";
import { salesCatalogText } from "../../scripts/sales-catalog-source.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name an acceptance build."); process.exit(78); }
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const profileRoot = await mkdtemp(path.join(tmpdir(), "sheet-work-file-"));
const contexts = [];
const results = [];
let profileCounter = 0;
async function fresh() {
  if (contexts.length) await contexts.at(-1).close();
  const context = await chromium.launchPersistentContext(path.join(profileRoot, String(++profileCounter)), {
    headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  contexts.push(context);
  await installDistRoutes(context, dist);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  return page;
}
async function ready(page) { await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor(); }
async function edit(page, id, value) {
  await page.getByTestId(id).dblclick();
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).fill(String(value));
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).press("Enter");
  await ready(page);
  assert.equal((await page.getByTestId(id).textContent()).trim(), String(value));
}
async function prepare(page) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Import & export", exact: true });
  assert.deepEqual(await panel.getByRole("heading").allTextContents(), ["Import & export", "Changes and warnings", "Cleanup", "Download"]);
  assert.equal(await panel.getByTestId("open-work-file").count(), 0, "Open work file stays on Home");
  const downloads = panel.getByRole("region", { name: "Download spreadsheet", exact: true });
  assert.deepEqual(await downloads.locator(".ts-row-actions button").allTextContents(), ["Download work file (.ro)", "Prepare CSV", "Prepare XLSX"]);
  await downloads.getByRole("button", { name: "Download work file (.ro)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /Downloading does not save a copy/);
  return dialog;
}
async function download(page, file, omissionPattern) {
  const dialog = await prepare(page);
  if (omissionPattern) assert.match(await dialog.getByRole("list", { name: "Not included in this file" }).textContent(), omissionPattern);
  else assert.equal(await dialog.getByRole("list", { name: "Not included in this file" }).count(), 0, "absent attachments generate no losses");
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const downloaded = await pending;
  assert.match(downloaded.suggestedFilename(), /\.ro$/);
  assert.equal(await downloaded.failure(), null);
  await downloaded.saveAs(path.join(profileRoot, file));
  await dialog.waitFor({ state: "detached" });
  return { path: path.join(profileRoot, file), bytes: await readFile(path.join(profileRoot, file)) };
}
async function open(page, file) {
  await page.getByRole("region", { name: "Other ways to start", exact: true }).getByTestId("open-work-file").setInputFiles(file);
  await ready(page);
}
async function attemptResidentOpen(page, file) {
  // Keep a real browser File (including the sparse over-limit file), and call
  // the same Shell handler as Home without adding an Open control to the view.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.dataset.testid = "resident-work-file-probe";
    document.body.append(input);
  });
  try {
    await page.getByTestId("resident-work-file-probe").setInputFiles(file);
    await page.getByTestId("resident-work-file-probe").evaluate(async input => {
      if (!input.files?.[0]) throw new Error("The refusal probe needs a real File.");
      await window.__tachikoAcceptance.attemptResidentWorkFileOpen(input.files[0]);
    });
  } finally {
    await page.getByTestId("resident-work-file-probe").evaluate(input => input.remove());
  }
}
async function assertSaveAvailable(page) {
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isEnabled(), true);
  assert.doesNotMatch(await page.getByTestId("save-status").textContent(), /Saved on this device/);
}
try {
  let page = await fresh();
  await openReleasePlanExample(page);
  const impactId = `cell:${expected.entity}:${expected.impact}`;
  await edit(page, impactId, 4);
  const first = await download(page, "release-first.ro");
  await independentOracle(page, first, sourceFiles, { entity: expected.entity, field: expected.impact, value: 4 });
  assert.equal(await page.locator('[data-work-dirty="true"]').count(), 1);
  assert.doesNotMatch(await page.getByTestId("save-status").textContent(), /Saved on this device/);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  results.push("example-edit-download-independent-formula-inventory-oracle-no-Saved-no-Close-permission");

  page = await fresh();
  await open(page, first.path);
  const reopenedFirst = await download(page, "release-first-reopened.ro");
  assert.deepEqual(reopenedFirst.bytes, first.bytes, "fresh profile admits and exports exactly the reviewed core inventory");
  await independentOracle(page, reopenedFirst, sourceFiles, { entity: expected.entity, field: expected.impact, value: 4 });
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await assertSaveAvailable(page);
  await page.getByTestId(impactId).filter({ hasText: "4" }).waitFor();
  assert.equal((await page.getByTestId(`cell:${expected.entity}:${expected.priority}`).textContent()).trim(), "9");
  await edit(page, impactId, 2);
  const second = await download(page, "release-second.ro");
  await independentOracle(page, second, sourceFiles, { entity: expected.entity, field: expected.impact, value: 2 });
  await assertSaveAvailable(page);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  let close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  const closeSave = close.getByRole("button", { name: "Save a copy…", exact: true });
  assert.equal(await closeSave.isEnabled(), true);
  assert.equal(await closeSave.getAttribute("aria-describedby"), null);
  await close.getByRole("button", { name: "Download work file (.ro)", exact: true }).click();
  const closeDownload = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await closeDownload.getByRole("button", { name: "Cancel", exact: true }).click();
  await ready(page);
  assert.equal(await page.locator('[data-work-dirty="true"]').count(), 1);
  results.push("fresh-profile-open-edit-download-v3-Save-available-and-Close-download-cancel-preserves-work");

  page = await fresh();
  await open(page, second.path);
  await assertSaveAvailable(page);
  await page.getByTestId(impactId).filter({ hasText: "2" }).waitFor();
  const third = await download(page, "release-third.ro");
  assert.deepEqual(third.bytes, second.bytes, "fresh Open then Download preserves exact core package bytes");
  results.push("second-fresh-profile-reopen-byte-identical-download");

  // Refusals start with clean admitted work: the file reader, rather than the
  // dirty-work replacement guard, must refuse and preserve the occurrence.
  const before = await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot());
  // Observe the actual browser File read, including positive controls below.
  // This instrumentation belongs only to this acceptance page.
  await page.evaluate(() => {
    window.workFileReads = [];
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (...args) {
      if (this instanceof File) window.workFileReads.push(this.name);
      return read.apply(this, args);
    };
  });
  const constrained = Buffer.from((await readFile(new URL("../fixtures/work-file/constrained-v3.hex", import.meta.url), "utf8")).replace(/\s/g, ""), "hex");
  for (const [name, buffer, reason] of [
    ["corrupt.ro", Buffer.from("corrupt bytes"), /portable|package|archive|container/i],
    ["csv-renamed.ro", Buffer.from("Name,Amount\nA,1\n"), /portable|package|archive|container/i],
    ["developmental.ro", developmentalArchive(second.bytes), /payload|representation|version/i],
    ["over-limit.ro", null, /limit|64|capacity|size/i],
    ["constrained.ro", constrained, /unconstrained|unsupported/i],
    ["wrong-extension.csv", second.bytes, /ending in .ro/i],
  ]) {
    const refusalFile = path.join(profileRoot, name);
    if (name === "over-limit.ro") {
      // A real file of the original 64 MiB + 1 size, without filling RAM.
      const handle = await openFileHandle(refusalFile, "w");
      try { await handle.truncate(64 * 1024 * 1024 + 1); }
      finally { await handle.close(); }
    } else await writeFile(refusalFile, buffer);
    await attemptResidentOpen(page, refusalFile);
    await page.getByRole("alert").filter({ hasText: /work file|Choose a Tachiko/ }).waitFor();
    assert.match(await page.getByRole("alert").last().textContent(), reason, `${name}: actual Work refusal reason remains visible`);
    assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.workFileSnapshot()), before, `${name}: resident occurrence, revision and exact core bytes preserved`);
    await assertSaveAvailable(page);
    const reads = await page.evaluate(() => window.workFileReads);
    if (name === "over-limit.ro" || name === "wrong-extension.csv") {
      assert.equal(reads.includes(name), false, `${name}: refusal happens before File.arrayBuffer()`);
    } else {
      assert.equal(reads.filter(read => read === name).length, 1, `${name}: read counter observes a real File read`);
    }
    results.push(`refused-${name}-without-replacement`);
  }

  // Deliberately dispatch a real edit behind the consent dialog, to exercise
  // a stale reviewed revision without weakening any normal UI modal guard.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const dialog = await prepare(page);
  await page.getByRole("tab", { name: "Table", exact: true }).dispatchEvent("click");
  await page.getByTestId(impactId).dispatchEvent("dblclick");
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("1", { force: true });
  await editor.press("Enter");
  await ready(page);
  await page.getByTestId(impactId).filter({ hasText: "1" }).waitFor({ state: "attached" });
  let downloads = 0;
  const onDownload = () => { downloads += 1; };
  page.on("download", onDownload);
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /work changed after/ }).waitFor();
  assert.equal(downloads, 0);
  assert.equal(await page.locator('[data-work-dirty="true"]').count(), 1);
  page.off("download", onDownload);
  results.push("stale-reviewed-revision-cannot-download");

  page = await fresh();
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await ready(page);
  const priceId = "cell:30000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000203";
  await edit(page, priceId, 250);
  const salesFirst = await download(page, "sales-first.ro", /Report settings/);
  const definitions = await independentOracle(page, salesFirst, salesCatalogText, { entity: "30000000-0000-4000-8000-000000000001", field: "20000000-0000-4000-8000-000000000203", value: 250 }, true);
  page = await fresh();
  await open(page, salesFirst.path);
  await assertSaveAvailable(page);
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await ready(page);
  await edit(page, priceId, 300);
  const salesSecond = await download(page, "sales-second.ro");
  const finalDefinitions = await independentOracle(page, salesSecond, salesCatalogText, { entity: "30000000-0000-4000-8000-000000000001", field: "20000000-0000-4000-8000-000000000203", value: 300 }, true);
  assert.deepEqual(finalDefinitions, definitions, "exact summary identity and bindings survive the full lifecycle");
  page = await fresh();
  await open(page, salesSecond.path);
  const salesThird = await download(page, "sales-third.ro");
  assert.deepEqual(salesThird.bytes, salesSecond.bytes);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.match(await page.getByLabel("Cross-table groups", { exact: true }).textContent(), /1200/);
  results.push("Sales-summary-definition-type-value-independent-group-oracle-and-double-reopen");

  page = await fresh();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({ name: "source.csv", mimeType: "text/csv", buffer: Buffer.from("Item,Amount\n A ,2\nB,3\n") });
  await page.getByRole("button", { name: "Import candidate", exact: true }).click();
  await ready(page);
  const imported = await download(page, "imported.ro", /imported spreadsheet file and its import information, changes and warnings/);
  assert.equal(archiveEntries(imported.bytes).some(entry => /source|ledger|report/.test(entry.name)), false, "package contains no Sheet attachments");
  assert.equal(await page.getByRole("button", { name: "Prepare CSV", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Prepare XLSX", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isEnabled(), true);
  results.push("import-source-omission-disclosed-while-Save-CSV-XLSX-remain-available");

  console.log(JSON.stringify({ status: "PASS", lane: "work-file-local", outcomes: results }));
} catch (error) {
  const infrastructure = /browserType\.launch|Target page, context or browser has been closed|mach port|bootstrap_check_in/i.test(String(error?.stack ?? error));
  console.error(infrastructure ? "BLOCKED: browser infrastructure" : "FAIL: work-file-local", error);
  process.exitCode = infrastructure ? 78 : 1;
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => {});
  await rm(profileRoot, { recursive: true, force: true });
}

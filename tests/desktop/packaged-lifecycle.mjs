// Desktop (macOS) packaged-app lifecycle: the Sheet #150 consumer journey on
// the real packaged Tauri app running the native Tachiko Work runtime.
//
// The app under test is the packaged e2e variant: the same frontend, native
// runtime and host as the shipped app, plus the `e2e` script channel, under a
// separate bundle identity so it never touches the person's own data. Steps
// drive the real UI with DOM events (no runtime/kit calls on the app's behalf).
// Every process is a real LaunchServices launch, and "restart" is a full quit
// of the app process followed by a fresh launch. An independent stdlib oracle
// checks every exported cell.
//
// Usage: node tests/desktop/packaged-lifecycle.mjs "<path to Tachiko Sheet E2E.app>"
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const app = path.resolve(process.argv[2] ?? "");
const bundleId = "dev.tachiko.sheet.e2e";
assert.ok(existsSync(path.join(app, "Contents", "Info.plist")), `packaged app not found: ${app}`);
const executable = path.join(app, "Contents", "MacOS");
const oracle = path.join(root, "acceptance", "capacity-8406", "oracle.py");
const ROWS = 8406;
const EDITS = [
  [0, 0, '000-edited-雪,"first"'],
  [ROWS >> 1, 1, "https://example.invalid/edited-middle?x=0007"],
  [ROWS - 1, 2, "0001700008405999"],
];
const formats = (process.env.CAPACITY_FORMATS ?? "csv,xlsx").split(",");

const work = await mkdtemp(path.join(tmpdir(), "tachiko-desktop-lifecycle-"));
const fixtures = path.join(work, "fixtures");
const downloads = path.join(work, "downloads");
const scripts = path.join(work, "scripts");
await mkdir(downloads);
await mkdir(scripts);
execFileSync("python3", ["-I", oracle, "generate", fixtures], { stdio: "inherit" });

const timings = {};
const timed = async (label, action) => {
  const started = performance.now();
  const result = await action();
  (timings[label] ??= []).push(Math.round(performance.now() - started));
  return result;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- process lifecycle -------------------------------------------------------

function appPids() {
  try {
    return execFileSync("pgrep", ["-f", executable], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function launch() {
  assert.deepEqual(appPids(), [], "no earlier app process is running");
  execFileSync("open", ["-n", "-a", app,
    "--env", `TACHIKO_SHEET_E2E_DIR=${scripts}`,
    "--env", `TACHIKO_SHEET_E2E_DOWNLOADS=${downloads}`,
    // A person takes time in the Save panel; exports must survive that wait.
    "--env", "TACHIKO_SHEET_E2E_DOWNLOAD_DELAY_MS=2500",
    // The unsaved-work dialog is answered "Cancel": closing must then not happen.
    "--env", "TACHIKO_SHEET_E2E_CLOSE_ANSWER=cancel",
    // The answer takes a moment, so the frozen page can be observed meanwhile.
    "--env", "TACHIKO_SHEET_E2E_CLOSE_ANSWER_DELAY_MS=1200"]);
  for (let attempt = 0; attempt < 100 && appPids().length === 0; attempt++) await sleep(100);
  const pids = appPids();
  assert.equal(pids.length, 1, "exactly one app process launched");
  await evaluate("return document.readyState", 30_000);
  return pids[0];
}

const hostLog = async () => existsSync(path.join(scripts, "host.log")) ? readFile(path.join(scripts, "host.log"), "utf8") : "";

/** Close the window exactly like the close button or ⌘W, through the host's unsaved-work guard. */
async function requestClose() {
  // Report this script's result first; the window may be gone right after.
  await evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('e2e_request_close'), 100); return true;");
}

/** Quit exactly like the menu's Quit (⌘Q), through the host's unsaved-work guard. */
async function requestQuit() {
  await evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('e2e_request_quit'), 100); return true;");
}

async function quit(pid, { via = "quit" } = {}) {
  await ({ close: requestClose, quit: requestQuit, terminate: requestTerminate })[via]();
  for (let attempt = 0; attempt < 150 && appPids().includes(pid); attempt++) await sleep(100);
  assert.ok(!appPids().includes(pid), `the app process exited; host log: ${await hostLog()}`);
}

const dialogs = async () => (await hostLog()).split("leave dialog").length;

/** Wait until no leave decision is open: the host takes one decision at a time. */
async function leaveSettled() {
  let last = await hostLog();
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(300);
    const now = await hostLog();
    if (now === last && !(await evaluate("return document.body.inert;"))) return;
    last = now;
  }
  throw new Error(`a leave decision stayed open; host: ${last}`);
}

async function leaveRefusedWhileUnsaved(pid, request) {
  await leaveSettled();
  const before = await dialogs();
  await request();
  for (let attempt = 0; attempt < 100 && (await dialogs()) === before; attempt++) await sleep(50);
  assert.ok((await dialogs()) > before, `leaving with unsaved work asks first; host: ${await hostLog()}`);
  assert.equal(await evaluate("return document.body.inert;"), true, "the page is frozen while leaving is decided");
  for (let attempt = 0; attempt < 60 && await evaluate("return document.body.inert;"); attempt++) await sleep(50);
  assert.equal(await evaluate("return document.body.inert;"), false, "Cancel makes the page usable again");
  assert.ok(appPids().includes(pid), "answering Cancel keeps the app and its work open");
  assert.equal(await evaluate("return Boolean(document.querySelector('[data-testid=\"project-ready\"]'));"), true, "the work is still open");
}

/** Terminate exactly like the Dock's Quit or logout (`NSApp terminate:`). */
async function requestTerminate() {
  await evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('e2e_request_terminate'), 100); return true;");
}

const closeRefusedWhileUnsaved = (pid) => leaveRefusedWhileUnsaved(pid, requestClose);
const terminateRefusedWhileUnsaved = (pid) => leaveRefusedWhileUnsaved(pid, requestTerminate);
const quitRefusedWhileUnsaved = (pid) => leaveRefusedWhileUnsaved(pid, requestQuit);

// ---- script channel ----------------------------------------------------------

let sequence = 0;
async function evaluate(body, timeout = 120_000, windowLabel = null) {
  const id = `s${String(++sequence).padStart(5, "0")}`;
  const result = path.join(scripts, `${id}.result.json`);
  await writeFile(path.join(scripts, `${id}.partial`), `${HELPERS}\n${body}`);
  await rename(path.join(scripts, `${id}.partial`), path.join(scripts, windowLabel ? `${id}@${windowLabel}.js` : `${id}.js`));
  const deadline = Date.now() + timeout;
  while (!existsSync(result)) {
    if (Date.now() > deadline) {
      const tail = (await hostLog()).trim().split("\n").slice(-15).join("\n");
      throw new Error(`script ${id} timed out:\n${body.slice(0, 400)}\nhost log tail:\n${tail}`);
    }
    await sleep(25);
  }
  const outcome = JSON.parse(await readFile(result, "utf8"));
  if (!outcome.ok) throw new Error(`script ${id} failed: ${outcome.error}\n${body.slice(0, 400)}`);
  return outcome.value;
}

// In-page helpers: accessible-name lookup and DOM events like a pointer/keyboard user.
const HELPERS = String.raw`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) {
      const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim()).filter(Boolean).join(" | ");
      const busy = document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy");
      throw new Error("timed out waiting for " + label + "; busy=" + busy + "; alerts=" + (alerts || "none"));
    }
    await sleep(20);
  }
}
const nameOf = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim();
const button = (name, scope = document) => [...scope.querySelectorAll("button")].find((b) => nameOf(b) === name && !b.disabled);
const dialog = (name) => [...document.querySelectorAll('[role="dialog"]')].find((d) => {
  const label = d.getAttribute("aria-labelledby");
  return (d.getAttribute("aria-label") || (label && document.getElementById(label)?.textContent) || "").trim() === name;
});
const textbox = (name) => [...document.querySelectorAll("input,textarea")].find((i) => {
  const labelled = i.getAttribute("aria-labelledby");
  const label = i.getAttribute("aria-label") || (labelled && document.getElementById(labelled)?.textContent) ||
    (i.id && document.querySelector('label[for="' + i.id + '"]')?.textContent) || "";
  return label.trim() === name;
});
function pointer(el, type) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, detail: type === "dblclick" ? 2 : 1 }));
}
function click(el) { pointer(el, "mousedown"); el.focus?.(); pointer(el, "mouseup"); pointer(el, "click"); }
function dblclick(el) { click(el); pointer(el, "mousedown"); pointer(el, "mouseup"); pointer(el, "click"); pointer(el, "dblclick"); }
function fill(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  input.focus();
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function press(el, key) {
  for (const type of ["keydown", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}
const ready = () => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false";
const current = () => ready() && document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current";
const grid = () => document.querySelector('table[aria-label="Table"]');
const rowAt = (row) => grid()?.querySelector('tbody tr[aria-rowindex="' + (row + 2) + '"]');
const cellAt = (row, column) => rowAt(row)?.querySelectorAll("td")[column];
const tab = (name) => [...document.querySelectorAll('[role="tab"]')].find((t) => nameOf(t) === name);
async function visibleTable(name) {
  click(await waitFor(() => tab("Table"), "Table tab"));
  const select = await waitFor(() => document.querySelector("#ts-active-table"), "table selector");
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, name);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(() => select.value === name && current() && grid()?.querySelector("tbody tr"), "table " + name);
  return [...grid().querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()));
}
async function resultRows() {
  click(await waitFor(() => tab("Cross-table summary"), "summary tab"));
  const table = await waitFor(() => document.querySelector('table[aria-label="Cross-table groups"]') && current() && document.querySelector('table[aria-label="Cross-table groups"]'), "summary table");
  return [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()));
}
// Scroll like a person until the row is in the rendered window, measuring the
// row pitch from the rows actually rendered (multi-line rows are taller).
async function reveal(row) {
  const scroller = document.querySelector(".ts-grid-scroll");
  for (let attempt = 0; attempt < 40 && !rowAt(row); attempt++) {
    const rendered = [...grid().querySelectorAll("tbody tr.ts-row")];
    const first = rendered[0];
    const last = rendered[rendered.length - 1];
    const span = last && first ? Number(last.getAttribute("aria-rowindex")) - Number(first.getAttribute("aria-rowindex")) : 0;
    const pitch = span > 0 ? (last.offsetTop - first.offsetTop) / span : (first?.offsetHeight || 32);
    const firstRow = first ? Number(first.getAttribute("aria-rowindex")) - 2 : 0;
    const target = first ? first.offsetTop + (row - firstRow) * pitch : row * pitch;
    scroller.scrollTop = Math.max(0, target - scroller.clientHeight / 2);
    await sleep(100);
  }
  const rendered = [...grid().querySelectorAll("tbody tr.ts-row")].map((r) => r.getAttribute("aria-rowindex"));
  return waitFor(() => rowAt(row), "row " + row + " (rendered " + rendered[0] + ".." + rendered[rendered.length - 1] +
    ", scrollTop " + scroller.scrollTop + "/" + scroller.scrollHeight + ", client " + scroller.clientHeight +
    ", visibility " + document.visibilityState + ", focus " + document.hasFocus() + ")");
}
`;

// ---- journey steps -----------------------------------------------------------

async function coldHome() {
  return evaluate(`
    await waitFor(() => document.querySelector('.ts-app[data-view="home"]') && [...document.querySelectorAll("h1,h2")].some((h) => h.textContent.trim() === "Tachiko Sheet"), "cold Home");
    await waitFor(() => !document.querySelector('[aria-label="Recovery"]'), "no recovery region");
    return {
      protocol: location.protocol,
      wasm: performance.getEntriesByType("resource").map((r) => r.name).filter((name) => name.split("?")[0].endsWith(".wasm") || name.includes("worker")),
      workbook: Boolean(document.querySelector('[data-testid="project-ready"]')),
    };
  `);
}

async function importSource(file) {
  const bytes = (await readFile(file)).toString("base64");
  const type = file.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await evaluate(`
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*=".csv"]'), "import input");
    const bytes = Uint8Array.from(atob(${JSON.stringify(bytes)}), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(path.basename(file))}, { type: ${JSON.stringify(type)} }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const review = await waitFor(() => dialog("Review import candidate"), "import review");
    const types = [...review.querySelectorAll("select")].map((s) => s.value);
    if (types.length !== 3 || types.some((t) => t !== "text")) throw new Error("columns are not all Text: " + types);
    return true;
  `);
  await timed("import", () => evaluate(`
    click(await waitFor(() => button("Import candidate", dialog("Review import candidate")), "enabled Import candidate"));
    await waitFor(() => ready() && grid()?.querySelector("tbody tr.ts-row"), "imported grid", 240000);
    return true;
  `, 300_000));
}

const rowCount = () => evaluate(`
  const declared = Number(grid().getAttribute("aria-rowcount")) - 1;
  const rendered = grid().querySelectorAll("tbody tr.ts-row").length;
  if (rendered >= 400) throw new Error("large table renders " + rendered + " rows, not a window");
  return declared;
`);

const cellText = (row, column) => evaluate(`await reveal(${row}); return cellAt(${row}, ${column}).textContent;`);

async function edit(row, column, value) {
  await evaluate(`
    await reveal(${row});
    dblclick(cellAt(${row}, ${column}));
    const input = await waitFor(() => textbox("Edit cell"), "cell editor");
    fill(input, ${JSON.stringify(value)});
    return true;
  `);
  await timed("edit", () => evaluate(`
    press(textbox("Edit cell"), "Enter");
    await waitFor(() => !textbox("Edit cell") && current() && cellAt(${row}, ${column})?.textContent === ${JSON.stringify(value)}, "published edit");
    return true;
  `));
}

async function history(direction, row, column, value) {
  await timed(direction, () => evaluate(`
    click(await waitFor(() => button(${JSON.stringify(direction === "undo" ? "Undo" : "Redo")}), "${direction} button"));
    await reveal(${row});
    await waitFor(() => current() && cellAt(${row}, ${column})?.textContent === ${JSON.stringify(value)}, "${direction} result");
    return true;
  `));
}

async function assertEdited(label) {
  assert.equal(await rowCount(), ROWS, `${label}: all rows present`);
  for (const [row, column, value] of EDITS) {
    assert.equal(await cellText(row, column), value, `${label}: edit at ${row},${column}`);
  }
  assert.equal(await cellText(1, 0), "invented_00001", `${label}: unedited neighbour`);
  assert.equal(await cellText(97, 2), "0001700000000097", `${label}: leading-zero timestamp text`);
}

async function saveCopy(name) {
  await evaluate(`
    click(await waitFor(() => button("Save a copy"), "Save a copy"));
    fill(await waitFor(() => textbox("Copy name"), "copy name"), ${JSON.stringify(name)});
    return true;
  `);
  await timed("save", () => evaluate(`
    click(await waitFor(() => button("Create copy"), "enabled Create copy"));
    await waitFor(() => document.querySelector('[data-testid="save-status"]')?.textContent.includes("Saved on this device"), "saved status");
    return true;
  `));
}

async function openSaved(name) {
  await timed("reopen", () => evaluate(`
    click(await waitFor(() => button(${JSON.stringify(`Open saved ${name}`)}), "saved copy entry"));
    await waitFor(() => ready() && grid()?.querySelector("tbody tr.ts-row"), "reopened grid", 240000);
    return true;
  `));
}

async function download(format, { replace = false } = {}) {
  // A fresh export starts from an empty folder so a stale file cannot pass; a
  // replacing export must atomically supersede an invalid sentinel file.
  for (const name of await readdir(downloads)) await rm(path.join(downloads, name), { force: true });
  if (replace) await writeFile(path.join(downloads, `Imported workbook.${format}`), "sentinel: not an export\n");
  const started = Date.now();
  await timed(`prepare_${format}`, () => evaluate(`
    click(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((t) => nameOf(t) === "Import & export"), "export tab"));
    click(await waitFor(() => button(${JSON.stringify(`Prepare ${format.toUpperCase()}`)}), "prepare"));
    await waitFor(() => dialog("Confirm download"), "download consent");
    return true;
  `));
  await evaluate(`
    click(await waitFor(() => button("Download", dialog("Confirm download")), "enabled Download"));
    await waitFor(() => !dialog("Confirm download"), "consent closed");
    return true;
  `);
  let file;
  for (let attempt = 0; attempt < 600 && !file; attempt++) {
    for (const name of await readdir(downloads)) {
      if (name.startsWith(".") || !name.endsWith(`.${format}`)) continue;
      const content = await readFile(path.join(downloads, name));
      if ((await stat(path.join(downloads, name))).mtimeMs >= started - 1000 && !content.toString("latin1").startsWith("sentinel:")) file = name;
    }
    if (!file) await sleep(100);
  }
  assert.ok(file, `${format} download was written by the native host; folder: ${JSON.stringify(await readdir(downloads))}; host: ${existsSync(path.join(scripts, "host.log")) ? await readFile(path.join(scripts, "host.log"), "utf8") : "-"}`);
  for (let attempt = 0; attempt < 100 && (await readdir(downloads)).some((name) => name.startsWith(".")); attempt++) await sleep(50);
  assert.deepEqual((await readdir(downloads)).filter((name) => name.startsWith(".")), [], "no temporary download file remains");
  const destination = path.join(downloads, file);
  execFileSync("python3", ["-I", oracle, "verify", destination], { stdio: "inherit" });
  return destination;
}

async function closeToHome() {
  await evaluate(`
    click(await waitFor(() => button("Close project"), "Close project"));
    await waitFor(() => dialog("Unsaved work") || document.querySelector('.ts-app[data-view="home"]'), "close outcome");
    const unsaved = dialog("Unsaved work");
    if (unsaved) click(button("Close without saving", unsaved));
    await waitFor(() => document.querySelector('.ts-app[data-view="home"]'), "Home");
    return true;
  `);
}

async function refusedImport(content, name) {
  const bytes = Buffer.from(content).toString("base64");
  return evaluate(`
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*=".csv"]'), "import input");
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: "text/csv" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const outcome = await waitFor(() => dialog("Review import candidate") || document.querySelector('[role="alert"]'), "refusal");
    if (outcome.getAttribute("role") === "dialog") {
      click(button("Import candidate", outcome));
      await waitFor(() => document.querySelector('[role="alert"]'), "refusal alert");
      const text = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");
      click(button("Cancel", dialog("Review import candidate")));
      return { text, opened: Boolean(document.querySelector('[data-testid="project-ready"]')) };
    }
    return { text: outcome.textContent, opened: Boolean(document.querySelector('[data-testid="project-ready"]')) };
  `);
}

const unsavedCheck = () => evaluate(`
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
`);


// ---- Sales example: the "30 seconds to value" path ---------------------------

async function salesJourney() {
  const name = "desktop-sales";
  let pid = await timed("launch", launch);
  await coldHome();
  await timed("open_sales", () => evaluate(`
    click(await waitFor(() => button("Open sales example"), "Open sales example"));
    await waitFor(() => ready() && document.querySelector(".ts-title")?.textContent === "Sales and catalog", "Sales example");
    return true;
  `));
  assert.deepEqual(await evaluate(`return visibleTable("sales");`), [["PEN", "3"], ["NOTE", "2"], ["PEN", "1"]], "Sales input rows");
  assert.deepEqual(await evaluate(`return visibleTable("catalog");`), [["PEN", "PEN", "200"], ["NOTE", "NOTE", "500"]], "Catalog input rows");
  assert.deepEqual(await evaluate(`return resultRows();`), [["NOTE", "1000"], ["PEN", "800"]], "initial summary");
  await screenshot("sales-summary");
  await timed("edit_price", () => evaluate(`
    await visibleTable("catalog");
    const headers = [...grid().querySelectorAll('th[scope="col"]')].map((h) => h.textContent.trim()).filter((h) => h !== "Row");
    const price = headers.indexOf("price");
    const row = [...grid().querySelectorAll("tbody tr")].find((r) => r.textContent.includes("PEN"));
    dblclick(row.querySelectorAll("td")[price]);
    fill(await waitFor(() => textbox("Edit cell"), "cell editor"), "250");
    press(textbox("Edit cell"), "Enter");
    await waitFor(() => !textbox("Edit cell") && current() && row.querySelectorAll("td")[price].textContent.trim() === "250", "published price");
    return true;
  `));
  assert.deepEqual(await evaluate(`return resultRows();`), [["NOTE", "1000"], ["PEN", "1000"]], "summary recalculated by the native runtime");
  const report = await evaluate(`
    click(await waitFor(() => tab("Report"), "Report tab"));
    await waitFor(() => document.querySelector('canvas[data-report-ready="true"]'), "report canvas");
    return document.querySelector('[aria-label="Current report data"]')?.innerText ?? "";
  `);
  assert.match(report, /NOTE\s*1000/);
  assert.match(report, /PEN\s*1000/);
  await screenshot("sales-report");
  // PNG exports are saved by the host, in the order requested. A save still
  // encoding already counts as unsaved work.
  for (const name of await readdir(downloads)) await rm(path.join(downloads, name), { force: true });
  const savedPngs = async () => (await hostLog()).split("\n").filter((line) => line.startsWith("saved tachiko-sheet-report.png: Ok(Saved)"));
  const before = (await savedPngs()).length;
  const encoding = await evaluate(`
    const exportPng = await waitFor(() => button("Export current PNG"), "PNG export");
    click(exportPng);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    click(exportPng);
    return event.defaultPrevented;
  `);
  assert.equal(encoding, true, "a PNG export in progress blocks leaving");
  for (let attempt = 0; attempt < 400 && (await savedPngs()).length < before + 2; attempt++) await sleep(50);
  assert.equal((await savedPngs()).length, before + 2, `both overlapping PNG exports were saved; host: ${await hostLog()}`);
  assert.equal(await unsavedCheck(), true, "the edited Sales work itself is still unsaved");
  const png = path.join(downloads, "tachiko-sheet-report.png");
  assert.deepEqual([...(await readFile(png)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "the saved report is a PNG");
  assert.deepEqual((await readdir(downloads)).filter((n) => n.startsWith(".")), [], "no temporary file remains");
  assert.doesNotMatch(await hostLog(), /download refused|: Err\(/, "no export went through WebKit or failed");
  await closeRefusedWhileUnsaved(pid);
  await quitRefusedWhileUnsaved(pid);
  await terminateRefusedWhileUnsaved(pid);
  // A bundled license link must not replace the Sheet document.
  await evaluate(`window.__sheetDocument = "kept"; click([...document.querySelectorAll(".ts-notices a")].find((a) => a.textContent === "MIT")); await sleep(500); return true;`);
  assert.equal(await evaluate(`return window.__sheetDocument ?? "replaced";`), "kept", "the Sheet document stays after a notices link");
  let notice = "";
  for (let attempt = 0; attempt < 50 && !notice.includes("Permission is hereby granted"); attempt++) {
    await sleep(200);
    notice = await evaluate(`return document.body?.innerText ?? "";`, 3_000, "page-0").catch(() => "");
  }
  assert.match(notice, /Permission is hereby granted/, "the notices window shows the MIT license text");
  assert.match(await hostLog(), /navigation held: tauri:\/\/localhost\/core-kit\/notices\/LICENSE-MIT/);
  // A reload with unsaved work asks first; Cancel keeps the document.
  await leaveRefusedWhileUnsaved(pid, () => evaluate(`setTimeout(() => location.reload(), 50); return true;`));
  assert.equal(await evaluate(`return window.__sheetDocument ?? "replaced";`), "kept", "a refused reload keeps the Sheet document");
  assert.match(await hostLog(), /leave dialog \(Reload\)/);
  await saveCopy(name);
  // With nothing unsaved, a reload goes through and starts fresh at Home.
  await evaluate(`setTimeout(() => location.reload(), 50); return true;`);
  let marker = "kept";
  for (let attempt = 0; attempt < 100 && marker !== "replaced"; attempt++) {
    await sleep(100);
    marker = await evaluate(`return window.__sheetDocument ?? "replaced";`, 5_000).catch(() => "pending");
  }
  assert.equal(marker, "replaced", "a clean reload reloads");
  await coldHome();
  await quit(pid, { via: "close" });

  pid = await timed("launch", launch);
  await coldHome();
  await openSaved(name);
  assert.deepEqual(await evaluate(`return visibleTable("catalog");`), [["PEN", "PEN", "250"], ["NOTE", "NOTE", "500"]], "reopened Catalog");
  assert.deepEqual(await evaluate(`return resultRows();`), [["NOTE", "1000"], ["PEN", "1000"]], "reopened summary recomputed");
  assert.equal(await unsavedCheck(), false, "a reopened saved copy is clean");
  // An edit still being published counts as unsaved work, even on clean work.
  const inFlight = await evaluate(`
    await visibleTable("catalog");
    const headers = [...grid().querySelectorAll('th[scope="col"]')].map((h) => h.textContent.trim()).filter((h) => h !== "Row");
    const row = [...grid().querySelectorAll("tbody tr")].find((r) => r.textContent.includes("PEN"));
    dblclick(row.querySelectorAll("td")[headers.indexOf("price")]);
    fill(await waitFor(() => textbox("Edit cell"), "cell editor"), "300");
    press(textbox("Edit cell"), "Enter");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    const busy = document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy");
    await waitFor(() => current(), "edit settled");
    return { unsaved: event.defaultPrevented, busy };
  `);
  assert.equal(inFlight.unsaved, true, `an in-flight edit blocks closing (busy=${inFlight.busy})`);
  await closeToHome();
  await quit(pid);
}

async function screenshot(label) {
  const folder = process.env.DESKTOP_SCREENSHOTS;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  // The window is looked up by owner name; screencapture needs only Screen Recording.
  const id = execFileSync("swift", ["-e", `import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerName as String] as? String) == "Tachiko Sheet E2E" { print(w[kCGWindowNumber as String]!); break }`], { encoding: "utf8" }).trim();
  if (id) execFileSync("screencapture", ["-x", "-o", `-l${id}`, path.join(folder, `${label}.png`)]);
}

// ---- run ---------------------------------------------------------------------

const webkitData = [
  path.join(homedir(), "Library", "WebKit", bundleId),
  path.join(homedir(), "Library", "Caches", bundleId),
];
for (const folder of webkitData) await rm(folder, { recursive: true, force: true });

const results = [];
let pid;
try {
  if (process.env.DESKTOP_JOURNEYS !== "capacity") await salesJourney();
  for (const format of process.env.DESKTOP_JOURNEYS === "sales" ? [] : formats) {
    const name = `capacity-8406-${format}`;
    pid = await timed("launch", launch);
    const home = await coldHome();
    assert.equal(home.protocol, "tauri:", "the packaged frontend is served by the app");
    assert.deepEqual(home.wasm, [], "no Worker or WASM runtime is loaded");
    assert.equal(home.workbook, false, "fresh launch opens Home without a workbook");

    await importSource(path.join(fixtures, `source-${ROWS}.${format}`));
    assert.equal(await rowCount(), ROWS, "imported row count");
    assert.match(await cellText(0, 0), /^invented_00000,雪"quote"/, "readable first imported cell");
    assert.equal(await cellText(ROWS - 1, 1), "https://example.invalid/account/08405");
    assert.equal(await unsavedCheck(), true, "imported work counts as unsaved for the close guard");
    await quitRefusedWhileUnsaved(pid);

    for (const [row, column, value] of EDITS) await edit(row, column, value);
    const original = (row, column) => [
      `invented_${String(row).padStart(5, "0")}`,
      `https://example.invalid/account/${String(row).padStart(5, "0")}`,
      (row % 97 === 0 ? "000" : "") + String(1700000000000 + row),
    ][column];
    const [[, ,], [middleRow, middleColumn, middleValue], [lastRow, lastColumn, lastValue]] = EDITS;
    await history("undo", lastRow, lastColumn, original(lastRow, lastColumn));
    await history("undo", middleRow, middleColumn, original(middleRow, middleColumn));
    await history("redo", middleRow, middleColumn, middleValue);
    await history("redo", lastRow, lastColumn, lastValue);
    await assertEdited("after history");

    await saveCopy(name);
    assert.equal(await unsavedCheck(), false, "saved work no longer blocks closing");

    // Full process quit, then a fresh launch reopening the saved copy.
    await quit(pid);
    pid = await timed("launch", launch);
    const relaunched = await coldHome();
    assert.equal(relaunched.workbook, false, "relaunch starts at Home");
    await openSaved(name);
    await assertEdited("after full restart");
    const csv = await download("csv");
    await download("csv", { replace: true });
    const xlsx = await download("xlsx");

    await closeToHome();
    const malformed = await refusedImport("a,b\n\"unterminated\n", `malformed-${format}.csv`);
    assert.equal(malformed.opened, false, "a malformed file opens no workbook");
    assert.ok(malformed.text.length > 0, "the refusal is explained");
    // Clean work: the Dock's Quit (terminate) exits like the menu's Quit.
    await quit(pid, { via: format === "xlsx" ? "terminate" : "quit" });
    pid = undefined;
    results.push({ format, csv: path.basename(csv), xlsx: path.basename(xlsx), refusal: malformed.text.slice(0, 160) });
  }
  console.log(JSON.stringify({
    case: "desktop packaged 8,406 x 3 lifecycle (native runtime)",
    status: "PASS",
    app,
    machine: execFileSync("uname", ["-mrs"], { encoding: "utf8" }).trim(),
    macos: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
    timingsMs: timings,
    results,
  }, null, 2));
} finally {
  if (pid && appPids().includes(pid)) execFileSync("kill", [pid]);
  if (process.env.DESKTOP_KEEP_LOG) await writeFile(process.env.DESKTOP_KEEP_LOG, await hostLog());
  await rm(work, { recursive: true, force: true });
}

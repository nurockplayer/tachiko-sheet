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
    "--env", "TACHIKO_SHEET_E2E_CLOSE_ANSWER=cancel"]);
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

async function quit(pid) {
  await requestClose();
  for (let attempt = 0; attempt < 150 && appPids().includes(pid); attempt++) await sleep(100);
  assert.ok(!appPids().includes(pid), `the app process exited; host log: ${await hostLog()}`);
}

async function closeRefusedWhileUnsaved(pid) {
  const before = (await hostLog()).split("close dialog:").length;
  await requestClose();
  for (let attempt = 0; attempt < 100 && (await hostLog()).split("close dialog:").length === before; attempt++) await sleep(50);
  assert.ok((await hostLog()).split("close dialog:").length > before, "closing with unsaved work asks first");
  await sleep(500);
  assert.ok(appPids().includes(pid), "answering Cancel keeps the app and its work open");
  assert.equal(await evaluate("return Boolean(document.querySelector('[data-testid=\"project-ready\"]'));"), true, "the work is still open");
}

// ---- script channel ----------------------------------------------------------

let sequence = 0;
async function evaluate(body, timeout = 120_000) {
  const id = `s${String(++sequence).padStart(5, "0")}`;
  const result = path.join(scripts, `${id}.result.json`);
  await writeFile(path.join(scripts, `${id}.partial`), `${HELPERS}\n${body}`);
  await rename(path.join(scripts, `${id}.partial`), path.join(scripts, `${id}.js`));
  const deadline = Date.now() + timeout;
  while (!existsSync(result)) {
    if (Date.now() > deadline) throw new Error(`script ${id} timed out:\n${body.slice(0, 400)}`);
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
    if (Date.now() > deadline) throw new Error("timed out waiting for " + label);
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
async function reveal(row) {
  const scroller = document.querySelector(".ts-grid-scroll");
  const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row')?.offsetHeight || 32;
  scroller.scrollTop = Math.max(0, row * pitch - scroller.clientHeight / 2);
  return waitFor(() => rowAt(row), "row " + row);
}
`;

// ---- journey steps -----------------------------------------------------------

async function coldHome() {
  return evaluate(`
    await waitFor(() => document.querySelector('.ts-app[data-view="home"]') && [...document.querySelectorAll("h1,h2")].some((h) => h.textContent.trim() === "Tachiko Sheet"), "cold Home");
    await waitFor(() => !document.querySelector('[aria-label="Recovery"]'), "no recovery region");
    return {
      protocol: location.protocol,
      wasm: performance.getEntriesByType("resource").filter((r) => /\\.wasm$|worker/.test(r.name)).map((r) => r.name),
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
    click(button("Import candidate", dialog("Review import candidate")));
    await waitFor(() => ready() && grid()?.querySelector("tbody tr.ts-row"), "imported grid");
    return true;
  `));
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
    click(button("Create copy"));
    await waitFor(() => document.querySelector('[data-testid="save-status"]')?.textContent.includes("Saved on this device"), "saved status");
    return true;
  `));
}

async function openSaved(name) {
  await timed("reopen", () => evaluate(`
    click(await waitFor(() => button(${JSON.stringify(`Open saved ${name}`)}), "saved copy entry"));
    await waitFor(() => ready() && grid()?.querySelector("tbody tr.ts-row"), "reopened grid");
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
    click(button("Download", dialog("Confirm download")));
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
  // Two PNG exports of the same unchanged chart: each is its own download.
  for (const name of await readdir(downloads)) await rm(path.join(downloads, name), { force: true });
  const finishedPngs = async () => (await hostLog()).split("\n").filter((line) => line.startsWith("finished blob:") && line.endsWith(" true"));
  for (let round = 1; round <= 2; round++) {
    await evaluate(`click(await waitFor(() => button("Export current PNG"), "PNG export")); return true;`);
    for (let attempt = 0; attempt < 300 && (await finishedPngs()).length < round; attempt++) await sleep(50);
    assert.equal((await finishedPngs()).length, round, `PNG export ${round} finished; host: ${await hostLog()}`);
  }
  const urls = (await finishedPngs()).map((line) => line.split(" ")[1]);
  assert.notEqual(urls[0], urls[1], "each PNG export has its own download identity");
  const pngs = (await readdir(downloads)).filter((name) => name.startsWith("tachiko-sheet-report") && name.endsWith(".png"));
  assert.ok(pngs.length >= 1, `report PNG saved; folder: ${JSON.stringify(await readdir(downloads))}`);
  for (const name of pngs) {
    assert.deepEqual([...(await readFile(path.join(downloads, name))).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} is a PNG`);
  }
  assert.deepEqual((await readdir(downloads)).filter((n) => n.startsWith(".")), [], "no temporary PNG remains");
  assert.doesNotMatch(await hostLog(), /export failure/, "no export was reported as failed");
  await closeRefusedWhileUnsaved(pid);
  await saveCopy(name);
  await quit(pid);

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
    await closeRefusedWhileUnsaved(pid);

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
    await quit(pid);
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
  await rm(work, { recursive: true, force: true });
}

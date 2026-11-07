// Packaged-app smoke test for Windows and Linux CI.
//
// The same e2e variant the macOS lifecycle uses (the shipped frontend, native
// runtime and host plus the `e2e` script channel), started directly as the
// packaged binary. It proves that the real app starts, imports through the
// native runtime, keeps unsaved work through Close/Quit while the answer is
// Cancel, exports through the host's create-new-file save, and exits with
// code 0 when the answer is Discard.
//
// Usage: node tests/desktop/packaged-smoke.mjs <path to the e2e binary>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const platform = process.platform;
assert.ok(
  platform === "win32" || platform === "linux",
  `this smoke test runs on Windows and Linux, not ${platform}`,
);
const binary = path.resolve(process.argv[2] ?? "");
assert.ok(
  process.argv[2] && existsSync(binary),
  `packaged e2e binary not found: ${process.argv[2] ?? "(no argument)"}`,
);
const expectedOrigin = platform === "win32" ? "http://tauri.localhost" : "tauri://localhost";
const EDITED = "Alpha edited";

const roots = [];
const sessions = [];
let appSession = null;
let sequence = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- process lifecycle -------------------------------------------------------

/** A fresh folder for one launch; deleted at the end only when everything passed. */
async function workspace() {
  const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP || tmpdir(), "tachiko-desktop-smoke-"));
  roots.push(dir);
  const scripts = path.join(dir, "scripts");
  const downloads = path.join(dir, "downloads");
  await mkdir(scripts);
  await mkdir(downloads);
  return { dir, scripts, downloads };
}

function describeExit(exit) {
  if (!exit) return "still running";
  if (exit.error) return `spawn error: ${exit.error}`;
  return `code ${exit.code ?? "null"}/${exit.signal ?? "no signal"}`;
}

async function launch({ closeAnswer, openArgument = false }) {
  const { dir, scripts, downloads } = await workspace();
  const openFixture = path.join(dir, "open-me.csv");
  await writeFile(openFixture, "Item,Amount\nTea,4.5\n");
  const child = spawn(binary, openArgument ? [openFixture] : [], {
    env: {
      ...process.env,
      TACHIKO_SHEET_E2E_DIR: scripts,
      TACHIKO_SHEET_E2E_DOWNLOADS: downloads,
      TACHIKO_SHEET_E2E_OPEN_ANSWER: openFixture,
      TACHIKO_SHEET_E2E_CLOSE_ANSWER: closeAnswer,
      TACHIKO_SHEET_E2E_WINDOW_SIZE: "1000x660",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  const target = { child, dir, scripts, downloads, output: { stdout: "", stderr: "" }, exit: null, exited: null };
  const keep = (key) => (chunk) => {
    target.output[key] = (target.output[key] + chunk.toString()).slice(-8000);
  };
  child.stdout?.on("data", keep("stdout"));
  child.stderr?.on("data", keep("stderr"));
  target.exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      target.exit = { code, signal };
      resolve(target.exit);
    });
    child.once("error", (error) => {
      target.exit = { code: null, signal: null, error: String(error) };
      resolve(target.exit);
    });
  });
  sessions.push(target);
  appSession = target;
  // The window answers only once the webview has loaded the packaged page.
  await evaluateOn(target, "return document.readyState", 90_000);
  return target;
}

async function stop(target) {
  if (!target || target.exit) return;
  target.child.kill();
  if (!(await Promise.race([target.exited, sleep(10_000).then(() => null)]))) {
    target.child.kill("SIGKILL");
    await Promise.race([target.exited, sleep(5_000)]);
  }
}

async function hostLog(target) {
  try {
    return await readFile(path.join(target.scripts, "host.log"), "utf8");
  } catch {
    return "";
  }
}

const relevant = (text) => text.split("\n").filter((line) => line.startsWith("leave dialog") || line.startsWith("saved ") || line.startsWith("save requested")).join("\n");

// ---- script channel ----------------------------------------------------------

async function evaluateOn(target, body, timeout = 120_000) {
  const id = `s${String(++sequence).padStart(5, "0")}`;
  const result = path.join(target.scripts, `${id}.result.json`);
  const partial = path.join(target.scripts, `${id}.partial`);
  await writeFile(partial, `${HELPERS}\n${body}\n`);
  await rename(partial, path.join(target.scripts, `${id}.js`));
  const deadline = Date.now() + timeout;
  while (!existsSync(result)) {
    if (target.exit) {
      throw new Error(
        `the app exited (${describeExit(target.exit)}) before script ${id} answered; host log:\n${(await hostLog(target)).trim()}`,
      );
    }
    if (Date.now() > deadline) {
      const tail = (await hostLog(target)).trim().split("\n").slice(-15).join("\n");
      throw new Error(`script ${id} timed out after ${timeout} ms; host log tail:\n${tail}`);
    }
    await sleep(25);
  }
  const outcome = JSON.parse(await readFile(result, "utf8"));
  if (!outcome.ok) throw new Error(`script ${id} failed: ${outcome.error}\n${body.slice(0, 400)}`);
  return outcome.value;
}

const evaluate = (body, timeout) => evaluateOn(appSession, body, timeout);

// In-page helpers: accessible-name lookup and DOM events like a pointer/keyboard user.
const HELPERS = String.raw`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) {
      const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim()).filter(Boolean).join(" | ");
      throw new Error("timed out waiting for " + label + "; alerts=" + (alerts || "none"));
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
const textbox = (name) => [...document.querySelectorAll("input,textarea")].find((i) => (i.getAttribute("aria-label") || "").trim() === name);
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
const cellAt = (row, column) => grid()?.querySelectorAll("tbody tr.ts-row")[row]?.querySelectorAll("td")[column] ?? null;
`;

// ---- journey steps -----------------------------------------------------------

async function importSmokeCsv() {
  const file = path.join(appSession.dir, "smoke.csv");
  await writeFile(file, "Name,Amount\nAlpha,1\nBeta,2\nGamma,3\n");
  const bytes = (await readFile(file)).toString("base64");
  await evaluate(`
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*=".csv"]'), "import input");
    const bytes = Uint8Array.from(atob(${JSON.stringify(bytes)}), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "smoke.csv", { type: "text/csv" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => dialog("Review import preview"), "import review", 30000);
    const types = () => [...(dialog("Review import preview")?.querySelectorAll(".ts-import-columns select") ?? [])];
    await waitFor(() => types().length === 2, "two column types");
    if (types()[1].value !== "number") {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setValue.call(types()[1], "number");
      types()[1].dispatchEvent(new Event("change", { bubbles: true }));
    }
    await waitFor(() => types()[1].value === "number", "Amount as Number");
    click(await waitFor(() => button("Import file", dialog("Review import preview")), "Import file"));
    await waitFor(() => ready() && grid()?.querySelector("tbody tr.ts-row"), "imported grid", 120000);
    return true;
  `, 180_000);
}

async function editCell(row, column, value) {
  await evaluate(`
    dblclick(await waitFor(() => cellAt(${row}, ${column}), "cell R${row + 1}C${column + 1}"));
    const input = await waitFor(() => textbox("Edit cell"), "cell editor");
    fill(input, ${JSON.stringify(value)});
    return true;
  `);
  await evaluate(`
    press(await waitFor(() => textbox("Edit cell"), "cell editor"), "Enter");
    await waitFor(() => !textbox("Edit cell") && current() && cellAt(${row}, ${column})?.textContent === ${JSON.stringify(value)}, "published edit");
    return true;
  `);
}

/** Close or quit exactly as the window button / menu Quit does. */
async function requestLeave(command) {
  await evaluate(`setTimeout(() => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}), 100); return true;`);
}

async function refusedWhileUnsaved(command, label) {
  const before = (await hostLog(appSession)).split("leave dialog").length - 1;
  await requestLeave(command);
  await sleep(5_000);
  assert.equal(appSession.exit, null, `${label}: the process stays running while the answer is Cancel`);
  const page = await evaluate(`
    await waitFor(() => document.body.inert === false, "page usable again");
    return { ready: document.readyState, value: cellAt(0, 0)?.textContent ?? null };
  `, 15_000);
  assert.equal(page.ready, "complete", `${label}: the window still answers`);
  assert.equal(page.value, EDITED, `${label}: the unsaved edit is still in the grid`);
  let after = before;
  for (let attempt = 0; attempt < 100 && after === before; attempt++) {
    after = (await hostLog(appSession)).split("leave dialog").length - 1;
    if (after === before) await sleep(100);
  }
  assert.ok(after > before, `${label}: the host asked about unsaved work; host log:\n${relevant(await hostLog(appSession))}`);
}

async function prepareAndDownloadCsv() {
  await evaluate(`
    click(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((t) => nameOf(t) === "Import & export"), "Import & export tab"));
    click(await waitFor(() => button("Prepare CSV"), "Prepare CSV"));
    const consent = await waitFor(() => dialog("Confirm download"), "download consent", 120000);
    click(await waitFor(() => button("Download", consent), "Download"));
    await waitFor(() => !dialog("Confirm download"), "consent closed");
    return true;
  `, 180_000);
}

/** The export is written by the host as a new file; wait until it holds the edit. */
async function waitForExport() {
  for (let attempt = 0; attempt < 600; attempt++) {
    for (const name of await readdir(appSession.downloads)) {
      if (name.startsWith(".")) continue;
      const content = await readFile(path.join(appSession.downloads, name), "utf8").catch(() => "");
      if (content.includes(EDITED) && content.includes("Beta")) return { name, content };
    }
    await sleep(100);
  }
  throw new Error(
    `no export with the edited value appeared in ${appSession.downloads}: ${JSON.stringify(await readdir(appSession.downloads))}; host log:\n${relevant(await hostLog(appSession))}`,
  );
}

// ---- run ---------------------------------------------------------------------

const checks = [];
const pass = (name) => checks.push(name);

async function main() {
  const first = await launch({ closeAnswer: "cancel" });

  // 1. The packaged window loads from the app's own origin and shows Home.
  const home = await evaluate(`
    await waitFor(() => document.readyState === "complete", "document complete");
    await waitFor(() => document.querySelector('.ts-app[data-view="home"]'), "Home");
    await waitFor(() => document.body.innerText.includes("Choose file…"), "Choose file…");
    return { ready: document.readyState, origin: location.origin };
  `);
  assert.equal(home.ready, "complete", "document.readyState is complete");
  pass("the packaged window loads with document.readyState complete");
  assert.equal(home.origin, expectedOrigin, `the packaged page is served from ${expectedOrigin}, not ${home.origin}`);
  pass(`location.origin is ${expectedOrigin}`);
  pass("Home offers “Choose file…”");

  // 1a. The File and Edit menus have every command, and they reach the page.
  await evaluate(`
    await waitFor(() => button("New table"), "New table enabled");
    const choose = (id) => window.__TAURI_INTERNALS__.invoke("e2e_menu_command", { id });
    await choose("new-table");
    const form = await waitFor(() => dialog("New table"), "File > New Table dialog");
    click(button("Cancel", form));
    await waitFor(() => !dialog("New table"), "New table dialog closed");
    await choose("open");
    const review = await waitFor(() => dialog("Review import preview"), "File > Open import review", 30000);
    click(button("Cancel", review));
    await waitFor(() => !dialog("Review import preview"), "import review closed");
    // Home ignores the rest; the host refuses a command its menu doesn't have.
    for (const id of ["save", "save-copy", "print", "undo", "redo"]) await choose(id);
    return true;
  `);
  pass("the menu has every File and Edit command, and File > New Table opens its dialog");

  // 1b. The notices the footer links to ship with the page.
  const notices = await evaluate(`
    const response = await fetch("/THIRD_PARTY_LICENSES.md");
    const text = await response.text();
    return { ok: response.ok, status: response.status, tauri: text.includes("tauri"), react: text.includes("react") };
  `);
  assert.ok(notices.ok, `the packaged page serves /THIRD_PARTY_LICENSES.md (status ${notices.status})`);
  assert.ok(notices.tauri && notices.react, `the notices cover the desktop crates and the page's React packages: ${JSON.stringify(notices)}`);
  pass("the packaged page serves complete third-party notices");

  // 2. A real import runs through the native runtime.
  await importSmokeCsv();
  const rows = await evaluate(`
    await waitFor(() => ready() && grid()?.querySelectorAll("tbody tr.ts-row").length === 3, "three imported rows");
    return [...grid().querySelectorAll("tbody tr.ts-row")].map((row) => [...row.querySelectorAll("td")].slice(0, 2).map((cell) => cell.textContent.trim()));
  `);
  assert.deepEqual(rows, [["Alpha", "1"], ["Beta", "2"], ["Gamma", "3"]], `the imported grid shows the CSV rows: ${JSON.stringify(rows)}`);
  pass("a CSV imports through the native runtime and shows its three rows");

  // 3. An edit is published and visible.
  await editCell(0, 0, EDITED);
  pass("an edited cell shows the new value");

  // 4./5. Close and Quit both ask; Cancel keeps the app, the window and the edit.
  await refusedWhileUnsaved("e2e_request_close", "Close");
  pass("Close asks about unsaved work, and Cancel keeps the app, window and edit");
  await refusedWhileUnsaved("e2e_request_quit", "Quit");
  pass("Quit asks about unsaved work, and Cancel keeps the app, window and edit");

  // 6. The host's real export path writes the edited value.
  await prepareAndDownloadCsv();
  const exported = await waitForExport();
  pass(`the CSV export ${exported.name} contains the edited value`);

  // 7. The same name is refused and the existing file is untouched.
  const sentinel = path.join(appSession.downloads, exported.name);
  const kept = "sentinel: not an export\n";
  await writeFile(sentinel, kept);
  const before = new Set(await readdir(appSession.downloads));
  await prepareAndDownloadCsv();
  await evaluate(`await waitFor(() => document.body.innerText.includes("already exists"), "existing-name refusal", 30000); return true;`);
  assert.equal(await readFile(sentinel, "utf8"), kept, "the existing file is unchanged");
  const added = (await readdir(appSession.downloads)).filter((name) => !name.startsWith(".") && !before.has(name));
  assert.deepEqual(added, [], `no new export was written when the name already exists: ${JSON.stringify(added)}`);
  pass("exporting an existing name is refused and leaves the file unchanged");

  // 8. Discard closes the window and exits the app with code 0.
  await stop(first);
  await launch({ closeAnswer: "discard" });
  await importSmokeCsv();
  await editCell(0, 0, "Discard me");
  await requestLeave("e2e_request_close");
  const outcome = await Promise.race([appSession.exited, sleep(30_000).then(() => null)]);
  assert.ok(outcome, "the app exits within 30 s when the answer is Discard");
  assert.equal(outcome.code, 0, `the app exits with code 0 (got ${describeExit(outcome)})`);
  pass("Discard closes the window and the app process exits with code 0");

  // 9. A file named on the command line, as a double-click starts the app, opens once Home is ready.
  const opened = await launch({ closeAnswer: "discard", openArgument: true });
  await evaluate(`await waitFor(() => dialog("Review import preview"), "import review of the launch argument", 60000); return true;`);
  pass("a .csv named at launch reaches the import review");
  await stop(opened);
}

async function diagnostics(error) {
  console.error(`FAIL: ${error.message}`);
  for (const target of sessions) {
    console.error(`--- app ${target.dir} (${describeExit(target.exit)})`);
    if (target.output.stdout.trim()) console.error(`stdout:\n${target.output.stdout.trim()}`);
    if (target.output.stderr.trim()) console.error(`stderr:\n${target.output.stderr.trim()}`);
    const log = (await hostLog(target)).trim();
    console.error(`host.log:\n${log || "(empty)"}`);
    if (!target.exit) {
      try {
        const alerts = await evaluateOn(target, `return [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim()).filter(Boolean);`, 5_000);
        console.error(`page alerts: ${JSON.stringify(alerts)}`);
      } catch (probe) {
        console.error(`page alerts: unavailable (${String(probe.message).split("\n")[0]})`);
      }
    }
  }
  console.error(`smoke folders kept for inspection: ${roots.join(", ")}`);
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  await diagnostics(error);
} finally {
  for (const target of sessions) await stop(target);
}

if (failed) {
  process.exitCode = 1;
} else {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ status: "PASS", platform, checks }));
}

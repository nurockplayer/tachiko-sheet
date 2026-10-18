import { fillDraftCell, draftActions } from "../product/grid-row-entry-driver.mjs";
// Host regression: the production desktop composition, real IndexedDB, and
// native Rust runtime. Only Tauri IPC is bridged to the existing frame harness.
// This complements (and does not replace) the packaged WebKit lifecycle.
// Run after build:desktop and building frame_harness; FRAME_HARNESS is required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { installDistRoutes, LOCAL_ORIGIN } from "../product/dist-routes.mjs";
import { waitForColdHome } from "../product/home-entry.mjs";

test("desktop New table: local copy, native portable reopen, bound Save and Close → Save", { timeout: 120_000 }, async () => {
  assert.ok(process.env.FRAME_HARNESS, "FRAME_HARNESS must name the built native harness");
  const work = await mkdtemp(path.join(tmpdir(), "sheet-desktop-local-save-"));
  const kinds = [];
  let context, child, browserPid;
  const alive = pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  async function stop() {
    if (context) {
      await context.close(); context = undefined;
      const deadline = Date.now() + 5_000;
      while (alive(browserPid) && Date.now() < deadline) await delay(50);
      assert.equal(alive(browserPid), false, "the full browser process exited before restart");
    }
    if (child) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.stdin.end();
        await exited;
      }
      child = undefined;
    }
  }
  async function start() {
    assert.equal(context, undefined);
    assert.equal(child, undefined, "native resident state cannot survive a restart");
    child = spawn(process.env.FRAME_HARNESS, [], { stdio: ["pipe", "pipe", "inherit"] });
    let buffered = Buffer.alloc(0);
    const waiting = [];
    child.stdout.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 5 && buffered.length >= 5 + buffered.readUInt32LE(1)) {
        const size = buffered.readUInt32LE(1);
        const reply = { status: buffered[0], body: Buffer.from(buffered.subarray(5, 5 + size)) };
        buffered = buffered.subarray(5 + size);
        const pending = waiting.shift();
        if (reply.status) pending.reject(new Error(reply.body.toString("utf8")));
        else pending.resolve(reply.body);
      }
    });
    const fail = error => { for (const pending of waiting.splice(0)) pending.reject(error); };
    child.on("error", fail);
    child.on("exit", () => fail(new Error("native harness exited")));
    const call = (op, bytes) => new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      const head = Buffer.alloc(5);
      head[0] = op; head.writeUInt32LE(bytes.length, 1);
      child.stdin.write(head); child.stdin.write(bytes);
    });
    context = await chromium.launchPersistentContext(path.join(work, "profile"), {
      headless: true,
      ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
    });
    const cdp = await context.browser().newBrowserCDPSession();
    browserPid = (await cdp.send("SystemInfo.getProcessInfo")).processInfo.find(entry => entry.type === "browser")?.id;
    await cdp.detach();
    assert.ok(browserPid > 0, "the browser exposes its process identity");
    await installDistRoutes(context, "dist-desktop");
    await context.exposeBinding("nativeInvoke", async (_, command, bytes) => {
      if (command === "page_identity") return 1;
      if (command === "runtime_attach") return Number((await call(0, Buffer.alloc(0))).readBigUInt64LE());
      assert.equal(command, "runtime_dispatch", "local persistence adds no native file command");
      const frame = Buffer.from(bytes);
      kinds.push(JSON.parse(frame.subarray(4, 4 + frame.readUInt32LE()).toString("utf8")).kind);
      return [...await call(1, frame)];
    });
    await context.addInitScript(() => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => {
          const result = await window.nativeInvoke(command, args instanceof Uint8Array ? [...args] : null);
          return command === "runtime_dispatch" ? new Uint8Array(result).buffer : result;
        },
      };
    });
    const page = context.pages()[0];
    page.setDefaultTimeout(10_000);
    await page.goto(LOCAL_ORIGIN);
    await waitForColdHome(page);
    assert.equal(await page.getByTestId("open-work-file").isDisabled(), true);
    return page;
  }
  const snapshot = page => page.locator('table[aria-label="Table"]').evaluate(table => ({
    name: document.querySelector("#ts-active-table option:checked").textContent,
    columns: [...table.querySelectorAll(".ts-col-head")].map(el => el.textContent),
    cells: [...table.querySelectorAll("tbody tr.ts-row td")].map(el => ({ id: el.dataset.testid, value: el.textContent.trim() })),
  }));
  async function edit(page, value) {
    await page.locator('tbody tr.ts-row td').nth(2).dblclick();
    const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
    await input.fill(value); await input.press("Enter"); await ready(page);
  }
  async function reopen(page, name = "Q4") {
    const before = kinds.length;
    await page.getByRole("button", { name: `Open saved ${name}`, exact: true }).click(); await ready(page);
    const opened = kinds.slice(before);
    assert.ok(opened.includes("verify_portable_ro"));
    assert.ok(opened.includes("open_portable_ro"));
    assert.ok(opened.indexOf("verify_portable_ro") < opened.indexOf("open_portable_ro"));
  }
  try {
    let page = await start();
    await page.getByRole("button", { name: "New table", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New table", exact: true });
    await dialog.getByLabel("Table name", { exact: true }).fill("My Expenses");
    for (const [index, name] of ["Item Name", "項目", "Amount"].entries()) {
      if (index) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
      await dialog.getByLabel(`Column ${index + 1} name`, { exact: true }).fill(name);
    }
    await dialog.getByLabel("Column 3 type", { exact: true }).selectOption("number");
    await dialog.getByRole("button", { name: "Create table", exact: true }).click(); await ready(page);
    for (const [name, value] of [["Item Name (Text)", "Tea"], ["項目 (Text)", "飲食"], ["Amount (Number)", "4.5"]]) {
      await fillDraftCell(page, page.getByLabel(`New row ${name}`, { exact: true }), value);
    }
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready(page);
    const initial = await snapshot(page);
    assert.equal(initial.name, "My Expenses");
    assert.deepEqual(initial.columns, ["Item Name", "項目", "Amount"]);
    assert.deepEqual(initial.cells.map(cell => cell.value), ["Tea", "飲食", "4.5"]);
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Download work file (.ro)", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Save a copy", exact: true }).click();
    const copy = page.getByRole("dialog", { name: "Save a copy", exact: true });
    await copy.getByLabel("Copy name", { exact: true }).fill("Q4");
    await copy.getByRole("button", { name: "Create copy", exact: true }).click();
    await copy.waitFor({ state: "detached" });
    assert.ok(kinds.includes("export_portable_ro"));
    await stop(); page = await start(); await reopen(page);
    assert.deepEqual(await snapshot(page), initial);

    await edit(page, "7");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
    const updated = await snapshot(page);
    assert.deepEqual(updated.cells.map(cell => cell.value), ["Tea", "飲食", "7"]);
    await stop(); page = await start(); await reopen(page);
    assert.deepEqual(await snapshot(page), updated);
    await page.getByRole("tab", { name: "Import & export", exact: true }).click();
    assert.doesNotMatch(await page.locator("body").innerText(), /Download the work file to keep these changes/);
    await page.getByRole("tab", { name: "Table", exact: true }).click();

    await edit(page, "9");
    const closed = await snapshot(page);
    assert.deepEqual(closed.cells.map(cell => cell.value), ["Tea", "飲食", "9"]);
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Save", exact: true }).click();
    await waitForColdHome(page); await reopen(page);
    assert.deepEqual(await snapshot(page), closed);

    // The unbound Close → Save a copy path must work for a new table too.
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await waitForColdHome(page);
    await page.getByRole("button", { name: "New table", exact: true }).click();
    const next = page.getByRole("dialog", { name: "New table", exact: true });
    await next.getByLabel("Table name", { exact: true }).fill("Close saved new");
    await next.getByRole("button", { name: "Create table", exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Save a copy…", exact: true }).click();
    const closeCopy = page.getByRole("dialog", { name: "Save a copy", exact: true });
    await closeCopy.getByLabel("Copy name", { exact: true }).fill("Close saved new");
    await closeCopy.getByRole("button", { name: "Create copy", exact: true }).click();
    await waitForColdHome(page); await reopen(page, "Close saved new");
    assert.deepEqual(await snapshot(page), { name: "Close saved new", columns: ["A"], cells: [] });
    console.log(JSON.stringify({ nativePortableReopens: kinds.filter(kind => kind === "open_portable_ro").length, status: "PASS" }));
  } finally { await stop(); await rm(work, { recursive: true, force: true }); }
});

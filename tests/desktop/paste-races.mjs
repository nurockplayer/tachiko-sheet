// Hook-driven G6 checks shared by the packaged desktop drivers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectWindowedRows } from "../product/windowed-table-collector.mjs";

export async function pasteRaces({ evaluate, work, windowsPid, extraChecks = [] }) {
  const failures = [];
  const check = async (name, run) => {
    try { await run(); console.log(`PASS: ${process.platform} ${name}`); }
    catch (error) { console.error(`FAIL: ${process.platform} ${name}: ${error.stack}`); failures.push(error); }
  };
  const fixture = await mkdtemp(path.join(work, "paste-fixture-"));
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-I",
    fileURLToPath(new URL("../../acceptance/capacity-8406/oracle.py", import.meta.url)), "generate", fixture], { stdio: "inherit" });
  const bytes = (await readFile(path.join(fixture, "source-8406.csv"))).toString("base64");
  await evaluate(`
    const input = await waitFor(() => document.querySelector('input[type="file"][accept*=".csv"]'), "paste fixture import");
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))], "paste-8406.csv"));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const review = await waitFor(() => dialog("Review import preview"), "paste import review");
    for (const select of review.querySelectorAll(".ts-import-columns select")) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "text");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    click(await waitFor(() => button("Import file", review), "Import file"));
    await waitFor(() => current() && grid()?.querySelector("tbody tr.ts-row"), "paste fixture ready", 240000);
    return true;
  `, 300_000);
  const page = String.raw`
    const row = index => grid().querySelector('tbody tr.ts-row[aria-rowindex="' + (index + 2) + '"]');
    const cell = (index, column = 0) => row(index)?.querySelectorAll("td")[column];
    const scroller = () => document.querySelector(".ts-grid-scroll");
    const inView = index => {
      const box = cell(index)?.getBoundingClientRect(), port = scroller().getBoundingClientRect();
      const top = port.top + scroller().clientTop;
      const header = grid().querySelector("thead").getBoundingClientRect().height;
      return box && box.top >= top + header - 1 && box.bottom <= top + scroller().clientHeight + 1;
    };
    async function show(index) {
      const pitch = grid().querySelector("tbody tr.ts-row").offsetHeight;
      scroller().scrollTop = index * pitch - scroller().clientHeight / 2;
      scroller().dispatchEvent(new Event("scroll"));
      await waitFor(() => inView(index), "paste target in view");
    }
    const valuesKey = (el) => el.dispatchEvent(new KeyboardEvent("keydown", {
      key: "V", ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform),
      shiftKey: true, bubbles: true, cancelable: true,
    }));
  `;
  const snapshot = () => evaluate(`return await (${collectWindowedRows.toString()})({ rowCount: 8406, columnCount: 3, draftRows: 1 });`, 300_000);
  const baseline = await snapshot();
  const expected = structuredClone(baseline);
  const patch = (index, value) => { expected[index][1][0].text = value; };

  if (windowsPid) await check("AltGr Right-Alt+V does not open Paste Special", async () => {
    await evaluate(`${page}
      await show(0); click(cell(0));
      window.__g6Keys = [];
      window.__g6KeyListener = event => window.__g6Keys.push({ key: event.key, code: event.code,
        trusted: event.isTrusted, ctrl: event.ctrlKey, alt: event.altKey, altGraph: event.getModifierState("AltGraph") });
      document.addEventListener("keydown", window.__g6KeyListener, true);
      return true;
    `);
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        fileURLToPath(new URL("../../scripts/installer-smoke/altgr.ps1", import.meta.url)), "-AppPid", String(windowsPid)], { stdio: "inherit", timeout: 30_000 });
      const result = await evaluate(`
        await waitFor(() => window.__g6Keys.some(e => e.code === "KeyV" && e.trusted), "native AltGr V reached WebView", 10000);
        await sleep(250);
        return { keys: window.__g6Keys, menu: Boolean(document.querySelector('[role="menu"][aria-label="Cell actions"]')) };
      `);
      console.log(`AltGr native evidence: ${JSON.stringify(result)}`);
      assert.ok(result.keys.some(e => e.code === "AltRight" && e.trusted), "native Right Alt reached WebView");
      assert.ok(result.keys.some(e => e.code === "KeyV" && e.trusted && e.ctrl && e.alt), "AltGr produced Ctrl+Alt+V");
      assert.equal(result.menu, false, "AltGr must not open Paste Special");
    } finally {
      await evaluate(`document.removeEventListener("keydown", window.__g6KeyListener, true);
        const menu = document.querySelector('[role="menu"]'); if (menu) press(menu, "Escape"); return true;`);
    }
  });
  for (const [name, run] of extraChecks) await check(name, run);

  await check("paste into an off-screen target changes only that cell and reveals it", async () => {
    await evaluate(`${page}
      await show(8000); click(cell(8000));
      window.__g6PasteTarget = cell(8000);
      scroller().scrollTop = 0; scroller().dispatchEvent(new Event("scroll"));
      await waitFor(() => !inView(8000), "selected target scrolled out of view");
      await sleep(100);
      if (inView(8000)) throw new Error("target scrolled back before paste");
      const data = new DataTransfer(); data.setData("text/plain", "off-screen-paste");
      window.__g6PasteTarget.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      await waitFor(() => current() && cell(8000)?.textContent === "off-screen-paste" && inView(8000), "pasted target revealed");
      return true;
    `);
    patch(8000, "off-screen-paste");
    assert.deepEqual(await snapshot(), expected, "all 25,218 values and stable targets; exactly one cell changed");
  });

  await check("slow paste retains its starting target when the active cell moves", async () => {
    const before = await snapshot();
    await evaluate(`${page}
      await show(10); click(cell(10));
      window.__g6ClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        readText: () => new Promise(resolve => {
          window.__g6ReadStarted = true;
          window.__g6ReadDone = false;
          setTimeout(() => { window.__g6ReadDone = true; resolve("slow-paste"); }, 1500);
        }),
      } });
      window.__g6ReadStarted = false;
      valuesKey(cell(10));
      await waitFor(() => window.__g6ReadStarted, "delayed clipboard read started");
      click(cell(11));
      if (window.__g6ReadDone) throw new Error("clipboard resolved before active-cell move");
      await waitFor(() => window.__g6ReadDone, "delayed clipboard resolved");
      await waitFor(() => current() && (cell(10)?.textContent === "slow-paste" || document.body.innerText.includes("selection changed while reading")), "paste result or refusal");
      return true;
    `);
    try {
      const after = await snapshot();
      before[10][1][0].text = "slow-paste";
      assert.deepEqual(after, before, "only the target selected when the clipboard read started changes");
    } finally {
      await evaluate(`if (window.__g6ClipboardDescriptor) Object.defineProperty(navigator, "clipboard", window.__g6ClipboardDescriptor);
        else delete navigator.clipboard; return true;`);
    }
  });
  if (failures.length) throw new AggregateError(failures, "G6 paste/native input checks failed");
}

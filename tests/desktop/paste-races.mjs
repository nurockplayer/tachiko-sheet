// Hook-driven G6 checks shared by the packaged desktop drivers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectWindowedRows } from "../product/windowed-table-collector.mjs";

export async function pasteRaces({ evaluate, work, extraChecks = [], receipt = async () => {} }) {
  const failures = [];
  const check = async (name, run) => {
    const start = new Date().toISOString();
    let outcome = "PASS";
    try { await run(); console.log(`PASS: ${process.platform} ${name}`); }
    catch (error) { outcome = "FAIL"; console.error(`FAIL: ${process.platform} ${name}: ${error.stack}`); failures.push(error); }
    finally { await receipt({ name, start, end: new Date().toISOString(), outcome }); }
  };
  const fixture = path.join(await mkdtemp(path.join(work, "paste-fixture-")), "capacity");
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-I", "-X", "utf8",
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
  const cancelEditor = () => evaluate(`
    const editor = textbox("Edit cell");
    if (editor) {
      press(editor, "Escape");
      await waitFor(() => !textbox("Edit cell") && grid()?.contains(document.activeElement), "cell editor cancelled and grid focused");
    }
    return true;
  `);
  const snapshot = () => evaluate(`return await (${collectWindowedRows.toString()})({ rowCount: 8406, columnCount: 3, draftRows: 1 });`, 300_000);

  for (const [name, run] of extraChecks) await check(name, run);

  await check("paste into an off-screen target changes only that cell and reveals it", async () => {
    // Compare with the workbook after the macOS extra checks and editor cleanup.
    await cancelEditor();
    const expected = await snapshot();
    await evaluate(`${page}
      await show(8000); click(cell(8000));
      await waitFor(() => current() && document.activeElement === cell(8000) &&
        cell(8000)?.getAttribute("aria-selected") === "true", "off-screen target selection published");
      return true;
    `);
    // Let the selection/focus render finish before scrolling it away; otherwise
    // the click's pending focus handoff can scroll it back during setup.
    await evaluate(`${page}
      window.__g6PasteTarget = cell(8000);
      scroller().scrollTop = 0; scroller().dispatchEvent(new Event("scroll"));
      await waitFor(() => !inView(8000), "selected target scrolled out of view");
      await sleep(100);
      if (inView(8000)) throw new Error("target scrolled back before paste");
      const data = new DataTransfer(); data.setData("text/plain", "off-screen-paste");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      window.__g6PasteTarget.dispatchEvent(event);
      try {
        await waitFor(() => current() && cell(8000)?.textContent === "off-screen-paste" && inView(8000), "pasted target revealed");
      } catch (error) {
        throw new Error(String(error) + "; off-screen evidence: " + JSON.stringify({
          sentTarget: window.__g6PasteTarget.dataset.testid,
          sentConnected: window.__g6PasteTarget.isConnected,
          sameLiveNode: window.__g6PasteTarget === cell(8000),
          liveTarget: cell(8000)?.dataset.testid, liveText: cell(8000)?.textContent,
          defaultPrevented: event.defaultPrevented, clipboardTypes: Array.from(event.clipboardData?.types ?? []),
          current: current(), inView: Boolean(inView(8000)), scrollTop: scroller().scrollTop,
          feedback: [...document.querySelectorAll(".ts-clipboard-status")].map(el => el.innerText),
        }));
      }
      return true;
    `);
    expected[8000][1][0].text = "off-screen-paste";
    assert.deepEqual(await snapshot(), expected, "all 25,218 values and stable targets; exactly one cell changed");
  });

  await check("slow paste is refused with every cell unchanged when the active cell moves", async () => {
    await cancelEditor();
    const before = await snapshot();
    try {
    const evidence = await evaluate(`${page}
      await show(10); click(cell(10));
      window.__g6ClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      window.__g6ClipboardSaved = true;
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
      await waitFor(() => document.activeElement === cell(11) &&
        cell(11)?.getAttribute("aria-selected") === "true", "active-cell move published");
      if (window.__g6ReadDone) throw new Error("clipboard resolved before active-cell move");
      await waitFor(() => window.__g6ReadDone, "delayed clipboard resolved");
      const refusal = () => [...document.querySelectorAll(".ts-clipboard-status")].find(el =>
        el.innerText.includes("The table or selection changed while reading the clipboard. Nothing was pasted.") &&
        el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible");
      await waitFor(() => current() && refusal(), "visible selection-change paste refusal");
      return {
        readStarted: window.__g6ReadStarted, readDone: window.__g6ReadDone,
        refusal: Boolean(refusal()),
        startingTarget: cell(10)?.dataset.testid, startingText: cell(10)?.textContent,
        movedTarget: cell(11)?.dataset.testid, movedText: cell(11)?.textContent,
      };
    `);
      const after = await snapshot();
      console.log("Slow paste native evidence: " + JSON.stringify({ ...evidence,
        allCellsUnchanged: JSON.stringify(after) === JSON.stringify(before) }));
      assert.equal(evidence.refusal, true, "the existing selection-change refusal is visible");
      assert.deepEqual(after, before, "all 25,218 values and stable targets, including both active cells, remain unchanged");
    } finally {
      await evaluate(`if (window.__g6ClipboardSaved) {
        if (window.__g6ClipboardDescriptor) Object.defineProperty(navigator, "clipboard", window.__g6ClipboardDescriptor);
        else delete navigator.clipboard;
        delete window.__g6ClipboardSaved;
      } return true;`);
    }
  });
  if (failures.length) throw new AggregateError(failures, "G6 paste/native input checks failed");
}

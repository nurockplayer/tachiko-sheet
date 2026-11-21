// Hook-driven G6 checks shared by the packaged desktop drivers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectWindowedRows } from "../product/windowed-table-collector.mjs";

// The only clipboard writer is an OS utility, outside the app's WebView.
export function writeOsClipboard(text) {
  if (process.platform === "darwin") {
    execFileSync("pbcopy", [], { input: text });
  } else if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$text = [Console]::In.ReadToEnd(); Set-Clipboard -Value $text"], { input: text });
  } else {
    execFileSync("xclip", ["-selection", "clipboard"], { input: text, stdio: ["pipe", "ignore", "ignore"] });
  }
}

export const nativePaste = evaluate => evaluate(`
  await window.__TAURI_INTERNALS__.invoke("e2e_menu_command", { id: "paste" });
  return true;
`);

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

  await check("real OS clipboard native-menu Paste changes exactly the target cells", async () => {
    await cancelEditor();
    const expected = await snapshot();
    const before = structuredClone(expected);
    const pasted = [["native-471-A", "native-471-B"], ["native-471-C", "native-471-D"]];
    writeOsClipboard(pasted.map(row => row.join("\t")).join("\n"));
    await evaluate(`${page}
      await show(10); click(cell(10));
      await waitFor(() => current() && document.activeElement === cell(10) &&
        cell(10)?.getAttribute("aria-selected") === "true", "native paste target selected");
      return true;
    `);
    await nativePaste(evaluate);
    await evaluate(`${page}
      await waitFor(() => current() && cell(10)?.textContent === "native-471-A" &&
        cell(11, 1)?.textContent === "native-471-D", "real clipboard native Paste applied");
      return true;
    `);
    pasted.forEach((row, r) => row.forEach((text, c) => { expected[10 + r][1][c].text = text; }));
    assert.deepEqual(await snapshot(), expected,
      "all 25,218 cell values and stable targets; exactly the four TSV cells changed");
    await evaluate(`${page}
      await show(10);
      await window.__TAURI_INTERNALS__.invoke("e2e_menu_command", { id: "undo" });
      await waitFor(() => current() && cell(10)?.textContent === ${JSON.stringify(before[10][1][0].text)}, "native paste undone");
      return true;
    `);
    assert.deepEqual(await snapshot(), before, "Undo restores every cell and stable target");
  });
  if (failures.length) throw new AggregateError(failures, "native clipboard Paste checks failed");
  return { status: "PASS", changedCells: 4, untouchedCellsIdentical: true };
}

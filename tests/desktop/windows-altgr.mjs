// Native input only: the e2e channel prepares the UI and reads trusted receipts.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { writeOsClipboard } from "./paste-races.mjs";

const pasteSpecialDetector = `() => [...document.querySelectorAll('[role="menu"][aria-label="Cell actions"]')].some(menu => {
  const items = [...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim());
  return items.length === 2 && items[0] === "Paste" && items[1] === "Paste values";
})`;

// A paste of this value anywhere in the grid would be unmistakable.
const clipboardSeed = "AltGr-553 must not paste this";
const readOsClipboard = () => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
  { encoding: "utf8" }).replace(/\r?\n$/, "");

export async function windowsAltGr({ evaluate, appPid }) {
  writeOsClipboard(clipboardSeed);
  assert.equal(readOsClipboard(), clipboardSeed, "OS clipboard holds the AltGr paste seed");
  const control = await evaluate(`
    const pasteSpecialOpen = ${pasteSpecialDetector};
    if (pasteSpecialOpen()) throw new Error("Paste Special already open before control");
    const cell = await waitFor(() => cellAt(0, 0), "Paste Special control cell");
    click(cell);
    cell.dispatchEvent(new KeyboardEvent("keydown", {
      key: "v", code: "KeyV", ctrlKey: true, altKey: true, bubbles: true, cancelable: true
    }));
    await waitFor(pasteSpecialOpen, "Ctrl+Alt+V opens the real Paste Special menu", 5000);
    const open = pasteSpecialOpen();
    press(document.activeElement, "Escape");
    await waitFor(() => !pasteSpecialOpen(), "Paste Special control dismissed", 5000);
    return open;
  `);
  assert.equal(control, true, "the AltGr closed-menu check must reject the Ctrl+Alt+V control");
  assert.throws(() => assert.equal(control, false), assert.AssertionError);
  console.log("PASS: Paste Special detector rejects open Ctrl+Alt+V control (Cell actions: Paste, Paste values)");
  const helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
    fileURLToPath(new URL("../../scripts/installer-smoke/altgr.ps1", import.meta.url)),
    "-AppPid", String(appPid)], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true, timeout: 60_000 });
  const exited = new Promise(resolve => {
    helper.once("error", error => resolve({ error }));
    helper.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const output = createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
  async function waitForHelper(marker) {
    for (;;) {
      const { value, done } = await output.next();
      if (done) throw new Error(`AltGr NOT DELIVERED: helper exited before ${marker}: ${JSON.stringify(await exited)}`);
      console.log(value);
      if (value.includes(marker)) return;
    }
  }
  try {
  await waitForHelper("AltGr native input ready");
  for (const key of ["V", "Q"]) {
    await evaluate(`
      const pasteSpecialOpen = ${pasteSpecialDetector};
      if (pasteSpecialOpen()) throw new Error("Paste Special already open before AltGr");
      const cell = await waitFor(() => cellAt(0, 0), "AltGr target cell");
      ${key === "Q" ? `dblclick(cell);
      const editor = await waitFor(() => textbox("Edit cell"), "AltGr editor");
      fill(editor, "");` : "click(cell);"}
      window.__altgrReceipt = [];
      window.__altgrListener = event => window.__altgrReceipt.push(event.type === "paste" ? { type: event.type, trusted: event.isTrusted } : {
        type: event.type, code: event.code, key: event.key,
        trusted: event.isTrusted, altGraph: event.getModifierState("AltGraph")
      });
      for (const type of ["keydown", "keyup", "paste"]) window.addEventListener(type, window.__altgrListener, true);
      // Every paste route reads the clipboard: the native paste event, or the app's own read for menu/keyboard paste.
      window.__altgrClipboardReads = 0;
      window.__altgrReadText = Object.getOwnPropertyDescriptor(navigator.clipboard, "readText");
      const readText = navigator.clipboard.readText.bind(navigator.clipboard);
      navigator.clipboard.readText = () => { window.__altgrClipboardReads++; return readText(); };
      window.__altgrCellBefore = cellAt(0, 0).textContent;
      return true;
    `);
    try {
      helper.stdin.write(`${key}\n`);
      await waitForHelper(`Right-Alt+${key} via SendInput (4/4)`);
      const receipt = await evaluate(`
        const pasteSpecialOpen = ${pasteSpecialDetector};
        await waitFor(() => window.__altgrReceipt.some(e => e.type === "keyup" && e.code === "Key${key}" && e.trusted),
          "AltGr+${key} NOT DELIVERED: missing trusted app key receipt", 5000);
        // A paste commits asynchronously; give one time to land before reading the grid.
        await sleep(${key === "V" ? 1500 : 300});
        return { events: window.__altgrReceipt, pasteSpecial: pasteSpecialOpen(),
          value: textbox("Edit cell")?.value ?? null, clipboardReads: window.__altgrClipboardReads,
          cellBefore: window.__altgrCellBefore, cellAfter: cellAt(0, 0)?.textContent ?? null,
          seedInGrid: (grid()?.textContent ?? "").includes(${JSON.stringify(clipboardSeed)}) };
      `);
      assert.ok(receipt.events.some(e => e.type === "keydown" && e.code === "AltRight" && e.trusted),
        `AltGr+${key} NOT DELIVERED: missing trusted Right Alt; ${JSON.stringify(receipt)}`);
      assert.ok(receipt.events.some(e => e.type === "keydown" && e.code === `Key${key}` && e.trusted && e.altGraph),
        `AltGr+${key} NOT DELIVERED: missing trusted German AltGraph chord; ${JSON.stringify(receipt)}`);
      console.log(`AltGr+${key} DELIVERED: ${JSON.stringify(receipt.events)}`);
      assert.equal(receipt.pasteSpecial, false, `AltGr+${key} must leave Paste Special closed`);
      assert.deepEqual(receipt.events.filter(e => e.type === "paste"), [], `AltGr+${key} must not fire a paste event; ${JSON.stringify(receipt)}`);
      assert.equal(receipt.clipboardReads, 0, `AltGr+${key} must not read the clipboard to paste; ${JSON.stringify(receipt)}`);
      assert.equal(receipt.seedInGrid, false, `AltGr+${key} pasted the clipboard into the grid; ${JSON.stringify(receipt)}`);
      if (key === "V") {
        assert.equal(receipt.cellAfter, receipt.cellBefore, `AltGr+V must leave the selected cell unchanged; ${JSON.stringify(receipt)}`);
        assert.equal(readOsClipboard(), clipboardSeed, "OS clipboard still held the seed, so a paste would have shown");
      }
      if (key === "Q") {
        assert.equal(receipt.value, "@", "German AltGr+Q inserts @ into the editor");
        await evaluate(`
          press(textbox("Edit cell"), "Enter");
          await waitFor(() => !textbox("Edit cell") && current() && cellAt(0, 0)?.textContent === "@", "AltGr @ committed cell");
          return true;
        `);
      }
      console.log(`PASS: windows native AltGr+${key} — ${key === "V" ? "Paste Special closed, no paste, cell unchanged" : 'edited cell contains "@"'}`);
    } finally {
      await evaluate(`
        for (const type of ["keydown", "keyup", "paste"]) window.removeEventListener(type, window.__altgrListener, true);
        if (window.__altgrReadText) Object.defineProperty(navigator.clipboard, "readText", window.__altgrReadText);
        else delete navigator.clipboard.readText;
        delete window.__altgrListener;
        delete window.__altgrReceipt;
        delete window.__altgrReadText;
        delete window.__altgrClipboardReads;
        delete window.__altgrCellBefore;
        return true;
      `);
    }
  }
  } finally {
    helper.stdin.end();
    const result = await exited;
    assert.equal(result.code, 0, `AltGr helper cleanup: ${JSON.stringify(result)}`);
  }
}

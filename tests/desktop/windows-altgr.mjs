// Native input only: the e2e channel prepares the UI and reads trusted receipts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { writeOsClipboard } from "./paste-races.mjs";

export async function windowsAltGr({ evaluate, appPid }) {
  writeOsClipboard("AltGr must not paste this");
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
      if (dialog("Paste Special")) throw new Error("Paste Special already open before AltGr");
      const cell = await waitFor(() => cellAt(0, 0), "AltGr target cell");
      ${key === "Q" ? `dblclick(cell);
      const editor = await waitFor(() => textbox("Edit cell"), "AltGr editor");
      fill(editor, "");` : "click(cell);"}
      window.__altgrReceipt = [];
      window.__altgrListener = event => window.__altgrReceipt.push({
        type: event.type, code: event.code, key: event.key,
        trusted: event.isTrusted, altGraph: event.getModifierState("AltGraph")
      });
      for (const type of ["keydown", "keyup"]) window.addEventListener(type, window.__altgrListener, true);
      return true;
    `);
    try {
      helper.stdin.write(`${key}\n`);
      await waitForHelper(`Right-Alt+${key} via SendInput (4/4)`);
      const receipt = await evaluate(`
        await waitFor(() => window.__altgrReceipt.some(e => e.type === "keyup" && e.code === "Key${key}" && e.trusted),
          "AltGr+${key} NOT DELIVERED: missing trusted app key receipt", 5000);
        await sleep(300);
        return { events: window.__altgrReceipt, pasteSpecial: !!dialog("Paste Special"),
          value: textbox("Edit cell")?.value ?? null };
      `);
      assert.ok(receipt.events.some(e => e.type === "keydown" && e.code === "AltRight" && e.trusted),
        `AltGr+${key} NOT DELIVERED: missing trusted Right Alt; ${JSON.stringify(receipt)}`);
      assert.ok(receipt.events.some(e => e.type === "keydown" && e.code === `Key${key}` && e.trusted && e.altGraph),
        `AltGr+${key} NOT DELIVERED: missing trusted German AltGraph chord; ${JSON.stringify(receipt)}`);
      console.log(`AltGr+${key} DELIVERED: ${JSON.stringify(receipt.events)}`);
      assert.equal(receipt.pasteSpecial, false, `AltGr+${key} must leave Paste Special closed`);
      if (key === "Q") {
        assert.equal(receipt.value, "@", "German AltGr+Q inserts @ into the editor");
        await evaluate(`
          press(textbox("Edit cell"), "Enter");
          await waitFor(() => !textbox("Edit cell") && current() && cellAt(0, 0)?.textContent === "@", "AltGr @ committed cell");
          return true;
        `);
      }
      console.log(`PASS: windows native AltGr+${key} — ${key === "V" ? "Paste Special closed" : 'edited cell contains "@"'}`);
    } finally {
      await evaluate(`
        for (const type of ["keydown", "keyup"]) window.removeEventListener(type, window.__altgrListener, true);
        delete window.__altgrListener;
        delete window.__altgrReceipt;
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

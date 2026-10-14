// Repair-batch 2 regressions over the production UI and real Worker/WASM.
// Faults only withhold real replies or completion frames; no fabricated state.
import assert from "node:assert/strict";

export async function runNewTableRepairCases({ page, ready, projection, checks }) {
  const selected = process.env.TABLE_ROWS_REPAIR_CASE;
  const failures = [];
  const dialog = () => page.getByRole("dialog", { name: "New table", exact: true });
  const entry = () => page.locator(".ts-entry-row");
  const unloadProtected = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  });
  async function assertDraftProtection(expected, message) {
    // Dialog -> Shell -> App effects settle over more than one render.
    await page.waitForFunction(expected => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === String(expected), expected);
    assert.equal(await unloadProtected(), expected, message);
  }
  async function openDialog(name) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    if (name !== undefined) await dialog().getByLabel("Table name", { exact: true }).fill(name);
  }
  async function cleanup() {
    if (await dialog().count()) await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    const close = page.getByRole("button", { name: "Close project", exact: true });
    const abandon = page.getByRole("button", { name: "Close and abandon recovery", exact: true });
    if (await close.count()) await close.click();
    else if (await abandon.count()) await abandon.click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
    await page.getByRole("button", { name: "New table", exact: true }).waitFor();
  }
  async function sales() {
    await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready(page);
  }
  async function create() {
    await dialog().getByRole("button", { name: "Create table", exact: true }).click();
    await dialog().waitFor({ state: "detached" });
  }
  const cases = {
    B: async () => {
      await openDialog(); assert.equal(await unloadProtected(), false, "initial defaults are not a draft");
      const name = dialog().getByLabel("Table name", { exact: true });
      await name.fill("Draft"); await assertDraftProtection(true, "a name draft protects unload");
      await name.fill(""); await assertDraftProtection(false, "reverting the name clears protection");
      const column = dialog().getByLabel("Column 1 name", { exact: true });
      await column.fill("Item"); await assertDraftProtection(true, "a column draft protects unload");
      await column.fill("A"); await assertDraftProtection(false);
      const type = dialog().getByLabel("Column 1 type", { exact: true });
      await type.selectOption("number"); await assertDraftProtection(true, "a type draft protects unload");
      await type.selectOption("text"); await assertDraftProtection(false);
      await dialog().getByRole("button", { name: "Add column", exact: true }).click();
      await assertDraftProtection(true, "column structure protects unload");
      await dialog().getByRole("button", { name: "Remove column 1", exact: true }).click();
      assert.equal(await unloadProtected(), true, "a remaining nondefault column still protects unload");
      await dialog().getByRole("button", { name: "Create table", exact: true }).click();
      await dialog().getByRole("alert").waitFor();
      assert.equal(await unloadProtected(), true, "refused Create retains draft protection");
      await cleanup(); await assertDraftProtection(false, "Cancel clears the dialog draft");
    },
    C: async () => {
      await openDialog("IME_draft");
      const name = dialog().getByLabel("Table name", { exact: true });
      for (const native of [{ isComposing: true }, { keyCode: 229 }]) {
        await name.evaluate((input, native) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...native })), native);
        assert.equal(await dialog().count(), 1, "composition Escape keeps the dialog open");
        assert.equal(await name.inputValue(), "IME_draft");
        assert.equal(await name.evaluate(input => input === document.activeElement), true);
      }
      await name.press("Escape"); await dialog().waitFor({ state: "detached" });
    },
    D: async () => {
      await sales(); const before = await projection(page);
      await page.getByTestId(`cell:${before.rows[0].id}:${before.columns[0].id}`).focus();
      await page.evaluate(() => { window.__rowEvidence.holdDeleteFrames = true; });
      await page.getByRole("button", { name: "Delete row", exact: true }).click(); await ready(page);
      await page.waitForFunction(() => window.__rowEvidence.deleteFrames?.length > 0);
      const destination = page.getByRole("button", { name: "Appearance", exact: true });
      await destination.focus();
      await page.evaluate(async () => {
        const evidence = window.__rowEvidence;
        evidence.holdDeleteFrames = false;
        for (const callback of evidence.deleteFrames.splice(0)) callback(performance.now());
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      assert.equal(await destination.evaluate(node => node === document.activeElement), true, "late delete frame respects newer focus");
      assert.equal((await projection(page)).rows.length, before.rows.length - 1, "real delete completed");
    },
    E: async () => {
      for (const operation of ["insert", "delete"]) {
        await sales();
        if (operation === "delete") { await page.locator("#ts-active-table").selectOption("sales"); await ready(page); }
        const before = await projection(page);
        assert.equal(await page.getByTestId("sales-tip").getAttribute("data-tip-state"), "try-it");
        if (operation === "insert") {
          for (const column of before.columns) await entry().locator(`[data-entry-field="${column.id}"]`).fill(column.field_type === "number" ? "6" : "ROW-PROBE");
          await entry().getByRole("button", { name: "Add", exact: true }).click();
        } else {
          await page.getByTestId(`cell:${before.rows.at(-1).id}:${before.columns[0].id}`).focus();
          await page.getByRole("button", { name: "Delete row", exact: true }).click();
        }
        await ready(page);
        assert.equal((await projection(page)).rows.length, before.rows.length + (operation === "insert" ? 1 : -1));
        assert.equal(await page.getByTestId("work-state").textContent(), "Edited — not saved", `${operation} clears the Sales initial marker`);
        assert.equal(await page.getByTestId("sales-tip").getAttribute("data-tip-state"), "updated", `${operation} acknowledges the Sales change`);
        await cleanup();
      }
    },
    F: async () => {
      await openDialog("Unused_columns");
      const add = dialog().getByRole("button", { name: "Add column", exact: true });
      await add.click(); await add.click();
      await dialog().getByRole("button", { name: "Remove column 2", exact: true }).click(); await add.click();
      const names = await dialog().locator(".ts-new-column input").evaluateAll(inputs => inputs.map(input => input.value));
      assert.equal(new Set(names).size, names.length, "remove/add defaults remain unique");
      await create(); await ready(page);
      assert.equal((await projection(page)).columns.length, 3, "unique headers reach the real creation boundary");
    },
  };
  for (const [item, run] of Object.entries(cases)) {
    if (selected && selected !== "all" && selected !== item) continue;
    try { await run(); checks.push(`repair-2-${item}`); console.log(JSON.stringify({ repair: item, status: "PASS" })); }
    catch (cause) {
      failures.push({ item, error: String(cause) });
      console.error(JSON.stringify({ repair: item, status: "FAIL", error: String(cause),
        observation: await page.evaluate(() => ({ alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent),
          requests: window.__rowEvidence.workers[0].requests.slice(-8), replies: window.__rowEvidence.workers[0].replies.slice(-8) })) }));
    }
    finally { await cleanup(); }
  }
  assert.deepEqual(failures, [], "all selected A–F production regressions pass");
}

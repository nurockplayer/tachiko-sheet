// Round 4: production UI and actual core replies, never fabricated outcomes.
import assert from "node:assert/strict";

export async function runNewTableRound4Cases({ page, ready, projection, checks, capture }) {
  const selected = process.env.TABLE_ROWS_ROUND4_CASE;
  const failures = [];
  const dialog = () => page.getByRole("dialog", { name: "New table", exact: true });
  const create = () => dialog().getByRole("button", { name: "Create table", exact: true }).click();
  const requests = type => page.evaluate(type => window.__rowEvidence.workers[0].requests.filter(r => r.request?.type === type).length, type);
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
  async function open(name) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    await dialog().getByLabel("Table name", { exact: true }).fill(name);
  }
  const cases = {
    ...Object.fromEntries(["ack", "table", "discovery"].map(fault => [`4-A-${fault}`, async () => {
      await open(`Retry_${fault}`);
      await dialog().getByLabel("Column 1 name", { exact: true }).fill("Amount");
      await dialog().getByLabel("Column 1 type", { exact: true }).selectOption("number");
      const count = await requests("new_table");
      await page.evaluate(fault => {
        if (fault === "ack") window.__rowEvidence.loseNextCreateReply = true;
        else window.__rowEvidence.failCreationObservation = fault;
      }, fault);
      await create();
      // Wait for either behavior so the baseline failure is an assertion,
      // rather than a timeout waiting for an already-unmounted dialog.
      await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="New table"]') || document.querySelector('[role="dialog"][aria-label="New table"] [role="alert"]'));
      assert.equal(await dialog().count(), 1, "uncertain creation keeps the configured dialog open");
      assert.equal(await dialog().getByRole("alert").textContent(), "Tachiko couldn't confirm the table was created. Nothing was saved — choose Create to try again.");
      assert.equal(await page.getByText("We could not confirm whether the file opened or read its values. Refresh to check the open work.", { exact: true }).count(), 0, "creation leaves no generic Open recovery prompt");
      assert.equal(await dialog().getByLabel("Table name", { exact: true }).inputValue(), `Retry_${fault}`);
      assert.equal(await dialog().getByLabel("Column 1 name", { exact: true }).inputValue(), "Amount");
      assert.equal(await dialog().getByLabel("Column 1 type", { exact: true }).inputValue(), "number");
      const probeId = -194 - ["ack", "table", "discovery"].indexOf(fault);
      await page.evaluate(id => window.__rowEvidence.liveWorker.postMessage({ id, kind: "observe_occurrence" }), probeId);
      await page.waitForFunction(id => window.__rowEvidence.workers[0].replies.some(r => r.id === id), probeId);
      const absence = await page.evaluate(id => window.__rowEvidence.workers[0].replies.find(r => r.id === id), probeId);
      assert.equal(absence.status, "error", "the actual core proves no resident work");
      assert.match(JSON.stringify(absence), /no_project|no project/i);
      assert.equal(await requests("new_table"), count + 1, "cleanup never automatically replays creation");
      assert.equal(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true, "retained configuration protects unload");
      if (fault === "ack" && capture) await capture("unconfirmed-dialog");
      await create(); await dialog().waitFor({ state: "detached" }); await ready(page);
      assert.equal(await requests("new_table"), count + 2, "only explicit Create dispatches again");
      assert.equal((await projection(page)).collection.key, `retry_${fault}`);
      assert.deepEqual((await projection(page)).columns.map(c => [c.key, c.field_type]), [["amount", "number"]]);
    }])),
    "4-B": async () => {
      await open("Work_file_source"); await create(); await dialog().waitFor({ state: "detached" }); await ready(page);
      // Export and reopen through the actual public core and normal Home input.
      const bytes = await page.evaluate(async () => {
        const kit = await import("/core-kit/experimental-client.js");
        const client = kit.createExperimentalDesignerClient();
        try {
          await client.newTable("Portable", [{ name: "A", field_type: "text" }]);
          const witness = await client.observeOccurrence();
          const exported = await client.exportPortableRo(witness.revision);
          return Array.from(new Uint8Array(exported.bytes));
        } finally { client.close(); }
      });
      await cleanup();
      await page.getByTestId("open-work-file").setInputFiles({ name: "source.ro", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) }); await ready(page);
      await cleanup(); await open("Ordinary_copy"); await create(); await dialog().waitFor({ state: "detached" }); await ready(page);
      await page.getByRole("button", { name: "Save a copy", exact: true }).click();
      const copy = page.getByRole("dialog", { name: "Save a copy", exact: true });
      await copy.getByLabel("Copy name", { exact: true }).fill("Round4 ordinary");
      await copy.getByRole("button", { name: "Create copy", exact: true }).click(); await copy.waitFor({ state: "detached" });
      await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
      const kind = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open("tachiko-sheet-local-copies", 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise((resolve, reject) => { const r = db.transaction("copies").objectStore("copies").get("Round4 ordinary"); r.onsuccess = () => resolve(r.result.kind); r.onerror = () => reject(r.error); }); }
        finally { db.close(); }
      });
      assert.notEqual(kind, "work-file", "New table saves through the ordinary copy carrier after .ro Close");
    },
    "4-C": async () => {
      await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready(page);
      const before = await projection(page);
      await page.getByTestId(`cell:${before.rows[0].id}:${before.columns[0].id}`).focus();
      await page.evaluate(() => { window.__rowEvidence.holdNextMutationReply = "remove_table_rows"; });
      await page.getByRole("button", { name: "Delete row", exact: true }).click();
      await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
      const destination = page.getByRole("button", { name: "Appearance", exact: true }); await destination.focus();
      await page.evaluate(() => { for (const data of window.__rowEvidence.heldReplies.splice(0)) window.__rowEvidence.liveWorker.dispatchEvent(new MessageEvent("message", { data })); });
      await ready(page);
      assert.equal(await destination.evaluate(e => e === document.activeElement), true, "late completion preserves newer DOM focus");
      assert.equal(await page.locator('td[tabindex="0"]').count(), 1, "removed focusedKey still leaves one Tab stop in the grid");
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.matches('td[data-testid^="cell:"]'))) return;
      }
      assert.fail("Tab must reach the grid after a late deletion");
    },
    "4-D": async () => {
      for (const triggerName of ["New table", "New table…"]) {
        const trigger = page.getByRole("button", { name: triggerName, exact: true });
        await trigger.click(); await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
        await page.waitForFunction(name => document.activeElement?.getAttribute("aria-label") === name || document.activeElement?.textContent === name, triggerName);
        await trigger.click(); await dialog().getByLabel("Table name", { exact: true }).fill("Focus_new");
        await create(); await dialog().waitFor({ state: "detached" }); await ready(page);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        assert.equal(await page.locator(".ts-entry-row [data-entry-field]").first().evaluate(e => e === document.activeElement), true, "successful Create focuses the first Add-row field");
        await cleanup();
      }
    },
    "4-D-intent": async () => {
      await open("Late_create");
      await page.evaluate(() => { window.__rowEvidence.holdNextMutationReply = "new_table"; });
      await create();
      await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
      // A persistent external focus target isolates the completion guard;
      // Home's controls themselves unmount when creation succeeds.
      await page.evaluate(() => {
        const target = document.createElement("button");
        target.dataset.testid = "newer-focus-probe";
        target.textContent = "Newer focus";
        document.body.append(target);
      });
      const destination = page.getByTestId("newer-focus-probe");
      await destination.focus();
      await page.evaluate(() => { for (const data of window.__rowEvidence.heldReplies.splice(0)) window.__rowEvidence.liveWorker.dispatchEvent(new MessageEvent("message", { data })); });
      await dialog().waitFor({ state: "detached" }); await ready(page);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await destination.evaluate(e => e === document.activeElement), true, "late creation respects newer focus intent");
      await destination.evaluate(e => e.remove());
    },
    "4-A-close": async () => {
      await open("Uncertain_close");
      const count = await requests("new_table");
      await page.evaluate(() => { window.__rowEvidence.loseNextCreateReply = true; window.__rowEvidence.loseNextClose = true; });
      await create();
      await page.waitForFunction(() => document.querySelector('[data-view="reload-required"]') || !document.querySelector('[role="dialog"][aria-label="New table"]'));
      assert.equal(await page.locator('[data-view="reload-required"]').count(), 1, "uncertain cleanup requires Reload");
      assert.equal(await page.getByTestId("project-ready").count(), 0);
      assert.equal(await requests("new_table"), count + 1, "uncertain Close never replays creation");
      await page.getByRole("button", { name: "Reload page", exact: true }).click();
      await page.getByRole("button", { name: "New table", exact: true }).waitFor();
    },
  };
  for (const [item, run] of Object.entries(cases)) {
    if (selected && selected !== "all" && selected !== item) continue;
    try { await run(); checks.push(item); console.log(JSON.stringify({ round4: item, status: "PASS" })); }
    catch (cause) { const failure = { item, error: String(cause) }; failures.push(failure); console.error(JSON.stringify({ round4: item, status: "FAIL", error: String(cause) })); }
    finally {
      if (await page.locator('[data-view="reload-required"]').count()) {
        await page.getByRole("button", { name: "Reload page", exact: true }).click();
        await page.getByRole("button", { name: "New table", exact: true }).waitFor();
      }
      await cleanup();
    }
  }
  assert.deepEqual(failures, [], "round-4 regressions pass");
}

// Batch 3: real production UI/core, delaying or losing actual transport replies.
import assert from "node:assert/strict";

export async function runNewTableRootCauseCases({ page, ready, projection, checks }) {
  const selected = process.env.TABLE_ROWS_ROOT_CASE;
  const failures = [];
  const dialog = () => page.getByRole("dialog", { name: "New table", exact: true });
  const entry = () => page.locator(".ts-entry-row");
  const requests = type => page.evaluate(type => window.__rowEvidence.workers[0].requests.filter(r => r.request?.type === type), type);
  async function cleanup(dispose = true) {
    if (await dialog().count()) await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    const close = page.getByRole("button", { name: "Close project", exact: true });
    const abandon = page.getByRole("button", { name: "Close and abandon recovery", exact: true });
    if (await close.count()) await close.click();
    else if (await abandon.count()) await abandon.click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
    await page.getByRole("button", { name: "New table", exact: true }).waitFor();
    if (!dispose) return;
    // Dispose any real resident left behind by the deliberately lost Close.
    await page.evaluate(() => {
      const e = window.__rowEvidence;
      e.loseNextCreateReply = false; e.loseNextClose = false;
      e.liveWorker.postMessage({ id: -189, kind: "close_project" });
    });
    await page.waitForFunction(() => window.__rowEvidence.workers[0].replies.at(-1)?.id === -189);
  }
  async function openDialog(name) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    await dialog().getByLabel("Table name", { exact: true }).fill(name);
  }
  async function createNamed(name) {
    await openDialog(name);
    await dialog().getByLabel("Column 1 name", { exact: true }).fill("Item");
    await dialog().getByRole("button", { name: "Create table", exact: true }).click();
    await dialog().waitFor({ state: "detached" }); await ready(page);
  }
  async function sales() {
    await page.getByRole("button", { name: "Open sales example", exact: true }).click(); await ready(page);
  }
  async function fillEntry(table, invalid = false) {
    for (const column of table.columns) await entry().locator(`[data-entry-field="${column.id}"]`).fill(column.field_type === "number" ? invalid ? "abc" : "6" : "ROOT-PROBE");
  }
  async function release() {
    await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
    await page.evaluate(() => {
      for (const data of window.__rowEvidence.heldReplies.splice(0)) window.__rowEvidence.liveWorker.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  const cases = {
    // Round 5-B: Work trims authoring names; the dialog must send the untouched draft.
    "5-B-trim": async () => {
      await openDialog(" Expenses ");
      await dialog().getByLabel("Column 1 name", { exact: true }).fill(" Item ");
      const before = (await requests("new_table")).length;
      await dialog().getByRole("button", { name: "Create table", exact: true }).click();
      await page.waitForFunction(() => {
        const d = document.querySelector('[role="dialog"][aria-label="New table"]');
        return !d || d.querySelector('[role="alert"]');
      });
      const dispatched = (await requests("new_table")).slice(before);
      assert.equal(dispatched.length, 1, "Create dispatches exactly once");
      assert.equal(dispatched[0].request.name, " Expenses ", "table name reaches Work exactly as typed");
      assert.deepEqual(dispatched[0].request.columns, [{ name: " Item ", field_type: "text" }], "column names reach Work exactly as typed");
      assert.equal(await dialog().count(), 0, "padded valid names create successfully in the real core");
      await ready(page);
      const table = await projection(page);
      assert.equal(table.collection.key, "expenses");
      assert.deepEqual(table.columns.map(column => column.key), ["item"]);
    },
    "R1-resident": async () => {
      await createNamed("Old");
      await page.evaluate(() => { window.__rowEvidence.loseNextClose = true; });
      await cleanup(false);
      await openDialog("Requested");
      await dialog().getByLabel("Column 1 name", { exact: true }).fill("Item");
      await dialog().getByRole("button", { name: "Add column", exact: true }).click();
      await dialog().getByLabel("Column 2 name", { exact: true }).fill("Item");
      const before = (await requests("new_table")).length;
      await page.evaluate(() => { window.__rowEvidence.loseNextCreateReply = true; });
      await dialog().getByRole("button", { name: "Create table", exact: true }).click();
      await page.waitForFunction(() => {
        const d = document.querySelector('[role="dialog"][aria-label="New table"]');
        return !d || d.querySelector('[role="alert"]');
      });
      // On the base the real duplicate-column refusal is lost, and Refresh
      // wrongly exposes Old as a recovered creation. Capture that too.
      if (!(await dialog().count())) {
        await page.locator(".ts-home").getByRole("button", { name: "Refresh", exact: true }).click(); await ready(page);
      } else await dialog().getByRole("alert").waitFor();
      const after = (await requests("new_table")).length;
      assert.equal(after, before, "authoritative resident precheck dispatches no creation over Old");
      assert.equal(await page.getByTestId("project-ready").count(), 0, "Old stays hidden on Home");
      assert.match(await dialog().getByRole("alert").textContent(), /reload/i);
      await page.evaluate(() => { window.__rowEvidence.loseNextCreateReply = false; });
    },
    R2: async () => {
      await sales(); const before = await projection(page);
      await page.getByTestId(`cell:${before.rows[0].id}:${before.columns[0].id}`).focus();
      await page.evaluate(() => { window.__rowEvidence.holdNextMutationReply = "remove_table_rows"; });
      await page.getByRole("button", { name: "Delete row", exact: true }).click();
      await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
      const destination = page.getByTestId(`cell:${before.rows[1].id}:${before.columns[0].id}`);
      await destination.focus(); await release(); await ready(page);
      assert.equal((await projection(page)).rows.length, before.rows.length - 1);
      assert.equal(await destination.getAttribute("tabindex"), "0", "late delete preserves newer roving cell");
      assert.equal(await destination.getAttribute("aria-selected"), "true", "late delete preserves newer selection");
      assert.equal(await destination.evaluate(node => node === document.activeElement), true);
    },
    R3: async () => {
      await sales(); const before = await projection(page); await fillEntry(before, true);
      await page.evaluate(() => { window.__rowEvidence.holdNextMutationReply = "insert_row"; });
      await entry().getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
      const destination = page.getByRole("button", { name: "Appearance", exact: true });
      await destination.focus(); await release(); await ready(page);
      await page.getByRole("alert").filter({ hasText: /not a finite Number/ }).waitFor();
      assert.equal(await destination.evaluate(node => node === document.activeElement), true, "late refusal must not focus an entry field over newer intent");
      assert.deepEqual(await projection(page), before, "real core refusal publishes nothing");
      assert.equal(await entry().locator('input[aria-invalid="true"]').inputValue(), "abc", "draft and field error remain");
    },
    "R4-row": async () => {
      await sales(); const before = await projection(page); await fillEntry(before);
      await page.evaluate(() => { window.__rowEvidence.loseNextMutationReply = "insert_row"; });
      await entry().getByRole("button", { name: "Add", exact: true }).click();
      await recoverSales("insert_row", before.revision, table => assert.equal(table.rows.length, before.rows.length + 1));
    },
    "R4-scalar": async () => {
      await sales(); const before = await projection(page);
      const column = before.columns.find(c => c.key === "price"); const row = before.rows[0];
      await page.getByTestId(`cell:${row.id}:${column.id}`).dblclick();
      const input = page.getByRole("textbox", { name: "Edit cell", exact: true }); await input.fill("17");
      await page.evaluate(() => { window.__rowEvidence.loseNextMutationReply = "edit_scalar"; });
      await input.press("Enter");
      await recoverSales("edit_scalar", before.revision, table => assert.equal(table.rows.find(r => r.id === row.id).fields.find(f => f.target.field === column.id).stored.value, 17));
    },
    "R4-history": async () => {
      await sales(); const before = await projection(page); await fillEntry(before);
      await entry().getByRole("button", { name: "Add", exact: true }).click(); await ready(page);
      await page.evaluate(() => { window.__rowEvidence.loseNextMutationReply = "undo"; });
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await recoverSales("undo", before.revision, table => assert.deepEqual(table.rows, before.rows));
    },
    defaults: async () => {
      await openDialog("Default_table");
      assert.equal(await dialog().getByLabel("Column 1 name", { exact: true }).inputValue(), "A", "default header is a core-valid spreadsheet letter");
      const add = dialog().getByRole("button", { name: "Add column", exact: true });
      await add.click(); await add.click();
      await dialog().getByRole("button", { name: "Remove column 2", exact: true }).click(); await add.click();
      assert.deepEqual(await dialog().locator(".ts-new-column input").evaluateAll(inputs => inputs.map(i => i.value)), ["A", "C", "B"]);
      await dialog().getByRole("button", { name: "Create table", exact: true }).click(); await dialog().waitFor({ state: "detached" }); await ready(page);
      assert.deepEqual((await projection(page)).columns.map(c => c.key).sort(), ["a", "b", "c"]);
      await cleanup(); await openDialog("Only_name");
      await dialog().getByRole("button", { name: "Create table", exact: true }).click(); await dialog().waitFor({ state: "detached" }); await ready(page);
      assert.deepEqual((await projection(page)).columns.map(c => [c.key, c.field_type]), [["a", "text"]], "name-only creation needs no header repair");
    },
    constraints: async () => {
      await openDialog("   ");
      await dialog().getByLabel("Column 1 name", { exact: true }).fill("Item");
      const before = (await requests("new_table")).length;
      await dialog().getByRole("button", { name: "Create table", exact: true }).click();
      await dialog().getByRole("alert").waitFor();
      assert.equal((await requests("new_table")).length, before + 1, "Work authoritatively refuses the table name after one dispatch");
      assert.equal(await dialog().getByLabel("Table name", { exact: true }).getAttribute("aria-invalid"), "true");
      await dialog().getByLabel("Table name", { exact: true }).fill("Valid_name");
      await dialog().getByLabel("Column 1 name", { exact: true }).fill("Bad\u0001Name");
      await dialog().getByRole("button", { name: "Create table", exact: true }).click(); await dialog().getByRole("alert").waitFor();
      assert.equal((await requests("new_table")).length, before + 2, "Work authoritatively refuses the column name after one dispatch");
      assert.equal(await dialog().getByLabel("Column 1 name", { exact: true }).getAttribute("aria-invalid"), "true");
      await dialog().getByRole("alert").filter({ hasText: /control characters/ }).waitFor();
    },
  };
  async function recoverSales(type, openingRevision, verify) {
    await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    const count = (await requests(type)).length;
    await page.locator(".ts-home").getByRole("button", { name: "Refresh", exact: true }).click(); await ready(page);
    const table = await projection(page); assert.notEqual(table.revision, openingRevision); verify(table);
    assert.equal((await requests(type)).length, count, "Refresh never replays mutation");
    assert.equal(await page.getByTestId("work-state").textContent(), "Edited — not saved", `${type} recovery clears initial Sales marker`);
    assert.equal(await page.getByTestId("sales-tip").getAttribute("data-tip-state"), "updated", `${type} recovery acknowledges observed revision`);
  }
  for (const [item, run] of Object.entries(cases)) {
    if (selected && selected !== "all" && selected !== item) continue;
    try { await run(); checks.push(`repair-3-${item}`); console.log(JSON.stringify({ repair3: item, status: "PASS" })); }
    catch (cause) {
      const failure = { item, error: String(cause), observation: await page.evaluate(() => ({
        title: document.querySelector('[data-testid="project-ready"]')?.textContent?.slice(0, 200),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent),
        requests: window.__rowEvidence.workers[0].requests.slice(-8), replies: window.__rowEvidence.workers[0].replies.slice(-8),
      })) };
      failures.push(failure); console.error(JSON.stringify({ repair3: item, status: "FAIL", ...failure }));
    }
    finally { await cleanup(); }
  }
  assert.deepEqual(failures, [], "all selected batch-3 regressions pass");
}

import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";
// Round 6: projection-driven roving focus over actual production/core history.
import assert from "node:assert/strict";

export async function runNewTableRound6Cases({ page, ready, projection, checks }) {
  const selected = process.env.TABLE_ROWS_ROUND6_CASE;
  const failures = [];
  const entry = () => page.locator(".ts-entry-row [data-entry-field]");
  const cell = (row, column) => page.getByTestId(`cell:${row.id}:${column.id}`);
  const action = name => page.getByRole("button", { name, exact: true });
  const settle = async () => {
    await ready(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  async function cleanup() {
    if (await action("Close project").count()) await action("Close project").click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
    await action("New table").waitFor();
  }
  async function tableWithRows(count) {
    await action("New table").click();
    const dialog = page.getByRole("dialog", { name: "New table", exact: true });
    await dialog.getByLabel("Table name", { exact: true }).fill("Focus_rows");
    await dialog.getByRole("button", { name: "Add column", exact: true }).click();
    await dialog.getByRole("button", { name: "Create table", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await settle();
    for (let row = 0; row < count; row++) {
      await fillDraftCell(page, entry().nth(0), `left${row}`);
      await fillDraftCell(page, entry().nth(1), `right${row}`);
      await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click();
      await settle();
    }
    return projection(page);
  }
  async function mutate(name, type, newer) {
    if (newer) await page.evaluate(type => { window.__rowEvidence.holdNextMutationReply = type; }, type);
    await action(name).click();
    if (newer) {
      await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
      await newer.focus();
      await page.evaluate(() => {
        for (const data of window.__rowEvidence.heldReplies.splice(0)) window.__rowEvidence.liveWorker.dispatchEvent(new MessageEvent("message", { data }));
      });
    }
    await settle();
    if (newer) assert.equal(await newer.evaluate(e => e === document.activeElement), true, `${name} preserves newer DOM focus`);
  }
  async function tabTarget(row, column) {
    assert.equal(await page.locator('td[data-testid^="cell:"][tabindex="0"]').count(), 1, "exactly one surviving grid Tab stop");
    assert.equal(await cell(row, column).getAttribute("tabindex"), "0", "nearest surviving cell retains the column");
  }
  for (const kind of ["undo-insert", "redo-delete", "delete-middle", "delete-only"]) {
    if (selected && selected !== "all" && selected !== kind) continue;
    const failureCount = failures.length;
    // Exercise newer grid and external focus before the ordinary completion.
    // Each regression group then independently fails on the unfixed source.
    for (const newerKind of kind === "delete-only" ? ["control", null] : ["cell", "control", null]) {
      try {
        const before = await tableWithRows(kind === "delete-only" ? 1 : 3);
        const column = before.columns[1];
        const removed = before.rows[kind === "undo-insert" ? 2 : kind === "delete-only" ? 0 : 1];
        if (kind === "redo-delete") {
          await cell(removed, column).focus();
          await mutate("Delete row", "remove_table_rows");
          await mutate("Undo", "undo");
          assert.deepEqual((await projection(page)).rows, before.rows, "real Undo restores the deleted row and identity");
        }
        await cell(removed, column).focus();
        const newer = newerKind === "cell" ? cell(before.rows[0], before.columns[0]) : newerKind === "control" ? action("Appearance") : null;
        const name = kind === "undo-insert" ? "Undo" : kind === "redo-delete" ? "Redo" : "Delete row";
        const type = kind === "undo-insert" ? "undo" : kind === "redo-delete" ? "redo" : "remove_table_rows";
        await mutate(name, type, newer);
        const after = await projection(page);
        assert.deepEqual(after.rows.map(r => r.id), before.rows.filter(r => r.id !== removed.id).map(r => r.id), "actual projection removes only the intended row");
        if (kind === "delete-only") {
          assert.equal(await page.locator('tr:not(.ts-entry-row) td[data-testid^="cell:"][tabindex="0"]').count(), 0);
          assert.equal(await entry().first().evaluate(e => e.tabIndex), 0, "empty table exposes its first Add-row field to Tab");
          if (!newer) assert.equal(await entry().first().evaluate(e => e === document.activeElement), true, "deleting the only row focuses Add-row");
        } else {
          const target = newerKind === "cell" ? before.rows[0] : before.rows[kind === "undo-insert" ? 1 : 2];
          if (!newer && kind === "undo-insert") assert.equal(await action(name).evaluate(e => e === document.activeElement), true, "Undo retains its usable initiator focus");
          if (!newer && kind === "redo-delete") assert.equal(await action("Refresh").evaluate(e => e === document.activeElement), true, "disabled Redo retains its existing desktop Refresh focus fallback");
          await tabTarget(target, newerKind === "cell" ? before.columns[0] : column);
          if (!newer && kind === "delete-middle") assert.equal(await cell(target, column).evaluate(e => e === document.activeElement), true, "middle-row Delete focuses the next row in the same column");

        }
        console.log(JSON.stringify({ round6: kind, newer: newerKind, status: "PASS" }));
      } catch (cause) {
        failures.push({ kind, newer: newerKind, error: String(cause) });
        console.error(JSON.stringify({ round6: kind, newer: newerKind, status: "FAIL", error: String(cause) }));
      } finally { await cleanup(); }
    }
    if (failures.length === failureCount) checks.push(`round6-${kind}`);
  }
  assert.deepEqual(failures, [], "round-6 regressions pass");
}

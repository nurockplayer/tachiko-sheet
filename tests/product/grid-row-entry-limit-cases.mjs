import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { homeImportInput } from "./home-entry.mjs";
import { draftActions } from "./grid-row-entry-driver.mjs";

// Ordinary import and real Worker publications. Delay only actual replies to
// prove that an asynchronous completion respects a newer user focus choice.
export async function runInsertionLimitFocusCases({ page, ready, projection, checks }) {
  const folder = await mkdtemp(path.join(tmpdir(), "sheet228-limit-focus-"));
  const action = name => page.getByRole("button", { name, exact: true });
  const settle = async () => {
    await ready(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    if (await action("Close project").count()) await action("Close project").click();
    const closing = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await closing.count()) await closing.getByRole("button", { name: "Close without saving", exact: true }).click();
    await action("New table").waitFor();
    const csv = path.join(folder, "limit.csv");
    await writeFile(csv, ["Item,Note", ...Array.from({ length: 127 }, (_, i) => `item-${i},note-${i}`)].join("\r\n") + "\r\n");
    await (await homeImportInput(page)).setInputFiles(csv);
    const review = page.getByRole("dialog", { name: "Review import preview", exact: true });
    await review.getByRole("button", { name: "Import file", exact: true }).click();
    await settle();
    const before = await projection(page);
    assert.equal(before.native_table_profile, true, "real imported Text fixture is native");
    assert.equal(before.rows.length, 127, "stored records exclude the draft");
    const column = before.columns[1];
    assert.ok(column, "use a non-first column to verify same-column focus");
    const beforeIds = new Set(before.rows.map(row => row.id));
    for (const submit of ["Enter", "Add row"]) {
      for (const newer of [null, "reply", "frame"]) {
        const entry = page.locator(`.ts-entry-row [data-entry-field="${column.id}"]`);
        // Keyboard entry avoids a second pointer click racing the long grid's
        // focus-reveal scroll after Undo restores the draft at the bottom.
        await entry.focus();
        await entry.press("F2");
        await page.getByTestId("cell-editor").fill(`${submit}-${newer}`);
        await entry.focus();
        if (newer === "reply") await page.evaluate(() => { window.__rowEvidence.holdNextMutationReply = "insert_row"; });
        if (newer === "frame") await page.evaluate(() => {
          window.__rowEvidence.insertPublished = false;
          window.__rowEvidence.holdInsertFrames = true;
        });
        if (submit === "Enter") await entry.press("Enter");
        else await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click();
        const destination = page.getByTestId(`cell:${before.rows[0].id}:${before.columns[0].id}`);
        if (newer === "reply") {
          await page.waitForFunction(() => window.__rowEvidence.heldReplies?.length > 0);
          await destination.focus();
          await page.evaluate(() => {
            const evidence = window.__rowEvidence;
            for (const data of evidence.heldReplies.splice(0)) evidence.liveWorker.dispatchEvent(new MessageEvent("message", { data }));
          });
        }
        if (newer === "frame") {
          await page.waitForFunction(() => window.__rowEvidence.insertFrames?.length > 0 && !document.querySelector(".ts-entry-row"), null, { polling: 20 });
          await destination.focus();
          await page.evaluate(() => {
            const evidence = window.__rowEvidence;
            evidence.holdInsertFrames = false;
            for (const callback of evidence.insertFrames.splice(0)) callback(performance.now());
          });
        }
        await settle();
        const after = await projection(page);
        assert.equal(after.rows.length, 128);
        const inserted = after.rows.filter(row => !beforeIds.has(row.id));
        assert.equal(inserted.length, 1, "one inserted record");
        assert.equal(inserted[0].fields.find(field => field.target.field === column.id).stored.value, `${submit}-${newer}`);
        assert.equal(await page.locator(".ts-entry-row").count(), 0);
        assert.equal(await action("Add row").count(), 0);
        const limit = page.locator('.ts-native-insertion-limit[role="status"]');
        assert.equal(await limit.textContent(), "This table has reached the 128-row limit for adding rows here.");
        const target = newer ? destination : page.getByTestId(`cell:${inserted[0].id}:${column.id}`);
        assert.equal(await target.evaluate(node => document.activeElement === node), true,
          `${submit}: ${newer ? "preserve newer focus" : "focus inserted cell in the same column"}`);
        assert.equal(await page.evaluate(() => document.activeElement?.matches('td[data-work-field]') ?? false), true);
        await action("Undo").click(); await settle();
        assert.deepEqual((await projection(page)).rows, before.rows, "one Undo restores all 127 original records");
        assert.equal(await page.locator(".ts-entry-row").count(), 1);
        checks.push(`insertion-limit-127-to-128-${submit === "Enter" ? "enter" : "button"}-${newer ? `newer-${newer}-focus-preserved` : "inserted-cell-focused"}`);
      }
    }
    await action("Close project").click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
    await action("New table").waitFor();
  } finally { await rm(folder, { recursive: true, force: true }); }
}

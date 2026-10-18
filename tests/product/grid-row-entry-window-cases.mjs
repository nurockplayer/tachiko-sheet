import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { j4CanaryText } from "../fixtures/j4-catalog-sales.mjs";
import { draftActions } from "./grid-row-entry-driver.mjs";

// The ordinary New table identifiers hit the kit's 64 KiB projection limit
// before windowing. Use a compact canonical fixture admitted by the same real
// kit, opened through Home's folder picker; no projection or reply is injected.
export async function runWindowedDraftCases({ page, ready, projection, checks }) {
  const folder = await mkdtemp(path.join(tmpdir(), "sheet207-windowed-"));
  try {
    const schema = JSON.parse(j4CanaryText["schemas.json"])[0];
    schema.fields = [schema.fields[1]];
    schema.key = "windowed";
    const field = schema.fields[0];
    field.key = "amount";
    const manifest = JSON.parse(j4CanaryText["manifest.json"]);
    manifest.document.title = "Windowed draft";
    await mkdir(path.join(folder, "entities"));
    await writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(path.join(folder, "schemas.json"), JSON.stringify([schema], null, 2) + "\n");
    const shards = Object.fromEntries([..."0123456789abcdef"].map(key => [key, ""]));
    for (let index = 0; index < 205; index++) {
      const id = `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      shards[createHash("sha256").update(id).digest("hex")[0]] += JSON.stringify({ id, key: `r${index}`, schema: schema.id, fields: { [field.id]: { kind: "number", value: index } } }) + "\n";
    }
    for (const [shard, text] of Object.entries(shards)) await writeFile(path.join(folder, "entities", `${shard}.jsonl`), text);
    await page.getByTestId("open-project").setInputFiles(folder);
    await page.getByTestId("project-ready").or(page.getByRole("alert")).first().waitFor();
    assert.equal(await page.getByTestId("project-ready").count(), 1, (await page.getByRole("alert").allTextContents()).join(" "));
    await ready(page);
    const table = await projection(page);
    assert.equal(table.native_table_profile, true, "core admits the real native fixture");
    assert.equal(table.rows.length, 205);
    const grid = page.getByRole("grid", { name: "Table", exact: true });
    assert.equal(await grid.getAttribute("aria-rowcount"), "207", "draft counts as a grid row; feedback does not");
    assert.equal(await grid.locator("tbody .ts-entry-row").count(), 0, "published row readers never see the draft");
    assert.equal(await grid.locator("tfoot").getAttribute("role"), "rowgroup");
    assert.equal(await grid.locator("tfoot .ts-entry-row").getAttribute("aria-rowindex"), "207");
    assert.equal(await grid.getByRole("row", { name: "New row", exact: true }).count(), 1, "draft remains a real accessible grid row");
    assert.ok(await grid.locator("tbody .ts-row").count() < 205, "rows are actually windowed");
    const entry = page.locator(".ts-entry-row [data-entry-field]");
    // Starting at the ordinary first-cell tab stop, arrows cross the window
    // boundaries and finally move off the last published row into the draft.
    await grid.locator("tbody .ts-row td").first().focus();
    for (let index = 0; index < 205; index++) await page.keyboard.press("ArrowDown");
    assert.equal(await entry.evaluate(node => node === document.activeElement), true);
    async function feedbackVisible() {
      await page.waitForFunction(() => {
        const port = document.querySelector(".ts-grid-scroll").getBoundingClientRect();
        const row = document.querySelector(".ts-entry-row").getBoundingClientRect();
        const bar = document.querySelector(".ts-entry-footer").getBoundingClientRect();
        return row.top >= port.top && bar.bottom <= Math.min(port.bottom, innerHeight) + 1;
      });
    }
    await page.keyboard.press("F2");
    await page.getByTestId("cell-editor").fill("abc");
    await page.getByText("Press Enter to add this row.", { exact: true }).waitFor();
    await feedbackVisible();
    await page.getByTestId("cell-editor").press("Enter"); await ready(page);
    // This kit admits the 205-row native projection but refuses another row
    // at its capacity guard before checking the Number input. Keep that real
    // row-level refusal; the small-table cases cover field-level refusals.
    await draftActions(page).getByRole("alert").waitFor();
    assert.equal(await draftActions(page).getByRole("alert").textContent(), "This row could not be added. Check its values and try again.");
    const refusal = await page.evaluate(() => window.__rowEvidence.workers[0].replies.filter(reply => reply.status === "error").at(-1));
    assert.equal(refusal.error.code, "invalid_table_operation");
    assert.match(refusal.error.message, /row capacity is exhausted/);
    await entry.press("ArrowUp"); await page.keyboard.press("ArrowDown");
    await feedbackVisible();
    assert.equal(await entry.evaluate(node => node === document.activeElement), true);
    assert.equal(await entry.getAttribute("aria-invalid"), null, "capacity refusal must not accuse a field");
    assert.equal((await projection(page)).rows.length, 205, "refusal does not add a row");
    if (process.env.TABLE_ROWS_AMENDMENT_SCREENSHOTS) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await entry.press("ArrowUp"); await page.keyboard.press("ArrowDown");
      await feedbackVisible();
      await mkdir("/tmp/sheet207-checks/screens", { recursive: true });
      await page.screenshot({ path: "/tmp/sheet207-checks/screens/windowed-draft-desktop.png" });
    }
    await draftActions(page).getByRole("button", { name: "Discard", exact: true }).click();
    checks.push("presentation-windowed-205-native-rows-keyboard-hint-refusal-visible-grid-rowcount");
  } finally { await rm(folder, { recursive: true, force: true }); }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { j4CanaryText } from "../fixtures/j4-catalog-sales.mjs";

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
    assert.equal(Number(await grid.getAttribute("aria-rowcount")) - await grid.locator(".ts-totals-row").count(), 206, "header plus 205 stored records (besides any totals row); no draft");
    assert.equal(await grid.locator(".ts-entry-row").count(), 0, "no insertion draft beyond Work's published gate");
    const limit = page.getByText("This table has reached the 128-row limit for adding rows here.", { exact: true });
    await limit.waitFor();
    assert.ok(await grid.locator("tbody .ts-row").count() < 205, "rows are actually windowed");
    // Traverse window boundaries and stay on the final stored row. The former
    // capacity-refused draft is now suppressed; small-table cases retain draft
    // input/focus/refusal coverage through ordinary supported insertion.
    await grid.locator("tbody .ts-row td").first().focus();
    for (let index = 0; index < 205; index++) await page.keyboard.press("ArrowDown");
    const lastCell = grid.locator('tbody tr[aria-rowindex="206"] td[data-work-field]');
    assert.equal(await lastCell.evaluate(node => node === document.activeElement), true);
    assert.equal(await lastCell.locator(".ts-cell-value").textContent(), "204");
    const before = await page.evaluate(() => window.__rowEvidence.workers.flatMap(worker => worker.requests).filter(message => ["insert_row", "paste_cells", "edit_cells"].includes(message.request?.type)).length);
    await lastCell.evaluate(node => {
      const data = new DataTransfer(); data.setData("text/plain", "999\n1000");
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.locator('.ts-clipboard-status[role="alert"]').filter({ hasText: "128-row limit" }).waitFor();
    assert.equal(await page.evaluate(() => window.__rowEvidence.workers.flatMap(worker => worker.requests).filter(message => ["insert_row", "paste_cells", "edit_cells"].includes(message.request?.type)).length), before, "overflow never dispatches or chunks");
    assert.deepEqual((await projection(page)).rows, table.rows, "every stored identity and value is preserved");
    assert.equal(await lastCell.evaluate(node => node === document.activeElement), true, "refusal retains the ordinary grid focus");
    if (process.env.TABLE_ROWS_AMENDMENT_SCREENSHOTS) {
      await mkdir("/tmp/sheet207-checks/screens", { recursive: true });
      await page.screenshot({ path: "/tmp/sheet207-checks/screens/windowed-insertion-limit-desktop.png" });
    }
    checks.push("presentation-windowed-205-native-records-keyboard-last-row-no-draft-insertion-limit-atomic-refusal");
  } finally { await rm(folder, { recursive: true, force: true }); }
}

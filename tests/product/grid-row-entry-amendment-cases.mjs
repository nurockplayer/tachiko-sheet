import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

export async function runDraftTabAmendmentCases({ page, ready, projection, checks }) {
  const entry = () => page.locator(".ts-entry-row [data-entry-field]");
  const editor = () => page.getByTestId("cell-editor");
  const add = () => draftActions(page).getByRole("button", { name: "Add row", exact: true });
  const requests = () => page.evaluate(() => window.__rowEvidence.workers[0].requests.filter(message => message.request?.type === "insert_row").length);
  const focused = cell => cell.evaluate(node => node === document.activeElement);
  const outsideGrid = () => page.evaluate(() => !document.activeElement?.closest(".ts-entry-row"));
  const settleFocus = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function create(title, columns) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New table", exact: true });
    await dialog.getByLabel("Table name", { exact: true }).fill(title);
    for (const [index, [name, type]] of columns.entries()) {
      if (index) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
      await dialog.getByLabel(`Column ${index + 1} name`, { exact: true }).fill(name);
      await dialog.getByLabel(`Column ${index + 1} type`, { exact: true }).selectOption(type);
    }
    await dialog.getByRole("button", { name: "Create table", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await ready(page);
  }
  async function close() {
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
    await page.getByRole("button", { name: "New table", exact: true }).waitFor();
  }
  async function capture(state) {
    if (!process.env.TABLE_ROWS_AMENDMENT_SCREENSHOTS) return;
    const directory = "/tmp/sheet207-checks/screens";
    await mkdir(directory, { recursive: true });
    const original = page.viewportSize();
    for (const [name, width] of [["desktop", 1440], ["compact", 390]]) {
      await page.setViewportSize({ width, height: 900 });
      if (state === "inline-refusal") {
        await page.locator('.ts-entry-row [aria-invalid="true"]').evaluate(node => node.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
      await page.screenshot({ path: `${directory}/${state}-${name}.png`, fullPage: true });
    }
    if (original) await page.setViewportSize(original);
  }

  await create("Untouched text", [["Left", "text"], ["Right", "text"]]);
  const untouched = await projection(page), before = await requests();
  await entry().first().press("Enter"); await editor().waitFor();
  assert.equal(await editor().inputValue(), "", "untouched Enter begins editing");
  await editor().press("Enter"); await editor().waitFor({ state: "detached" });
  assert.equal(await focused(entry().first()), true, "empty editor Enter returns to its cell without publishing");
  await entry().first().press("Tab"); await page.keyboard.press("Tab"); await settleFocus();
  assert.equal(await focused(add()), true, "untouched last-cell Tab leaves natively");
  assert.equal(await draftActions(page).getByRole("alert").count(), 0, "untouched Tab has no missing-input hint");
  await add().click();
  await entry().last().press("F2"); await editor().press("Tab"); await settleFocus();
  assert.equal(await focused(add()), true, "untouched last-editor Tab leaves explicitly");
  assert.equal(await draftActions(page).getByRole("alert").count(), 0);
  assert.equal(await requests(), before, "untouched all-Text Enter, Tab and Add row never dispatch insert_row");
  assert.deepEqual(await projection(page), untouched, "untouched actions leave row count and revision unchanged");
  checks.push("amendment-untouched-all-text-enter-edit-tab-exit-add-no-dispatch");
  await close();

  await create("Draft navigation", [["Item", "text"], ["Amount", "number"], ["Paid", "boolean"]]);
  await capture("empty-draft");
  const empty = await projection(page), noInserts = await requests();
  await fillDraftCell(page, entry().nth(0), "Retained");
  await fillDraftCell(page, entry().nth(2), " FaLsE ");
  await entry().first().press("F2");
  await page.getByText("Press Enter to add this row.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Add or discard the new row first.", { exact: true }).count(), 0, "ordinary entry uses positive hint copy");
  await capture("mid-entry");
  await editor().press("Tab"); await page.keyboard.press("Shift+Tab");
  assert.equal(await focused(entry().first()), true, "Shift+Tab navigates normally, not to the missing column");
  await entry().last().press("Tab"); await settleFocus();
  assert.equal(await outsideGrid(), true, "incomplete non-editor Tab leaves the grid");
  assert.equal(await focused(add()), true);
  await page.getByRole("alert").filter({ hasText: "Add Amount to add this row." }).waitFor();
  await entry().last().press("F2"); await editor().press("Tab"); await settleFocus();
  assert.equal(await outsideGrid(), true, "incomplete editor Tab accepts locally and leaves the grid");
  assert.equal(await focused(add()), true, "missing-input hint must not steal focus back");
  assert.equal(await requests(), noInserts);
  assert.deepEqual(await projection(page), empty);
  assert.equal(await entry().first().locator(".ts-cell-value").textContent(), "Retained");
  assert.equal(await entry().last().locator(".ts-cell-value").textContent(), "false", "draft boolean uses the published spelling");
  await entry().last().press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "New row Amount (Number)");
  assert.equal(await requests(), noInserts, "only Enter redirects incomplete input; it still cannot publish");
  checks.push("amendment-incomplete-cell-and-editor-tab-announced-hint-exit-enter-only-redirect");

  await page.keyboard.press("F2"); await editor().fill("abc"); await editor().press("Enter"); await ready(page);
  await page.getByRole("alert").filter({ hasText: "Amount needs a number." }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "New row Amount (Number)");
  assert.equal(await entry().nth(1).getAttribute("aria-invalid"), "true");
  assert.deepEqual(await projection(page), empty);
  await capture("inline-refusal");
  await page.keyboard.press("F2"); await editor().fill("12"); await editor().press("Enter"); await ready(page);
  await page.waitForFunction(() => document.activeElement?.matches('.ts-entry-row [data-entry-field]'));
  const added = await projection(page);
  const names = new Map(added.columns.map(column => [column.id, column.key]));
  assert.deepEqual(added.rows.map(row => Object.fromEntries(row.fields.map(field => [names.get(field.target.field), field.stored.value]))), [{ item: "Retained", amount: 12, paid: false }]);
  assert.equal(await page.locator("tbody .ts-row td").last().locator(".ts-cell-value").textContent(), "false", "published and draft boolean spellings match");
  await capture("after-add");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page);
  assert.deepEqual((await projection(page)).rows, empty.rows);
  checks.push("amendment-refusal-correction-preserves-other-values-add-undo-and-eight-review-screens");
  await close();

  await create("Boolean normalization", [["Paid", "boolean"]]);
  const beforeBoolean = await requests();
  await fillDraftCell(page, entry().first(), "maybe");
  await entry().first().press("Enter");
  await draftActions(page).getByRole("alert").filter({ hasText: "Add Paid to add this row." }).waitFor();
  assert.equal(await requests(), beforeBoolean, "non-boolean text stays incomplete without dispatch");
  assert.equal((await projection(page)).rows.length, 0);
  await fillDraftCell(page, entry().first(), " TRUE ");
  assert.equal(await entry().first().locator(".ts-cell-value").textContent(), "true");
  await entry().first().press("Tab"); await ready(page);
  await page.waitForFunction(() => document.activeElement?.matches('.ts-entry-row [data-entry-field]'));
  assert.equal(await requests(), beforeBoolean + 1, "normalized boolean last-cell Tab publishes exactly once");
  assert.deepEqual((await projection(page)).rows.map(row => row.fields[0].stored), [{ kind: "boolean", value: true }]);
  checks.push("review-p2-normalized-boolean-preview-readiness-typed-publication-invalid-kept");
  await close();

}

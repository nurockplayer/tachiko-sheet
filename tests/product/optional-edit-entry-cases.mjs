import assert from "node:assert/strict";
import { homeImportInput } from "./home-entry.mjs";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

// Ordinary UI is the only writer. __exportEvidence copies real Worker traffic.
export async function runOptionalEditEntryCases(page, { close, checks }) {
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const projection = () => page.evaluate(() => structuredClone(window.__exportEvidence.table));
  const commands = type => page.evaluate(type => window.__exportEvidence.requests.filter(item => item.request?.type === type).map(item => item.request), type);
  const undo = async () => { await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(); };
  const noUndo = async () => assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true, "no extra history action");
  const paste = (cell, text) => cell.evaluate((node, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await (await homeImportInput(page)).setInputFiles({ name: "optional-entry.csv", mimeType: "text/csv", buffer: Buffer.from("Row,Note,Amount,Extra\nblank,,,\npresent,kept,2,present-extra\n") });
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  for (const [i, type] of ["text", "text", "number", "text"].entries()) await preview.locator("select").nth(i).selectOption(type);
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await preview.waitFor({ state: "detached" }); await ready();
  const baseline = await projection();
  assert.equal(baseline.native_table_profile, true);
  assert.deepEqual(baseline.columns.map(column => [column.field_type, column.required]), [["text", false], ["text", false], ["number", false], ["text", false]]);
  const ids = baseline.columns.map(column => column.id);
  const entity = baseline.rows[0].id;
  const target = (r, c) => ({ entity: baseline.rows[r].id, field: ids[c] });
  const cell = (r, c) => page.getByTestId(`cell:${baseline.rows[r].id}:${ids[c]}`);
  const input = () => page.getByTestId("cell-editor");
  async function assertBlank(row, index) {
    assert.ok(row.blank_fields.includes(ids[index]));
    assert.equal(row.fields.some(field => field.target.field === ids[index]), false, "blank is sparse, not empty Text");
    const element = page.getByTestId(`cell:${row.id}:${ids[index]}`);
    assert.equal(await element.textContent(), "");
    assert.equal(await element.getAttribute("aria-description"), "Blank");
    assert.equal(await element.locator(".ts-cell--empty-text, .ts-empty-text-marker").count(), 0);
    assert.equal((await element.getAttribute("class")).includes("ts-cell--empty-text"), false);
  }
  for (const index of [1, 2, 3]) {
    await assertBlank(baseline.rows[0], index);
    assert.equal(await cell(0, index).getAttribute("aria-readonly"), "false");
  }
  // Navigation/selection include sparse slots, independently of editing.
  await cell(0, 0).focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await cell(0, 1).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await cell(0, 2).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Shift+ArrowLeft");
  assert.equal(await cell(0, 1).getAttribute("aria-selected"), "true");
  assert.equal(await cell(0, 2).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Escape");

  const scalarCount = (await commands("edit_scalar")).length;
  for (const erase of [false, true]) {
    await cell(0, 1).press("F2");
    if (erase) { await input().fill("temporary"); await input().fill(""); }
    await input().press("Enter"); await ready();
    assert.equal((await commands("edit_scalar")).length, scalarCount, "empty/unchanged blank editor dispatches nothing");
    assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  }
  await cell(0, 1).focus(); await page.keyboard.press("x");
  await input().fill("Typed blank"); await input().press("Enter"); await ready();
  const typed = await projection();
  const scalar = (await commands("edit_scalar")).at(-1);
  assert.equal((await commands("edit_scalar")).length, scalarCount + 1);
  assert.deepEqual(scalar, { type: "edit_scalar", expected_revision: baseline.revision, target: target(0, 1), input: { kind: "text", value: "Typed blank" } });
  assert.equal(typed.rows[0].fields.find(field => field.target.field === ids[1]).stored.value, "Typed blank");
  assert.ok(!typed.rows[0].blank_fields.includes(ids[1]));
  await undo(); assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  await assertBlank((await projection()).rows[0], 1);

  // An entirely empty paste on blank slots is a no-op, even before dispatch.
  const editCount = (await commands("edit_cells")).length;
  await cell(0, 1).click(); await paste(cell(0, 1), "\t");
  await page.locator(".ts-clipboard-status").filter({ hasText: "The pasted cells are unchanged." }).waitFor();
  assert.equal((await commands("edit_cells")).length, editCount);
  assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  const beforePaste = await projection();
  await paste(cell(0, 1), "\t7\tPasted\nupdated\t3\t");
  await page.locator(".ts-clipboard-status").filter({ hasText: "Updated 2 rows" }).waitFor(); await ready();
  assert.equal((await commands("edit_cells")).length, editCount + 1);
  assert.deepEqual((await commands("edit_cells")).at(-1), { type: "edit_cells", expected_revision: beforePaste.revision, edits: [
    { target: target(0, 2), input: { kind: "number", input: "7" } },
    { target: target(0, 3), input: { kind: "text", value: "Pasted" } },
    { target: target(1, 1), input: { kind: "text", value: "updated" } },
    { target: target(1, 2), input: { kind: "number", input: "3" } },
    { target: target(1, 3), input: { kind: "clear" } },
  ] });
  const pasted = await projection();
  await assertBlank(pasted.rows[0], 1);
  assert.equal(pasted.rows[0].fields.find(field => field.target.field === ids[2]).stored.value, 7);
  assert.equal(pasted.rows[0].fields.find(field => field.target.field === ids[3]).stored.value, "Pasted");
  await assertBlank(pasted.rows[1], 3);
  // Linked facts must share the grid's column-aware presence rendering.
  await cell(1, 3).click();
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const emptyFact = page.getByTestId(`brief:${baseline.rows[1].id}:${ids[3]}`);
  assert.equal(await emptyFact.textContent(), "");
  assert.equal(await emptyFact.getAttribute("aria-description"), "Blank");
  assert.equal(await emptyFact.locator(".ts-cell-value").getAttribute("aria-hidden"), null);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await cell(0, 1).click();
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const blankFact = page.getByTestId(`brief:${baseline.rows[0].id}:${ids[1]}`);
  assert.equal(await blankFact.textContent(), "");
  assert.equal(await blankFact.getAttribute("aria-description"), "Blank");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await undo(); assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  checks.push("Brief linked facts share grid cleared optional Text accessibility and sparse blank rendering");
  checks.push("P1-a actual imported optional sparse slots: navigation/range selection; blank editor/no-op; exact typed target; atomic mixed blank/present paste; empty-on-blank unchanged; one-step Undo restores every blank/value/ID");

  // One mixed overwrite/append request. Empty existing-row Text stays a raw
  // value; only new optional slots carry explicit absence to paste_cells.
  await cell(1, 0).click();
  const beforeAppend = await projection();
  const pasteCount = (await commands("paste_cells")).length;
  const scalarBeforeAppend = (await commands("edit_scalar")).length;
  const editsBeforeAppend = (await commands("edit_cells")).length;
  const insertsBeforeAppend = (await commands("insert_row")).length;
  await paste(cell(1, 0), "present\tkept\t2\tpresent-extra\nappended\t\t\t\nzero\t \t0\t");
  await page.locator(".ts-clipboard-status").filter({ hasText: "Updated 3 rows" }).waitFor(); await ready();
  assert.equal((await commands("paste_cells")).length, pasteCount + 1);
  assert.equal((await commands("edit_scalar")).length, scalarBeforeAppend);
  assert.equal((await commands("edit_cells")).length, editsBeforeAppend);
  assert.equal((await commands("insert_row")).length, insertsBeforeAppend);
  assert.deepEqual((await commands("paste_cells")).at(-1), { type: "paste_cells", expected_revision: beforeAppend.revision,
    collection: baseline.collection.key, start_entity: baseline.rows[1].id, start_field: ids[0], rows: [
      ["present", "kept", "2", "present-extra"],
      ["appended", { kind: "clear" }, { kind: "clear" }, { kind: "clear" }],
      ["zero", " ", "0", { kind: "clear" }],
    ] });
  const appended = await projection();
  assert.equal(appended.rows.length, baseline.rows.length + 2);
  for (const original of baseline.rows) assert.deepEqual(appended.rows.find(row => row.id === original.id), original);
  const blankAppend = appended.rows.find(row => row.fields.some(field => field.target.field === ids[0] && field.stored?.value === "appended"));
  assert.ok(blankAppend);
  for (const i of [1, 2, 3]) await assertBlank(blankAppend, i);
  const zeroAppend = appended.rows.find(row => row.fields.some(field => field.target.field === ids[0] && field.stored?.value === "zero"));
  assert.ok(zeroAppend);
  assert.deepEqual(zeroAppend.fields.find(field => field.target.field === ids[1]).stored, { kind: "text", value: " " });
  assert.deepEqual(zeroAppend.fields.find(field => field.target.field === ids[2]).stored, { kind: "number", value: 0 });
  await assertBlank(zeroAppend, 3);
  await undo(); assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  checks.push("append-paste real optional Text/Number blanks use explicit absence; existing records unchanged; whitespace/zero values preserved; one request and one Undo removes both appended records");

  const draft = () => page.locator(".ts-entry-row");
  const draftCell = index => draft().locator(`[data-entry-field="${ids[index]}"]`);
  const insertCount = (await commands("insert_row")).length;
  await draftCell(0).press("Enter"); await input().press("Enter");
  await draftCell(3).press("Tab");
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  assert.equal((await commands("insert_row")).length, insertCount, "untouched all-optional row never dispatches");
  assert.equal(await page.locator(".ts-row-error").count(), 0, "no missing-value nag");
  await noUndo();
  for (const [index, raw] of [[0, "Partial"], [2, "0"], [3, " "]]) {
    const beforeInsert = await projection();
    const count = (await commands("insert_row")).length;
    await fillDraftCell(page, draftCell(index), raw);
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
    assert.equal((await commands("insert_row")).length, count + 1);
    assert.deepEqual((await commands("insert_row")).at(-1), { type: "insert_row", expected_revision: beforeInsert.revision, collection: beforeInsert.collection.key,
      initializers: [{ field: ids[index], input: index === 2 ? { kind: "number", input: raw } : { kind: "text", value: raw } }] });
    const inserted = await projection();
    const row = inserted.rows.find(row => !baseline.rows.some(original => original.id === row.id));
    assert.ok(row); assert.equal(inserted.rows.length, baseline.rows.length + 1);
    assert.deepEqual(row.fields.map(field => field.stored), [index === 2 ? { kind: "number", value: 0 } : { kind: "text", value: raw }]);
    for (const blankIndex of [0, 1, 2, 3].filter(i => i !== index)) await assertBlank(row, blankIndex);
    await undo(); assert.deepEqual((await projection()).rows, baseline.rows); await noUndo();
  }
  const beforeRefusal = await projection();
  await fillDraftCell(page, draftCell(0), "Retained");
  await fillDraftCell(page, draftCell(2), "abc");
  const refusedCount = (await commands("insert_row")).length;
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  await draftActions(page).getByRole("alert").waitFor();
  assert.equal((await commands("insert_row")).length, refusedCount + 1, "invalid optional Number reaches Work");
  assert.deepEqual(await projection(), beforeRefusal, "refusal preserves revision and every stored fact");
  assert.equal(await draftCell(0).locator(".ts-cell-value").textContent(), "Retained");
  assert.equal(await draftCell(2).locator(".ts-cell-value").textContent(), "abc");
  await page.waitForFunction(selector => document.querySelector(selector) === document.activeElement, `[data-entry-field="${ids[2]}"]`);
  await noUndo();
  await draftActions(page).getByRole("button", { name: "Discard", exact: true }).click();
  assert.equal((await commands("insert_row")).length, refusedCount + 1);
  checks.push("P1-b actual all-optional import: untouched no-dispatch/no-nag; sparse draft initializers; optional-only text/zero/whitespace; blank projection/empty display; single Undo; Work refusal retains input/focus and no history");
  await close(page);
}

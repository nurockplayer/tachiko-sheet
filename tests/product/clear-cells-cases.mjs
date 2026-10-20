// #229: real kit fixtures, ordinary UI writers, passive Worker projection observer.
import assert from "node:assert/strict";
import { homeImportInput } from "./home-entry.mjs";

async function fixture(page, derived = false) {
  return page.evaluate(async derived => {
    const { createExperimentalDesignerClient } = await import("/core-kit/experimental-client.js");
    const client = createExperimentalDesignerClient();
    try {
      const opened = await client.newTable("Clear cells", [
        { name: "Note", field_type: "text", required: false },
        { name: "Amount", field_type: "number", required: false },
        { name: "Required text", field_type: "text" },
        { name: "Required number", field_type: "number" },
        { name: "When", field_type: "date" },
        { name: "Paid", field_type: "boolean" },
      ]);
      const { columns, collection } = opened.table;
      let revision = opened.table.revision;
      for (const values of [["kept", 2, "required", 7, "2026-10-20", false], ["", undefined, "", 0, "2026-10-21", true], [undefined, undefined, "last", 3, "2026-10-22", false]]) {
        revision = (await client.trackerCommand({ type: "insert_row", expected_revision: revision, collection: collection.key,
          initializers: columns.flatMap((column, i) => values[i] === undefined ? [] : [{ field: column.id,
            input: column.field_type === "number" ? { kind: "number", input: String(values[i]) } : column.field_type === "boolean" ? { kind: "boolean", value: values[i] }
              : { kind: column.field_type, value: values[i] } }]),
        })).resulting_revision;
      }
      let table = await client.queryTable(collection.key);
      let formulaTable = null;
      if (derived) {
        const copy = await client.duplicateCollection(revision, collection.key, "Derived");
        formulaTable = await client.queryTable(copy.collection.key);
        revision = (await client.updateFormula(copy.publication.resulting_revision,
          { entity: formulaTable.rows[0].id, field: formulaTable.columns[1].id }, `[${table.rows[0].key}.${columns[1].key}] + 1`)).resulting_revision;
        table = await client.queryTable(collection.key);
      }
      const exported = await client.exportPortableRo(revision);
      return { table, formulaKey: formulaTable?.collection.key, bytes: [...new Uint8Array(exported.bytes)] };
    } finally { await client.close(); }
  }, derived);
}

export async function runClearCellsCases(page, { close, checks }) {
  let formulaKey;
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const projection = () => page.evaluate(() => structuredClone(window.__exportEvidence.table));
  const commands = () => page.evaluate(() => window.__exportEvidence.requests.filter(item => ["edit_cells", "edit_scalar"].includes(item.request?.type)).map(item => item.request));
  const editor = () => page.getByTestId("cell-editor");
  const status = text => page.locator('.ts-clipboard-status[role="status"]').filter({ hasText: text });
  const paste = (cell, text) => cell.evaluate((node, text) => {
    const data = new DataTransfer(); data.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  const noUndo = async () => assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true, "no extra history action");
  const openFixture = async derived => {
    const built = await fixture(page, derived);
    formulaKey = built.formulaKey;
    await page.getByTestId("open-work-file").setInputFiles({ name: "clear-cells.ro", mimeType: "application/octet-stream", buffer: Buffer.from(built.bytes) });
    await ready();
    if (derived) { await page.locator("#ts-active-table").selectOption(built.table.collection.key); await ready(); }
    return projection();
  };
  const baseline = await openFixture(false);
  assert.equal(baseline.native_table_profile, true);
  assert.deepEqual(baseline.columns.map(c => c.required), [false, false, true, true, true, true]);
  const cell = (r, c) => page.getByTestId(`cell:${baseline.rows[r].id}:${baseline.columns[c].id}`);
  const target = (r, c) => ({ entity: baseline.rows[r].id, field: baseline.columns[c].id });
  const undo = async () => {
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
    assert.deepEqual((await projection()).rows, baseline.rows, "one Undo restores every value and presence bit exactly"); await noUndo();
  };
  const assertBlank = async (r, c) => {
    const row = (await projection()).rows[r];
    assert.ok(row.blank_fields.includes(baseline.columns[c].id));
    assert.equal(row.fields.some(f => f.target.field === baseline.columns[c].id), false);
    assert.equal(await cell(r, c).textContent(), ""); assert.equal(await cell(r, c).getAttribute("aria-description"), "Blank");
  };
  async function accepted(action, edits, scalar = false) {
    const before = await projection(), count = (await commands()).length;
    await action();
    await status(`Cleared ${edits.length} cell`).waitFor(); await ready();
    assert.equal((await commands()).length, count + 1, "exactly one mutation request");
    assert.deepEqual((await commands()).at(-1), scalar ? { type: "edit_scalar", expected_revision: before.revision, ...edits[0] }
      : { type: "edit_cells", expected_revision: before.revision, edits });
  }
  const clear = (r, c) => ({ target: target(r, c), input: { kind: "clear" } });
  const empty = (r, c) => ({ target: target(r, c), input: { kind: "text", value: "" } });
  // Both optional types and required Text empty commits; exact single action.
  for (const c of [0, 1, 2]) {
    await cell(0, c).press("F2"); await editor().fill("");
    await accepted(() => editor().press("Enter"), [c === 2 ? empty(0, c) : clear(0, c)], c === 2);
    if (c < 2) await assertBlank(0, c);
    else assert.deepEqual((await projection()).rows[0].fields.find(f => f.target.field === target(0, c).field).stored, { kind: "text", value: "" });
    await undo();
  }
  checks.push("#229 empty commit optional Text/Number explicit clear and required Text explicit empty; one request/Undo restores presence exactly");
  for (const [c, label] of [[3, "Number"], [4, "Date"], [5, "Yes/No"]]) {
    const before = await projection(), count = (await commands()).length;
    await cell(0, c).press("F2"); await editor().fill(""); await editor().press("Enter");
    await status(`This ${label} column needs a value in every row.`).waitFor();
    assert.equal(await editor().inputValue(), ""); assert.equal(await editor().evaluate(n => n === document.activeElement), true);
    assert.equal((await commands()).length, count); assert.deepEqual(await projection(), before); await noUndo();
    await editor().press("Escape");
  }
  checks.push("#229 required Number/Date/Yes-No empty commit refuses locally with type guidance, retained editor/input/focus and zero dispatch/history");
  // Unchanged values, stored empty Text and blanks never dispatch or add history.
  for (const [r, c] of [[0, 0], [0, 1], [0, 5], [1, 0], [1, 2], [2, 0], [2, 1]]) {
    const count = (await commands()).length, before = await projection();
    await cell(r, c).press("F2"); await editor().press("Enter"); await editor().waitFor({ state: "detached" });
    assert.equal((await commands()).length, count); assert.deepEqual(await projection(), before); await noUndo();
  }
  checks.push("#229 unchanged editors including stored empty Text and sparse blanks are no-op with no request/history");
  for (const [r, c] of [[0, 0], [0, 1], [0, 2], [1, 0]]) {
    await cell(r, c).click();
    await accepted(() => page.keyboard.press("Delete"), [c === 2 ? empty(r, c) : clear(r, c)]);
    if (c !== 2) await assertBlank(r, c);
    await undo();
  }
  checks.push("#229 Delete single optional Text/Number, present empty optional Text and required Text; atomic one-step Undo");
  await cell(0, 0).click(); await cell(2, 2).click({ modifiers: ["Shift"] });
  await accepted(() => page.keyboard.press("Backspace"), [clear(0, 0), clear(0, 1), empty(0, 2), clear(1, 0), empty(2, 2)]);
  for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]) await assertBlank(r, c);
  await undo();
  checks.push("#229 Backspace 3x3 mixed optional/required Text range uses one atomic request, omits blanks/unchanged Text, one Undo restores exact presence");
  for (const [c, label] of [[3, "Number"], [4, "Date"], [5, "Yes/No"]]) {
    await cell(0, 0).click(); await cell(1, c).click({ modifiers: ["Shift"] });
    const before = await projection(), count = (await commands()).length;
    const selected = await page.locator('td[aria-selected="true"]').evaluateAll(nodes => nodes.map(n => n.dataset.testid));
    await page.keyboard.press(c === 3 ? "Backspace" : "Delete"); await status("This Number column needs a value in every row.").waitFor();
    assert.equal((await commands()).length, count); assert.deepEqual(await projection(), before);
    assert.deepEqual(await page.locator('td[aria-selected="true"]').evaluateAll(nodes => nodes.map(n => n.dataset.testid)), selected);
    await noUndo();
    await cell(0, c).click(); await page.keyboard.press("Delete"); await status(`This ${label} column needs a value in every row.`).waitFor();
    assert.equal((await commands()).length, count); await noUndo();
  }
  checks.push("#229 required Number/Date/Yes-No Delete and mixed range refusal: zero dispatch, whole projection/history/selection preserved");
  await cell(2, 0).click(); await cell(2, 1).click({ modifiers: ["Shift"] });
  const noOpCount = (await commands()).length;
  await page.keyboard.press("Backspace"); await status("The selected cells are unchanged.").waitFor();
  assert.equal((await commands()).length, noOpCount); await noUndo();
  await cell(1, 2).click(); await page.keyboard.press("Delete"); await status("The selected cells are unchanged.").waitFor();
  assert.equal((await commands()).length, noOpCount); await noUndo();
  checks.push("#229 all-blank range and already-empty required Text Delete are no-op without dispatch/history or browser navigation");
  // Native text editing and composition never invoke grid clear.
  await cell(0, 0).press("F2"); await editor().fill("abcd");
  const beforeKeys = await projection(), keyCount = (await commands()).length;
  await editor().press("End"); await editor().press("Backspace"); assert.equal(await editor().inputValue(), "abc");
  await editor().press("Home"); await editor().press("Delete"); assert.equal(await editor().inputValue(), "bc");
  assert.equal((await commands()).length, keyCount); assert.deepEqual(await projection(), beforeKeys); await editor().press("Escape");
  for (const key of ["Delete", "Backspace"]) {
    await cell(0, 0).evaluate((node, key) => node.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, cancelable: true })), key);
    assert.equal((await commands()).length, keyCount); assert.deepEqual(await projection(), beforeKeys);
  }
  await cell(0, 0).evaluate(node => node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await page.keyboard.press("Delete"); await page.keyboard.press("Backspace");
  assert.equal((await commands()).length, keyCount); assert.deepEqual(await projection(), beforeKeys);
  await cell(0, 0).evaluate(node => node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.waitForTimeout(30); await noUndo();
  checks.push("#229 editor Backspace/Delete retain text-editing meaning; composing key and active composition events dispatch nothing (synthetic guard coverage)");
  await cell(0, 0).click(); const beforePaste = await projection(), pasteCount = (await commands()).length;
  await paste(cell(0, 0), "\t\t\n\t\t"); await page.locator(".ts-clipboard-status").filter({ hasText: "Updated 2 rows" }).waitFor(); await ready();
  assert.equal((await commands()).length, pasteCount + 1);
  assert.deepEqual((await commands()).at(-1), { type: "edit_cells", expected_revision: beforePaste.revision, edits: [clear(0, 0), clear(0, 1), empty(0, 2), clear(1, 0)] });
  await assertBlank(0, 0); await assertBlank(0, 1); await assertBlank(1, 0); await undo();
  for (const [c, label] of [[3, "Number"], [4, "Date"], [5, "Yes/No"]]) {
    await cell(0, c).click(); const before = await projection(), count = (await commands()).length;
    await paste(cell(0, c), ""); await page.locator(".ts-clipboard-status").filter({ hasText: `This ${label} column needs a value in every row.` }).waitFor();
    assert.equal((await commands()).length, count); assert.deepEqual(await projection(), before); await noUndo();
  }
  await cell(0, 0).click();
  const mixedPasteBefore = await projection(), mixedPasteCount = (await commands()).length;
  await paste(cell(0, 0), "\t\t\t"); await status("This Number column needs a value in every row.").waitFor();
  assert.equal((await commands()).length, mixedPasteCount); assert.deepEqual(await projection(), mixedPasteBefore); await noUndo();
  await cell(2, 0).click(); const blankPasteCount = (await commands()).length;
  await paste(cell(2, 0), "\t"); await status("The pasted cells are unchanged.").waitFor();
  assert.equal((await commands()).length, blankPasteCount); await noUndo();
  checks.push("#229 paste-with-clear over existing rows: optional clear/required empty Text mixed payload; blank no-op; required scalar whole-paste local refusal; exact Undo/no history");
  // Nonempty lexical input is preserved, including whitespace, zero and false.
  await cell(0, 0).click(); await paste(cell(0, 0), " \t0\trequired\t7\t2026-10-20\tfalse");
  await page.locator(".ts-clipboard-status").filter({ hasText: "Updated 1 row" }).waitFor(); await ready();
  const values = (await projection()).rows[0].fields.map(f => f.stored);
  assert.ok(values.some(v => v?.kind === "text" && v.value === " "));
  assert.ok(values.some(v => v?.kind === "number" && v.value === 0));
  assert.ok(values.some(v => v?.kind === "boolean" && v.value === false));
  await undo(); checks.push("#229 whitespace/zero/false paste remain values and Undo restores exact prior values");
  await close(page);

  // A separate formula table consumes a native source. Work alone determines
  // whether a clear is legal; the UI never traverses dependencies.
  const derived = await openFixture(true);
  assert.equal(derived.native_table_profile, true);
  const source = page.getByTestId(`cell:${derived.rows[0].id}:${derived.columns[1].id}`);
  for (const mode of ["editor", "range", "paste"]) {
    await source.click(); const before = await projection(), count = (await commands()).length;
    const publishedBefore = await page.evaluate(() => window.__exportEvidence.replies.filter(r => r.response?.type === "published").length);
    if (mode === "editor") { await source.press("F2"); await editor().fill(""); await editor().press("Enter"); }
    else if (mode === "range") await page.keyboard.press("Delete");
    else await paste(source, "");
    await page.locator(".ts-clipboard-status").filter({ hasText: /not applied|not cleared|validation|calculation/i }).waitFor(); await ready();
    assert.equal((await commands()).length, count + 1, "one clear reaches the real Work validator");
    assert.deepEqual((await commands()).at(-1).edits, [{ target: { entity: derived.rows[0].id, field: derived.columns[1].id }, input: { kind: "clear" } }]);
    assert.deepEqual(await projection(), before); await noUndo();
    const refusal = await page.evaluate(() => window.__exportEvidence.replies.findLast(r => r.status === "error").error);
    assert.ok((await page.locator(".ts-clipboard-status").allTextContents()).join(" ").includes(refusal.message), "Work refusal is surfaced without invented diagnostics");
    assert.equal(await page.evaluate(() => window.__exportEvidence.replies.filter(r => r.response?.type === "published").length), publishedBefore, "Work published nothing");
    if (mode === "editor") {
      assert.equal(await editor().inputValue(), "");
      await page.waitForFunction(() => document.activeElement?.dataset.testid === "cell-editor");
      await editor().press("Escape");
    } else assert.equal(await source.getAttribute("aria-selected"), "true");
  }
  checks.push("#229 real Work derived-input clear refusal through editor/grid/paste: explicit clear reaches validator, no publication/history, editor input/focus or grid selection retained");
  await page.locator("#ts-active-table").selectOption(formulaKey); await ready();
  const formulaView = await projection();
  assert.notEqual(formulaView.native_table_profile, true);
  const formulaCell = page.getByTestId(`cell:${formulaView.rows[0].id}:${formulaView.columns[1].id}`);
  assert.equal(await formulaCell.getAttribute("aria-readonly"), "true");
  const formulaCount = (await commands()).length;
  await formulaCell.click(); await page.keyboard.press("Delete"); await status("This table cannot be cleared here.").waitFor();
  assert.equal((await commands()).length, formulaCount); assert.deepEqual(await projection(), formulaView); await noUndo();
  checks.push("#229 derived/non-native table Delete refuses plainly with zero dispatch, no skipped formula target and no history");
  await close(page);

  const imported = await page.evaluate(async () => {
    const { createExperimentalDesignerClient } = await import("/core-kit/experimental-client.js");
    const client = createExperimentalDesignerClient();
    try {
      const input = new TextEncoder().encode("Row,When,Paid\nBlank,,\nPresent,2026-10-20,false\n").buffer;
      const result = await client.importSpreadsheet(input, "csv", { delimiter: ",", header: true }, { column_types: [["text", "date", "boolean"]], extra_columns: [[]] });
      const exported = await client.exportPortableRo(result.opened.table.revision);
      return [...new Uint8Array(exported.bytes)];
    } finally { await client.close(); }
  });
  await page.getByTestId("open-work-file").setInputFiles({ name: "readonly-clear.ro", mimeType: "application/octet-stream", buffer: Buffer.from(imported) }); await ready();
  const readonly = await projection(), readonlyCount = (await commands()).length;
  assert.notEqual(readonly.native_table_profile, true);
  const readonlyCell = (r, c) => page.getByTestId(`cell:${readonly.rows[r].id}:${readonly.columns[c].id}`);
  for (const [r, c] of [[0, 1], [1, 2]]) {
    await readonlyCell(r, c).click(); await page.keyboard.press("Delete"); await status("This table cannot be cleared here.").waitFor();
    assert.equal((await commands()).length, readonlyCount); assert.deepEqual(await projection(), readonly); await noUndo();
  }
  await readonlyCell(0, 0).click(); await readonlyCell(1, 2).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Backspace"); await status("This table cannot be cleared here.").waitFor();
  assert.equal((await commands()).length, readonlyCount); assert.deepEqual(await projection(), readonly); await noUndo();
  checks.push("#229 imported optional Date/Yes-No single/range clearing refuses whole with zero requests, unchanged presence and no history");
  await close(page);

  // Use the admitted 8,406-row Text capacity profile, as clipboard-local does.
  // Smaller native-created fixtures hit the ordinary projection envelope
  // before they can supply a >1,024-cell rectangle.
  const csv = "Row,Note,Extra\r\n" + Array.from({ length: 8406 }, (_, i) => `row_${i},note,extra`).join("\r\n") + "\r\n";
  await (await homeImportInput(page)).setInputFiles({ name: "clear-limit.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  for (let c = 0; c < 3; c++) await preview.locator("select").nth(c).selectOption("text");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await preview.waitFor({ state: "detached" }); await ready();
  const largeBefore = await projection(), largeCount = (await commands()).length;
  assert.equal(largeBefore.native_table_profile, true);
  assert.equal(largeBefore.rows.length, 8406);
  const first = page.getByTestId(`cell:${largeBefore.rows[0].id}:${largeBefore.columns[0].id}`);
  await first.click();
  for (let i = 1; i < 350; i++) await page.keyboard.press("Shift+ArrowDown");
  for (let i = 1; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Backspace"); await status("The selected range exceeds the 1,024-cell limit.").waitFor();
  assert.equal((await commands()).length, largeCount); assert.deepEqual(await projection(), largeBefore); await noUndo();
  checks.push("#229 350x3 range exceeds 1,024: local refusal, no chunks/requests/publication/history");
  await close(page);
}

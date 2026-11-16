// #221: real Home import, clipboard events and read-only public-kit observations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { homeImportInput } from "./home-entry.mjs";

export async function runImportedClipboardCases({ page, work, ready, close, displayed, tableMetadata, commands, values, cell, paste, status, unchangedPaste, checks }) {
  async function importFile(file, types, expectedNative) {
    await (await homeImportInput(page)).setInputFiles(file);
    const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
    for (const [index, type] of types.entries()) await preview.locator(".ts-import-column select").nth(index).selectOption(type);
    await preview.getByRole("button", { name: "Import file", exact: true }).click();
    await preview.waitFor({ state: "detached" }); await ready();
    const table = await tableMetadata();
    assert.equal(Boolean(table.native_table_profile), expectedNative, "consume the real fixture projection, independent of import origin");
    assert.deepEqual(table.columns.map(column => column.field_type), types);
    return table;
  }
  const editsFor = (table, start, block) => block.flatMap((row, r) => row.map((value, c) => ({
    target: { entity: table.rows[start + r].id, field: table.columns[c].id },
    input: { kind: "text", value },
  })));


  await close();
  // Reuse the exact capacity-8406 fixture recipe and ordinary import path.
  const fixtures = path.join(work, "capacity-paste-fixtures");
  execFileSync("python3", ["-I", new URL("../../acceptance/capacity-8406/oracle.py", import.meta.url).pathname, "generate", fixtures], { stdio: "inherit" });
  page.setDefaultTimeout(60_000);
  const baseline = await importFile(path.join(fixtures, "source-8406.csv"), ["text", "text", "text"], true);
  assert.equal(baseline.rows.length, 8406);
  const start = 8000;
  async function scrollTo(index) {
    await page.evaluate(index => {
      const scroller = document.querySelector(".ts-grid-scroll");
      const pitch = document.querySelector('table[aria-label="Table"] tbody tr.ts-row').offsetHeight;
      scroller.scrollTop = index * pitch - scroller.clientHeight / 2;
    }, index);
    await cell(baseline, index, 0).waitFor();
  }
  const samples = [0, 4203, 8405, start - 1, start, start + 1, start + 2];
  async function readSamples() {
    const rows = [];
    let revision;
    for (const index of samples) {
      await scrollTo(index);
      const grid = await displayed();
      revision ??= grid.revision;
      assert.equal(grid.revision, revision, "scrolling preserves the displayed revision");
      const row = grid.rows.find(row => row.id === baseline.rows[index].id);
      assert.ok(row, `sample row ${index + 1} displays its original identity`);
      assert.deepEqual(row.cells.map(cell => cell.field), baseline.columns.map(column => column.id));
      rows.push(row);
    }
    return { revision, rows };
  }
  const before = await readSamples();
  assert.equal(before.revision, baseline.revision, "imported fixture and grid start at the same revision");
  for (const [i, index] of samples.entries()) {
    assert.deepEqual(values(before)[i], baseline.columns.map(column =>
      String(baseline.rows[index].fields.find(field => field.target.field === column.id).stored.value)));
  }
  await scrollTo(start);
  const anchor = cell(baseline, start, 0);
  await anchor.waitFor();
  assert.equal(await anchor.locator("..").getAttribute("aria-rowindex"), String(start + 2));
  assert.ok(await page.locator("tbody tr.ts-row").count() < 400, "8,406-row import is genuinely windowed");
  assert.ok(await page.locator(".ts-grid-scroll").evaluate(node => node.scrollTop > node.clientHeight * 10), "paste is far scrolled");
  await anchor.click();
  const block = [["far-A", "https://example.invalid/pasted-A", "0001700008000001"], ["far-B", "https://example.invalid/pasted-B", "0001700008000002"]];
  const beforeCount = (await commands()).length;
  await paste(anchor, block.map(row => row.join("\t")).join("\n"));
  await status().filter({ hasText: "Updated 2 rows" }).waitFor();
  const after = await readSamples();
  assert.notEqual(after.revision, before.revision, "paste advances the application revision");
  assert.equal((await commands()).length, beforeCount + 1);
  assert.deepEqual((await commands()).at(-1), {
    type: "edit_cells", expected_revision: baseline.revision, edits: editsFor(baseline, start, block),
  }, "one command addresses exactly the six original stable targets at rows 8001–8002");
  for (const [i, index] of samples.entries()) {
    assert.deepEqual(after.rows[i].id, before.rows[i].id);
    assert.deepEqual(values(after)[i], index === start || index === start + 1 ? block[index - start] : values(before)[i],
      `displayed sample row ${index + 1}: pasted targets change and untouched samples stay intact`);
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await readSamples()).rows, before.rows, "one Undo restores every sampled displayed value and identity");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await readSamples()).rows, after.rows, "one Redo restores the pasted display and untouched samples");
  checks.push("221.a real capacity-8406 import; windowed far-scroll 2x3 paste; exact six stable targets; DOM values/revisions at both pasted rows and first/middle/last/adjacent untouched samples; one Undo/Redo");
  await close(); page.setDefaultTimeout(10000);

  const typedCsv = path.join(work, "imported-paste-types.csv");
  await writeFile(typedCsv, "Item,Paid,When\nfirst,false,2026-10-01\nsecond,true,2026-10-02\nuntouched,false,2026-10-03\n");
  // Work #606: imported optional Yes/No and Date columns keep the table native.
  await importFile(typedCsv, ["text", "boolean", "date"], true);
  const typedBaseline = await displayed();
  assert.deepEqual(values(typedBaseline), [["first", "false", "2026-10-01"], ["second", "true", "2026-10-02"], ["untouched", "false", "2026-10-03"]]);
  await cell(typedBaseline, 0, 0).click();
  const typedCount = (await commands()).length;
  await paste(cell(typedBaseline, 0, 0), "changed-first\tTrUe\t2026-10-19\nchanged-second\tFaLsE\t2026-10-20");
  await status().filter({ hasText: "Updated 2 rows" }).waitFor();
  const typedAfter = await displayed();
  const typedValues = [["changed-first", "true", "2026-10-19"], ["changed-second", "false", "2026-10-20"], ["untouched", "false", "2026-10-03"]];
  assert.deepEqual(values(typedAfter), typedValues);
  assert.deepEqual(typedAfter.rows.map(row => row.id), typedBaseline.rows.map(row => row.id));
  assert.deepEqual(typedAfter.rows[2], typedBaseline.rows[2], "untouched row is identical");
  assert.equal((await commands()).length, typedCount + 1);
  const typedCommand = (await commands()).at(-1);
  assert.equal(typedCommand.type, "edit_cells");
  assert.deepEqual(typedCommand.edits.map(edit => edit.target), editsFor(typedBaseline, 0, typedValues.slice(0, 2)).map(edit => edit.target));
  assert.deepEqual(typedCommand.edits.map(edit => edit.input), [
    { kind: "text", value: "changed-first" }, { kind: "boolean", value: true }, { kind: "date", value: "2026-10-19" },
    { kind: "text", value: "changed-second" }, { kind: "boolean", value: false }, { kind: "date", value: "2026-10-20" },
  ]);
  // Invalid value follows a valid row: refusal must also preserve its text/date peers.
  // An empty value clears an optional Yes/No (Work #606), so it is not a refusal.
  for (const bad of ["yes", "no", "1", "0", " TRUE ", "falsehood"]) {
    assert.equal(await unchangedPaste(`must-not-change\tTRUE\t2026-11-01\nalso-unchanged\t${bad}\t2026-11-02`, /true or false/), 0);
  }
  for (const bad of ["10/19/2026", "not-a-date", "2026-02-30"]) {
    assert.equal(await unchangedPaste(`must-not-change\tTRUE\t2026-11-01\nalso-unchanged\tFALSE\t${bad}`, /year first/), 1);
    assert.deepEqual((await commands()).at(-1).edits.at(-1).input, { kind: "date", value: bad }, "raw invalid date reaches Work unchanged");
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  assert.deepEqual((await displayed()).rows, typedBaseline.rows, "all refusals preserve the single successful paste history entry");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
  assert.deepEqual((await displayed()).rows, typedAfter.rows);
  checks.push("221.b–c real imported Text/Yes-No/Date fixture; exact mixed-case TRUE/FALSE folding and valid ISO dates; other Boolean text and invalid dates refuse whole, preserving every field/revision/history");
}

// #228: author fixtures through the real public kit, then open its opaque .ro
// through Home. No hand-written canonical state, codec or product test hook.
import assert from "node:assert/strict";
import path from "node:path";

const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const disclosure = "CSV cannot preserve the difference between blank cells and empty text; both export as empty cells.";
const copy = target => target.evaluate(node => {
  const data = new DataTransfer();
  node.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData("text/plain");
});

async function assertPresenceDescription(page, cell, description) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument");
    const testId = await cell.getAttribute("data-testid");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-testid="${testId}"]` });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    assert.equal(nodes[0].description?.value, description, "Chromium accessibility tree carries the presence description");
    assert.equal(nodes[0].name?.value, "", "hidden decoration and tooltips do not repeat the description as the cell name");
  } finally { await cdp.detach(); }
}

export async function runBlankDisplayCases(page, { output, close, checks }) {
  // Native optional Text/Number and required empty Text, zero and false.
  const fixture = await page.evaluate(async () => {
    const { createExperimentalDesignerClient } = await import("/core-kit/experimental-client.js");
    const client = createExperimentalDesignerClient();
    try {
      const opened = await client.newTable("Presence", [
        { name: "Row", field_type: "text" },
        { name: "Note", field_type: "text", required: false },
        { name: "Amount", field_type: "number", required: false },
        { name: "Required text", field_type: "text" },
        { name: "Paid", field_type: "boolean" },
      ]);
      const collection = opened.table.collection.key;
      const columns = opened.table.columns;
      let revision = opened.table.revision;
      for (const [label, note] of [["Blank", undefined], ["Empty text", ""], ["Whitespace", " "]]) {
        const values = [label, note, note === undefined ? undefined : 0, "", false];
        const initializers = columns.flatMap((column, i) => values[i] === undefined ? [] : [{
          field: column.id,
          input: column.field_type === "number" ? { kind: "number", input: String(values[i]) }
            : column.field_type === "boolean" ? { kind: "boolean", value: values[i] }
              : { kind: "text", value: values[i] },
        }]);
        revision = (await client.trackerCommand({ type: "insert_row", expected_revision: revision, collection, initializers })).resulting_revision;
      }
      const table = await client.queryTable(collection);
      const blankRow = table.rows.find(row => row.fields.some(field => field.stored?.value === "Blank"));
      const blank = await client.queryFields(revision, [{ entity: blankRow.id, field: columns[1].id }]);
      const exported = await client.exportPortableRo(revision);
      return { table, blank: blank.fields[0], bytes: [...new Uint8Array(exported.bytes)] };
    } finally { await client.close(); }
  });
  assert.equal(fixture.blank.blank, true);
  assert.equal(fixture.blank.stored, null);
  const { table } = fixture;
  const row = label => table.rows.find(row => row.fields.some(field => field.stored?.value === label));
  const cell = (label, index) => page.getByTestId(`cell:${row(label).id}:${table.columns[index].id}`);
  assert.equal(table.columns[1].required, false);
  assert.ok(row("Blank").blank_fields.includes(table.columns[1].id));
  await page.getByTestId("open-work-file").setInputFiles({ name: "presence.ro", mimeType: "application/octet-stream", buffer: Buffer.from(fixture.bytes) });
  await ready(page);
  assert.equal(await cell("Blank", 1).textContent(), "");
  await cell("Blank", 1).focus();
  assert.equal(await cell("Blank", 1).getAttribute("aria-description"), "Blank");
  assert.equal(await cell("Empty text", 1).textContent(), '""');
  assert.equal(await cell("Empty text", 1).getAttribute("aria-description"), "Empty text");
  assert.equal(await cell("Empty text", 1).locator(".ts-cell-value").getAttribute("aria-hidden"), "true");
  await assertPresenceDescription(page, cell("Blank", 1), "Blank");
  await assertPresenceDescription(page, cell("Empty text", 1), "Empty text");
  assert.equal(await copy(cell("Blank", 1)), "");
  assert.equal(await copy(cell("Empty text", 1)), "");
  assert.equal(await cell("Empty text", 3).textContent(), "", "required empty Text keeps its rendering");
  assert.equal(await cell("Empty text", 2).textContent(), "0");
  assert.equal(await cell("Empty text", 4).textContent(), "false");
  assert.equal(await cell("Whitespace", 1).textContent(), " ");
  assert.equal(await cell("Whitespace", 1).getAttribute("aria-description"), null);
  // A range containing decorated empty Text and a blank must copy two empty values.
  await cell("Blank", 1).click();
  await cell("Empty text", 1).click({ modifiers: ["Shift"] });
  assert.equal(await copy(cell("Empty text", 1)), '\n""');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `blank-empty-text-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.ok(!(await page.getByRole("tabpanel", { name: "Import & export", exact: true }).textContent()).includes(disclosure), "no invented presence warning before export");
  for (const format of ["XLSX", "CSV"]) {
    await page.getByRole("button", { name: `Prepare ${format}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
    await dialog.waitFor();
    assert.equal((await dialog.textContent()).includes(disclosure), format === "CSV", "presence loss appears only when the kit emits it");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
  checks.push("#228 real-kit optional blank vs empty Text; required Text unchanged; sparse-ID join; accessible descriptions; value-only single/range copy; CSV-only emitted presence disclosure; desktop/compact screenshots");
  await close(page);

  // The importer already admits optional Date/Boolean. Preserve its blanks;
  // this slice adds no Date/Boolean authoring operations.
  const imported = await page.evaluate(async () => {
    const { createExperimentalDesignerClient } = await import("/core-kit/experimental-client.js");
    const client = createExperimentalDesignerClient();
    try {
      const input = new TextEncoder().encode("Row,When,Paid\nBlank,,\nPresent,2026-10-20,false\n").buffer;
      const result = await client.importSpreadsheet(input, "csv", { delimiter: ",", header: true }, { column_types: [["text", "date", "boolean"]], extra_columns: [[]] });
      const table = result.opened.table;
      const exported = await client.exportPortableRo(table.revision);
      return { table, bytes: [...new Uint8Array(exported.bytes)] };
    } finally { await client.close(); }
  });
  await page.getByTestId("open-work-file").setInputFiles({ name: "imported-blanks.ro", mimeType: "application/octet-stream", buffer: Buffer.from(imported.bytes) });
  await ready(page);
  assert.equal(Boolean(imported.table.native_table_profile), false, "optional imported Date/Boolean do not acquire native authoring admission");
  assert.equal(await page.locator(".ts-entry-row").count(), 0, "no native draft-row operation is offered");
  const blankRow = imported.table.rows.find(row => row.blank_fields?.length === 2);
  assert.ok(blankRow);
  for (const column of imported.table.columns.slice(1)) {
    assert.equal(column.required, false);
    const cell = page.getByTestId(`cell:${blankRow.id}:${column.id}`);
    assert.equal(await cell.textContent(), "");
    assert.equal(await cell.getAttribute("aria-description"), "Blank");
  }
  checks.push("#228 real imported optional Date/Yes-No blanks remain visually empty and accessibly Blank");
  await close(page);
}

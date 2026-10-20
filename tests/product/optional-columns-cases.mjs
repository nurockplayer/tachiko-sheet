import assert from "node:assert/strict";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

// Passive copies of public Worker traffic are installed by native-export-local.
// All mutations below use the ordinary product UI and the real Work runtime.
export async function runOptionalColumnsCases(page, { close, checks, output }) {
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const projection = () => page.evaluate(() => structuredClone(window.__exportEvidence.table));
  const requests = type => page.evaluate(type => window.__exportEvidence.requests.filter(item => item.request?.type === type).map(item => item.request), type);
  const state = table => ({ columns: table.columns, rows: table.rows });
  const history = async name => { await page.getByRole("button", { name, exact: true }).click(); await ready(); };
  async function oneStep(before, after) {
    await history("Undo"); assert.deepEqual(state(await projection()), state(before));
    await history("Redo"); assert.deepEqual(state(await projection()), state(after));
  }
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  const cell = (table, row, column) => page.getByTestId(`cell:${table.rows[row].id}:${table.columns[column].id}`);
  async function menu(table, index, action, compact = false) {
    if (compact) {
      await cell(table, 0, index).focus();
      await page.getByRole("button", { name: "Column", exact: true }).click();
      await page.waitForFunction(() => Boolean(document.querySelector(".ts-column-toolbar .ts-command-menu")?.style.left));
    } else {
      await page.getByRole("columnheader", { name: table.columns[index].display_name, exact: true }).hover();
      await page.getByRole("button", { name: `Column actions for ${table.columns[index].display_name}`, exact: true }).click();
    }
    if (compact && output) await page.screenshot({ path: `${output}/230-requiredness-menu-390.png` });
    await page.getByRole("button", { name: action, exact: true }).click(); await ready();
  }
  async function add(name, type) {
    await page.getByRole("button", { name: "+ column", exact: true }).click();
    const d = dialog("Add column");
    await d.getByLabel("Column name", { exact: true }).fill(name);
    await d.getByLabel("Column type", { exact: true }).selectOption(type);
    return d;
  }
  async function submit(d) {
    await d.getByRole("button", { name: "Add column", exact: true }).click();
    await d.waitFor({ state: "detached" }); await ready();
  }

  await page.getByRole("button", { name: "New table", exact: true }).click();
  let d = dialog("New table");
  await d.getByLabel("Table name", { exact: true }).fill("Optional authoring");
  await d.getByLabel("Column 1 name", { exact: true }).fill("Note");
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByLabel("Column 2 name", { exact: true }).fill("Price");
  await d.getByLabel("Column 2 type", { exact: true }).selectOption("number");
  for (const index of [1, 2]) assert.equal(await d.getByLabel(`Column ${index} Required`, { exact: true }).isChecked(), false);
  if (output) await page.screenshot({ path: `${output}/230-new-table-optional.png` });
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await d.waitFor({ state: "detached" }); await ready();
  let table = await projection();
  assert.deepEqual(table.columns.map(column => [column.field_type, column.required]), [["text", false], ["number", false]]);
  assert.deepEqual((await requests("new_table")).at(-1).columns, [{ name: "Note", field_type: "text", required: false }, { name: "Price", field_type: "number", required: false }]);
  for (const [index, value] of [[0, "Tea"], [1, "7"]]) {
    const before = await projection();
    await fillDraftCell(page, page.locator(".ts-entry-row [data-entry-field]").nth(index), value);
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
    table = await projection();
    assert.deepEqual(table.rows.at(-1).blank_fields, [table.columns[1 - index].id]);
    await oneStep(before, table);
  }
  checks.push("230 optional Text/Number New table sends explicit false; ordinary draft inserts retain sparse blanks; each insert has one-step Undo/Redo");

  const beforeBlank = await projection();
  d = await add("Extra", "text");
  await d.getByText("Existing rows start blank", { exact: true }).waitFor();
  assert.equal(await d.getByLabel(/^Fill all/).count(), 0);
  if (output) await page.screenshot({ path: `${output}/230-add-column-blank.png` });
  await submit(d); table = await projection();
  const extra = table.columns.at(-1);
  assert.equal(extra.required, false);
  for (const row of table.rows) assert.ok(row.blank_fields.includes(extra.id));
  const blankCommand = (await requests("add_column")).at(-1);
  assert.equal(blankCommand.required, false);
  assert.equal(Object.hasOwn(blankCommand, "initializers"), false);
  await oneStep(beforeBlank, table);
  checks.push("230 optional add-column starts every existing row blank with no initializers; one-step Undo/Redo restores exact schema and rows");

  const beforeRefusal = await projection(), requestCount = (await requests("set_column_requiredness")).length;
  await menu(table, table.columns.length - 1, "Require a value");
  await page.getByRole("status").filter({ hasText: "2 rows in Extra are blank. Fill them before requiring a value." }).waitFor();
  assert.equal((await requests("set_column_requiredness")).length, requestCount + 1, "Work decides strengthening even when a complete count is available");
  assert.deepEqual(await projection(), beforeRefusal);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Column actions for Extra");
  await history("Undo"); assert.deepEqual(state(await projection()), state(beforeBlank), "refusal adds zero history; Undo removes the preceding column addition");
  await history("Redo"); assert.deepEqual(state(await projection()), state(beforeRefusal));
  checks.push("230 Work refuses strengthening sparse blanks; complete current count, polite status and trigger focus; unchanged revision and zero history");

  const beforeFilled = await projection();
  d = await add("Empty note", "text");
  await d.getByLabel("Fill existing rows", { exact: true }).check();
  await d.getByLabel(/^Fill all/).fill("");
  await submit(d); table = await projection();
  const emptyIndex = table.columns.length - 1;
  assert.equal((await requests("add_column")).at(-1).initializers.length, table.rows.length);
  assert.equal(await cell(table, 0, emptyIndex).getAttribute("aria-description"), "Empty text");
  await oneStep(beforeFilled, table);
  const beforeRequire = table;
  await menu(table, emptyIndex, "Require a value"); table = await projection();
  assert.equal(table.columns[emptyIndex].required, true, "empty Text is present and can be required");
  assert.equal(await cell(table, 0, emptyIndex).textContent(), "");
  assert.equal((await cell(table, 0, emptyIndex).getAttribute("class")).includes("ts-cell--empty-text"), false);
  await history("Undo");
  assert.deepEqual(state(await projection()), state(beforeRequire));
  assert.equal(await cell(table, 0, emptyIndex).getAttribute("aria-description"), "Empty text");
  assert.equal(await cell(table, 0, emptyIndex).textContent(), '""');
  await history("Redo"); assert.equal((await projection()).columns[emptyIndex].required, true);
  checks.push("230 Fill existing rows explicitly stores empty Text; Require accepts present empty Text; projection drives marker removal and one-step Undo restoration");

  const beforeRequired = await projection();
  d = await add("Filled price", "number");
  await d.getByLabel("Required", { exact: true }).check();
  await d.getByRole("button", { name: "Add column", exact: true }).click();
  await d.getByRole("alert").filter({ hasText: "Choose a fill value" }).waitFor();
  await d.getByLabel(/^Fill all/).fill("12.5");
  await d.getByLabel("Required", { exact: true }).uncheck();
  assert.equal(await d.getByLabel(/^Fill all/).count(), 0);
  await d.getByLabel("Fill existing rows", { exact: true }).check();
  assert.equal(await d.getByLabel(/^Fill all/).inputValue(), "12.5");
  await d.getByLabel("Required", { exact: true }).check();
  assert.equal(await d.getByLabel(/^Fill all/).inputValue(), "12.5");
  await submit(d); table = await projection();
  const filledIndex = table.columns.length - 1, filledId = table.columns[filledIndex].id;
  assert.equal(table.columns[filledIndex].required, true);
  assert.equal((await requests("add_column")).at(-1).required, true);
  assert.deepEqual(table.rows.map(row => row.fields.find(field => field.target.field === filledId).stored.value), [12.5, 12.5]);
  await oneStep(beforeRequired, table);
  checks.push("230 required Number addition mandates complete fill; Required/Fill switches retain typed input; one-step Undo/Redo");

  const required = await projection();
  await menu(required, filledIndex, "Allow blanks"); const optional = await projection();
  assert.equal(optional.columns[filledIndex].required, false); await oneStep(required, optional);
  await page.setViewportSize({ width: 390, height: 900 });
  await menu(optional, filledIndex, "Require a value", true); const restored = await projection();
  assert.equal(restored.columns[filledIndex].required, true);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Column");
  await page.setViewportSize({ width: 1400, height: 1000 });
  await oneStep(optional, restored);
  checks.push("230 desktop Allow blanks → compact Require a value round trip uses projected truth; each accepted action has exactly one Undo and returns focus");
  await close(page);
}

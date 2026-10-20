import assert from "node:assert/strict";
import { homeImportInput } from "./home-entry.mjs";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

// Normal UI with real imported metadata and Work export/refusal. The observer
// only copies requests/replies; no error, canonical data or success is injected.
export async function runImportedExportRefusalCases(page, { close, prepare, downloads, checks }) {
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await (await homeImportInput(page)).setInputFiles({ name: "layout.csv", mimeType: "text/csv", buffer: Buffer.from("Item,Amount\nTea,2\n") });
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.locator("select").nth(1).selectOption("number");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await preview.waitFor({ state: "detached" }); await ready();
  assert.equal((await page.evaluate(() => window.__exportEvidence.table)).native_table_profile, true);

  const renameRequests = () => page.evaluate(() => window.__exportEvidence.requests.filter(item => item.request?.type === "rename_column").length);
  const renameBefore = await renameRequests();
  const heading = page.locator(".ts-col-head").first();
  assert.equal(await heading.getAttribute("tabindex"), null, "imported heading has no Rename tab stop");
  await heading.dblclick();
  for (const key of ["Enter", "F2"]) await heading.dispatchEvent("keydown", { key, bubbles: true });
  assert.equal(await page.getByRole("dialog", { name: "Rename column", exact: true }).count(), 0);
  const disclosure = page.locator(".ts-column-overflow > summary").first();
  await disclosure.click();
  assert.equal(await page.getByRole("button", { name: "Rename…", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Remove…", exact: true }).isEnabled(), true);
  await disclosure.press("Escape");
  assert.equal(await page.getByRole("button", { name: "+ column", exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 900 });
  const compact = page.getByRole("button", { name: "Column", exact: true });
  await compact.click();
  assert.equal(await page.getByRole("button", { name: /^Rename/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add column…", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: /^Remove “/ }).isEnabled(), true);
  await compact.press("Escape");
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.getByRole("button", { name: "+ column", exact: true }).waitFor();
  assert.equal(await renameRequests(), renameBefore, "every gated entry point dispatches no Rename");

  async function add(name, fill) {
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    await page.getByRole("button", { name: "+ column", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add column", exact: true });
    await dialog.getByLabel("Column name", { exact: true }).fill(name);
    await dialog.getByLabel("Fill existing rows", { exact: true }).check();
    await dialog.getByLabel(/^Fill all/).fill(fill);
    await dialog.getByRole("button", { name: "Add column", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await ready();
    assert.ok((await page.evaluate(() => window.__exportEvidence.table)).columns.some(column => column.display_name === name));
  }
  // Rename of a surviving imported header is intentionally unreachable until
  // Work #560. A new explicit field heading is still supported by the import
  // export contract and exercises current headers without client-side guesses.
  await add("Current item", "Kept");
  const draft = page.locator(".ts-entry-row");
  await fillDraftCell(page, draft.getByLabel("New row Item (Text)", { exact: true }), "Coffee");
  await fillDraftCell(page, draft.getByLabel("New row Amount (Number)", { exact: true }), "3");
  await fillDraftCell(page, draft.getByLabel("New row Current item (Text)", { exact: true }), "Added");
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  // The new explicit name collides with a historical metadata heading. Work
  // allocates the emitted heading and reports imported_current_header, keeping
  // the original disclosure oracle reachable without renaming an import.
  await add("Item", "Collision");
  const expected = [["Item", "Amount", "Current item", "Item (2)"], ["Tea", "2", "Kept", "Collision"], ["Coffee", "3", "Added", "Collision"]];
  assert.deepEqual(await prepare(page, "csv"), expected, "explicit added heading and appended record reach the actual CSV");
  const ledger = await page.locator(".ts-ledger").textContent();
  assert.match(ledger, /The current column heading "Item" will download as "Item \(2\)"/);
  assert.match(ledger, /New columns and rows are added at the end with default formatting/);
  const baseline = await page.evaluate(() => structuredClone(window.__exportEvidence.table));

  // An explicit formula-leading new heading cannot be represented safely as CSV.
  await add("=Refused heading", "Unchanged");
  const before = await page.evaluate(() => structuredClone(window.__exportEvidence.table));
  const savedBefore = await page.getByTestId("save-status").textContent();
  const count = downloads.length;
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const ledgerBefore = await page.locator(".ts-ledger").textContent();
  const requestCount = await page.evaluate(() => window.__exportEvidence.requests.length);
  await page.getByRole("button", { name: "Prepare CSV", exact: true }).click();
  const alert = page.getByRole("region", { name: "Download spreadsheet", exact: true }).getByRole("alert");
  await alert.waitFor();
  assert.equal(await alert.textContent(), "This table changed in ways the original workbook layout can't represent, so it can't be downloaded in that layout. Your work is unchanged.");
  const evidence = await page.evaluate(start => ({
    requests: window.__exportEvidence.requests.slice(start).filter(item => /export/.test(item.operation?.type)),
    failure: window.__exportEvidence.replies.filter(item => item.status === "error").at(-1)?.error,
  }), requestCount);
  assert.equal(evidence.failure.code, "imported_spreadsheet_export_refused");
  assert.deepEqual(evidence.requests.map(item => item.operation.type), ["export"], "one metadata export; no silent native fallback");
  assert.equal(await page.locator(".ts-ledger").textContent(), ledgerBefore, "prior review findings remain available");
  assert.equal(await page.getByRole("dialog", { name: "Confirm download", exact: true }).count(), 0);
  assert.equal(downloads.length, count);
  assert.equal(await page.getByTestId("save-status").textContent(), savedBefore);
  assert.deepEqual(await page.evaluate(() => window.__exportEvidence.table), before, "every stored value, ID and revision survives refusal");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
  const undone = await page.evaluate(() => window.__exportEvidence.table);
  assert.deepEqual(undone.columns, baseline.columns, "refusal does not consume the Add-column Undo action");
  assert.deepEqual(undone.rows, baseline.rows, "Undo restores every baseline value and identity");
  assert.deepEqual(await prepare(page, "csv"), expected, "repair by Undo retains the original metadata route");
  checks.push("#228 imported Rename gated at headings/keyboard/tab stop/desktop and compact menu; explicit Add-column heading/structure CSV; real refusal; metadata review/work/save/history preserved; no fallback; Undo/retry");
  await close(page);
}

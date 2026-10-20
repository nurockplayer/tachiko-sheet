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

  const original = await page.evaluate(() => structuredClone(window.__exportEvidence.table));
  const fieldId = original.columns[0].id;
  const generatedKey = original.columns[0].key;
  const renameRequests = () => page.evaluate(() => window.__exportEvidence.requests.filter(item => item.request?.type === "rename_column").length);
  const heading = page.locator(".ts-col-head").first();
  const disclosure = page.locator(".ts-column-overflow > summary").first();

  async function labels(name) {
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    assert.equal(await heading.textContent(), name, "grid immediately uses the current resolved heading");
    assert.equal(await page.locator(".ts-column-header").first().getAttribute("aria-label"), name);
    assert.equal(await page.locator(".ts-entry-row").getByLabel(`New row ${name} (Text)`, { exact: true }).count(), 1);
    if ((await page.viewportSize()).width > 600) {
      assert.equal(await disclosure.getAttribute("aria-label"), `Column actions for ${name}`);
    }
    await page.getByRole("tab", { name: "Brief", exact: true }).click();
    assert.equal(await page.locator(".ts-fact-key").first().textContent(), name, "Brief shares the header resolver");
    await page.getByRole("tab", { name: "Table", exact: true }).click();
  }
  async function downloadsMatchGrid() {
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    const headers = await page.locator(".ts-col-head").allTextContents();
    const csv = await prepare(page, "csv");
    assert.deepEqual(csv[0], headers, "parsed real CSV headings equal the visible grid");
    assert.deepEqual(csv.slice(1), [["Tea", "2"]], "renaming preserves every CSV value");
    const xlsx = await prepare(page, "xlsx");
    assert.deepEqual(xlsx[0].rows[0].map(cell => cell.value), headers, "parsed real XLSX headings equal the visible grid");
    assert.deepEqual(xlsx[0].rows[1].map(cell => cell.value), ["Tea", 2], "renaming preserves typed XLSX values");
    await page.getByRole("tab", { name: "Table", exact: true }).click();
  }
  await labels("Item");
  assert.equal(await heading.getAttribute("tabindex"), "0", "imported native heading has the normal Rename tab stop");
  const entries = [
    ["double-click", "Current item"], ["F2", "Keyboard item"], ["Enter", "Enter item"],
    ["desktop menu", "Desktop item"], ["compact menu", "Compact item"], ["double-click", generatedKey],
  ];
  for (const [entry, name] of entries) {
    await labels("Item");
    const before = await renameRequests();
    if (entry === "compact menu") {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByRole("button", { name: "Column", exact: true }).click();
      await page.getByRole("button", { name: "Rename “Item”…", exact: true }).click();
    } else if (entry === "desktop menu") {
      await disclosure.click();
      assert.equal(await page.getByRole("button", { name: "Remove…", exact: true }).isEnabled(), true);
      await page.getByRole("button", { name: "Rename…", exact: true }).click();
    } else if (entry === "double-click") await heading.dblclick();
    else { await heading.focus(); await heading.press(entry); }
    const dialog = page.getByRole("dialog", { name: "Rename column", exact: true });
    assert.equal(await dialog.getByLabel("Column name", { exact: true }).inputValue(), "Item", "dialog starts with the resolved metadata header");
    await dialog.getByLabel("Column name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Rename column", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await ready();
    assert.equal(await renameRequests(), before + 1, `${entry} dispatches one Rename`);
    const current = await page.evaluate(() => window.__exportEvidence.table);
    assert.equal(current.columns[0].id, fieldId);
    assert.equal(current.columns[0].display_name, name);
    assert.equal(current.columns[0].display_name_explicit, true);
    assert.deepEqual(current.rows, original.rows, "Rename preserves all stored values and identities");
    await labels(name);
    if (entry === "compact menu") {
      await page.getByRole("button", { name: "Column", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: `Rename “${name}”…`, exact: true }).count(), 1);
      await page.getByRole("button", { name: "Column", exact: true }).press("Escape");
      await page.setViewportSize({ width: 1400, height: 1000 });
    }
    await downloadsMatchGrid();
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
    assert.equal((await page.evaluate(() => window.__exportEvidence.table)).columns[0].display_name_explicit, undefined);
    await labels("Item"); await downloadsMatchGrid();
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready();
    await labels(name); await downloadsMatchGrid();
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready();
    await labels("Item");
    assert.deepEqual((await page.evaluate(() => window.__exportEvidence.table)).columns, original.columns);
  }
  assert.equal(await page.getByRole("button", { name: "+ column", exact: true }).isEnabled(), true);

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
  // Keep the structural export and header-collision disclosure oracles as
  // separate coverage after exercising every surviving-header Rename entry.
  await add("Current item", "Kept");
  const draft = page.locator(".ts-entry-row");
  await fillDraftCell(page, draft.getByLabel("New row Item (Text)", { exact: true }), "Coffee");
  await fillDraftCell(page, draft.getByLabel("New row Amount (Number)", { exact: true }), "3");
  await fillDraftCell(page, draft.getByLabel("New row Current item (Text)", { exact: true }), "Added");
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  // The new explicit name collides with a historical metadata heading. Work
  // allocates the emitted heading and reports imported_current_header, keeping
  // the original disclosure oracle in addition to the Rename proofs above.
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
  checks.push("#227 imported Rename via double-click/F2/Enter/desktop/compact menu; grid/aria/draft/Brief/dialog labels; Undo/Redo and explicit generated-key name; parsed real CSV/XLSX headers equal grid; Add-column collision/structure CSV; real refusal; metadata review/work/save/history preserved; no fallback; Undo/retry");
  await close(page);
}

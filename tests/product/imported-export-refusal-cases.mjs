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

  async function rename(to) {
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    const header = page.getByRole("columnheader").nth(1);
    await header.locator(".ts-col-head").dblclick();
    const dialog = page.getByRole("dialog", { name: "Rename column", exact: true });
    await dialog.getByLabel("Column name", { exact: true }).fill(to);
    await dialog.getByRole("button", { name: "Rename column", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await ready();
    assert.equal((await page.evaluate(() => window.__exportEvidence.table)).columns[0].display_name, to);
  }
  await rename("Current item");
  const draft = page.locator(".ts-entry-row");
  console.log(JSON.stringify({ issue228: "imported-heading-observation",
    projected: (await page.evaluate(() => window.__exportEvidence.table)).columns[0].display_name,
    header: await page.getByRole("columnheader").nth(1).getAttribute("aria-label"),
    draft: await draft.locator("[data-entry-field]").first().getAttribute("aria-label"),
  }));
  await fillDraftCell(page, draft.locator("[data-entry-field]").nth(0), "Coffee");
  await fillDraftCell(page, draft.locator("[data-entry-field]").nth(1), "3");
  await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready();
  assert.deepEqual(await prepare(page, "csv"), [["Current item", "Amount"], ["Tea", "2"], ["Coffee", "3"]], "current heading and appended record reach the actual CSV");
  const ledger = await page.locator(".ts-ledger").textContent();
  assert.match(ledger, /The current column heading/);
  assert.match(ledger, /New columns and rows are added at the end with default formatting/);

  // A formula-leading current heading cannot be represented safely as CSV.
  await rename("=Current item");
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
  assert.equal((await page.evaluate(() => window.__exportEvidence.table)).columns[0].display_name, "Current item", "refusal does not consume an Undo action");
  assert.deepEqual(await prepare(page, "csv"), [["Current item", "Amount"], ["Tea", "2"], ["Coffee", "3"]], "repair by Undo retains the original metadata route");
  checks.push("#228 real imported structure/current heading CSV; located Work refusal with plain copy; metadata review/work/save/history preserved; no native fallback; Undo and retry");
  await close(page);
}

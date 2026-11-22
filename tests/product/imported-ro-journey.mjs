import assert from "node:assert/strict";
import path from "node:path";

// Shared by workbook-tabs step 8 and habit 24: real UI, disk download and cold reopen.
export async function standaloneImportedRoReopen(page, restart, directory, expected) {
  const button = name => page.getByRole("button", { name, exact: true });
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await ready();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await button("Download work file (.ro)").click();
  const dialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await dialog.waitFor();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(directory, "standalone.ro");
  await (await downloaded).saveAs(file);
  page = await restart();
  await page.getByTestId("open-work-file").setInputFiles(file);
  await ready();
  assert.deepEqual(await page.locator(".ts-table-tab").allTextContents(), expected,
    "standalone .ro reopen keeps imported names and Work order without the XLSX source attachment");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await button("Prepare XLSX").click();
  const exported = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true }).click();
  const xlsx = path.join(directory, "standalone-export.xlsx");
  await (await exported).saveAs(xlsx);
  await button("Close project").click();
  const close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await close.count()) await close.getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(xlsx);
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.waitFor();
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await ready();
  assert.deepEqual(await page.locator(".ts-table-tab").allTextContents(), expected,
    "XLSX exported from standalone .ro reimports with the same names and order");
  return page;
}

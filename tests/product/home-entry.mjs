import assert from "node:assert/strict";

export async function waitForColdHome(page) {
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0, "fresh entry exposes Home without a workbook");
  assert.equal(await page.getByTestId("currentness").count(), 0, "fresh entry exposes no workbook currentness");
}

export async function openReleasePlanExample(page) {
  await waitForColdHome(page);
  await page.getByRole("button", { name: "Open release plan example", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
}

export async function openFolder(page, folder) {
  await waitForColdHome(page);
  await page.getByTestId("open-project").setInputFiles(folder);
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
}

export async function homeImportInput(page) {
  await page.getByText("Choose file…", { exact: true }).waitFor({ state: "visible" });
  const input = page.locator('input[type="file"][accept*=".csv"]');
  await input.waitFor({ state: "attached" });
  return input;
}

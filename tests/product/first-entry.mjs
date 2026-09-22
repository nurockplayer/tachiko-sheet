import assert from "node:assert/strict";

// The public entry opens the representative workbook. Existing route-specific
// regressions deliberately close that clean work before exercising their own
// import/open path, which also proves Close does not trigger another entry open.
export async function leaveFirstEntryAtHome(page) {
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByTestId("open-project").waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await page.getByTestId("project-ready").count(),
    0,
    "Close must not automatically reopen the first-entry workbook",
  );
}

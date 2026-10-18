// Enter values through the same inline editor used by published grid cells.
export async function fillDraftCell(page, cell, value) {
  await cell.dblclick();
  await page.getByTestId("cell-editor").fill(String(value));
  // Leaving a draft cell retains its value without publishing the row.
  await cell.focus();
}
export const draftActions = page => page.locator(".ts-entry-actions");

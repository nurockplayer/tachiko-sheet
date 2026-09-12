// Acceptance-build-only recovery evidence. The fault is injected through the
// existing bounded acceptance harness after a real UI edit; no DOM is mocked.
import { chromium } from "playwright";
import { installDistRoutes, LOCAL_ORIGIN } from "../tests/product/dist-routes.mjs";

const url = process.env.WORK_ACCEPTANCE_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : undefined);
if (!url) throw new Error("WORK_ACCEPTANCE_URL (or WORK_DIST) is required");
const fixture = "tests/fixtures/release-plan.roproj";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  if (process.env.WORK_DIST) await installDistRoutes(context, process.env.WORK_DIST);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor({ timeout: 15000 });
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const notes = page.getByRole("textbox", { name: "Decision notes", exact: true });
  const initialEntity = await page.locator("[data-work-entity]").first().getAttribute("data-work-entity");
  await notes.fill("draft-authored-for-row-A");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const entityCells = page.locator("[data-work-entity]");
  let otherCell;
  for (let index = 0; index < await entityCells.count(); index += 1) {
    const cell = entityCells.nth(index);
    if ((await cell.getAttribute("data-work-entity")) !== initialEntity) {
      otherCell = cell;
      break;
    }
  }
  if (!otherCell) throw new Error("fixture must expose a distinct second entity");
  await otherCell.click();
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  await notes.fill("draft-authored-for-row-B");
  await page.evaluate(() => window.__tachikoAcceptance?.failNextOpenProjection());
  await page.getByRole("button", { name: "Apply notes", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor({ timeout: 15000 });
  const currentness = await page.getByTestId("currentness").textContent();
  if (currentness?.trim() !== "Needs refresh") throw new Error(`unexpected recovery currentness: ${currentness}`);
  if (await page.getByTestId("operation-outcome").count() !== 0) {
    throw new Error("known publication recovery rendered an empty idle outcome chip");
  }
  if (await page.locator('[data-testid^="cell:"]').count() !== 0) {
    throw new Error("recovery rendered a stale grid");
  }
  await page.screenshot({ path: "evidence/visual-foundation/targets/recovery-acceptance-fault.png", fullPage: true });
  console.log(JSON.stringify({ status: "PASS", currentness: currentness.trim(), outcome: null, stale_grid_cells: 0, screenshot: "recovery-acceptance-fault.png" }));
  await context.close();
} finally {
  await browser.close();
}

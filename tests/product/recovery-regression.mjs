// Focused acceptance regression for recovery context across a replacement.
// Runs against the normal hosted acceptance origin, with real Worker/WASM calls.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const url = process.env.WORK_CLIENT_URL;
if (!url) {
  console.error("BLOCKED: WORK_CLIENT_URL is required for the hosted recovery regression.");
  process.exit(78);
}
let chromium;
try {
  ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core"));
} catch {
  console.error("BLOCKED: the pinned Playwright dependency is unavailable.");
  process.exit(78);
}
const fixture = fileURLToPath(new URL("../fixtures/release-plan.roproj", import.meta.url));
const expected = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const launchOptions = {
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};
const browser = await chromium.launch(launchOptions);
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();
  const before = await page.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount());

  await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
  await page.getByTestId(`cell:${expected.entity}:${expected.impact}`).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("3");
  await editor.press("Enter");
  await page.getByTestId("operation-outcome").filter({ hasText: "Outcome needs review" }).waitFor();
  await page.evaluate(() => window.__tachikoAcceptance.settleFaultWindow());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const a = await page.evaluate(() => window.__tachikoAcceptance.observe());
  assert.match(
    await page.locator("body").textContent(),
    /An unconfirmed input was retained for review: \{"kind":"number","input":"3"\}/,
  );

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("recovery-copy");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();

  await page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  const afterDispatch = await page.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount());
  assert.equal(afterDispatch - before, 1, "replacement Open must dispatch exactly once");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const b = await page.evaluate(() => window.__tachikoAcceptance.observe());
  assert.notEqual(b.occurrence, a.occurrence, "replacement must establish a fresh occurrence");
  assert.equal(b.impact, expected.initialImpact, "replacement must show B's authoritative fixture value");
  assert.doesNotMatch(
    await page.locator("body").textContent(),
    /An unconfirmed input was retained for review: \{"kind":"number","input":"3"\}/,
  );
  console.log(JSON.stringify({ case: "focused replacement recovery", status: "PASS", openProjectDispatches: afterDispatch - before }));
} finally {
  await browser.close();
}

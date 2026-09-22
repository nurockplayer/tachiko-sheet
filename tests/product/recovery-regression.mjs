// Focused acceptance regression for recovery context across a replacement.
// Runs against the normal hosted acceptance origin, with real Worker/WASM calls.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";
import { leaveFirstEntryAtHome } from "./first-entry.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : undefined);
if (!url) {
  console.error("BLOCKED: WORK_CLIENT_URL (or WORK_DIST) is required for the recovery regression.");
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
async function waitForHomeOpen(page) {
  await page.getByRole("region", { name: "Recovery", exact: true }).waitFor({ state: "detached" });
  const input = page.getByTestId("open-project");
  await input.waitFor();
  await page.waitForFunction(() => {
    const candidate = document.querySelector('[data-testid="open-project"]');
    return candidate instanceof HTMLInputElement && !candidate.disabled && candidate.value === "";
  });
}
try {
  const context = await browser.newContext();
  if (process.env.WORK_DIST) await installDistRoutes(context, process.env.WORK_DIST);
  const page = await context.newPage();
  await page.goto(url);
  await leaveFirstEntryAtHome(page);
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
  assert.equal(
    await page.getByTestId("operation-outcome").count(),
    0,
    "known publication recovery must not render an empty idle outcome chip",
  );
  assert.equal(
    await page.locator('[data-testid^="cell:"]').count(),
    0,
    "recovery must not render a stale grid",
  );
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

  // An unknown saved Open must not expose its candidate projection or permit
  // copy/export dispatches, even after repeated Refresh attempts.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  const exportBeforeUnknownOpen = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  const copiesBeforeUnknownOpen = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
  await page.getByRole("button", { name: "Open saved recovery-copy", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), true);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.deepEqual(
    await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()),
    exportBeforeUnknownOpen,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()),
    copiesBeforeUnknownOpen,
  );
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await waitForHomeOpen(page);
  await page.getByRole("button", { name: "Open saved recovery-copy", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("reopened-after-recovery");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();

  // The same marker must also protect an unknown Open with no old resident.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await waitForHomeOpen(page);
  await page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await waitForHomeOpen(page);
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();
  console.log(JSON.stringify({ case: "focused replacement and unknown-open recovery", status: "PASS", openProjectDispatches: afterDispatch - before }));
  await context.close();
} finally {
  await browser.close();
}

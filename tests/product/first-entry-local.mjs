// Focused normal-entry regression against the real acceptance build.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";
import { leaveFirstEntryAtHome } from "./first-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name an acceptance build.");
  process.exit(78);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
try {
  const success = await browser.newContext();
  await installDistRoutes(success, dist);
  const successPage = await success.newPage();
  await successPage.goto(LOCAL_ORIGIN);
  await successPage.getByTestId("project-ready").waitFor();
  assert.equal(
    await successPage.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount()),
    1,
    "first entry must dispatch the authoritative Open exactly once",
  );
  await leaveFirstEntryAtHome(successPage);
  assert.equal(
    await successPage.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount()),
    1,
    "Close must not replay the first-entry Open",
  );
  await success.close();

  const failure = await browser.newContext();
  await installDistRoutes(failure, dist);
  await failure.route("**/examples/release-plan/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const failurePage = await failure.newPage();
  await failurePage.goto(LOCAL_ORIGIN);
  const alert = failurePage.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.textContent(), /unavailable \(503\)/, "known initial failure must remain visible");
  await failurePage.getByTestId("open-project").waitFor();
  await failurePage.waitForTimeout(100);
  assert.equal(await failurePage.getByTestId("project-ready").count(), 0, "known initial failure must not retry");
  assert.equal(
    await failurePage.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount()),
    0,
    "known fixture-load failure must not dispatch an unknown runtime Open",
  );
  await failure.close();
  console.log(JSON.stringify({ status: "PASS", firstEntryOpenDispatches: 1, knownFailureRetry: false }));
} finally {
  await browser.close();
}

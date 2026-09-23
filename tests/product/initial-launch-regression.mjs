// First-entry launch regression: hold the real initial fixture manifest so the
// pre-ready frame is observable, then exercise success, known failure and Close.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : undefined);
if (!url) {
  console.error("BLOCKED: WORK_CLIENT_URL (or WORK_DIST) is required for the initial launch regression.");
  process.exit(78);
}
let chromium;
try {
  ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core"));
} catch {
  console.error("BLOCKED: the pinned Playwright dependency is unavailable.");
  process.exit(78);
}

const dist = process.env.WORK_DIST;
const launchOptions = {
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};
const browser = await chromium.launch(launchOptions);

async function launch(mode) {
  const context = await browser.newContext();
  if (dist) await installDistRoutes(context, dist);

  let releaseManifest;
  let markRequested;
  const manifestGate = new Promise((resolve) => { releaseManifest = resolve; });
  const manifestRequested = new Promise((resolve) => { markRequested = resolve; });
  let manifestRequests = 0;
  await context.route("**/examples/release-plan/manifest.json", async (route) => {
    manifestRequests += 1;
    markRequested();
    if (mode !== "immediate") await manifestGate;
    if (mode === "failure") {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "controlled initial-open failure" });
      return;
    }
    if (dist) {
      const manifest = await readFile(path.join(dist, "examples/release-plan/manifest.json"));
      await route.fulfill({ status: 200, contentType: "application/json", body: manifest });
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const launchStatus = page.getByTestId("initial-launch");
  await launchStatus.waitFor();
  await manifestRequested;
  assert.equal((await launchStatus.textContent()).trim(), "Opening your work…");
  assert.equal(await launchStatus.getAttribute("aria-busy"), "true");
  assert.equal(await page.getByLabel("Open project folder", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Try example", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Import CSV or XLSX", exact: true }).count(), 0);
  assert.equal(await page.getByTestId("project-ready").count(), 0, "booting must not claim a workbook is ready");

  return { context, page, releaseManifest, getManifestRequests: () => manifestRequests };
}

try {
  {
    const attempt = await launch("success-delayed");
    attempt.releaseManifest();
    await attempt.page.getByTestId("project-ready").waitFor();
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0);
    assert.ok(await attempt.page.locator('[data-testid^="cell:"]').count() > 0, "the real workbook grid must appear");
    assert.equal(attempt.getManifestRequests(), 1, "the automatic Open should dispatch once");
    await attempt.context.close();
  }

  {
    const attempt = await launch("failure");
    attempt.releaseManifest();
    await attempt.page.getByRole("alert").filter({ hasText: "example file manifest.json is unavailable (503)" }).waitFor();
    await attempt.page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0);
    assert.ok(await attempt.page.getByTestId("open-project").isEnabled(), "manual project Open remains available after a known failure");
    assert.equal(await attempt.page.getByRole("button", { name: "Try example", exact: true }).isEnabled(), true);
    await attempt.page.getByRole("heading", { name: "Import CSV or XLSX", exact: true }).waitFor();
    await attempt.page.getByRole("heading", { name: "Saved copies", exact: true }).waitFor();
    await attempt.context.close();
  }

  {
    const attempt = await launch("success-delayed");
    attempt.releaseManifest();
    await attempt.page.getByTestId("project-ready").waitFor();
    await attempt.page.getByRole("button", { name: "Close project", exact: true }).click();
    await attempt.page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
    await attempt.page.waitForTimeout(250);
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "explicit Close must remain on Home");
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0, "Close must not restart booting");
    assert.equal(attempt.getManifestRequests(), 1, "explicit Close must not reopen the automatic example");
    await attempt.context.close();
  }

  {
    const attempt = await launch("success-delayed");
    await attempt.page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
    attempt.releaseManifest();
    await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0, "unknown Open must leave booting for explicit recovery");
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "unknown Open must not expose a candidate workbook");
    assert.equal(await attempt.page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(), true);
    assert.equal(await attempt.page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
    await attempt.context.close();
  }

  {
    const attempt = await launch("success-delayed");
    await attempt.page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
    attempt.releaseManifest();
    await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0, "acknowledged Open projection failure must leave booting");
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "unconfirmed projection must not expose a workbook");
    assert.equal(await attempt.page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(), true);
    assert.equal(await attempt.page.getByRole("button", { name: "Close and abandon recovery", exact: true }).isEnabled(), true);
    await attempt.context.close();
  }

  console.log(JSON.stringify({ case: "delayed initial launch success, known failure, unknown-open and acknowledged-open recovery, and explicit Close", status: "PASS" }));
} finally {
  await browser.close();
}

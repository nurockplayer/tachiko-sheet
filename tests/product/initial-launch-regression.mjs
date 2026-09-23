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
const MANIFEST_OBSERVATION_TIMEOUT_MS = 5_000;
const launchOptions = {
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};
const browser = await chromium.launch(launchOptions);
const pendingCleanup = new Set();

async function installHomeMountHistory(page) {
  await page.addInitScript(() => {
    const containsLegacyHome = (node) => {
      if (!(node instanceof Element)) return false;
      const home = node.matches(".ts-home")
        ? node
        : node.closest(".ts-home") ?? node.querySelector(".ts-home");
      return Boolean(home?.querySelector(".ts-card, [data-testid='open-project']"));
    };
    const history = [];
    Object.defineProperty(window, "__initialLaunchLegacyHomeMounts", { value: history });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && containsLegacyHome(record.target)) {
          history.push({ time: performance.now(), kind: "class" });
        }
        for (const node of record.addedNodes) {
          if (containsLegacyHome(node)) history.push({ time: performance.now(), kind: "mount" });
        }
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

async function verifyHomeMountObserver() {
  const page = await browser.newPage();
  try {
    await installHomeMountHistory(page);
    await page.goto("about:blank");
    await page.evaluate(() => {
      const home = document.createElement("main");
      home.className = "ts-home";
      const card = document.createElement("section");
      card.className = "ts-card";
      home.append(card);
      document.body.append(home);
      // A transient Home can be removed before the MutationObserver callback;
      // its addedNodes record still has to preserve the mount evidence.
      home.remove();
    });
    await page.waitForFunction(
      () => (window.__initialLaunchLegacyHomeMounts?.length ?? 0) > 0,
      null,
      { timeout: 1_000 },
    );
    assert.ok(
      await page.evaluate(() => window.__initialLaunchLegacyHomeMounts.length) > 0,
      "the mount observer must detect even a removed-before-callback legacy Home surface",
    );
  } finally {
    await page.close();
  }
}

async function launch(mode) {
  const context = await browser.newContext();
  let contextClosed = false;
  let releaseManifest;
  let observationTimer;

  let markRequested;
  const manifestGate = new Promise((resolve) => { releaseManifest = resolve; });
  const manifestRequested = new Promise((resolve) => {
    markRequested = resolve;
  });
  let manifestRequests = 0;
  const cleanup = async () => {
    clearTimeout(observationTimer);
    releaseManifest();
    pendingCleanup.delete(cleanup);
    if (contextClosed) return;
    contextClosed = true;
    await context.close();
  };
  pendingCleanup.add(cleanup);

  try {
    if (dist) await installDistRoutes(context, dist);
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
    await installHomeMountHistory(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const launchStatus = page.getByTestId("initial-launch");
    await launchStatus.waitFor();
    await Promise.race([
      manifestRequested,
      new Promise((_, reject) => {
        observationTimer = setTimeout(
          () => reject(new Error(`initial release-plan manifest was not requested within ${MANIFEST_OBSERVATION_TIMEOUT_MS}ms`)),
          MANIFEST_OBSERVATION_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(observationTimer);
    assert.equal((await launchStatus.textContent()).trim(), "Opening your work…");
    assert.equal(await launchStatus.getAttribute("aria-busy"), "true");
    assert.equal(await page.locator(".ts-app-root.ts-app").count(), 1, "the pending frame must use the approved app typography and surface recipe");
    await page.waitForFunction(() => document.styleSheets.length > 0);
    assert.match(await launchStatus.evaluate((node) => getComputedStyle(node).fontFamily), /Inter|system-ui/, "pending text must not fall back to browser serif typography");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(
      await page.evaluate(() => window.__initialLaunchLegacyHomeMounts.length),
      0,
      "no legacy Home content may mount before the delayed manifest is released",
    );
    assert.equal(await page.getByLabel("Open project folder", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Try example", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Import CSV or XLSX", exact: true }).count(), 0);
    assert.equal(await page.getByTestId("project-ready").count(), 0, "booting must not claim a workbook is ready");

    return {
      context,
      page,
      releaseManifest,
      close: cleanup,
      getManifestRequests: () => manifestRequests,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

try {
  await verifyHomeMountObserver();
  {
    const attempt = await launch("success-delayed");
    attempt.releaseManifest();
    await attempt.page.getByTestId("project-ready").waitFor();
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0);
    assert.ok(await attempt.page.locator('[data-testid^="cell:"]').count() > 0, "the real workbook grid must appear");
    assert.equal(attempt.getManifestRequests(), 1, "the automatic Open should dispatch once");
    await attempt.close();
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
    await attempt.close();
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
    await attempt.close();
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
    await attempt.close();
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
    await attempt.close();
  }

  console.log(JSON.stringify({ case: "delayed initial launch success, known failure, unknown-open and acknowledged-open recovery, and explicit Close", status: "PASS" }));
} finally {
  await Promise.allSettled([...pendingCleanup].map((cleanup) => cleanup()));
  await browser.close();
}

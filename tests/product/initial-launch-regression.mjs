// Cold-Home regression: background preparation is read-only; explicit example
// actions own workbook requests and remain available after fixture failure/Close.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : undefined);
if (!url) {
  console.error("BLOCKED: WORK_CLIENT_URL (or WORK_DIST) is required for the cold Home regression.");
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
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
const pendingCleanup = new Set();

async function waitForConfirmedSalesEntry(page) {
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  assert.equal(await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).inputValue(), "catalog");
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), "catalog.price");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const result = page.getByTestId("j4-result-0");
  await result.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await result.getByText(/up to date/).waitFor();
  const groups = await result.getByLabel("Cross-table groups", { exact: true }).locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("td"));
    return `${cells[0]?.textContent?.trim() ?? ""}: ${cells[1]?.textContent?.trim() ?? ""}`;
  }));
  assert.deepEqual(groups, ["NOTE: 1000", "PEN: 800"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Current report data", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Sales by product");
}

async function openHome(mode = "success") {
  const context = await browser.newContext();
  let releaseManifest;
  let markRequested;
  const manifestGate = new Promise((resolve) => { releaseManifest = resolve; });
  const manifestRequested = new Promise((resolve) => { markRequested = resolve; });
  let manifestRequests = 0;
  const startupFaultRequests = [];
  let closed = false;
  const cleanup = async () => {
    releaseManifest();
    pendingCleanup.delete(cleanup);
    if (closed) return;
    closed = true;
    await context.close();
  };
  pendingCleanup.add(cleanup);
  if (dist && url === LOCAL_ORIGIN) await installDistRoutes(context, dist);
  if (mode === "startup-wasm") {
    await context.addInitScript(() => {
      window.__startupCopyReadAttempts = 0;
      const indexedDatabase = window.indexedDB;
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: new Proxy(indexedDatabase, {
          get(target, property) {
            if (property === "open") return (...args) => {
              window.__startupCopyReadAttempts += 1;
              if (sessionStorage.getItem("__startupCopyReadFault") !== "disarmed") {
                throw new DOMException("controlled copy-list failure", "SecurityError");
              }
              return target.open(...args);
            };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
    });
  }
  const startupFaultMode = mode.endsWith("-held") ? mode.slice(0, -5) : mode;
  const startupFaultPath = {
    "startup-kit-entry": "/core-kit/experimental-client.js",
    "startup-worker": "/core-kit/experimental-client.worker.js",
    "startup-wasm": "/core-kit/designer_runtime.wasm",
    "startup-success": "/core-kit/experimental-client.js",
  }[startupFaultMode];
  let releaseStartupFault;
  let markStartupFaultRequested;
  const startupFaultGate = new Promise((resolve) => { releaseStartupFault = resolve; });
  const startupFaultRequested = new Promise((resolve) => { markStartupFaultRequested = resolve; });
  let startupFaultHandler;
  if (startupFaultPath) {
    startupFaultHandler = async (route) => {
      startupFaultRequests.push(new URL(route.request().url()).pathname);
      markStartupFaultRequested();
      if (mode.endsWith("-held")) await startupFaultGate;
      if (mode === "startup-success-held") {
        const asset = await readFile(path.join(dist, "core-kit/experimental-client.js"));
        await route.fulfill({ status: 200, contentType: "text/javascript", body: asset });
        return;
      }
      await route.abort("failed");
    };
    await context.route(`**${startupFaultPath}`, startupFaultHandler);
  }
  await context.route("**/examples/release-plan/manifest.json", async (route) => {
    manifestRequests += 1;
    markRequested();
    if (mode === "delayed") await manifestGate;
    if (mode === "failure") {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "controlled manual-open failure" });
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
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => console.error(JSON.stringify({ kind: "pageerror", message: error.message, stack: error.stack })));
  page.on("console", (message) => { if (message.type() === "error") console.error(JSON.stringify({ kind: "console-error", text: message.text() })); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.getByTestId("open-project").waitFor();
  return { context, page, releaseManifest, manifestRequested, releaseStartupFault, startupFaultRequested, getManifestRequests: () => manifestRequests, startupFaultRequests, startupFaultPath, startupFaultHandler, close: cleanup };
}

try {
  {
    const attempt = await openHome("delayed");
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "cold Home exposes no workbook");
    assert.equal(await attempt.page.getByTestId("initial-launch").count(), 0, "cold Home has no booting state");
    assert.equal(attempt.getManifestRequests(), 0, "mount does not request the release-plan fixture");
    await attempt.page.waitForFunction(() => window.__tachikoAcceptance.workMethodCounts().observeOccurrence === 1);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject ?? 0), 0, "background preparation observes without opening work");
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, "background preparation creates no summaries");
    assert.equal(await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).isEnabled(), true);
    await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).click();
    await attempt.manifestRequested;
    assert.equal(attempt.getManifestRequests(), 1, "one explicit action dispatches one fixture request");
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "the held manual open does not claim readiness");
    attempt.releaseManifest();
    await attempt.page.getByTestId("project-ready").waitFor();
    assert.ok(await attempt.page.locator('[data-testid^="cell:"]').count() > 0, "the real example workbook appears after the explicit action");
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject), 1, "healthy explicit release-plan action dispatches one Open");
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, "ordinary release-plan action does not create a summary");
    await attempt.page.getByRole("button", { name: "Close project", exact: true }).click();
    await attempt.page.getByTestId("open-project").waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "Close returns to Home");
    assert.equal(attempt.getManifestRequests(), 1, "Close does not restart an example open");
    await attempt.close();
  }

  {
    const attempt = await openHome("failure");
    await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).click();
    await attempt.page.getByRole("alert").filter({ hasText: "example file manifest.json is unavailable (503)" }).waitFor();
    await attempt.page.getByTestId("open-project").waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "known manual failure leaves Home resident");
    assert.equal(await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).isEnabled(), true, "the user can retry explicitly");
    assert.equal(attempt.getManifestRequests(), 1, "the failure is not retried automatically");
    await attempt.close();
  }

  for (const mode of ["startup-kit-entry", "startup-worker", "startup-wasm"]) {
    const attempt = await openHome(mode);
    try {
      await attempt.page.getByRole("alert").filter({ hasText: "Tachiko couldn’t start in this browser" }).waitFor();
    } catch (error) {
      console.error(JSON.stringify({ kind: "startup-fault-diagnostic", mode, requests: attempt.startupFaultRequests,
        counts: await attempt.page.evaluate(() => window.__tachikoAcceptance?.workMethodCounts?.() ?? null).catch(() => null),
        body: await attempt.page.locator("body").innerText().catch(() => "<unreadable>") }));
      throw error;
    }
    assert.equal(await attempt.page.getByRole("button", { name: "Reload page", exact: true }).isEnabled(), true);
    assert.equal(await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).isDisabled(), true, `${mode} locks the visible Sales action`);
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, `${mode} exposes no workbook`);
    assert.equal(await attempt.page.locator('[data-testid="open-project"]').isDisabled(), true, `${mode} locks folder Open`);
    assert.equal(await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).isDisabled(), true, `${mode} locks release-plan Open`);
    assert.equal(await attempt.page.getByRole("button", { name: "Refresh", exact: true }).count(), 0, `${mode} is not presented as resident-work Recovery`);
    if (mode === "startup-wasm") {
      await attempt.page.getByText("Saved copies couldn’t be read.", { exact: true }).waitFor();
      assert.equal(await attempt.page.getByRole("button", { name: "Try again", exact: true }).isDisabled(), true, "inventory Retry stays locked while startup is unavailable");
      assert.equal(await attempt.page.getByRole("alert").filter({ hasText: "Tachiko couldn’t start in this browser" }).count(), 1, "the independent inventory failure does not replace startup guidance");
      assert.equal(await attempt.page.evaluate(() => window.__startupCopyReadAttempts), 1, "the independent inventory read reached IndexedDB once");
    } else {
      await attempt.page.getByText("No saved copies yet", { exact: true }).waitFor();
      assert.equal(await attempt.page.getByRole("alert").filter({ hasText: "Tachiko couldn’t start in this browser" }).count(), 1, `${mode} keeps the neutral startup guidance after inventory settles`);
    }
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject ?? 0), 0, `${mode} failed before mutating Open`);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, `${mode} failed before summary creation`);
    assert.deepEqual(attempt.startupFaultRequests, [{
      "startup-kit-entry": "/core-kit/experimental-client.js",
      "startup-worker": "/core-kit/experimental-client.worker.js",
      "startup-wasm": "/core-kit/designer_runtime.wasm",
    }[mode]], `${mode} interception reached the requested pinned startup asset`);
    await attempt.context.unroute(`**${attempt.startupFaultPath}`, attempt.startupFaultHandler);
    if (mode === "startup-wasm") {
      await attempt.page.evaluate(() => sessionStorage.setItem("__startupCopyReadFault", "disarmed"));
    }
    await attempt.page.reload({ waitUntil: "domcontentloaded" });
    await attempt.page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
    if (mode === "startup-wasm") {
      await attempt.page.getByText("No saved copies yet", { exact: true }).waitFor();
      assert.equal(await attempt.page.evaluate(() => window.__startupCopyReadAttempts), 1, "fresh Reload retries the independent inventory read with the fault disarmed");
    }
    await attempt.page.waitForFunction(() => window.__tachikoAcceptance.workMethodCounts().observeOccurrence === 1);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject ?? 0), 0, `${mode} Reload freshly warms without Open`);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, `${mode} Reload freshly warms without summary creation`);
    await attempt.close();
  }

  for (const mode of ["startup-kit-entry-held", "startup-worker-held", "startup-wasm-held"]) {
    const attempt = await openHome(mode);
    await attempt.page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
    await attempt.startupFaultRequested;
    assert.equal(await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).isEnabled(), true, `${mode} leaves the Home action available while warming`);
    await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).click();
    await attempt.page.getByRole("button", { name: "Opening…", exact: true }).waitFor();
    attempt.releaseStartupFault();
    await attempt.page.getByRole("alert").filter({ hasText: "Tachiko couldn’t start in this browser" }).waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, `${mode} exposes no workbook`);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject ?? 0), 0, `${mode} fails before mutating Open`);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, `${mode} fails before summary creation`);
    assert.deepEqual(attempt.startupFaultRequests, [{
      "startup-kit-entry-held": "/core-kit/experimental-client.js",
      "startup-worker-held": "/core-kit/experimental-client.worker.js",
      "startup-wasm-held": "/core-kit/designer_runtime.wasm",
    }[mode]], `${mode} intercepted the actual pinned startup asset once`);
    await attempt.close();
  }

  let warmedSalesMethodCounts;
  {
    const attempt = await openHome("success");
    await attempt.page.waitForFunction(() => window.__tachikoAcceptance.workMethodCounts().observeOccurrence === 1);
    await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).click();
    await attempt.page.getByTestId("project-ready").waitFor();
    await waitForConfirmedSalesEntry(attempt.page);
    warmedSalesMethodCounts = await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
    assert.equal(warmedSalesMethodCounts.openProject, 1, "a click after preparation dispatches one Open");
    assert.equal(warmedSalesMethodCounts.createKeyedGroupedSum, 1, "a click after preparation creates one summary");
    await attempt.close();
  }

  {
    const attempt = await openHome("startup-success-held");
    await attempt.startupFaultRequested;
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().observeOccurrence ?? 0), 0, "held warm-up has not completed its one readiness observation");
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().openProject ?? 0), 0);
    await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).click();
    await attempt.page.getByRole("button", { name: "Opening…", exact: true }).waitFor();
    attempt.releaseStartupFault();
    await attempt.page.getByTestId("project-ready").waitFor();
    await waitForConfirmedSalesEntry(attempt.page);
    const heldWarmCounts = await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
    assert.equal(heldWarmCounts.observeOccurrence, warmedSalesMethodCounts.observeOccurrence, "held successful warm reuses the same readiness and confirmed-read sequence as an already-warm entry");
    assert.equal(heldWarmCounts.queryKeyedGroupedSum, warmedSalesMethodCounts.queryKeyedGroupedSum, "held successful warm confirms the same real summary query");
    assert.equal(heldWarmCounts.openProject, 1, "click during successful warm-up dispatches one Open");
    assert.equal(heldWarmCounts.createKeyedGroupedSum, 1, "one coordinated Sales entry creates one definition");
    assert.deepEqual(attempt.startupFaultRequests, ["/core-kit/experimental-client.js"], "the held successful warm uses one actual kit-entry request");
    await attempt.close();
  }

  {
    const attempt = await openHome("success");
    await attempt.page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
    await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).click();
    await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "unknown Open does not expose a candidate workbook");
    assert.equal(await attempt.page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
    assert.equal(attempt.getManifestRequests(), 1, "unknown Open does not replay");
    await attempt.close();
  }

  {
    const attempt = await openHome("success");
    await attempt.page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
    await attempt.page.getByRole("button", { name: "Open release plan example", exact: true }).click();
    await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, "acknowledged Open projection failure stays recoverable");
    assert.equal(await attempt.page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(), true);
    assert.equal(await attempt.page.getByRole("button", { name: "Close and abandon recovery", exact: true }).isEnabled(), true);
    assert.equal(attempt.getManifestRequests(), 1, "projection recovery does not retry the open");
    await attempt.close();
  }

  for (const recovery of ["acknowledged", "unknown"]) {
    const attempt = await openHome("success");
    if (recovery === "acknowledged") {
      await attempt.page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
    } else {
      await attempt.page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
    }
    await attempt.page.getByRole("button", { name: "Open sales example", exact: true }).click();
    await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
    assert.equal(await attempt.page.getByTestId("project-ready").count(), 0, `${recovery} Sales Open exposes no partial workbook`);
    assert.equal(await attempt.page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0, `${recovery} Sales Open exposes no Save`);
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, `${recovery} Sales Open never starts automatic summary creation`);
    await attempt.page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (recovery === "acknowledged") {
      await attempt.page.getByTestId("project-ready").waitFor();
      assert.equal(await attempt.page.locator('[data-testid^="j4-result-"]').count(), 0, "acknowledged recovery observes the resident without reconstructing a summary");
    } else {
      await attempt.page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
      await attempt.page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
      await attempt.page.getByTestId("open-project").waitFor();
    }
    assert.equal(await attempt.page.evaluate(() => window.__tachikoAcceptance.workMethodCounts().createKeyedGroupedSum ?? 0), 0, `${recovery} Refresh does not replay setup`);
    await attempt.close();
  }

  console.log(JSON.stringify({ case: "cold Home, explicit Try example, fixture retry, startup Reload routes at kit/Worker/WASM boundaries, and Sales Open recovery without setup replay", status: "PASS" }));
} finally {
  await Promise.allSettled([...pendingCleanup].map((cleanup) => cleanup()));
  await browser.close();
}

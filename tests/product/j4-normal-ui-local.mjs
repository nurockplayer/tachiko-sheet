// Real built-product J4 journey over the fixed Sheet canary. This uses only
// visible controls and labels; core IDs stay inside the runtime adapter.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const canary = path.join(dist, "examples", "j4-catalog-sales");
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-j4-product-"));
let context;
let salesCopySequence = 0;
const resultsEvidenceDir = process.env.RESULTS_SCREENSHOT_DIR;
if (resultsEvidenceDir) await mkdir(resultsEvidenceDir, { recursive: true });

async function start() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => { throw error; });
  page.on("console", (message) => { if (message.type() === "error") throw new Error(`page console error: ${message.text()}`); });
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("open-project").waitFor();
  return page;
}

async function openCanary(page) {
  await page.getByTestId("open-project").setInputFiles(canary);
  await page.getByTestId("project-ready").waitFor();
}

async function enterSalesFromHome(page, { addAnotherSummary = false } = {}) {
  const openBefore = await page.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount());
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const openAfter = await page.evaluate(() => window.__tachikoAcceptance.openProjectRequestCount());
  assert.equal(openAfter - openBefore, 1, "healthy readiness is followed by exactly one canonical Open");
  await page.waitForFunction(() => document.querySelector("#ts-active-table")?.value === "catalog");
  assert.equal(await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).inputValue(), "catalog", "confirmed entry selects Catalog");
  const resultsPane = page.getByTestId("results-pane");
  await resultsPane.waitFor();
  assert.equal(await resultsPane.locator(".ts-result-card").count(), 1, "Sales lands with its per-definition Results card");
  const catalogHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = catalogHeaders.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog exposes its visible price column");
  const penPrice = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex);
  await penPrice.waitFor();
  assert.equal(await penPrice.evaluate((cell) => document.activeElement === cell), true, "Sales landing focuses the exact Catalog PEN price cell");
  assert.equal(await page.locator('[data-testid="work-state"]').textContent(), "Not saved yet", "initial Sales D10 appears only in Work status");
  assert.equal(await page.locator(".ts-sales-tip").getByText("Not saved yet", { exact: true }).count(), 0, "Sales tip does not duplicate the D10 footer label");
  assert.equal(await resultsPane.locator(".ts-result-status").getByText("Up to date", { exact: true }).count(), 1, "current Results card binds the discovered revision");
  const chart = resultsPane.locator("svg.ts-mini-chart");
  if (await chart.count() === 1) {
    assert.equal(await chart.getAttribute("aria-hidden"), "true", "the measured chart is decorative to assistive technology");
    assert.equal(await chart.getAttribute("focusable"), "false");
  } else {
    assert.equal(await resultsPane.getByText("The chart is shown in Report.", { exact: true }).count(), 1, "a chart that does not fit is deferred without altering the value table");
  }
  assert.deepEqual(await groupRows(resultsPane.getByRole("table", { name: "Sales by product values", exact: true })), ["NOTE: 1000", "PEN: 800"]);
  await verifyResultsViewportMatrix(page, resultsEvidenceDir);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Hide results", exact: true }).click();
  await page.getByRole("button", { name: "Show results", exact: true }).waitFor();
  assert.equal(await page.getByTestId("results-pane").count(), 0, "Hide removes the Results pane while retaining its one-shot layout marker");
  await page.getByRole("button", { name: "Show results", exact: true }).click();
  await page.getByTestId("results-pane").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Hide results", "Show returns focus to the Results heading action");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "one Home action installs one generated summary");
  assert.deepEqual(await groupRows(page.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"]);
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), "catalog.price", "confirmed entry exposes its one-shot Catalog price landing marker");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Current report data", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Sales by product");
  assert.equal(await page.getByLabel("Category label", { exact: true }).inputValue(), "Product");
  assert.equal(await page.getByLabel("Value label", { exact: true }).inputValue(), "Revenue");
  assert.equal(await page.getByLabel("Show legend", { exact: true }).isChecked(), false);
  if (addAnotherSummary) {
    await chooseBinding(page, { orderQuantity: "product_code" });
    await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.locator('[data-testid="work-state"]').textContent(), "Not saved yet", "a pre-publication Create refusal preserves initial D10");
    assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), "catalog.price", "pre-publication refusal preserves the Sales tip");
    await chooseBinding(page);
    await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="j4-result-"]').length === 2 &&
      document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
    assert.notEqual(await page.locator('[data-testid="work-state"]').textContent(), "Not saved yet", "confirmed Create ends initial D10 for this occurrence");
    assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "confirmed Create installs the second definition without replacing the first");
    await page.getByRole("tab", { name: "Table", exact: true }).click();
    const tip = page.getByTestId("sales-tip");
    await tip.getByRole("button", { name: "Dismiss tip", exact: true }).click();
    await tip.waitFor({ state: "detached" });
    assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), null, "dismissal clears only the one-shot Sales tip marker");
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="Table"]');
      const active = document.activeElement;
      const currentCell = table?.querySelector("td[data-work-occurrence][data-work-revision]");
      return active instanceof HTMLTableCellElement && active.closest('table[aria-label="Table"]') === table &&
        active.dataset.workOccurrence === currentCell?.getAttribute("data-work-occurrence") &&
        active.dataset.workRevision === currentCell?.getAttribute("data-work-revision");
    });
    assert.equal(await page.evaluate(() => document.activeElement?.matches('table[aria-label="Table"] td[data-work-occurrence][data-work-revision]') ?? false), true, "dismissing the Sales tip restores focus to a current grid cell");
  }
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const savedName = `sales-entry-marker-saved-${++salesCopySequence}`;
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(savedName);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), null, "successful Save consumes the one-shot Sales entry tip");
  return savedName;
}

async function verifyConfiguredSalesSaveReopen(page, initialCopyName) {
  const initialSaved = await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), initialCopyName);
  assert.equal(initialSaved?.kind, "opaque", "configured Sales is preserved as the real opaque copy");
  assert.ok(initialSaved?.presentation, "the initial Sales copy retains its paired report presentation");
  assert.equal(initialSaved.presentation?.snapshotRevision, initialSaved.revision, "initial report attachment names the exact saved snapshot revision");
  assert.equal(initialSaved.presentation?.snapshotDigest, initialSaved.bytesHash, "initial report attachment digest names the exact opaque snapshot bytes");
  assert.deepEqual(initialSaved.presentation?.report, {
    definitionId: initialSaved.presentation?.report.definitionId,
    type: "bar", title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false,
  }, "the receipt carries the configured Sales report and definition identity");
  const firstOccurrence = (await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot())).occurrence;
  await closeWithoutSaving(page);
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: `Open saved ${initialCopyName}`, exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const reopenedInitial = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  assert.notEqual(reopenedInitial.occurrence, firstOccurrence, "opening the saved initial Sales copy creates a fresh occurrence");
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), null, "a saved-copy reopen does not restore the UI-only Sales tip marker");
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-catalog-layout"), null, "a saved-copy reopen does not restore the UI-only compact-layout marker");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "the initial saved Sales copy completes authoritative discovery");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  const initialRows = await groupRows(page.getByLabel("Cross-table groups", { exact: true }));
  assert.deepEqual(initialRows, ["NOTE: 1000", "PEN: 800"], "fresh initial-copy query returns the configured Sales values");
  const initialIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(initialIds.length, 1, "initial Sales reopen re-queries exactly its one persisted definition");
  assert.equal(initialSaved.presentation?.report.definitionId, initialIds[0], "initial report receipt belongs to the generated definition discovered after reopen");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const initialCard = page.getByTestId("results-pane").locator('article[data-testid^="result-card:"]');
  assert.equal(await initialCard.count(), 1);
  assert.equal(await initialCard.getAttribute("data-testid"), `result-card:${initialIds[0]}`, "the current Results card is paired to the definition queried from the saved copy");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const initialReport = page.getByLabel("Current report data", { exact: true });
  await initialReport.waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Sales by product");
  assert.equal(await page.getByLabel("Category label", { exact: true }).inputValue(), "Product");
  assert.equal(await page.getByLabel("Value label", { exact: true }).inputValue(), "Revenue");
  assert.equal(await page.getByLabel("Show legend", { exact: true }).isChecked(), false);
  assert.match(await initialReport.textContent(), /NOTE\s*1000/);
  assert.match(await initialReport.textContent(), /PEN\s*800/);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await verifyPhoneOpenReport(page, 390);
  await verifyPhoneOpenReport(page, 375);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  const penRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" });
  await penRow.first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  await editor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.deepEqual(await groupRows(page.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 1000"], "confirmed PEN250 edit automatically updates the saved-copy source values");

  const editedCopyName = `sales-edited-pen250-${++salesCopySequence}`;
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(editedCopyName);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const editedSaved = await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), editedCopyName);
  assert.equal(editedSaved?.kind, "opaque");
  assert.equal(editedSaved?.presentation?.snapshotRevision, editedSaved?.revision, "edited report attachment names the exact PEN250 snapshot revision");
  assert.equal(editedSaved?.presentation?.snapshotDigest, editedSaved?.bytesHash, "edited report attachment digest names the exact opaque snapshot bytes");
  assert.deepEqual(editedSaved?.presentation?.report, {
    definitionId: editedSaved?.presentation?.report.definitionId,
    type: "bar", title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false,
  }, "the edited receipt retains the report paired to the same definition");
  assert.deepEqual(await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), initialCopyName), initialSaved, "saving the edited copy leaves the earlier initial Sales copy unchanged");
  const editedOccurrence = (await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot())).occurrence;
  await closeWithoutSaving(page);
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: `Open saved ${editedCopyName}`, exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  const reopenedEdited = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  assert.notEqual(reopenedEdited.occurrence, editedOccurrence, "opening the edited Sales copy creates a fresh occurrence");
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-entry-tip"), null, "edited-copy reopen does not restore the UI-only Sales tip marker");
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-catalog-layout"), null, "edited-copy reopen does not restore the UI-only compact-layout marker");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "the edited saved copy completes authoritative discovery");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.deepEqual(await groupRows(page.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 1000"], "fresh edited-copy query returns the PEN250 values");
  const editedIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(editedIds.length, 1, "edited Sales reopen re-queries exactly one persisted definition");
  assert.equal(editedIds[0], initialIds[0], "both copies retain the same real grouped-summary definition identity");
  assert.equal(editedSaved.presentation?.report.definitionId, editedIds[0], "edited report receipt belongs to the generated definition discovered after reopen");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const editedCard = page.getByTestId("results-pane").locator('article[data-testid^="result-card:"]');
  assert.equal(await editedCard.count(), 1);
  assert.equal(await editedCard.getAttribute("data-testid"), `result-card:${editedIds[0]}`, "the current Results card is paired to the definition queried from the edited copy");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const editedReport = page.getByLabel("Current report data", { exact: true });
  await editedReport.waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Sales by product");
  assert.equal(await page.getByLabel("Category label", { exact: true }).inputValue(), "Product");
  assert.equal(await page.getByLabel("Value label", { exact: true }).inputValue(), "Revenue");
  assert.equal(await page.getByLabel("Show legend", { exact: true }).isChecked(), false);
  assert.match(await editedReport.textContent(), /NOTE\s*1000/);
  assert.match(await editedReport.textContent(), /PEN\s*1000/);
  console.log(JSON.stringify({
    case: "sales-initial-and-edited-save-reopen",
    initial: { name: initialCopyName, receipt: initialSaved, occurrence: reopenedInitial.occurrence, revision: reopenedInitial.revision, definitionIds: initialIds, groups: initialRows },
    edited: { name: editedCopyName, receipt: editedSaved, occurrence: reopenedEdited.occurrence, revision: reopenedEdited.revision, definitionIds: editedIds, groups: ["NOTE: 1000", "PEN: 1000"] },
  }));
}

async function verifyResultsViewportMatrix(page, screenshotDir) {
  const sizes = [
    [1440, 900], [1100, 900], [834, 1112], [768, 1024], [390, 844], [375, 812],
    [1023, 900], [1024, 900], [1199, 900], [1200, 900],
  ];
  const observations = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measured = await page.evaluate(() => {
      const tip = document.querySelector('[data-testid="sales-tip"]');
      const region = document.querySelector(".ts-work-region");
      const grid = document.querySelector(".ts-grid-scroll");
      const table = document.querySelector('table[aria-label="Table"]');
      const pane = document.querySelector('[data-testid="results-pane"]');
      const priceColumn = Array.from(table?.querySelectorAll("thead th") ?? []).findIndex((header) => header.textContent?.trim() === "price");
      const priceRow = Array.from(table?.querySelectorAll("tbody tr") ?? []).find((row) => row.textContent?.includes("PEN"));
      const priceCell = priceRow?.querySelectorAll("td")[priceColumn - 1] ?? null;
      const scroll = grid?.getBoundingClientRect();
      const cell = priceCell?.getBoundingClientRect();
      const work = region?.getBoundingClientRect();
      const result = pane?.getBoundingClientRect();
      const tipRect = tip?.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      const intersects = Boolean(scroll && cell && cell.left >= scroll.left - 1 && cell.right <= scroll.right + 1 && cell.top >= scroll.top - 1 && cell.bottom <= scroll.bottom + 1);
      return {
        scrollWidth: grid?.scrollWidth ?? -1, clientWidth: grid?.clientWidth ?? -1,
        intersects, tipBeforeGrid: Boolean(tip && grid && tip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING),
        side: Boolean(work && result && result.left >= work.right - 1),
        stacked: Boolean(tipRect && gridRect && pane && pane.getBoundingClientRect().top >= gridRect.bottom - 1),
        tipSideVisible: Boolean(tip && getComputedStyle(tip.querySelector(".ts-sales-tip-body--side")).display !== "none"),
        tipStackedVisible: Boolean(tip && getComputedStyle(tip.querySelector(".ts-sales-tip-body--stacked")).display !== "none"),
        gridHeight: gridRect?.height ?? 0,
        gridMax: grid ? Number.parseFloat(getComputedStyle(grid).maxHeight) : 0,
        windowScrollY: window.scrollY,
      };
    });
    assert.ok(measured.intersects, `focused PEN price remains fully visible at ${width}x${height}: ${JSON.stringify(measured)}`);
    assert.ok(measured.tipBeforeGrid, `the Sales tip precedes the grid at ${width}x${height}`);
    assert.ok(measured.scrollWidth <= measured.clientWidth + 1, `qualified Sales Catalog has no horizontal grid overflow at ${width}x${height}: ${JSON.stringify(measured)}`);
    assert.ok(measured.gridHeight <= measured.gridMax + 1, `Sales grid respects its measured viewport cap at ${width}x${height}: ${JSON.stringify(measured)}`);
    if (width >= 1024) {
      assert.ok(measured.side && measured.tipSideVisible && !measured.tipStackedVisible, `wide layout places Results beside the table and uses right-side tip copy at ${width}`);
    } else {
      assert.ok(measured.stacked && !measured.tipSideVisible && measured.tipStackedVisible, `narrow layout stacks Results below the table and uses below-table tip copy at ${width}`);
    }
    if ([1440, 834, 390, 375].includes(width)) {
      const tipHeights = await measureSalesTipVariants(page, { fontSize: 12, longTitle: false });
      assert.ok(Math.max(...tipHeights.heights) - Math.min(...tipHeights.heights) <= 1, `all Sales tip variants share a stable slot at ${width}px: ${JSON.stringify(tipHeights)}`);
      const enlarged = await measureSalesTipVariants(page, { fontSize: 18, longTitle: true });
      assert.ok(Math.max(...enlarged.heights) - Math.min(...enlarged.heights) <= 1, `enlarged text and long/wrapping titles retain the shared tip slot at ${width}px: ${JSON.stringify(enlarged)}`);
      observations.push({ tipWidths: { width, standard: tipHeights, enlargedLongTitle: enlarged } });
    }
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `results-${width}x${height}.png`), fullPage: true });
    observations.push({ width, height, ...measured });
  }
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-catalog-layout"), "true", "the responsive compact layout remains bound to the current Sales Catalog occurrence");
  const resultsPane = page.getByTestId("results-pane");
  const svg = resultsPane.locator("svg.ts-mini-chart");
  await svg.waitFor();
  await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.measureText;
    window.__chartFontProbe = { original, wide: true };
    prototype.measureText = function (text) {
      return window.__chartFontProbe.wide ? { width: 1000 } : window.__chartFontProbe.original.call(this, text);
    };
    document.fonts.dispatchEvent(new Event("loadingdone"));
  });
  await resultsPane.locator(".ts-result-deferred").waitFor();
  assert.equal(await svg.count(), 0, "a completed font change rechecks measured labels and defers a chart that no longer fits");
  await page.evaluate(() => {
    window.__chartFontProbe.wide = false;
    document.fonts.dispatchEvent(new Event("loadingdone"));
  });
  await svg.waitFor();
  await page.evaluate(() => { CanvasRenderingContext2D.prototype.measureText = window.__chartFontProbe.original; delete window.__chartFontProbe; });
  assert.equal(await resultsPane.locator(".ts-result-deferred").count(), 0, "a subsequent font change redraws the chart after labels fit again");
  console.log(JSON.stringify({ case: "results-responsive-matrix", observations }));
}

async function measureSalesTipVariants(page, { fontSize, longTitle }) {
  return page.evaluate(({ fontSize, longTitle }) => {
    const original = document.querySelector('[data-testid="sales-tip"]');
    const app = document.querySelector('.ts-app');
    if (!(original instanceof HTMLElement) || !(app instanceof HTMLElement)) throw new Error("Sales tip host is unavailable");
    const width = original.getBoundingClientRect().width;
    const clone = original.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error("Sales tip clone failed");
    clone.style.position = "fixed";
    clone.style.left = "-10000px";
    clone.style.top = "0";
    clone.style.width = `${width}px`;
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clone.style.fontSize = `${fontSize}px`;
    clone.setAttribute("aria-hidden", "true");
    if (longTitle) {
      for (const body of clone.querySelectorAll(".ts-sales-tip-body--side")) body.textContent = "Change the PEN price. Annual revenue by product and region across multiple fiscal periods updates on the right.";
      for (const body of clone.querySelectorAll(".ts-sales-tip-body--stacked")) body.textContent = "Change the PEN price. Annual revenue by product and region across multiple fiscal periods updates below the table.";
    }
    app.append(clone);
    const keys = ["try-it", "updating", "updated", "needs-attention", "needs-refresh"];
    const heights = keys.map((key) => {
      clone.className = original.className.replace(/ts-sales-tip--(?:try-it|updating|updated|needs-attention|needs-refresh)/g, "").trim();
      clone.classList.add(`ts-sales-tip--${key}`);
      for (const variant of clone.querySelectorAll("[data-tip-variant]")) {
        variant.setAttribute("aria-hidden", String(variant.getAttribute("data-tip-variant") !== key));
      }
      return clone.getBoundingClientRect().height;
    });
    clone.remove();
    return { width, heights, keys };
  }, { fontSize, longTitle });
}

async function verifyPhoneOpenReport(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 812 });
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByTestId("results-pane").waitFor();
  const composition = page.locator(".ts-table-composition");
  const openReport = page.getByRole("button", { name: "Open report", exact: true });
  assert.equal(await openReport.count(), 1, `one Open report action is available at phone width ${width}`);
  const compositionBox = await composition.boundingBox();
  assert.ok(compositionBox, `Table composition is mounted at ${width}`);
  await page.mouse.move(compositionBox.x + compositionBox.width / 2, compositionBox.y + compositionBox.height / 2);
  await page.mouse.wheel(0, 520);
  await page.waitForFunction(() => (document.querySelector(".ts-table-composition")?.scrollTop ?? 0) > 0);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".ts-results-pane button")].find((node) => node.textContent?.trim() === "Open report");
    const composition = document.querySelector(".ts-table-composition");
    if (!(button instanceof HTMLElement) || !(composition instanceof HTMLElement)) return false;
    const rect = button.getBoundingClientRect();
    const port = composition.getBoundingClientRect();
    return rect.top - 4 >= port.top && rect.bottom + 4 <= port.bottom;
  });
  const pointerWitness = await phoneActionWitness(page, openReport, composition);
  assert.ok(pointerWitness.height >= 44, `Open report meets the 44px touch target at ${width}: ${JSON.stringify(pointerWitness)}`);
  assert.ok(pointerWitness.inScrollport && pointerWitness.visible && pointerWitness.unobstructed, `wheel-scrolled Open report is visible and unobstructed at ${width}: ${JSON.stringify(pointerWitness)}`);
  assert.ok(pointerWitness.containerScrollTop > 0 || pointerWitness.windowScrollY > 0, `the real phone surface scrolls to Open report at ${width}: ${JSON.stringify(pointerWitness)}`);
  await page.mouse.click(pointerWitness.left + pointerWitness.width / 2, pointerWitness.top + pointerWitness.height / 2);
  await page.getByLabel("Current report data", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Report", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const grid = page.getByRole("grid", { name: "Table", exact: true });
  const gridRows = grid.locator("tbody tr");
  assert.ok(await gridRows.count() > 0, "the reopened Catalog has a visible grid row");
  const gridCell = gridRows.nth(0).locator("td").nth(0);
  await gridCell.focus();
  assert.equal(await gridCell.evaluate((cell) => document.activeElement === cell), true, "keyboard path starts in the Catalog grid");
  const tabTrace = [];
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const node = document.activeElement;
      return node instanceof HTMLElement ? { tag: node.tagName, text: node.textContent?.trim() ?? "", className: typeof node.className === "string" ? node.className : "" } : null;
    });
    tabTrace.push(active);
    if (await openReport.evaluate((button) => document.activeElement === button)) break;
  }
  assert.equal(await openReport.evaluate((button) => document.activeElement === button), true, `keyboard Tab from grid reaches Open report at ${width}: ${JSON.stringify(tabTrace)}`);
  const keyboardWitness = await phoneActionWitness(page, openReport, composition);
  assert.ok(keyboardWitness.height >= 44 && keyboardWitness.inScrollport && keyboardWitness.visible && keyboardWitness.unobstructed, `keyboard-focused action remains visible, 44px, and unobstructed at ${width}: ${JSON.stringify(keyboardWitness)}`);
  if (resultsEvidenceDir) await page.screenshot({ path: path.join(resultsEvidenceDir, `keyboard-open-report-${width}.png`), fullPage: false });
  await page.keyboard.press("Shift+Tab");
  assert.equal(await openReport.evaluate((button) => document.activeElement !== button), true, "reverse Tab leaves Open report");
  await page.keyboard.press("Tab");
  assert.equal(await openReport.evaluate((button) => document.activeElement === button), true, "forward Tab returns to Open report");
  await openReport.press("Enter");
  await page.getByLabel("Current report data", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Report", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const hideResults = page.getByRole("button", { name: "Hide results", exact: true });
  await hideResults.focus();
  await hideResults.press("Enter");
  const showResults = page.getByRole("button", { name: "Show results", exact: true });
  await page.waitForFunction(() => document.activeElement?.matches(".ts-results-show") ?? false);
  const showWitness = await phoneActionWitness(page, showResults, composition);
  assert.ok(showWitness.inScrollport && showWitness.unobstructed, `keyboard Hide returns visible focus to Show results at ${width}: ${JSON.stringify(showWitness)}`);
  await showResults.press("Enter");
  await page.waitForFunction(() => document.activeElement?.matches(".ts-results-hide") ?? false);
  const hideWitness = await phoneActionWitness(page, hideResults, composition);
  assert.ok(hideWitness.inScrollport && hideWitness.unobstructed, `keyboard Show restores visible focus to Hide results at ${width}: ${JSON.stringify(hideWitness)}`);
  console.log(JSON.stringify({ case: "phone-open-report", width, pointerWitness, keyboardWitness, showWitness, hideWitness, openedTwice: true, tabTrace }));
  await page.getByRole("tab", { name: "Table", exact: true }).click();
}

async function phoneActionWitness(page, button, composition) {
  const [rect, containerScrollTop, windowScrollY] = await Promise.all([
    button.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      const composition = node.closest(".ts-table-composition");
      const port = composition?.getBoundingClientRect();
      const footer = document.querySelector(".ts-workspace-footer")?.getBoundingClientRect();
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
        visible: bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight,
        inScrollport: Boolean(port && bounds.top - 4 >= port.top && bounds.bottom + 4 <= port.bottom),
        unobstructed: hit === node || node.contains(hit),
        activeElement: document.activeElement instanceof HTMLElement
          ? { tag: document.activeElement.tagName, className: document.activeElement.className, text: document.activeElement.textContent?.trim() }
          : null,
        composition: port ? { top: port.top, bottom: port.bottom, scrollTop: composition.scrollTop } : null,
        footer: footer ? { top: footer.top, bottom: footer.bottom, height: footer.height } : null,
        documentScroll: { x: window.scrollX, y: window.scrollY },
      };
    }),
    composition.evaluate((node) => node.scrollTop),
    page.evaluate(() => window.scrollY),
  ]);
  return { ...rect, containerScrollTop, windowScrollY };
}

async function closeWithoutSaving(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  if (await page.getByRole("button", { name: "Close without saving", exact: true }).count()) {
    await page.getByRole("button", { name: "Close without saving", exact: true }).click();
  }
  await page.getByTestId("open-project").waitFor();
}

async function chooseBinding(page, {
  ordersTable = "sales", orderLookupKey = "product_code", orderQuantity = "quantity",
  productsTable = "catalog", productKey = "code", productCategory = "category", productPrice = "price",
} = {}) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const choose = page.getByRole("button", { name: "Choose tables and fields", exact: true });
  if (await choose.count()) await choose.click();
  await page.getByLabel("Orders table", { exact: true }).selectOption(ordersTable);
  await page.getByLabel("Order lookup key", { exact: true }).selectOption(orderLookupKey);
  await page.getByLabel("Order quantity", { exact: true }).selectOption(orderQuantity);
  await page.getByLabel("Products table", { exact: true }).selectOption(productsTable);
  await page.getByLabel("Product key", { exact: true }).selectOption(productKey);
  await page.getByLabel("Product category", { exact: true }).selectOption(productCategory);
  await page.getByLabel("Product price", { exact: true }).selectOption(productPrice);
}

async function bindAndCreate(page, { failPostPublicationRead = false, productCategory = "category" } = {}) {
  await chooseBinding(page, { productCategory });
  if (failPostPublicationRead) await page.evaluate(() => window.__tachikoAcceptance.failNextJ4PostPublicationRead());
  const previousResultCount = await page.locator('[data-testid^="j4-result-"]').count();
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  if (!failPostPublicationRead) {
    await page.waitForFunction((count) =>
      document.querySelectorAll('[data-testid^="j4-result-"]').length > count &&
      document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current",
    previousResultCount);
    await page.locator('[data-testid^="j4-result-"]').last().getByLabel("Cross-table groups", { exact: true }).waitFor();
  }
}

async function groupText(page) {
  return (await groupRows(page.getByTestId("j4-result-0").getByLabel("Cross-table groups", { exact: true }))).join(" ");
}

async function groupRows(table) {
  return table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("td"));
    return `${cells[0]?.textContent?.trim() ?? ""}: ${cells[1]?.textContent?.trim() ?? ""}`;
  }));
}

async function allGroupRows(page) {
  const tables = await page.getByLabel("Cross-table groups", { exact: true }).all();
  return Promise.all(tables.map((table) => groupRows(table)));
}

try {
  let page = await start();
  const initialSalesCopy = await enterSalesFromHome(page);
  await verifyConfiguredSalesSaveReopen(page, initialSalesCopy);
  await closeWithoutSaving(page);
  await enterSalesFromHome(page, { addAnotherSummary: true });
  await closeWithoutSaving(page);
  await page.evaluate(() => window.__tachikoAcceptance.failNextJ4PostPublicationRead());
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "post-publication recovery exposes no partial result");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0, "known-publication recovery withholds Save");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.deepEqual(await groupRows(page.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"], "one ordinary Refresh discovers the resident summary");
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "recovery does not replay creation");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0, "recovery does not reconstruct report setup");
  await closeWithoutSaving(page);
  await openCanary(page);
  await bindAndCreate(page, { failPostPublicationRead: true });
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator("[data-work-dirty]").getAttribute("data-work-dirty"), "true");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.doesNotMatch(await page.locator("body").textContent(), /was not created/i);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 800/);

  // The visible selectors permit a text field in the numeric quantity role.
  // The core must reject that second Create before publication, and the
  // existing current result must remain available without a refresh.
  const firstSummary = await groupText(page);
  const firstRefreshControls = await page.getByRole("button", { name: "Refresh core result", exact: true }).count();
  await chooseBinding(page, { orderQuantity: "product_code" });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal(await page.getByTestId("j4-result-0").count(), 1, "a known pre-publication rejection must retain the existing result");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), firstRefreshControls, "a known pre-publication rejection must retain existing refresh controls");
  assert.equal(await groupText(page), firstSummary, "a known pre-publication rejection must retain the current grouped values");

  const tablePicker = page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true });
  // Opening a clean editor must not leave it mounted across a collection
  // switch. The source witness and value must remain unchanged, and switching
  // tables must not dispatch an Execute mutation.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const cleanHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const cleanPriceIndex = cleanHeaders.filter((header) => header !== "Row").indexOf("price");
  const cleanPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  const cleanCell = cleanPenRow.locator("td").nth(cleanPriceIndex);
  const cleanEntity = await cleanCell.getAttribute("data-work-entity");
  const cleanOccurrence = await cleanCell.getAttribute("data-work-occurrence");
  const cleanRevision = await cleanCell.getAttribute("data-work-revision");
  const cleanValue = await cleanCell.locator(".ts-cell-value").textContent();
  assert.ok(cleanEntity, "Catalog clean-edit target must expose its entity.");
  await cleanCell.dblclick();
  const cleanEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await cleanEditor.waitFor();
  assert.equal(await cleanEditor.inputValue(), cleanValue, "clean editor must retain the source value");
  const cleanSwitchDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  await tablePicker.selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).count(), 0, "clean editor must clear when leaving its collection");
  const salesGrid = page.locator('table[aria-label="Table"]');
  assert.equal(await salesGrid.locator('td[tabindex="0"]').count(), 1, "a new collection grid must retain exactly one roving tab stop");
  // The table selector retains keyboard focus after selection. Reach the grid
  // by normal Tab navigation, then verify grid navigation with real keys.
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  const salesFirstCell = salesGrid.locator('td[tabindex="0"]');
  assert.equal(await salesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Tab must enter the new grid at its roving tab stop");
  const enteredSalesCellId = await salesFirstCell.getAttribute("data-testid");
  await page.keyboard.press("ArrowRight");
  const arrowSalesCellId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.ok(arrowSalesCellId?.startsWith("cell:"), "Arrow navigation must remain in the new grid");
  assert.notEqual(arrowSalesCellId, enteredSalesCellId, "Arrow navigation must leave the entered Sales cell");
  await page.waitForFunction((testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("tabindex") === "0", arrowSalesCellId);
  await page.keyboard.press("Shift+Tab");
  const tabSalesCellId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.equal(tabSalesCellId, enteredSalesCellId, "Shift+Tab navigation must remain in the Sales grid");
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const returnedCell = page.locator(`td[data-work-entity="${cleanEntity}"]`).nth(cleanPriceIndex);
  await returnedCell.waitFor();
  assert.equal(await returnedCell.getAttribute("data-work-occurrence"), cleanOccurrence, "collection switch must retain occurrence");
  assert.equal(await returnedCell.getAttribute("data-work-revision"), cleanRevision, "collection switch must retain revision");
  assert.equal(await returnedCell.locator(".ts-cell-value").textContent(), cleanValue, "collection switch must retain value");
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).count(), 0, "clean editor must not resurrect on return");
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-testid="cell-editor"]') ?? false), false, "clean editor must not retain focus on return");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), cleanSwitchDispatches, "collection switches must not dispatch Execute");
  await returnedCell.dblclick();
  const retainedEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await retainedEditor.fill("250");
  assert.equal(await tablePicker.isDisabled(), true, "a modified cell draft must block collection switching");
  assert.equal(await retainedEditor.inputValue(), "250", "modified draft must be retained");
  assert.equal(await retainedEditor.evaluate((input) => document.activeElement === input), true, "modified draft must retain focus");
  await retainedEditor.press("Escape");

  // A cleanup preview is tied to its collection. Switching from A to B must
  // remove the old preview and never dispatch its stale commit.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const catalogHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const categoryIndex = catalogHeaders.filter((header) => header !== "Row").indexOf("category");
  assert.ok(categoryIndex >= 0, "Catalog must expose its visible category field.");
  const catalogRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  const catalogCategory = catalogRow.locator("td").nth(categoryIndex);
  await catalogCategory.dblclick();
  const catalogEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await catalogEditor.fill(" PEN ");
  await catalogEditor.press("Enter");
  await catalogEditor.waitFor({ state: "detached" });
  assert.match(await catalogCategory.textContent(), /\sPEN\s/, "Catalog A must contain a real trim candidate before preview");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  const switchedSalesGrid = page.locator('table[aria-label="Table"]');
  const switchedSalesFirstCell = switchedSalesGrid.locator("td").first();
  const switchedSalesFirstId = await switchedSalesFirstCell.getAttribute("data-testid");
  // The last focused Catalog cell is now unmounted. Both close-dialog exits
  // must resolve focus against the live Sales grid instead.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved work", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesFirstId);
  assert.equal(await switchedSalesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Escape from unsaved-work must focus the live Sales first cell");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesFirstId);
  assert.equal(await switchedSalesFirstCell.evaluate((cell) => document.activeElement === cell), true, "Keep editing must focus the live Sales first cell");
  await page.keyboard.press("ArrowRight");
  const switchedSalesSecondId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  assert.ok(switchedSalesSecondId?.startsWith("cell:"), "Sales keyboard navigation must remain in the grid");
  assert.notEqual(switchedSalesSecondId, switchedSalesFirstId, "Sales keyboard navigation must focus a non-first cell");
  await tablePicker.selectOption("sales");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null), switchedSalesSecondId, "same-collection selection must preserve current focus");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction((testId) => document.activeElement?.getAttribute("data-testid") === testId, switchedSalesSecondId);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null), switchedSalesSecondId, "Keep editing must restore a connected current-grid cell");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  assert.equal(await page.getByTestId("cleanup-preview").count(), 0, "collection switch must clear the A preview");
  const staleCommitDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  assert.equal(await page.getByRole("button", { name: "Commit preview", exact: true }).count(), 0, "stale A commit must not remain actionable");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), staleCommitDispatches, "retained stale cleanup must dispatch zero requests");

  // Fresh B preview/commit targets only the selected sales collection.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Diagnostic source report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const salesRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await salesRow.locator("td").first().dblclick();
  const salesEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await salesEditor.fill(" PEN ");
  await salesEditor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") !== "pending");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "diagnostics are a confirmed Work observation, not an unknown workbook state");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table diagnostics", { exact: true }).waitFor();
  assert.match(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).textContent(), /Some results need attention/);
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "confirmed observation retains its complete definition inventory");
  assert.equal(await page.getByLabel("Cross-table diagnostics", { exact: true }).count(), 1, "the affected result exposes its Work diagnostics");
  assert.equal(await page.getByLabel("Cross-table groups", { exact: true }).count(), 0, "diagnostic results withhold grouped values");
  const diagnosticResult = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) });
  assert.equal(await diagnosticResult.getByLabel("Cross-table groups", { exact: true }).count(), 0, "diagnostic values do not retain the old grouped result");
  assert.equal(await page.getByRole("tab", { name: "Import & export", exact: true }).count(), 1, "confirmed diagnostics keep normal workbook navigation available");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.match(await page.getByText(/This summary needs attention.*Previous chart values are hidden/i).textContent(), /Correct the source data to see the report/);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Diagnostic source report", "diagnostics retain report configuration and draft");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 0, "a diagnostic source never revives its previous chart");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "PNG is withheld for a diagnostic source");
  const copiesBeforeDiagnosticSave = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("diagnostic-source-blocked");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeDiagnosticSave, "the invalid configured report blocks its copy before storage write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Diagnostic source report");
  await page.getByRole("button", { name: "Remove report", exact: true }).click();
  await page.getByText("The report configuration was removed. Table data and the cross-table definition were kept.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  await page.getByTestId("cleanup-preview").waitFor();
  const bTargets = page.getByLabel("Cleanup targets", { exact: true });
  assert.ok(await bTargets.locator("tbody tr").count() > 0, "B preview must expose an explicit target");
  assert.match(await bTargets.textContent(), /product_code/, "B preview target must belong to sales");
  const bCommitDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const bCommit = page.getByRole("button", { name: "Commit preview", exact: true });
  await bCommit.click();
  await bCommit.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), bCommitDispatches + 1, "fresh B cleanup must dispatch once");
  assert.equal(await tablePicker.inputValue(), "sales", "B cleanup must leave the sales collection active");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.locator('table[aria-label="Table"]').waitFor();
  assert.match(await page.locator('table[aria-label="Table"]').textContent(), /PEN/, "B cleanup must retain the normalized sales value");

  // A later definition publication whose projection/read fails is known
  // published but not current. It must remain fail-closed until Refresh
  // re-reads the full inventory, retaining every earlier definition.
  await bindAndCreate(page, { failPostPublicationRead: true });
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.doesNotMatch(await page.locator("body").textContent(), /was not created/i);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-1").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "recovery must retain the first summary after the second publication");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 2, "recovery must retain the first refresh control");

  // A modified cell draft must remain in place when summary creation is
  // attempted. Cancelling it permits the normal create path to continue.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const draftHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const draftPriceIndex = draftHeaders.filter((header) => header !== "Row").indexOf("price");
  const draftPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await draftPenRow.locator("td").nth(draftPriceIndex).dblclick();
  const draftEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await draftEditor.fill("250");
  const blockedCreateDispatches = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await chooseBinding(page);
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /Apply or cancel.*before creating a cross-table summary/i);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), blockedCreateDispatches, "draft guard must dispatch zero creates");
  assert.equal(await draftEditor.inputValue(), "250", "draft guard must retain the modified value");
  assert.equal(await draftEditor.evaluate((input) => document.activeElement === input), true, "draft guard must restore editor focus");
  await draftEditor.press("Escape");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-2").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "cancelled drafts must allow normal summary creation");

  // A scalar rejection before publication must restore every current J4
  // result and definition, rather than leaving just one sibling visible.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const priorGroups = await allGroupRows(page);
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const rejectedHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const rejectedPriceIndex = rejectedHeaders.filter((header) => header !== "Row").indexOf("price");
  const rejectedPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await rejectedPenRow.locator("td").nth(rejectedPriceIndex).dblclick();
  const rejectedEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await rejectedEditor.fill("not a number");
  await rejectedEditor.press("Enter");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  await rejectedEditor.press("Escape");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "a known edit rejection must retain every result");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3, "a known edit rejection must retain sibling refresh controls");
  assert.deepEqual(await allGroupRows(page), priorGroups, "a known edit rejection must restore complete prior J4 results");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await tablePicker.selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0, "Catalog must expose its visible price field.");
  const penRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" });
  await penRow.first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  assert.equal(await tablePicker.isDisabled(), true, "a modified cell draft must block collection switching");
  assert.equal(await editor.evaluate((input) => document.activeElement === input), true, "collection guard must retain draft focus");
  await editor.press("Enter");

  // Steward acceptance provenance: #46 comment 5860466401 amends the
  // ordinary confirmed scalar-edit oracle to automatic complete re-query.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-2").getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByTestId("currentness").filter({ hasText: "Up to date" }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 3, "all known summary definitions must be re-queried");
  for (const result of await page.locator('[data-testid^="j4-result-"]').all()) {
    const values = (await groupRows(result.getByLabel("Cross-table groups", { exact: true }))).join(" ");
    assert.match(values, /NOTE: 1000/);
    assert.match(values, /PEN: 1000/);
  }
  assert.equal(await page.getByRole("button", { name: /Refresh cross-table summary/ }).count(), 0, "the ordinary edit path must not need manual Refresh");
  assert.equal(await page.getByRole("button", { name: "Refresh core result", exact: true }).count(), 3);

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-restart");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();

  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j4-restart", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-0").getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 1000/);

  // Steward acceptance provenance: #46 comment 5860466401 requires the
  // second-definition failure witness after a confirmed scalar publication.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await bindAndCreate(page, { productCategory: "code" });
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "fault witness starts with two real definitions");
  await page.getByTestId("j4-result-0").getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Second query recovery report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const failureHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const failurePriceIndex = failureHeaders.filter((header) => header !== "Row").indexOf("price");
  const failurePenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await failurePenRow.locator("td").nth(failurePriceIndex).dblclick();
  const failureEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await failureEditor.fill("250");
  const executeBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const copiesBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  const scalarWitnessBeforeEdit = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  const exportsBeforeFault = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(() => {
    window.__tachikoAcceptance.failSecondScalarRequeryReplyAfterFirst();
    window.__tachikoAcceptance.deferSecondScalarRequeryReply();
  });
  await failureEditor.press("Enter");
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.scalarRequeryFaultProbe();
    return probe.invokedDefinitionIds.length === 2 && probe.secondReplyHeld;
  });
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "pending");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Updating…");
  const pendingSnapshotStatus = page.getByText("Updating… — showing previous results.", { exact: true });
  assert.equal(await pendingSnapshotStatus.isVisible(), true, "the pending previous-snapshot status stays visible across workbook tabs");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isDisabled(), true, "Save is withheld while grouped results are pending");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("heading", { name: "Previous grouped result", exact: true }).waitFor();
  assert.match(await groupText(page), /NOTE: 1000/);
  assert.match(await groupText(page), /PEN: 800/);
  assert.equal(await page.getByRole("button", { name: "Create bar report", exact: true }).first().isDisabled(), true, "report creation is withheld while grouped results are pending");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByText("Updating… — the report is unavailable until previous results are confirmed.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0, "the old report is not exposed as current while pending");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "PNG is withheld while the report source is pending");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeFault, "pending re-query dispatches no copy write");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeFault, "pending re-query dispatches no semantic export");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "pending re-query does not retry the published scalar edit");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.releaseSecondScalarRequeryReply());
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "unknown");
  assert.match(await page.locator("body").textContent(), /change was published/i);
  assert.doesNotMatch(await page.locator("body").textContent(), /change was not applied/i);
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "the successful first query must not be partially installed");
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0, "recovery withholds the prior report as current");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0, "recovery withholds PNG");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0, "recovery withholds Save");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), copiesBeforeFault, "recovery dispatches no copy write");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeFault, "recovery dispatches no semantic export");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "published edit is never retried after query failure");
  const queryFault = await page.evaluate(() => window.__tachikoAcceptance.scalarRequeryFaultProbe());
  assert.equal(queryFault.publicationAcknowledged, true, "fault is armed only after a real scalar publication acknowledgement");
  assert.equal(typeof queryFault.attemptId, "number", "the scalar witness belongs to one immutable attempt");
  assert.equal(typeof queryFault.clientIdentity, "number", "the scalar witness identifies its owning public client");
  assert.equal(queryFault.occurrence, scalarWitnessBeforeEdit.occurrence, "the publication remains on the observed Work occurrence");
  assert.equal(typeof queryFault.publicationCallId, "number", "the attempt records its real publication dispatch");
  assert.equal(queryFault.suppliedWitness.occurrence, queryFault.occurrence);
  assert.equal(queryFault.suppliedWitness.revision, queryFault.revision, "discovery uses the acknowledged result revision");
  assert.equal(typeof queryFault.discoveryInvocationId, "number", "the attempt records the exact discovery invocation");
  assert.equal(queryFault.queryCallIds.length, 2, "both real query dispatches are captured by this attempt");
  assert.notEqual(queryFault.queryCallIds[0], queryFault.queryCallIds[1]);
  assert.equal(queryFault.invokedDefinitionIds.length, 2, "the first query returns before the second real query fails");
  assert.equal(queryFault.secondReplyHeld, false, "the deterministic second-reply hold has been released");
  assert.notEqual(queryFault.invokedDefinitionIds[0], queryFault.invokedDefinitionIds[1]);
  assert.equal(queryFault.discardedDefinitionId, queryFault.invokedDefinitionIds[1], "the second real query reply is the discarded reply");
  console.log(JSON.stringify({
    case: "steward-46-scalar-requery-fault-attribution",
    attemptId: queryFault.attemptId,
    clientIdentity: queryFault.clientIdentity,
    occurrence: queryFault.occurrence,
    publicationCallId: queryFault.publicationCallId,
    resultRevision: queryFault.revision,
    discoveryInvocationId: queryFault.discoveryInvocationId,
    suppliedWitness: queryFault.suppliedWitness,
    actualQueryCallIds: queryFault.queryCallIds,
    actualDefinitionIds: queryFault.invokedDefinitionIds,
    discardedDefinitionId: queryFault.discardedDefinitionId,
  }));

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "one explicit Refresh re-observes the complete definition set");
  const recoveredGroups = await allGroupRows(page);
  assert.ok(recoveredGroups.every((rows) => /NOTE: 1000/.test(rows.join(" ")) && /PEN: 1000/.test(rows.join(" "))));
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const recoveredReport = page.getByLabel("Current report data", { exact: true });
  await recoveredReport.waitFor();
  assert.match(await recoveredReport.textContent(), /PEN\s*1000/);
  assert.match(await recoveredReport.textContent(), /NOTE\s*1000/);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Second query recovery report", "report configuration and presentation draft survive recovery");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), executeBeforeFault + 1, "Refresh observes; it does not replay the semantic edit");
  await page.evaluate(() => window.__tachikoAcceptance.resetScalarRequeryFaultProbe());
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.scalarRequeryFaultProbe()), {
    attemptId: null,
    publicationAcknowledged: false,
    clientIdentity: null,
    occurrence: null,
    publicationCallId: null,
    revision: null,
    discoveryInvocationId: null,
    suppliedWitness: null,
    queryCallIds: [],
    invokedDefinitionIds: [],
    discardedDefinitionId: null,
    secondReplyHeld: false,
    invalidReason: null,
  }, "the one-shot query fault and evidence reset deterministically");

  // On the unchanged pinned core, the normal UI admits the exact self-binding
  // Orders catalog/code/price -> Products catalog/code/code/price. Pair it
  // with Sales/product_code so its diagnostic leaves a real valid sibling.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await chooseBinding(page, {
    ordersTable: "catalog", orderLookupKey: "code", orderQuantity: "price",
    productsTable: "catalog", productKey: "code", productCategory: "code", productPrice: "price",
  });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByTestId("j4-result-1").getByLabel("Cross-table groups", { exact: true }).waitFor();
  const twoDefinitions = await page.locator('[data-testid^="j4-result-"]').count();
  assert.equal(twoDefinitions, 2, "both summaries are created through the visible binding controls");
  const salesBackedResult = page.locator('[data-testid^="j4-result-"]').filter({ hasText: /PEN\s*800/ });
  assert.equal(await salesBackedResult.count(), 1, "the Sales-backed definition is identified by its real grouped output");
  await salesBackedResult.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Catalog sibling report");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  const siblingSales = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await siblingSales.locator("td").first().dblclick();
  const siblingEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await siblingEditor.fill(" PEN ");
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await siblingEditor.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current");
  const diagnosticDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(diagnosticDefinitionIds.length, 2, "both actual Work definitions are re-queried after publication");
  assert.notEqual(diagnosticDefinitionIds[0], diagnosticDefinitionIds[1], "the automatic re-query addresses two distinct definition IDs");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const diagnosticDefinition = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) });
  const validSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  await diagnosticDefinition.waitFor();
  await validSibling.waitFor();
  assert.equal(await diagnosticDefinition.count(), 1, "Sales-backed definition A keeps its source diagnostics");
  assert.equal(await validSibling.count(), 1, "Catalog self-binding definition B retains its genuine grouped result");
  const selfBindingRows = await groupRows(validSibling.getByLabel("Cross-table groups", { exact: true }));
  assert.deepEqual(selfBindingRows, ["NOTE: 250000", "PEN: 40000"], "the sibling shows actual Catalog-to-Catalog Work values");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");

  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  const blockedSiblingCopies = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-diagnostic-sibling");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), blockedSiblingCopies, "a diagnostic report source blocks Save before the storage write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Remove report", exact: true }).click();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j4-diagnostic-sibling");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal((await page.getByTestId("save-status").textContent())?.includes("Saved on this device"), true, "without an invalid report dependency, Save succeeds with the confirmed results");

  await context.close();
  context = undefined;
  page = await start();
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: "Open saved j4-diagnostic-sibling", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const reopenedDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(reopenedDefinitionIds.length, 2, "reopen re-queries both saved real definition IDs");
  assert.notEqual(reopenedDefinitionIds[0], reopenedDefinitionIds[1]);
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention", "saved truth retains diagnostic attention");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const reopenedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await reopenedSibling.count(), 1, "fresh reopen retains the unaffected sibling result");
  assert.match(await reopenedSibling.textContent(), /NOTE/);
  assert.match(await reopenedSibling.textContent(), /PEN/);
  assert.deepEqual(await groupRows(reopenedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"], "fresh reopen re-queries the stored binding through Work");

  // A later scalar edit starts with a prior diagnostic plus a genuine sibling.
  // While the second real query is held, neither snapshot may be labeled current.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const pendingHeaders = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const pendingPriceIndex = pendingHeaders.filter((header) => header !== "Row").indexOf("price");
  const pendingPenRow = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
  await pendingPenRow.locator("td").nth(pendingPriceIndex).dblclick();
  const pendingEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await pendingEditor.fill("250");
  const pendingExecuteCount = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
  const pendingCopyWrites = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  const pendingExports = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(() => {
    window.__tachikoAcceptance.failSecondScalarRequeryReplyAfterFirst();
    window.__tachikoAcceptance.deferSecondScalarRequeryReply();
  });
  await pendingEditor.press("Enter");
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.scalarRequeryFaultProbe();
    return probe.invokedDefinitionIds.length === 2 && probe.secondReplyHeld;
  });
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "pending");
  assert.equal(await page.getByText("Updating… — showing previous results.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).isDisabled(), true);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("heading", { name: "Previous grouped result", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const previousSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await previousSibling.count(), 1);
  assert.equal(await previousSibling.locator(".ts-content-meta").textContent().then((text) => text?.startsWith("Previous result") ?? false), true, "a valid sibling snapshot is labeled previous while pending");
  assert.equal(await page.getByText("This previous result has source issues. Its values are hidden while results update.", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).count(), 0, "the neutral attention notice is withheld while results are pending");
  const pendingCreateButtons = page.getByRole("button", { name: "Create bar report", exact: true });
  assert.equal(await pendingCreateButtons.count(), 1, "the result with no grouped values offers no report creation");
  for (const button of await pendingCreateButtons.all()) assert.equal(await button.isDisabled(), true);
  const pendingRefreshButtons = page.getByRole("button", { name: "Refresh core result", exact: true });
  assert.equal(await pendingRefreshButtons.count(), 2);
  for (const button of await pendingRefreshButtons.all()) assert.equal(await button.isDisabled(), true);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), pendingCopyWrites);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), pendingExports);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1, "a held re-query never retries the scalar edit");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.releaseSecondScalarRequeryReply());
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 0, "failed sibling refresh installs no partial query set");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), pendingCopyWrites);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), pendingExports);
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table diagnostics", { exact: true }) }).count(), 1);
  const refreshedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await refreshedSibling.count(), 1);
  assert.deepEqual(await groupRows(refreshedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 62500"], "explicit Refresh observes the scalar edit through Work");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), pendingExecuteCount + 1, "Refresh re-observes without replaying the published edit");

  // Steward amendment #46 comment 5860466401 clause 8: a known targeted
  // query failure must remove only that definition and preserve its sibling.
  await context.close();
  context = undefined;
  page = await start();
  await openCanary(page);
  await bindAndCreate(page);
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => window.__tachikoAcceptance.queryDefinitionIds().length === 1);
  const firstDefinitionQueryIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(firstDefinitionQueryIds.length, 1, "the first real definition ID is captured after its real Work query");
  const targetId = firstDefinitionQueryIds[0];
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const initialA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  assert.equal(await initialA.count(), 1, "A is identified by its distinct real Sales groups");
  await initialA.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Targeted recovery report");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.evaluate(() => window.__tachikoAcceptance.resetQueryDefinitionIds());
  await chooseBinding(page, {
    ordersTable: "catalog", orderLookupKey: "code", orderQuantity: "price",
    productsTable: "catalog", productKey: "code", productCategory: "code", productPrice: "price",
  });
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.locator('[data-testid^="j4-result-"]').filter({ hasText: /PEN\s*40000/ }).getByLabel("Cross-table groups", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2);
  const targetDefinitionIds = await page.evaluate(() => window.__tachikoAcceptance.queryDefinitionIds());
  assert.equal(targetDefinitionIds.length, 2, "creation of B re-queries both definitions through real Work");
  assert.ok(targetDefinitionIds.includes(targetId), "the original A definition ID remains in the real definition set");
  assert.notEqual(targetDefinitionIds[0], targetDefinitionIds[1]);
  const targetIndex = targetDefinitionIds.indexOf(targetId);
  assert.notEqual(targetIndex, -1);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const currentA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  const currentB = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*40000/ });
  assert.equal(await currentA.count(), 1, "A is selected by its distinct real Sales groups");
  assert.equal(await currentB.count(), 1, "B is selected by its distinct real Catalog groups");
  assert.deepEqual(await groupRows(currentA.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await groupRows(currentB.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 1, "A's current report chart is available before the fault");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 1, "A's current PNG is available before the fault");
  const beforeTargetedFailure = await page.evaluate(() => ({
    execute: window.__tachikoAcceptance.executeRequestCount(),
    copies: window.__tachikoAcceptance.copyWriteDispatchCounts(),
  }));
  const targetSnapshot = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  const exportsBeforeTargetedRefresh = await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts());
  await page.evaluate(({ definitionId, occurrence, revision }) =>
    window.__tachikoAcceptance.armTargetedQueryReplyFault(definitionId, occurrence, revision),
  { definitionId: targetId, occurrence: targetSnapshot.occurrence, revision: targetSnapshot.revision });
  const armedTargetProbe = await page.evaluate(() => window.__tachikoAcceptance.targetedQueryFaultProbe());
  assert.equal(armedTargetProbe.armed, true);
  assert.equal(armedTargetProbe.definitionId, targetId);
  assert.equal(armedTargetProbe.occurrence, targetSnapshot.occurrence);
  assert.equal(armedTargetProbe.revision, targetSnapshot.revision);
  assert.equal(typeof armedTargetProbe.owningClientIdentity, "number");
  assert.equal(armedTargetProbe.actualReplyRevision, null);
  assert.equal(armedTargetProbe.consumed, false);
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await currentA.getByRole("button", { name: "Refresh core result", exact: true }).click();
  await page.waitForFunction(() => {
    const probe = window.__tachikoAcceptance.targetedQueryFaultProbe();
    return !probe.armed && document.querySelector('[data-testid="currentness"]')?.getAttribute("data-currentness") === "current";
  });
  const targetedFaultEvidence = await page.evaluate(() => window.__tachikoAcceptance.targetedQueryFaultProbe());
  assert.equal(targetedFaultEvidence.consumed, true, `one matching real target reply is discarded: ${JSON.stringify(targetedFaultEvidence)}`);
  assert.equal(targetedFaultEvidence.definitionId, targetId);
  assert.equal(targetedFaultEvidence.occurrence, targetSnapshot.occurrence);
  assert.equal(targetedFaultEvidence.revision, targetSnapshot.revision);
  assert.equal(targetedFaultEvidence.actualReplyRevision, targetSnapshot.revision, "the discarded reply came from real Work at the armed revision");
  assert.equal(typeof targetedFaultEvidence.owningClientIdentity, "number");
  assert.equal(targetedFaultEvidence.consumed, true, "the one-shot target was consumed exactly once");
  assert.equal(await page.getByTestId("currentness").getAttribute("data-currentness"), "current", "the workbook remains current after this known targeted failure");
  assert.equal((await page.getByTestId("currentness").textContent())?.trim(), "Results need attention");
  assert.equal(await page.getByText("Some results need attention. Check the affected summaries.", { exact: true }).isVisible(), true, "a read failure uses neutral attention guidance");
  assert.equal(await page.getByText("Some results need attention. Correct the source data to update them.", { exact: true }).count(), 0, "a read failure does not claim the source data changed");
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 1, "only targeted A is withdrawn");
  const preservedSibling = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) });
  assert.equal(await preservedSibling.count(), 1);
  assert.equal(await preservedSibling.locator(".ts-content-meta").textContent().then((text) => text?.startsWith("Current result") ?? false), true);
  assert.deepEqual(await groupRows(preservedSibling.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  assert.equal(await page.getByText("This summary has no confirmed current result. Refresh it to try again.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: `Refresh cross-table summary ${targetIndex + 1}`, exact: true }).count(), 1, "A keeps a targeted recovery control");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), beforeTargetedFailure.execute, "the targeted query failure dispatches no semantic operation");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), exportsBeforeTargetedRefresh, "the targeted query failure dispatches no exports");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report", "A report draft is retained while its source result is missing");
  assert.equal(await page.getByText("This summary has no confirmed current result. Refresh it to try again. Previous chart values are hidden.", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/Correct the source data to see the report/i).count(), 0, "the read failure does not show diagnostic source-correction guidance");
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  const beforeDependentSave = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("targeted-failure-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /was not created/i }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts()), beforeDependentSave, "the report dependency blocks Save before a copy write");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: `Refresh cross-table summary ${targetIndex + 1}`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="currentness"]')?.textContent?.trim() === "Up to date");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="j4-result-"]').count(), 2, "ordinary targeted Refresh restores both results");
  const recoveredA = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*800/ });
  const recoveredB = page.locator('[data-testid^="j4-result-"]').filter({ has: page.getByLabel("Cross-table groups", { exact: true }) }).filter({ hasText: /PEN\s*40000/ });
  assert.equal(await recoveredA.count(), 1);
  assert.equal(await recoveredB.count(), 1);
  assert.deepEqual(await groupRows(recoveredA.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 1000", "PEN: 800"]);
  assert.deepEqual(await groupRows(recoveredB.getByLabel("Cross-table groups", { exact: true })), ["NOTE: 250000", "PEN: 40000"]);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Targeted recovery report");
  assert.equal(await page.getByRole("region", { name: "Report chart", exact: true }).count(), 1, "A's chart returns after the real targeted query");
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 1, "A's PNG returns after the real targeted query");
  assert.equal(await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount()), beforeTargetedFailure.execute, "targeted failure and recovery do not replay a semantic operation");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.exportDispatchCounts()), {
    canonical: exportsBeforeTargetedRefresh.canonical,
    opaque: exportsBeforeTargetedRefresh.opaque + 1,
  }, "only the blocked Save's prerequisite snapshot export occurs; targeted failure and recovery dispatch none");
  await closeWithoutSaving(page);
  await openCanary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".ts-app").getAttribute("data-sales-catalog-layout"), null, "replacement clears UI-only Sales layout eligibility");
  const ordinaryGrid = page.locator('table[aria-label="Table"]');
  const ordinaryScrollport = page.locator(".ts-grid-scroll");
  await ordinaryGrid.waitFor();
  const ordinarySizing = await ordinaryGrid.evaluate((table) => ({
    minWidth: getComputedStyle(table).minWidth,
    scrollWidth: table.scrollWidth,
    clientWidth: table.parentElement?.clientWidth ?? 0,
    scrollportHeight: table.parentElement?.getBoundingClientRect().height ?? 0,
  }));
  assert.equal(await page.locator(".ts-grid--sales-catalog").count(), 0, "an ordinary workbook never inherits the Sales compact selector");
  assert.equal(ordinarySizing.minWidth, "1024px", "an ordinary workbook retains the generic minimum width");
  assert.ok(ordinarySizing.scrollWidth > ordinarySizing.clientWidth, `an ordinary narrow workbook keeps horizontal grid scrolling: ${JSON.stringify(ordinarySizing)}`);
  assert.ok(ordinarySizing.scrollportHeight >= 168, `an ordinary workbook keeps the 168px row viewport floor: ${JSON.stringify(ordinarySizing)}`);
  assert.equal(await page.locator(".ts-workspace-footer").isVisible(), true, "the ordinary workbook footer stays available at phone width");
  const ordinaryCell = ordinaryGrid.locator("tbody td").first();
  await ordinaryCell.click();
  assert.equal(await ordinaryCell.evaluate((cell) => document.activeElement === cell), true, "ordinary grid selection remains keyboard focusable");
  await ordinaryCell.press("Enter");
  const ordinaryEditor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await ordinaryEditor.waitFor();
  const ordinaryValue = await ordinaryEditor.inputValue();
  await ordinaryEditor.press("Escape");
  assert.equal(await ordinaryEditor.count(), 0, "ordinary editor still closes with Escape");
  assert.equal(await ordinaryCell.textContent(), ordinaryValue, "cancelling the ordinary edit leaves the source value intact");
  if (resultsEvidenceDir) await page.screenshot({ path: path.join(resultsEvidenceDir, "ordinary-wide-grid-390x844.png"), fullPage: true });
  console.log(JSON.stringify({ case: "ordinary-wide-grid-regression", viewport: [390, 844], ordinarySizing, sourceValue: ordinaryValue }));
  console.log(JSON.stringify({
    case: "steward-46-clause-8-targeted-refresh",
    actualDefinitionIds: { a: targetId, afterB: targetDefinitionIds },
    actualWitness: { occurrence: targetSnapshot.occurrence, revision: targetSnapshot.revision },
    actualFault: targetedFaultEvidence,
    recoveredValues: { a: ["NOTE: 1000", "PEN: 800"], b: ["NOTE: 250000", "PEN: 40000"] },
  }));
  await page.evaluate(() => window.__tachikoAcceptance.resetTargetedQueryReplyFault());
} finally {
  if (context) {
    const cleanupPage = context.pages()[0];
    await cleanupPage?.evaluate(() => window.__tachikoAcceptance?.releaseSecondScalarRequeryReply()).catch(() => {});
    await cleanupPage?.evaluate(() => window.__tachikoAcceptance?.resetTargetedQueryReplyFault()).catch(() => {});
    await context.close().catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
}

// Real built-product J5 journey. Report values are observed only through the
// current core J4 result; the test never supplies a client-side total.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-j5-product-"));
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
let context;

async function start(viewport) {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  page.setDefaultTimeout(5000);
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  return page;
}

async function bindSummary(page) {
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByTestId("save-status").filter({ hasText: "Not saved yet" }).waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  await page.getByLabel("Orders table", { exact: true }).selectOption("sales");
  await page.getByLabel("Order lookup key", { exact: true }).selectOption("product_code");
  await page.getByLabel("Order quantity", { exact: true }).selectOption("quantity");
  await page.getByLabel("Products table", { exact: true }).selectOption("catalog");
  await page.getByLabel("Product key", { exact: true }).selectOption("code");
  await page.getByLabel("Product category", { exact: true }).selectOption("category");
  await page.getByLabel("Product price", { exact: true }).selectOption("price");
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
}

async function editPenPrice(page) {
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0);
  await page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  await editor.press("Enter");
}

async function downloadedPng(page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current PNG", exact: true }).click();
  const download = await downloadPromise;
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return png;
}

async function redrawReport(page, title) {
  const control = page.getByLabel("Title", { exact: true });
  await control.fill(`${title} redraw`);
  await control.fill(title);
  await page.locator(".ts-report-canvas").evaluate((canvas) => {
    if (canvas.dataset.reportReady !== "true") throw new Error("Report redraw did not settle.");
  });
}

/**
 * A persisted presentation can be structurally valid and byte-paired yet no
 * longer name a discoverable definition. This is a host-record fault only;
 * the core bytes and their digest remain untouched.
 */
async function replaceSavedReportDefinition(page, name, definitionId) {
  await page.evaluate(async ({ name: copyName, definitionId: nextDefinitionId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tachiko-sheet-local-copies", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the saved-copy store."));
    });
    try {
      const transaction = db.transaction(["opaque-copies"], "readwrite");
      const store = transaction.objectStore("opaque-copies");
      const record = await new Promise((resolve, reject) => {
        const request = store.get(copyName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not read the saved report."));
      });
      if (!record?.presentation) throw new Error("Expected a persisted presentation attachment.");
      record.presentation.report.definitionId = nextDefinitionId;
      store.put(record);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not store the report fault."));
        transaction.onabort = () => reject(transaction.error ?? new Error("The report fault transaction aborted."));
      });
    } finally {
      db.close();
    }
  }, { name, definitionId });
}

async function replaceSavedReportText(page, name, field, value) {
  await page.evaluate(async ({ name: copyName, field: reportField, value: nextValue }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tachiko-sheet-local-copies", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the saved-copy store."));
    });
    try {
      const transaction = db.transaction(["opaque-copies"], "readwrite");
      const store = transaction.objectStore("opaque-copies");
      const record = await new Promise((resolve, reject) => {
        const request = store.get(copyName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not read the saved report."));
      });
      if (!record?.presentation) throw new Error("Expected a persisted presentation attachment.");
      record.presentation.report[reportField] = nextValue;
      store.put(record);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not store the report fault."));
        transaction.onabort = () => reject(transaction.error ?? new Error("The report fault transaction aborted."));
      });
    } finally {
      db.close();
    }
  }, { name, field, value });
}

async function eraseCanvasColor(page, hex, bounds) {
  await page.locator(".ts-report-canvas").evaluate((canvas, { hex, bounds }) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Test fault requires a 2D context.");
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    const image = context.getImageData(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset] === red && image.data[offset + 1] === green && image.data[offset + 2] === blue && image.data[offset + 3] === 255) {
        image.data[offset] = 255;
        image.data[offset + 1] = 255;
        image.data[offset + 2] = 255;
      }
    }
    context.putImageData(image, bounds.left, bounds.top);
  }, { hex, bounds });
}

/** Remove only the connecting line corridor; point markers remain untouched. */
async function eraseCanvasStroke(page, bounds) {
  await page.locator(".ts-report-canvas").evaluate((canvas, bounds) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Test fault requires a 2D context.");
    context.fillStyle = "#ffffff";
    context.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }, bounds);
}

/**
 * Decodes the downloaded artifact, then independently compares its pixels to
 * the configured report text and expected series colour. This deliberately
 * observes the encoded PNG rather than product DOM or canvas calls.
 */
async function pngFacts(page, png, expected) {
  const base64 = png.toString("base64");
  return page.evaluate(async ({ encoded, expected }) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PNG pixel inspection requires a 2D context.");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;

    const colorCount = (hex, bounds) => {
      const red = Number.parseInt(hex.slice(1, 3), 16);
      const green = Number.parseInt(hex.slice(3, 5), 16);
      const blue = Number.parseInt(hex.slice(5, 7), 16);
      let count = 0;
      for (let y = bounds.top; y < Math.min(bounds.bottom, canvas.height); y += 1) {
        for (let x = bounds.left; x < Math.min(bounds.right, canvas.width); x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (actual[offset] === red && actual[offset + 1] === green && actual[offset + 2] === blue && actual[offset + 3] === 255) count += 1;
        }
      }
      return count;
    };

    const textMatches = expected.text.map((entry) => {
      const sample = new OffscreenCanvas(canvas.width, canvas.height);
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) throw new Error("PNG text inspection requires a 2D context.");
      sampleContext.fillStyle = "#ffffff";
      sampleContext.fillRect(0, 0, sample.width, sample.height);
      sampleContext.fillStyle = entry.color;
      sampleContext.font = entry.font;
      sampleContext.textAlign = entry.align;
      sampleContext.fillText(entry.value, entry.x, entry.y);
      const samplePixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
      const textColor = [Number.parseInt(entry.color.slice(1, 3), 16), Number.parseInt(entry.color.slice(3, 5), 16), Number.parseInt(entry.color.slice(5, 7), 16)];
      const expectedPixels = [];
      for (let offset = 0; offset < samplePixels.length; offset += 4) {
        if (samplePixels[offset] !== textColor[0] || samplePixels[offset + 1] !== textColor[1] || samplePixels[offset + 2] !== textColor[2] || samplePixels[offset + 3] !== 255) continue;
        expectedPixels.push({
          x: (offset / 4) % sample.width,
          y: Math.floor(offset / 4 / sample.width),
          red: samplePixels[offset],
          green: samplePixels[offset + 1],
          blue: samplePixels[offset + 2],
          alpha: samplePixels[offset + 3],
        });
      }
      const offsets = entry.search
        ? Array.from({ length: entry.search.bottom - entry.search.top + 1 }, (_, y) =>
          Array.from({ length: entry.search.right - entry.search.left + 1 }, (_, x) => ({
            x: entry.search.left + x - entry.x,
            y: entry.search.top + y - entry.y,
          })),
        ).flat()
        : [{ x: 0, y: 0 }];
      let matchingPixels = 0;
      let completeMatches = 0;
      for (const shift of offsets) {
        let matching = 0;
        for (const pixel of expectedPixels) {
          const x = pixel.x + shift.x;
          const y = pixel.y + shift.y;
          if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
          const offset = (y * canvas.width + x) * 4;
          if (actual[offset] === pixel.red && actual[offset + 1] === pixel.green && actual[offset + 2] === pixel.blue && actual[offset + 3] === pixel.alpha) matching += 1;
        }
        matchingPixels = Math.max(matchingPixels, matching);
        if (matching === expectedPixels.length) completeMatches += 1;
      }
      return { value: entry.value, expectedPixels: expectedPixels.length, matchingPixels, completeMatches, minimumMatches: entry.minimumMatches ?? 1 };
    });
    return {
      width: canvas.width,
      height: canvas.height,
      seriesPixels: colorCount(expected.seriesColor, expected.seriesBounds),
      legendPixels: colorCount(expected.seriesColor, expected.legendBounds),
      seriesSlots: expected.seriesSlots.map((bounds) => colorCount(expected.seriesColor, bounds)),
      seriesAbsences: expected.seriesAbsences.map((bounds) => colorCount(expected.seriesColor, bounds)),
      lineStrokeCorridors: (expected.lineStrokeCorridors ?? []).map((bounds) => colorCount(expected.seriesColor, bounds)),
      textMatches,
    };
  }, { encoded: base64, expected });
}

async function assertReportPng(page, png, expected) {
  const facts = await pngFacts(page, png, expected);
  assert.ok(facts.width > 0 && facts.height > 0, "downloaded report must decode to a nonempty bitmap");
  assert.ok(facts.seriesPixels > 100, "downloaded report must retain its series pixels");
  assert.ok(facts.legendPixels > 50, "downloaded report must retain its legend swatch");
  for (const [index, pixels] of facts.seriesSlots.entries()) assert.ok(pixels > 20, `downloaded report must retain series geometry in slot ${index + 1}`);
  for (const [index, pixels] of facts.seriesAbsences.entries()) assert.equal(pixels, 0, `downloaded report must not draw series outside slot ${index + 1}`);
  for (const [index, pixels] of facts.lineStrokeCorridors.entries()) {
    assert.ok(pixels > expected.lineStrokeCorridors[index].minimumPixels, `downloaded report must retain line stroke corridor ${index + 1}`);
  }
  for (const text of facts.textMatches) {
    assert.ok(text.expectedPixels > 0, `oracle must rasterize ${text.value}`);
    assert.equal(text.matchingPixels, text.expectedPixels, `downloaded report must retain configured text: ${text.value}`);
    assert.ok(text.completeMatches >= text.minimumMatches, `downloaded report must retain every expected instance of: ${text.value}`);
  }
}

const barArtifact = {
  seriesColor: "#2563eb",
  seriesBounds: { left: 80, top: 80, right: 250, bottom: 320 },
  legendBounds: { left: 550, top: 16, right: 590, bottom: 42 },
  seriesSlots: [{ left: 95, top: 96, right: 153, bottom: 306 }, { left: 191, top: 96, right: 249, bottom: 306 }],
  seriesAbsences: [],
  text: [
    { value: "Initial sales report", color: "#1f2937", font: "600 20px system-ui, sans-serif", align: "start", x: 76, y: 38 },
    { value: "Initial value", color: "#475569", font: "14px system-ui, sans-serif", align: "start", x: 76, y: 62 },
    { value: "Product category", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 372, y: 358 },
    { value: "Bar series", color: "#334155", font: "14px system-ui, sans-serif", align: "start", x: 580, y: 33 },
    { value: "NOTE", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 326 },
    { value: "PEN", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 326 },
    { value: "1000", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 112, search: { left: 100, top: 96, right: 145, bottom: 145 } },
    { value: "800", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 130, search: { left: 196, top: 96, right: 244, bottom: 145 } },
  ],
};

const blankLabelArtifact = {
  ...barArtifact,
  text: [
    { value: "Current report", color: "#1f2937", font: "600 20px system-ui, sans-serif", align: "start", x: 76, y: 38 },
    { value: "Value", color: "#475569", font: "14px system-ui, sans-serif", align: "start", x: 76, y: 62 },
    { value: "Category", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 372, y: 358 },
  ],
};

const lineArtifact = {
  seriesColor: "#7c3aed",
  seriesBounds: { left: 80, top: 80, right: 250, bottom: 320 },
  legendBounds: { left: 550, top: 16, right: 590, bottom: 42 },
  seriesSlots: [{ left: 116, top: 91, right: 132, bottom: 111 }, { left: 212, top: 91, right: 228, bottom: 111 }],
  seriesAbsences: [{ left: 116, top: 148, right: 132, bottom: 164 }],
  // This middle corridor is outside both point markers. It proves the PNG
  // contains the line stroke itself, not merely the two plotted dots.
  lineStrokeCorridors: [{ left: 140, top: 94, right: 204, bottom: 99, minimumPixels: 80 }],
  text: [
    { value: "Updated sales report", color: "#1f2937", font: "600 20px system-ui, sans-serif", align: "start", x: 76, y: 38 },
    { value: "Updated value", color: "#475569", font: "14px system-ui, sans-serif", align: "start", x: 76, y: 62 },
    { value: "Updated category", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 372, y: 358 },
    { value: "Line series", color: "#334155", font: "14px system-ui, sans-serif", align: "start", x: 580, y: 33 },
    { value: "NOTE", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 326 },
    { value: "PEN", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 326 },
    { value: "1000", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 124, y: 112, search: { left: 100, top: 96, right: 145, bottom: 145 } },
    { value: "1000", color: "#334155", font: "14px system-ui, sans-serif", align: "center", x: 220, y: 112, search: { left: 196, top: 96, right: 244, bottom: 145 } },
  ],
};

try {
  let page = await start({ width: 500, height: 900 });
  await bindSummary(page);
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  let reportData = page.getByLabel("Current report data", { exact: true });
  await reportData.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "ts-tab-report", { timeout: 1000 });
  assert.match(await reportData.textContent(), /PEN\s*800/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);
  const titleAtLimit = "A".repeat(119) + "😀";
  const titleOverLimit = "A".repeat(120) + "😀";
  const labelAtLimit = "界".repeat(79) + "😀";
  const labelOverLimit = "界".repeat(80) + "😀";
  const title = page.getByLabel("Title", { exact: true });
  const categoryLabel = page.getByLabel("Category label", { exact: true });
  const valueLabel = page.getByLabel("Value label", { exact: true });
  await title.fill(titleAtLimit);
  assert.equal(await title.getAttribute("aria-invalid"), null, "120 code points must remain valid despite 121 UTF-16 code units");
  await title.fill(titleOverLimit);
  assert.equal(await title.inputValue(), titleOverLimit, "an over-limit draft must remain visible verbatim");
  assert.equal(await title.getAttribute("aria-invalid"), "true");
  await page.getByText(/Title must be 120 Unicode code points or fewer \(121 entered\)/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("blocked-invalid-presentation");
  assert.equal(await page.getByRole("button", { name: "Create copy", exact: true }).isDisabled(), true, "an invalid report draft must block a new copy without treating its copy name as the report draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Unsaved work", exact: true }).waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await title.inputValue(), titleOverLimit, "keeping an invalid report draft must preserve its exact text");
  assert.equal(await title.getAttribute("aria-invalid"), "true");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("sales");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await title.inputValue(), titleOverLimit, "an invalid draft must survive a same-occurrence table switch");
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Create line report", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Correct the invalid report presentation text before replacing this report." }).waitFor();
  assert.equal(await title.inputValue(), titleOverLimit, "creating another report must not discard an invalid draft");
  await title.fill(titleAtLimit);
  assert.equal(await title.getAttribute("aria-invalid"), null);
  await categoryLabel.fill(labelAtLimit);
  assert.equal(await categoryLabel.getAttribute("aria-invalid"), null, "80 code points must remain valid despite astral UTF-16 length");
  await valueLabel.fill(labelOverLimit);
  assert.equal(await valueLabel.inputValue(), labelOverLimit);
  assert.equal(await valueLabel.getAttribute("aria-invalid"), "true");
  await valueLabel.fill("Initial value");
  await page.getByLabel("Title", { exact: true }).fill("Initial sales report");
  await page.getByLabel("Category label", { exact: true }).fill("Product category");

  // The report canvas must remain keyboard-reachable as a named, horizontally
  // scrollable region without changing the existing control order.
  const legend = page.getByRole("checkbox", { name: "Show legend", exact: true });
  const reportScroll = page.getByRole("region", { name: "Report chart", exact: true });
  await legend.focus();
  assert.equal(await legend.evaluate((element) => element === document.activeElement), true);
  const reportCard = page.getByRole("region", { name: "Current report", exact: true });
  const overflow = await reportScroll.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  const cardBounds = await reportCard.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(cardBounds.scrollWidth <= cardBounds.clientWidth, `report card must remain bounded (${cardBounds.clientWidth}x${cardBounds.scrollWidth})`);
  assert.ok(overflow.scrollWidth > overflow.clientWidth, `report chart must horizontally overflow its viewport (${overflow.clientWidth}x${overflow.scrollWidth})`);
  await page.keyboard.press("Tab");
  assert.equal(await reportScroll.evaluate((element) => element === document.activeElement), true, "Tab from the legend must reach the named report chart region");
  const scrollBefore = await reportScroll.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction((before) => document.querySelector('[aria-label="Report chart"]')?.scrollLeft > before, scrollBefore, { timeout: 1000 });
  const scrollAfter = await reportScroll.evaluate((element) => element.scrollLeft);
  assert.ok(scrollAfter > scrollBefore, `ArrowRight must scroll the report chart region (${scrollBefore}->${scrollAfter})`);
  await page.keyboard.press("Tab");
  const exportButton = page.getByRole("button", { name: "Export current PNG", exact: true });
  assert.equal(await exportButton.evaluate((element) => element === document.activeElement), true, "Tab must continue to Export current PNG");
  await assertReportPng(page, await downloadedPng(page), barArtifact);
  await page.getByLabel("Title", { exact: true }).fill("");
  await page.getByLabel("Category label", { exact: true }).fill("");
  await page.getByLabel("Value label", { exact: true }).fill("");
  const blankLabelFacts = await pngFacts(page, await downloadedPng(page), blankLabelArtifact);
  for (const text of blankLabelFacts.textMatches) {
    assert.equal(text.matchingPixels, 0, `downloaded report must not substitute a default ${text.value} label`);
  }
  await page.getByLabel("Title", { exact: true }).fill("Initial sales report");
  await page.getByLabel("Category label", { exact: true }).fill("Product category");
  await page.getByLabel("Value label", { exact: true }).fill("Initial value");

  // Saving immediately after creating the summary preserves a published
  // snapshot. Reopening starts a fresh resident session whose revision is
  // intentionally different, so the report must bind through the freshly
  // discovered definition/result rather than comparing the old revision token.
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-direct-publication-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = undefined;
  page = await start({ width: 500, height: 900 });
  await page.getByRole("button", { name: "Open saved j5-direct-publication-report", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  for (const [label, value] of [["Title", "Initial sales report"], ["Category label", "Product category"], ["Value label", "Initial value"]]) {
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value, `direct post-publication reopen must retain ${label}`);
  }

  // A table switch changes only the table projection; the still-current
  // report source and raster stay eligible for export.
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("sales");
  await page.getByRole("columnheader", { name: "product_code", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByRole("button", { name: "Export current PNG", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).isEnabled(), true);
  await assertReportPng(page, await downloadedPng(page), barArtifact);

  await editPenPrice(page);
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByText("This report source is not current. Refresh the cross-table summary before viewing or sharing it, or remove this report configuration before saving.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);
  const removeReportButton = page.getByRole("button", { name: "Remove report", exact: true });
  // The stale-source status can render in the same React turn that releases
  // the preceding edit. Wait for the existing control to become actionable;
  // pressing a disabled button would not exercise the required removal.
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Remove report");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await removeReportButton.focus();
  await page.keyboard.press("Enter");
  await page.getByText("The report configuration was removed. Table data and the cross-table definition were kept.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement?.textContent?.trim() === "Report", { timeout: 1000 });
  assert.equal(await page.getByRole("tab", { name: "Report", exact: true }).evaluate((element) => element === document.activeElement), true, "keyboard Remove must return focus to the Report tab");
  await page.getByText("Create a bar or line report from a current cross-table result.", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("operation-outcome").count(), 0, "a successful report removal must clear the pending outcome");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-stale-report-removed");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j5-stale-report-removed", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByText("Create a bar or line report from a current cross-table result.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export current PNG", exact: true }).count(), 0);

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  const refreshMissingSummary = page.getByRole("button", { name: "Refresh cross-table summary 1", exact: true });
  if (await refreshMissingSummary.count()) await refreshMissingSummary.click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create line report", exact: true }).click();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  reportData = page.getByLabel("Current report data", { exact: true });
  await reportData.waitFor();
  assert.match(await reportData.textContent(), /PEN\s*1000/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);
  await page.getByLabel("Title", { exact: true }).fill("Updated sales report");
  await page.getByLabel("Category label", { exact: true }).fill("Updated category");
  await page.getByLabel("Value label", { exact: true }).fill("Updated value");
  await assertReportPng(page, await downloadedPng(page), lineArtifact);

  // Each decodable fault isolates one oracle dimension. None uses a product
  // draw/layout helper: the downloaded PNG remains the only observation.
  await eraseCanvasColor(page, "#7c3aed", lineArtifact.seriesBounds);
  const seriesOnlyFault = await downloadedPng(page);
  await assert.rejects(() => assertReportPng(page, seriesOnlyFault, lineArtifact), /series pixels/);
  await redrawReport(page, "Updated sales report");

  // Keep both point markers and labels, while removing only their connecting
  // stroke. The independent PNG corridor oracle must fail.
  await eraseCanvasStroke(page, lineArtifact.lineStrokeCorridors[0]);
  const strokeOnlyFault = await downloadedPng(page);
  await assert.rejects(() => assertReportPng(page, strokeOnlyFault, lineArtifact), /line stroke corridor 1/);
  await redrawReport(page, "Updated sales report");

  await page.locator(".ts-report-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Test fault requires a 2D context.");
    context.fillStyle = "#ffffff";
    context.fillRect(100, 310, 50, 30);
    context.fillRect(196, 310, 50, 30);
  });
  const textOnlyFault = await downloadedPng(page);
  await assert.rejects(() => assertReportPng(page, textOnlyFault, lineArtifact), /configured text: (NOTE|PEN)/);
  await redrawReport(page, "Updated sales report");

  // Preserve the expected points but add a decodable, misplaced series mark.
  // The global colour count still passes; the absence/geometry oracle must not.
  await page.locator(".ts-report-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Test fault requires a 2D context.");
    context.fillStyle = "#7c3aed";
    context.fillRect(116, 148, 16, 16);
  });
  const geometryFault = await downloadedPng(page);
  await assert.rejects(() => assertReportPng(page, geometryFault, lineArtifact), /outside slot 1/);
  await redrawReport(page, "Updated sales report");

  // A faulted raster can still be a valid PNG. The artifact oracle must reject
  // it because it contains neither the series nor the configured text.
  await page.locator(".ts-report-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Test fault requires a 2D context.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  });
  const faultedPng = await downloadedPng(page);
  await assert.rejects(() => assertReportPng(page, faultedPng, lineArtifact), /series pixels/);
  await redrawReport(page, "Updated sales report");
  await page.getByLabel("Title", { exact: true }).fill("");
  await page.getByLabel("Category label", { exact: true }).fill("");
  await page.getByLabel("Value label", { exact: true }).fill("");
  const blankLineLabelFacts = await pngFacts(page, await downloadedPng(page), blankLabelArtifact);
  for (const text of blankLineLabelFacts.textMatches) {
    assert.equal(text.matchingPixels, 0, `downloaded line report must not substitute a default ${text.value} label`);
  }

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  context = undefined;
  page = await start();
  await page.getByRole("button", { name: "Open saved j5-report", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  reportData = page.getByLabel("Current report data", { exact: true });
  assert.ok(await reportData.count(), await page.locator("body").textContent());
  assert.match(await reportData.textContent(), /PEN\s*1000/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);
  for (const label of ["Title", "Category label", "Value label"]) {
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "", `reopened report must retain an empty ${label}`);
  }
  const reopenedBlankLabelFacts = await pngFacts(page, await downloadedPng(page), blankLabelArtifact);
  for (const text of reopenedBlankLabelFacts.textMatches) {
    assert.equal(text.matchingPixels, 0, `reopened PNG must not substitute a default ${text.value} label`);
  }

  // A failed Refresh temporarily loses the projection but does not prove that
  // this occurrence was replaced. The local-only invalid text and its dirty
  // lifecycle guard must survive the recovery and return with the work.
  await page.getByLabel("Title", { exact: true }).fill(titleOverLimit);
  await page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), true, "a retained invalid report draft must keep the unload lifecycle guard during recovery");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), titleOverLimit, "a same-occurrence Refresh recovery must retain the invalid text exactly");
  assert.equal(await page.getByLabel("Title", { exact: true }).getAttribute("aria-invalid"), "true");
  await page.getByLabel("Title", { exact: true }).fill("");

  // A host-injected over-limit attachment is rejected by readAny before App
  // can replace its resident work or publish the saved-copy receipt.
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("j5-overlimit");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await replaceSavedReportText(page, "j5-overlimit", "title", titleOverLimit);
  await page.getByRole("button", { name: "Open saved j5-overlimit", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByTestId("save-status").count(), 0, "an over-limit attachment must not publish a replacement receipt");
  await page.getByRole("button", { name: "Open saved j5-report", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();

  // An acknowledged Open can lose its first projection. Refresh must bind the
  // saved presentation only after the same replacement and clean J4 discovery.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
  await page.getByRole("button", { name: "Open saved j5-report", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Current report data", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  reportData = page.getByLabel("Current report data", { exact: true });
  await reportData.waitFor();
  assert.match(await reportData.textContent(), /PEN\s*1000/);
  assert.match(await reportData.textContent(), /NOTE\s*1000/);

  // A host-private attachment may still pass its shape, revision and opaque
  // byte digest checks while referring to a non-current definition. Opening
  // that partial pair must stay in recoverable state: no current facts, saved
  // receipt or unpaired save may be published, including after repeat Refresh.
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await replaceSavedReportDefinition(page, "j5-report", "missing-current-definition");
  await page.getByRole("button", { name: "Open saved j5-report", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0);
  assert.equal(await page.getByTestId("save-status").count(), 0, "an unpaired saved copy must not claim a saved receipt");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 0, "repeat Refresh must retain the unpaired candidate");
  assert.equal(await page.getByTestId("save-status").count(), 0, "repeat Refresh must not publish a partial saved receipt");
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}

// Focused executable checks for the shipped visual foundation. These checks
// use the normal product entry and the committed actual-core evidence corpus.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { installDistRoutes, LOCAL_ORIGIN } from "./dist-routes.mjs";

const dist = process.env.WORK_DIST ?? "dist";
let chromium;
try {
  ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core"));
} catch {
  console.error("BLOCKED: the pinned Playwright dependency is unavailable.");
  process.exit(78);
}

const fixture = fileURLToPath(new URL("../../evidence/visual-foundation/fixture-50.roproj", import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();

  const longCell = page.locator('[data-testid^="cell:"][title]').first();
  await longCell.waitFor();
  const fullValue = await longCell.getAttribute("title");
  assert.ok(fullValue && fullValue.length > 40, "long cell must expose a full-value tooltip");
  assert.equal(
    (await longCell.locator(".ts-cell-value").textContent())?.trim(),
    fullValue,
    "the rendered cell must retain the complete value in the accessible DOM",
  );

  const grid = page.locator(".ts-grid-scroll");
  const beforeScroll = await grid.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollLeft: element.scrollLeft,
  }));
  assert.ok(beforeScroll.scrollWidth > beforeScroll.clientWidth, "1024px grid must overflow horizontally");
  await grid.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const afterScroll = await grid.evaluate((element) => element.scrollLeft);
  assert.ok(afterScroll > beforeScroll.scrollLeft, "grid must permit deliberate horizontal scrolling");

  await page.emulateMedia({ forcedColors: "active" });
  const focusCell = page.locator(".ts-cell").first();
  const style = async () => focusCell.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      outlineColor: computed.outlineColor,
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      boxShadow: computed.boxShadow,
      backgroundColor: computed.backgroundColor,
    };
  });
  const beforeFocus = await style();
  await focusCell.focus();
  const afterFocus = await style();
  assert.notDeepEqual(
    { outlineColor: afterFocus.outlineColor, outlineStyle: afterFocus.outlineStyle, outlineWidth: afterFocus.outlineWidth, boxShadow: afterFocus.boxShadow },
    { outlineColor: beforeFocus.outlineColor, outlineStyle: beforeFocus.outlineStyle, outlineWidth: beforeFocus.outlineWidth, boxShadow: beforeFocus.boxShadow },
    "forced-colors focus must change rendered focus styles",
  );
  assert.equal(afterFocus.outlineStyle, "solid", "forced-colors focus must retain a solid boundary");
  assert.equal(afterFocus.outlineWidth, "3px", "forced-colors focus must retain a 3px boundary");
  assert.ok(
    afterFocus.outlineColor !== afterFocus.backgroundColor || afterFocus.boxShadow !== "none",
    "forced-colors focus boundary must differ from the selected background",
  );

  console.log(JSON.stringify({
    status: "PASS",
    viewport: "1024x768",
    full_value_chars: fullValue.length,
    grid_scroll_width: beforeScroll.scrollWidth,
    grid_client_width: beforeScroll.clientWidth,
    scrolled_left: afterScroll,
    forced_colors: { before: beforeFocus, after: afterFocus },
  }));
  await context.close();
} finally {
  await browser.close();
}

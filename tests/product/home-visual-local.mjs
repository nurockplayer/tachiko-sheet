// Normal built-product Home presentation at desktop, tablet, and phone sizes.
// This is an isolated disposable profile over the acceptance build.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const dist = process.env.WORK_DIST ?? "dist-acceptance";
const out = process.env.HOME_VISUAL_OUT;
if (!out) throw new Error("HOME_VISUAL_OUT must name an evidence directory outside the repository.");
const browser = await chromium.launch({ headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await installDistRoutes(context, dist);
const page = await context.newPage();
page.setDefaultTimeout(10000);
let unavailableContext;
const layouts = [
  { name: "desktop", width: 1440, height: 1000, returningFirst: false },
  { name: "tablet", width: 834, height: 1112, returningFirst: true },
  { name: "phone", width: 390, height: 844, returningFirst: true },
];

function panelOrder() {
  return [...document.querySelectorAll(".ts-home-grid > section")].map((element) => element.getAttribute("aria-label"));
}
async function waitForHome() {
  await page.getByRole("heading", { name: "Tachiko Sheet", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Sales and catalog", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Saved copies", exact: true }).waitFor();
}
async function assertPhoneFlowFits() {
  const layout = await page.locator(".ts-home-example-flow").evaluate((element) => {
    const visible = [...element.children].filter((child) => getComputedStyle(child).display !== "none");
    const centers = [...new Set(visible.map((child) => {
      const rect = child.getBoundingClientRect();
      return Math.round((rect.top + rect.bottom) / 2);
    }))];
    return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, centers,
      text: visible.map((child) => child.textContent).join(" ") };
  });
  assert.equal(layout.scrollWidth <= layout.clientWidth && layout.centers.length === 1, true,
    `phone diagram fits on one line with its table and chart glyphs: ${JSON.stringify(layout)}`);
}

try {
  await page.goto(LOCAL_ORIGIN, { waitUntil: "domcontentloaded" });
  await waitForHome();
  assert.deepEqual(await page.evaluate(panelOrder), ["Sales and catalog example", "Saved copies", "Other ways to start"]);
  await page.getByText("No saved copies yet", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open sales example", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Open release plan example", exact: true }).isEnabled(), true);
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.name === "phone") await assertPhoneFlowFits();
    await page.screenshot({ path: `${out}/home-empty-${layout.name}.png`, fullPage: true });
    assert.deepEqual(await page.evaluate(panelOrder), ["Sales and catalog example", "Saved copies", "Other ways to start"], `${layout.name} empty Home order`);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Home visual sample");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await waitForHome();
  await page.getByRole("button", { name: "Open saved Home visual sample", exact: true }).waitFor();
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.waitForFunction((expected) => {
      const panels = [...document.querySelectorAll(".ts-home-grid > section")].map((element) => element.getAttribute("aria-label"));
      const desired = expected
        ? ["Saved copies", "Sales and catalog example", "Other ways to start"]
        : ["Sales and catalog example", "Saved copies", "Other ways to start"];
      return JSON.stringify(panels) === JSON.stringify(desired);
    }, layout.returningFirst);
    if (layout.name === "phone") await assertPhoneFlowFits();
    assert.deepEqual(await page.evaluate(panelOrder), layout.returningFirst
      ? ["Saved copies", "Sales and catalog example", "Other ways to start"]
      : ["Sales and catalog example", "Saved copies", "Other ways to start"]);
    assert.equal(await page.getByRole("button", { name: "Open saved Home visual sample", exact: true }).isEnabled(), true);
    await page.screenshot({ path: `${out}/home-populated-${layout.name}.png`, fullPage: true });
  }
  unavailableContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installDistRoutes(unavailableContext, dist);
  await unavailableContext.addInitScript(() => {
    window.__homeCopyOpenAttempts = 0;
    window.__homeCopyFailureArmed = true;
    const source = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: new Proxy(source, {
        get(target, property) {
          if (property === "open") return (...args) => {
            window.__homeCopyOpenAttempts += 1;
            if (window.__homeCopyFailureArmed) throw new DOMException("controlled local-copy read failure", "SecurityError");
            return Reflect.apply(Reflect.get(target, property, target), target, args);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
  });
  const unavailablePage = await unavailableContext.newPage();
  unavailablePage.setDefaultTimeout(10000);
  await unavailablePage.goto(LOCAL_ORIGIN, { waitUntil: "domcontentloaded" });
  await unavailablePage.getByText("Saved copies couldn’t be read.", { exact: true }).waitFor();
  assert.equal(await unavailablePage.getByRole("alert").count(), 0, "copy-list failure stays in its friendly inline state");
  assert.equal(await unavailablePage.locator(".ts-home-copy-unavailable").count(), 1);
  assert.equal(await unavailablePage.getByRole("button", { name: "Try again", exact: true }).isEnabled(), true);
  assert.equal(await unavailablePage.evaluate(() => window.__homeCopyOpenAttempts), 1, "one failed inventory read reaches IndexedDB");
  await unavailablePage.screenshot({ path: `${out}/home-unavailable-desktop.png`, fullPage: true });
  await unavailablePage.evaluate(() => { window.__homeCopyFailureArmed = false; });
  await unavailablePage.getByRole("button", { name: "Try again", exact: true }).click();
  await unavailablePage.getByText("No saved copies yet", { exact: true }).waitFor();
  assert.equal(await unavailablePage.evaluate(() => window.__homeCopyOpenAttempts), 2, "Retry dispatches one fresh local-copy read");
  console.log(JSON.stringify({ status: "PASS", layouts: layouts.map(({ name }) => name), savedCopy: "Home visual sample", unavailableRetry: "two actual IndexedDB open attempts", screenshots: 7 }));
} finally {
  await unavailableContext?.close();
  await context.close();
  await browser.close();
}

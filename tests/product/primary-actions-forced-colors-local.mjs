// Real-product rendered coverage for every consumer of the enabled primary
// button recipe. Journeys use visible controls; paint is sampled before any
// action is dispatched.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const mapping = JSON.parse(await readFile(path.join(root, "docs/design/interface-profile-v1-mapping.json"), "utf8"));
const profileDir = await mkdtemp(path.join(tmpdir(), "tachiko-primary-colors-"));
const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1280, height: 800 }, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
await installDistRoutes(context, dist);
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(10000);

// Stress colors intentionally invert the public roles, exercising that the
// same shared forced-colors treatment wins over both active profile palettes.
const canonicalProfile = {
  schemaVersion: 1, name: "Canonical profile", colorScheme: "light",
  typography: "tachiko-local", density: "compact", chrome: "porcelain",
  colors: Object.fromEntries(mapping.roles.map(({ role, value }) => [role, value])),
};
const stressProfile = {
  schemaVersion: 1, name: "Primary action stress", colorScheme: "light",
  typography: "tachiko-local", density: "compact", chrome: "porcelain",
  colors: { ...Object.fromEntries(mapping.roles.map(({ role, value }) => [role, `#${(0xffffff ^ Number.parseInt(value.slice(1), 16)).toString(16).padStart(6, "0")}`])), "surface.chrome": "#E8EFF5", "surface.content": "#EEF4F8", "text.primary": "#132D4A", "action.primary.background": "#164B76", "grid.canvas": "#F4F8FA", "focus.ring": "#164B76" },
};
const interactionResults = [];

async function paint(button, label, { preservePointer = false } = {}) {
  if (!preservePointer) await page.mouse.move(0, 0);
  await button.scrollIntoViewIfNeeded();
  const targetText = (await button.textContent())?.trim();
  const screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  const result = await page.evaluate(async ({ screenshot, label, targetText }) => {
    const image = new Image(); image.src = `data:image/png;base64,${screenshot}`;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const element = [...document.querySelectorAll(".ts-button--primary:not(:disabled)")].find((candidate) => candidate.textContent.trim() === targetText);
    if (!element) return { error: `real enabled button not found: ${label}` };
    const style = getComputedStyle(element); const elementRect = element.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element); const textRect = range.getBoundingClientRect();
    const left = Math.max(0, Math.floor(Math.max(elementRect.left, textRect.left)));
    const top = Math.max(0, Math.floor(Math.max(elementRect.top, textRect.top)));
    const right = Math.min(canvas.width, Math.ceil(Math.min(elementRect.right, textRect.right)));
    const bottom = Math.min(canvas.height, Math.ceil(Math.min(elementRect.bottom, textRect.bottom)));
    if (right <= left || bottom <= top) return { error: `empty rendered text crop: ${label}` };
    const pixels = context.getImageData(left, top, right - left, bottom - top).data;
    const counts = new Map();
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) { const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`; counts.set(key, (counts.get(key) ?? 0) + 1); } }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const foreground = style.color.match(/\d+/g).slice(0, 3).map(Number);
    const rgb = dominant?.[0].split(",").map(Number) ?? [];
    const lum = (c) => { const n = c / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
    const l1 = 0.2126 * lum(foreground[0]) + 0.7152 * lum(foreground[1]) + 0.0722 * lum(foreground[2]);
    const l2 = rgb.length ? 0.2126 * lum(rgb[0]) + 0.7152 * lum(rgb[1]) + 0.0722 * lum(rgb[2]) : 0;
    return { label, foregroundPixels: counts.get(foreground.join(",")) ?? 0, backgroundPixels: dominant?.[1] ?? 0, contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), forcedColorAdjust: style.forcedColorAdjust };
  }, { screenshot, label, targetText });
  assert.equal(result.error, undefined, `${label}: ${result.error ?? ""}`);
  assert.ok(result.foregroundPixels > 0, `${label}: no rendered glyph pixels in text bounds`);
  assert.ok(result.backgroundPixels > 0, `${label}: no rendered backplate pixels in text bounds`);
  assert.ok(result.contrast >= 4.5, `${label}: rendered contrast ${result.contrast.toFixed(2)}:1 is below 4.5:1`);
  return result;
}

async function sample(button, label) {
  const results = [];
  for (const [profileName, candidate] of [["canonical", canonicalProfile], ["stress", stressProfile]]) {
    assert.equal(await page.evaluate((value) => window.__tachikoAcceptance.applyInterfaceProfile(value), candidate), true, `${profileName} profile must apply`);
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ forcedColors: "active", colorScheme });
      results.push({ consumer: label, profile: profileName, colorScheme, ...(await paint(button, label)) });
    }
  }
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  if (results.length) await page.evaluate((value) => window.__tachikoAcceptance.applyInterfaceProfile(value), canonicalProfile);
  return results;
}

const results = [];
try {
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByTestId("open-project").setInputFiles(path.join(root, "tests/fixtures/release-plan.roproj"));
  await page.getByTestId("project-ready").waitFor();
  results.push(...await sample(page.getByRole("button", { name: "Save a copy", exact: true }), "Save a copy"));
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const copyName = page.getByRole("textbox", { name: "Copy name", exact: true });
  await copyName.fill("forced-colors-probe");
  const createCopy = page.getByRole("button", { name: "Create copy", exact: true });
  results.push(...await sample(createCopy, "Create copy"));
  // Representative keyboard focus and active press retain visible system focus/contrast.
  await copyName.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  assert.equal(await createCopy.evaluate((element) => element === document.activeElement), true, "two Tabs must reach Create copy from the real copy-name field through Cancel");
  await page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
  const focus = await createCopy.evaluate((element) => ({ visible: element.matches(":focus-visible") && getComputedStyle(element).outlineStyle !== "none", width: getComputedStyle(element).outlineWidth }));
  assert.equal(focus.visible, true, "Create copy keyboard focus outline must remain visible");
  const focusPaint = await paint(createCopy, "Create copy keyboard focus", { preservePointer: true });
  const outlineScreenshot = (await page.screenshot({ type: "png" })).toString("base64");
  const outlineEvidence = await page.evaluate(async (screenshot) => {
    const button = document.activeElement;
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    const image = new Image(); image.src = `data:image/png;base64,${screenshot}`;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const gap = Number.parseFloat(style.outlineOffset); const width = Number.parseFloat(style.outlineWidth);
    let pixels = 0;
    const x1 = Math.max(0, Math.floor(rect.left - gap - width - 3)); const x2 = Math.min(canvas.width, Math.ceil(rect.right + gap + width + 3));
    const y1 = Math.max(0, Math.floor(rect.top - gap - width - 3)); const y2 = Math.min(canvas.height, Math.ceil(rect.bottom + gap + width + 3));
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = y1; y < y2; y += 1) for (let x = x1; x < x2; x += 1) {
      const outside = x < rect.left - gap || x >= rect.right + gap || y < rect.top - gap || y >= rect.bottom + gap;
      const withinOutline = x >= rect.left - gap - width && x < rect.right + gap + width && y >= rect.top - gap - width && y < rect.bottom + gap + width;
      if (!outside || !withinOutline) continue;
      const offset = (y * canvas.width + x) * 4;
      let nx = x; let ny = y;
      if (x < rect.left - gap) nx = x - 3;
      else if (x >= rect.right + gap) nx = x + 3;
      else if (y < rect.top - gap) ny = y - 3;
      else ny = y + 3;
      if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
      const neighbor = (ny * canvas.width + nx) * 4;
      const delta = Math.abs(data[offset] - data[neighbor]) + Math.abs(data[offset + 1] - data[neighbor + 1]) + Math.abs(data[offset + 2] - data[neighbor + 2]);
      if (delta > 40) pixels += 1;
    }
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor, visibleOutlinePixels: pixels };
  }, outlineScreenshot);
  assert.deepEqual([outlineEvidence.outlineStyle, outlineEvidence.outlineWidth, outlineEvidence.outlineOffset], ["solid", "3px", "2px"], "keyboard focus geometry must retain the visible 3px solid outline with 2px gap");
  assert.ok(outlineEvidence.visibleOutlinePixels > 0, `keyboard focus must paint visible system-color outline pixels: ${JSON.stringify(outlineEvidence)}`);
  interactionResults.push({ state: "keyboard focus", colorScheme: "light", profile: "canonical", ...focusPaint, ...outlineEvidence });

  await createCopy.hover();
  assert.equal(await createCopy.evaluate((element) => element.matches(":hover")), true, "hover probe must enter the real button state");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme });
    interactionResults.push({ state: "hover", colorScheme, profile: "canonical", ...(await paint(createCopy, "Create copy hover", { preservePointer: true })) });
  }
  const beforePress = await page.evaluate(() => ({ observations: window.__tachikoAcceptance.saveObservation(), writes: window.__tachikoAcceptance.copyWriteDispatchCounts() }));
  await page.mouse.down();
  assert.equal(await createCopy.evaluate((element) => element.matches(":active")), true, "pressed probe must enter the real button state");
  await page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
  interactionResults.push({ state: "pressed", colorScheme: "light", profile: "canonical", ...(await paint(createCopy, "Create copy pressed", { preservePointer: true })) });
  await page.mouse.move(0, 0);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => ({ observations: window.__tachikoAcceptance.saveObservation(), writes: window.__tachikoAcceptance.copyWriteDispatchCounts() })), beforePress, "paint-only pressed state must not dispatch Create copy");
  assert.equal(await page.getByRole("dialog", { name: "Save a copy", exact: true }).count(), 1, "pressed state must leave the copy dialog open");
  await page.keyboard.press("Escape");

  // Apply Notes is reachable on the accepted editable release-plan fixture.
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  await page.getByRole("textbox", { name: "Decision notes", exact: true }).fill("Primary palette rendered probe");
  results.push(...await sample(page.getByRole("button", { name: "Apply notes", exact: true }), "Apply Notes"));

  // Reset the uncommitted draft by reloading, then use the J4 canary for summary/report.
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();

  // Configure the real J4 canary summary without invoking publication yet.
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  for (const [label, value] of [["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"], ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"]]) await page.getByLabel(label, { exact: true }).selectOption(value);
  const createSummary = page.getByRole("button", { name: "Create cross-table summary", exact: true });
  results.push(...await sample(createSummary, "Create cross-table summary"));
  await createSummary.click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Primary button probe");
  results.push(...await sample(page.getByRole("button", { name: "Export current PNG", exact: true }), "Export current PNG"));

  // Import candidate uses the actual CSV chooser and parser, then enables cleanup.
  const csv = path.join(root, "acceptance/j3-interop/fixtures/messy.csv");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const closeDialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await closeDialog.count()) await closeDialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).waitFor();
  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(csv);
  const importDialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await importDialog.waitFor();
  const importButton = importDialog.getByRole("button", { name: "Import candidate", exact: true });
  results.push(...await sample(importButton, "Import candidate"));
  await importButton.click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Preview trim", exact: true }).click();
  const commit = page.getByRole("button", { name: "Commit preview", exact: true });
  results.push(...await sample(commit, "Commit preview"));
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();

  // Download confirmation is reached through the actual exporter and safely cancelled.
  await page.getByRole("button", { name: "Prepare CSV", exact: true }).click();
  const download = page.getByRole("dialog", { name: "Confirm download", exact: true }).getByRole("button", { name: "Download", exact: true });
  results.push(...await sample(download, "Download"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  assert.equal(results.length, 8 * 4, "all eight actual primary consumers must be checked in both profiles/palettes");
  console.log(JSON.stringify({ case: "enabled primary forced-colors rendered consumers", status: "PASS", inventory: ["Save a copy", "Apply Notes", "Commit preview", "Create cross-table summary", "Export current PNG", "Create copy", "Import candidate", "Download"], samples: results, interactionResults }));
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}

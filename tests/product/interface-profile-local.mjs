// Supporting real-kit evidence for the fixed #68 appearance-only invariants.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const mapping = JSON.parse(await readFile(path.join(root, "docs/design/interface-profile-v1-mapping.json"), "utf8"));
const profile = {
  schemaVersion: 1, name: "Appearance boundary probe", colorScheme: "light",
  typography: "tachiko-local", density: "compact", chrome: "porcelain",
  colors: {
    // Invert every canonical role so a protected recipe cannot pass by coincidence.
    ...Object.fromEntries(mapping.roles.map(({ role, value }) => [role,
      `#${(0xffffff ^ Number.parseInt(value.slice(1), 16)).toString(16).padStart(6, "0")}`])),
    "surface.chrome": "#E8EFF5", "surface.content": "#EEF4F8",
    "text.primary": "#132D4A", "action.primary.background": "#164B76",
    "grid.canvas": "#F4F8FA", "focus.ring": "#164B76",
  },
};
const browser = await chromium.launch({ headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await installDistRoutes(context, process.env.WORK_DIST ?? path.join(root, "dist-acceptance"));
const page = await context.newPage();
page.setDefaultTimeout(10000);

async function downloadedPng() {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current PNG", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
}

async function forcedColorPaintEvidence(label) {
  // Check the resting control, not a pointer hover left by the Save journey.
  await page.mouse.move(0, 0);
  const screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  const evidence = await page.evaluate(async ({ label: caseLabel, screenshot }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${screenshot}`;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const rgb = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
    const relativeLuminance = ([r, g, b]) => {
      const linear = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const contrast = (first, second) => {
      const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
      const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const paint = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`${caseLabel}: missing ${selector}`);
      const style = getComputedStyle(element);
      const elementRect = element.getBoundingClientRect();
      // Tight text bounds reject a same-color text backplate even when the
      // surrounding button/header has the expected contrasting system color.
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRect = range.getBoundingClientRect();
      const rect = {
        left: Math.max(elementRect.left, textRect.left),
        top: Math.max(elementRect.top, textRect.top),
        right: Math.min(elementRect.right, textRect.right),
        bottom: Math.min(elementRect.bottom, textRect.bottom),
      };
      const left = Math.max(0, Math.floor(rect.left));
      const top = Math.max(0, Math.floor(rect.top));
      const right = Math.min(canvas.width, Math.ceil(rect.right));
      const bottom = Math.min(canvas.height, Math.ceil(rect.bottom));
      if (right <= left || bottom <= top) throw new Error(`${caseLabel}: empty crop for ${selector}`);
      const pixels = context.getImageData(left, top, right - left, bottom - top).data;
      const counts = new Map();
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) continue;
        const color = [pixels[index], pixels[index + 1], pixels[index + 2]];
        const key = color.join(",");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const dominant = [...counts.entries()].sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])[0];
      const foreground = rgb(style.color);
      const foregroundKey = foreground.join(",");
      return {
        selector,
        crop: { left, top, right, bottom },
        foreground,
        foregroundPixels: counts.get(foregroundKey) ?? 0,
        dominantBackground: dominant ? dominant[0].split(",").map(Number) : [],
        backgroundPixels: dominant?.[1] ?? 0,
        contrast: dominant ? contrast(foreground, dominant[0].split(",").map(Number)) : 0,
        forcedColorAdjust: style.forcedColorAdjust,
      };
    };
    return {
      label: caseLabel,
      save: paint(".ts-header-actions .ts-button--primary:not(:disabled)"),
      selectedFocusedValue: paint(".ts-row--selected .ts-cell--focused .ts-cell-value"),
      selectedNonFocusedValue: paint(".ts-row--selected .ts-cell:not(.ts-cell--focused) .ts-cell-value"),
      selectedRowNumber: paint(".ts-row--selected .ts-row-head"),
    };
  }, { label, screenshot });
  const failures = [];
  for (const paint of [evidence.save, evidence.selectedFocusedValue, evidence.selectedNonFocusedValue, evidence.selectedRowNumber]) {
    if (paint.foregroundPixels <= 0) failures.push(`${paint.selector} has no rendered glyph foreground pixels`);
    if (paint.backgroundPixels <= 0) failures.push(`${paint.selector} has no rendered interior background pixels`);
    if (paint.contrast < 4.5) failures.push(`${paint.selector} rendered contrast ${paint.contrast.toFixed(2)} is too low`);
  }
  assert.deepEqual(failures, [], `${label}: ${failures.join("; ")}`);
  return evidence;
}

try {
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Try sales example", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  for (const [label, value] of [
    ["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"],
    ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"],
  ]) await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Profile-independent report");
  const pngBefore = await downloadedPng();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("profile-boundary-report");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  const savedBefore = await page.evaluate(() => window.__tachikoAcceptance.savedSnapshot("profile-boundary-report"));
  assert.equal(savedBefore.kind, "opaque");
  assert.ok(savedBefore.presentation?.report, "normal Save must persist the real report attachment");

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  // Table selection awaits the real runtime projection; selectOption only dispatches it.
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0);
  const cell = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex);
  await cell.focus();
  const canonicalForcedColors = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme });
    canonicalForcedColors.push(await forcedColorPaintEvidence(`canonical profile / ${colorScheme}`));
  }
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  await cell.press("Enter");
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("250");
  await editor.evaluate((element) => element.setSelectionRange(1, 2));
  const runtimeBefore = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());

  const applied = await page.evaluate(async (candidate) => {
    const api = window.__tachikoAcceptance;
    const rootNode = document.getElementById("root");
    const shell = document.querySelector(".ts-app");
    const input = document.querySelector('[aria-label="Edit cell"]');
    const active = document.activeElement;
    const markup = rootNode.innerHTML;
    const shellNodes = [shell, ...shell.querySelectorAll("*")];
    const draft = [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection];
    const selected = document.querySelector(".ts-cell--focused");
    const counts = api.workMethodCounts();
    const copyCounts = api.copyWriteDispatchCounts();
    const state = api.saveObservation();
    const shellColor = getComputedStyle(shell).color;
    const protectedNodes = [...document.querySelectorAll(".ts-chip, .ts-button:disabled, .ts-context-table select:disabled, .ts-notes:disabled")];
    const protectedStyles = () => protectedNodes.map((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor, style.borderColor];
    });
    const safety = protectedStyles();
    // Supplement real controls with isolated CSS recipes for transient/disabled states.
    // This fixture owns no application state and stays outside the production root.
    const fixture = document.createElement("div");
    fixture.className = "ts-app";
    fixture.setAttribute("aria-hidden", "true");
    fixture.style.cssText = "position:fixed;left:-10000px;top:0;width:500px;contain:layout;pointer-events:none";
    fixture.innerHTML = `
      <button class="ts-button" disabled></button>
      <button class="ts-button ts-button--primary" disabled></button>
      <button class="ts-button ts-button--ghost" disabled></button>
      <button class="ts-button ts-button--danger" disabled></button>
      <button class="ts-button ts-button--danger"></button>
      <input class="ts-file-input" type="file" disabled>
      <input class="ts-cell-input" disabled>
      <div class="ts-report-controls"><input disabled></div>
      <div class="ts-context-table"><select disabled></select></div>
      <textarea class="ts-notes" disabled></textarea>
      <span class="ts-status">Opening</span>
      ${["", "current", "saved", "unknown", "failed", "pending", "muted", "edited", "saving"].map((state) =>
        `<span class="ts-chip ${state ? `ts-chip--${state}` : ""}">Status</span>`).join("")}
      <p class="ts-notice">Notice</p><p class="ts-error">Error</p><p class="ts-dialog-error">Error</p>
      <div class="ts-modal-backdrop" style="position:static"></div>`;
    document.body.append(fixture);
    const recipeStyles = () => [...fixture.querySelectorAll("button,input,select,textarea,span,p,.ts-modal-backdrop")].map((node) => {
      const style = getComputedStyle(node);
      // The empty scrim paints only its background; inherited text/border colors paint nothing.
      if (node.classList.contains("ts-modal-backdrop")) return [node.className, style.backgroundColor];
      const pseudo = getComputedStyle(node, "::before");
      return [node.className, style.color, style.backgroundColor, style.borderColor, pseudo.color];
    });
    const recipes = recipeStyles();
    const ok = api.applyInterfaceProfile(candidate);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const recipesAfter = recipeStyles();
    fixture.remove();
    const shellNodesAfter = [shell, ...shell.querySelectorAll("*")];
    return {
      ok, recipes, recipesAfter, counts, countsAfter: api.workMethodCounts(), copyCounts, copyCountsAfter: api.copyWriteDispatchCounts(),
      state, stateAfter: api.saveObservation(), draft, draftAfter: [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection],
      sameRoot: rootNode === document.getElementById("root"), sameShell: shell === document.querySelector(".ts-app"),
      sameEditor: input === document.querySelector('[aria-label="Edit cell"]') && input.isConnected,
      sameSelectedCell: selected === document.querySelector(".ts-cell--focused"), sameFocus: active === document.activeElement && active === input,
      sameShellNodes: shellNodes.length === shellNodesAfter.length &&
        shellNodes.every((node, index) => node.isConnected && node === shellNodesAfter[index]),
      sameProtectedNodes: protectedNodes.every((node, index) => node.isConnected && node ===
        document.querySelectorAll(".ts-chip, .ts-button:disabled, .ts-context-table select:disabled, .ts-notes:disabled")[index]),
      sameMarkup: markup === rootNode.innerHTML, visibleRoleChanged: shellColor !== getComputedStyle(shell).color,
      safety, safetyAfter: protectedStyles(), protectedCount: protectedNodes.length,
    };
  }, profile);
  for (const key of ["ok", "sameRoot", "sameShell", "sameEditor", "sameSelectedCell", "sameFocus", "sameShellNodes", "sameProtectedNodes", "sameMarkup", "visibleRoleChanged"]) assert.equal(applied[key], true, key);
  for (const key of ["counts", "copyCounts", "state", "draft", "safety", "recipes"]) assert.deepEqual(applied[`${key}After`], applied[key], key);
  assert.ok(applied.protectedCount >= 2, "probe must include actual protected product controls/statuses");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()), runtimeBefore);
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.savedSnapshot("profile-boundary-report")), savedBefore);

  await editor.press("Escape");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const pngAfter = await downloadedPng();
  assert.deepEqual(pngAfter, pngBefore, "exported report PNG must be byte-identical after profile application");

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const focusCell = page.locator(".ts-cell").first();
  await focusCell.focus();
  const stressForcedColors = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme, reducedMotion: "reduce" });
    stressForcedColors.push(await forcedColorPaintEvidence(`stress profile / ${colorScheme}`));
  }
  const accessibility = await focusCell.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle, transition: style.transitionDuration, scroll: style.scrollBehavior };
  });
  assert.equal(accessibility.width, "3px");
  assert.equal(accessibility.style, "solid");
  assert.equal(accessibility.scroll, "auto");
  assert.ok(parseFloat(accessibility.transition) <= 0.00001);
  console.log(JSON.stringify({ case: "Interface Profile appearance-only boundary", status: "PASS", workMethodDelta: Object.entries(applied.countsAfter).reduce((total, [key, value]) => total + value - (applied.counts[key] ?? 0), 0), protectedRecipes: applied.recipes.length, protectedNodes: applied.protectedCount, reportPngSha256: createHash("sha256").update(pngAfter).digest("hex"), forcedColorPaint: [...canonicalForcedColors, ...stressForcedColors] }));
} finally {
  await context.close();
  await browser.close();
}

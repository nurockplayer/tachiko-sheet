// Rendered #69 visual/accessibility probe. Contrast backgrounds are composited
// from computed browser styles, with a screenshot fallback for gradients.
// This is a proxy, not physical AT or browser zoom.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const key = "tachiko-sheet:appearance-preference:v2";
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
const profiles = [
  { id: "tachiko", label: "Tachiko", chrome: "porcelain" },
  { id: "familiar-spreadsheet", label: "Familiar Spreadsheet", chrome: "structured" },
  { id: "minimal-focus", label: "Minimal-Focus", chrome: "quiet" },
];
const densities = [
  { id: "compact", label: "Compact", pitch: 28 },
  { id: "comfortable", label: "Comfortable", pitch: 32 },
];
const widths = [320, 600, 1023, 1024];
const failures = [];
const observations = [];
const evidence = (condition, label, details = null) => {
  if (!condition) failures.push({ label, details });
};

function rgb(value) {
  const match = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16)).concat(1);
  return null;
}

function luminance(color) {
  const linear = color.slice(0, 3).map((component) => {
    const srgb = component / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  if (!first || !second) return null;
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function checkRatio(value, required, label, details = {}) {
  const score = contrast(rgb(value.foreground), rgb(value.background));
  evidence(score !== null && score + 1e-9 >= required, label, { ...details, foreground: value.foreground, paintedBackground: value.background, ratio: score, required });
}

async function openApp(context, page) {
  await installDistRoutes(context, dist);
  page.setDefaultTimeout(10000);
  await page.goto(LOCAL_ORIGIN);
  await page.locator(".ts-app").waitFor();
}

async function choose(page, profileId, density) {
  const profile = profiles.find((item) => item.id === profileId);
  const densityOption = densities.find((item) => item.id === density);
  assert.ok(profile && densityOption, "probe selects only closed built-in options");
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.locator(".ts-appearance-profile-option").filter({ hasText: profile.label }).click();
  await page.locator(".ts-appearance-density-option").filter({ hasText: densityOption.label }).click();
  await page.waitForFunction(({ chrome, density: expectedDensity }) =>
    document.documentElement.getAttribute("data-ts-profile-chrome") === chrome &&
    document.documentElement.getAttribute("data-ts-profile-density") === expectedDensity,
  { chrome: profile.chrome, density });
}

async function openCanary(context, page) {
  await page.getByTestId("project-ready").waitFor();
  const closeProject = page.getByRole("button", { name: "Close project", exact: true });
  if (await closeProject.count()) {
    await closeProject.click();
  } else {
    const overflow = page.locator('.ts-command-overflow > summary[aria-label="More document commands"]');
    if (await overflow.isVisible()) {
      await overflow.click();
      await page.locator(".ts-command-overflow > button").click();
    }
  }
  const canary = page.getByRole("button", { name: "Try sales example", exact: true });
  try {
    await canary.waitFor({ state: "visible", timeout: 2500 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      view: document.querySelector(".ts-app")?.getAttribute("data-view") ?? null,
      projectReady: Boolean(document.querySelector('[data-testid="project-ready"]')),
      openDetails: [...document.querySelectorAll("details")].filter((details) => details.open).map((details) => details.className),
      visibleCloseButtons: [...document.querySelectorAll('button')]
        .filter((button) => button.textContent?.trim() === "Close project" && button.getClientRects().length > 0)
        .length,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => dialog.getAttribute("aria-label")),
      dirty: document.querySelector('[data-testid="work-state"]')?.getAttribute("data-work-state") ?? null,
    }));
    throw new Error(`Could not return to Home before opening the canary: ${JSON.stringify(state)}; ${error instanceof Error ? error.message : String(error)}`);
  }
  await canary.click();
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("tab", { name: "Table", exact: true }).waitFor();
  const firstCell = page.locator(".ts-grid tbody .ts-cell").first();
  await firstCell.focus();
  await page.waitForSelector(".ts-cell--focused");
}

const colorTargets = [
  ["workbook title", ".ts-title"],
  ["workbook wordmark", ".ts-wordmark"],
  ["Appearance trigger", ".ts-appearance-trigger"],
  ["primary command", ".ts-header-actions .ts-button--primary"],
  ["profile radio label", ".ts-appearance-profile-option"],
  ["selected profile radio label", ".ts-appearance-profile-option--selected"],
  ["selected density control", ".ts-appearance-density-option--selected"],
  ["grid column header", ".ts-col-head"],
  ["selected row header", ".ts-row--selected .ts-row-head"],
  ["selected row cell", ".ts-row--selected td.ts-cell"],
  ["focused selected cell", ".ts-cell--focused"],
  ["workbook status", ".ts-workbook-status .ts-chip"],
];

async function paintedSamples(page, targets) {
  const samples = [];
  for (const [label, selector] of targets) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) {
      samples.push({ label, missing: true });
      continue;
    }
    try {
      await locator.scrollIntoViewIfNeeded();
    } catch (error) {
      throw new Error(`Could not reveal ${label} (${selector}) for visual sampling: ${error instanceof Error ? error.message : String(error)}`);
    }
    const pngData = (await page.screenshot({ animations: "disabled" })).toString("base64");
    const styleInfo = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const layers = [];
      let gradient = false;
      for (let node = element; node; node = node.parentElement) {
        const current = getComputedStyle(node);
        if (current.backgroundImage !== "none") gradient = true;
        const parsed = current.backgroundColor.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i);
        if (!parsed) continue;
        const alpha = parsed[4] === undefined ? 1 : Number(parsed[4]);
        if (alpha > 0) layers.push([Number(parsed[1]), Number(parsed[2]), Number(parsed[3]), alpha]);
        if (alpha >= 1) break;
      }
      let resolvedBackground = null;
      if (!gradient && layers.length) {
        let composited = [255, 255, 255];
        for (const [r, g, b, alpha] of layers.reverse()) composited = [r, g, b].map((channel, index) => Math.round(channel * alpha + composited[index] * (1 - alpha)));
        resolvedBackground = `rgb(${composited.join(", ")})`;
      }
      return {
        tagName: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        role: element.getAttribute("role"),
        width: rect.width,
        height: rect.height,
        foreground: style.color,
        backgroundPaint: style.backgroundColor,
        border: style.borderTopColor,
        borderWidth: style.borderTopWidth,
        outline: style.outlineColor,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        resolvedBackground,
      };
    });
    const screenshotBackground = styleInfo.resolvedBackground ? null : await page.evaluate(async ({ pngData, rect }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${pngData}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixel = (x, y) => {
      const ix = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
      const iy = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
      const [r, g, b] = context.getImageData(ix, iy, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
      // Scroll the target into view first, then sample actual viewport paint.
      const x = Math.min(image.naturalWidth - 1, Math.max(1, rect.x + rect.width / 2));
      const y = Math.min(image.naturalHeight - 1, Math.max(1, rect.y + Math.min(2, rect.height / 3)));
      return pixel(x, y);
    }, { pngData, rect: styleInfo.rect });
    if (!styleInfo.width || !styleInfo.height) samples.push({ label, hidden: true });
    else samples.push({ label, ...styleInfo, background: styleInfo.resolvedBackground ?? screenshotBackground });
  }
  return samples;
}

async function auditContrast(page, targetList, tag) {
  const samples = await paintedSamples(page, targetList);
  for (const sample of samples) {
    const label = `${tag} ${sample.label}`;
    if (sample.missing || sample.hidden) {
      evidence(false, `${label} is rendered`, sample);
      continue;
    }
    checkRatio(sample, 4.5, `${label} text contrast is at least 4.5:1`, { sample: sample.label, tag });
  }
  return samples;
}

async function menuViewportAndOpen(page, tag) {
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const popover = page.locator(".ts-appearance-popover");
  await popover.waitFor({ state: "visible" });
  const bounds = await popover.boundingBox();
  const viewport = page.viewportSize();
  evidence(Boolean(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1),
    `${tag} Appearance popover is within viewport`, { bounds, viewport });
  return bounds;
}

async function screenshotPixel(page, x, y) {
  const pngData = (await page.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async ({ pngData: encoded, x: sampleX, y: sampleY }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const scaleX = image.naturalWidth / innerWidth;
    const scaleY = image.naturalHeight / innerHeight;
    const pixel = context.getImageData(
      Math.max(0, Math.min(canvas.width - 1, Math.round(sampleX * scaleX))),
      Math.max(0, Math.min(canvas.height - 1, Math.round(sampleY * scaleY))),
      1,
      1,
    ).data;
    return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  }, { pngData, x, y });
}

async function auditAppearanceTriggerBoundary(page, width) {
  const button = page.locator(".ts-appearance-trigger");
  await button.evaluate((element) => element.blur());
  const layout = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const x = rect.x + Math.floor(rect.width / 2);
    const y = rect.y + Math.floor(rect.height / 2);
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      borderTopColor: style.borderTopColor,
      borderLeftColor: style.borderLeftColor,
      borderTopWidth: style.borderTopWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderTopStyle: style.borderTopStyle,
      borderLeftStyle: style.borderLeftStyle,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      focused: document.activeElement === element,
      visible: style.visibility === "visible" && style.display !== "none" && rect.width > 0 && rect.height > 0,
      topPaintTarget: document.elementFromPoint(x, rect.y) === element,
      leftPaintTarget: document.elementFromPoint(rect.x, y) === element,
    };
  });
  if (!layout.visible || layout.rect.x < 1 || layout.rect.y < 1) {
    evidence(false, `${width}px Appearance trigger border is visible and has exterior sample space`, layout);
    return;
  }

  const topPaint = await screenshotPixel(page, layout.rect.x + Math.floor(layout.rect.width / 2), layout.rect.y);
  const topOutside = await screenshotPixel(page, layout.rect.x + Math.floor(layout.rect.width / 2), layout.rect.y - 1);
  const topInside = await screenshotPixel(page, layout.rect.x + Math.floor(layout.rect.width / 2), layout.rect.y + 1);
  const leftPaint = await screenshotPixel(page, layout.rect.x, layout.rect.y + Math.floor(layout.rect.height / 2));
  const leftOutside = await screenshotPixel(page, layout.rect.x - 1, layout.rect.y + Math.floor(layout.rect.height / 2));
  const leftInside = await screenshotPixel(page, layout.rect.x + 1, layout.rect.y + Math.floor(layout.rect.height / 2));
  const topRatio = contrast(rgb(topPaint), rgb(topOutside));
  const leftRatio = contrast(rgb(leftPaint), rgb(leftOutside));
  const sameRgb = (first, second) => {
    const a = rgb(first);
    const b = rgb(second);
    return Boolean(a && b && a.slice(0, 3).every((channel, index) => channel === b[index]));
  };
  const detail = {
    ...layout,
    top: { borderPixel: topPaint, computedBorder: layout.borderTopColor, outside: topOutside, inside: topInside, contrast: topRatio },
    left: { borderPixel: leftPaint, computedBorder: layout.borderLeftColor, outside: leftOutside, inside: leftInside, contrast: leftRatio },
  };
  evidence(layout.borderTopWidth === "1px" && layout.borderLeftWidth === "1px" &&
    layout.borderTopStyle === "solid" && layout.borderLeftStyle === "solid" &&
    !layout.focused && layout.boxShadow === "none" &&
    layout.topPaintTarget && layout.leftPaintTarget,
  `${width}px samples land on the visible Appearance trigger's 1px exterior border`, detail);
  evidence(sameRgb(topPaint, layout.borderTopColor) && sameRgb(leftPaint, layout.borderLeftColor),
    `${width}px Appearance trigger edge pixels match the computed border color`, detail);
  evidence(!sameRgb(topOutside, layout.outlineColor) && !sameRgb(leftOutside, layout.outlineColor),
    `${width}px exterior samples do not hit focus-outline paint`, detail);
  evidence(topRatio !== null && topRatio >= 3 && leftRatio !== null && leftRatio >= 3,
    `${width}px Appearance trigger exterior border contrasts at least 3:1 against adjacent header paint`, detail);
  evidence(contrast(rgb(topPaint), rgb(topInside)) >= 3 && contrast(rgb(leftPaint), rgb(leftInside)) >= 3,
    `${width}px Appearance trigger border remains distinct from its interior surface`, detail);
  observations.push({ appearanceTriggerBoundary: width, ...detail });
}

async function auditSelectedProfileRadioPaint(page, tag) {
  const radio = page.locator(".ts-appearance-profile-option--selected input[type=radio]");
  const layout = await radio.evaluate((input) => {
    const rect = input.getBoundingClientRect();
    const label = input.closest(".ts-appearance-profile-option");
    const style = getComputedStyle(input);
    const labelStyle = label ? getComputedStyle(label) : null;
    return {
      checked: input.checked,
      accentColor: style.accentColor,
      forcedColorAdjust: style.forcedColorAdjust,
      labelForeground: labelStyle?.color ?? null,
      labelBackground: labelStyle?.backgroundColor ?? null,
      markerPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      adjacentPoint: { x: rect.right + 4, y: rect.y + rect.height / 2 },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const markerPaint = await screenshotPixel(page, layout.markerPoint.x, layout.markerPoint.y);
  const adjacentPaint = await screenshotPixel(page, layout.adjacentPoint.x, layout.adjacentPoint.y);
  const markerContrast = contrast(rgb(markerPaint), rgb(adjacentPaint));
  const detail = { ...layout, markerPaint, adjacentPaint, markerContrast, required: 3 };
  evidence(layout.checked, `${tag} selected Profile radio is checked`, detail);
  evidence(layout.accentColor === layout.labelForeground,
    `${tag} selected Profile radio uses the system HighlightText label color as its accent`, detail);
  evidence(markerContrast !== null && markerContrast >= 3,
    `${tag} selected Profile radio marker paint contrasts at least 3:1 with its actual adjacent selected-label paint`, detail);
  observations.push({ selectedProfileRadioPaint: tag, ...detail });
}

async function geometry(page, width, combo) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const rows = [...document.querySelectorAll(".ts-grid tbody tr")].slice(0, 2).map((row) => row.getBoundingClientRect().top);
    const grid = document.querySelector(".ts-grid-scroll");
    const head = document.querySelector(".ts-workbook-head");
    const title = document.querySelector(".ts-title");
    const app = document.querySelector(".ts-app");
    const tableSelector = document.querySelector(".ts-context-table select");
    const panel = document.querySelector(".ts-panel");
    const panelRect = panel?.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    return {
      pageWidth: root.scrollWidth,
      viewportWidth: innerWidth,
      appWidth: app?.getBoundingClientRect().width ?? 0,
      gridHeight: grid?.clientHeight ?? 0,
      gridAvailableHeight: panelRect && gridRect ? Math.max(0, Math.floor(panelRect.bottom - gridRect.top)) : 0,
      tableSelectorHeight: tableSelector?.getBoundingClientRect().height ?? null,
      rowPitch: rows.length === 2 ? rows[1] - rows[0] : null,
      headerBackground: head ? getComputedStyle(head).backgroundImage : "missing",
      titleFont: title ? getComputedStyle(title).fontFamily : "missing",
      titleRadius: head ? getComputedStyle(head).borderRadius : "missing",
    };
  });
  evidence(result.pageWidth <= width, `${width}px page has no horizontal overflow`, { ...result, combo });
  evidence(result.gridHeight + 1 >= Math.min(168, result.gridAvailableHeight),
    `${width}px grid keeps the 168px floor when space permits`, { ...result, combo });
  evidence(result.rowPitch === combo.pitch, `${width}px rendered row pitch equals ${combo.pitch}px`, { ...result, combo });
  const expectedTarget = combo.density === "comfortable" ? 36 : 32;
  evidence(result.tableSelectorHeight === expectedTarget,
    `${width}px Table selector height equals the ${expectedTarget}px ${combo.density} target`, { ...result, combo, expectedTarget });
  return result;
}

async function auditWorkbookViewportBounds(page, width, height, profile) {
  await page.setViewportSize({ width, height });
  for (const viewName of ["Table", "Brief", "Import & export"]) {
    await page.getByRole("tab", { name: viewName, exact: true }).click();
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      const footer = document.querySelector(".ts-workspace-footer");
      const grid = document.querySelector(".ts-grid-scroll");
      const panelRect = panel?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        scrollY,
        panelTop: panelRect?.top ?? null,
        panelBottom: panelRect?.bottom ?? null,
        panelHeight: panelRect?.height ?? null,
        panelClientHeight: panel?.clientHeight ?? null,
        panelScrollHeight: panel?.scrollHeight ?? null,
        panelOverflowY: panel ? getComputedStyle(panel).overflowY : "missing",
        gridClientWidth: grid?.clientWidth ?? null,
        gridScrollWidth: grid?.scrollWidth ?? null,
        gridOverflowX: grid ? getComputedStyle(grid).overflowX : null,
        footerTop: footerRect?.top ?? null,
        footerBottom: footerRect?.bottom ?? null,
      };
    });
    const label = `${width}x${height} ${profile} ${viewName}`;
    evidence(layout.panelOverflowY === "auto", `${label} panel can scroll its own long content`, layout);
    evidence(layout.panelBottom <= layout.footerTop + 1, `${label} panel ends before the Views/status footer`, layout);
    evidence(layout.footerBottom <= height + 1, `${label} keeps the complete Views/status footer in the viewport`, layout);
    evidence(layout.pageHeight <= height + 1 && layout.scrollY === 0, `${label} does not push the document beyond the viewport`, layout);
    if (width === 320 && viewName === "Brief") {
      evidence(layout.panelScrollHeight > layout.panelClientHeight,
        `${label} scrolls the long Brief content inside its panel`, layout);
    }
    if (width === 320 && viewName === "Table") {
      evidence(layout.gridOverflowX === "auto" && layout.gridScrollWidth > layout.gridClientWidth,
        `${label} preserves the Table's own horizontal grid scroller`, layout);
    }
    observations.push({ workbookViewport: label, ...layout });
  }
}

async function auditTallGridLayoutOnly(page) {
  const clonedRows = await page.evaluate(() => {
    const body = document.querySelector(".ts-grid tbody");
    const source = body?.firstElementChild;
    if (!body || !source) return 0;
    const startingCount = body.children.length;
    for (let index = startingCount; index < 120; index += 1) {
      const clone = source.cloneNode(true);
      clone.setAttribute("data-layout-stress-row", "true");
      body.append(clone);
    }
    return body.children.length;
  });
  evidence(clonedRows === 120, "layout-only DOM stress creates 120 painted rows", { clonedRows });

  for (const [width, height] of [[1512, 982], [320, 640]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const panel = document.querySelector(".ts-panel");
      const grid = document.querySelector(".ts-grid-scroll");
      const footer = document.querySelector(".ts-workspace-footer");
      const tabs = document.querySelector('[role="tablist"][aria-label="Workbook views"]');
      const status = document.querySelector(".ts-workbook-status");
      const notices = document.querySelector(".ts-notices");
      const rect = (element) => element?.getBoundingClientRect();
      const panelRect = rect(panel);
      const gridRect = rect(grid);
      const footerRect = rect(footer);
      const tabsRect = rect(tabs);
      const statusRect = rect(status);
      const noticesRect = rect(notices);
      const gridStyle = grid ? getComputedStyle(grid) : null;
      if (grid) {
        grid.scrollTop = grid.scrollHeight;
        grid.scrollLeft = grid.scrollWidth;
      }
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        panelBottom: panelRect?.bottom ?? null,
        panelClientHeight: panel?.clientHeight ?? null,
        panelScrollHeight: panel?.scrollHeight ?? null,
        gridTop: gridRect?.top ?? null,
        gridBottom: gridRect?.bottom ?? null,
        gridHeight: gridRect?.height ?? null,
        gridClientHeight: grid?.clientHeight ?? null,
        gridScrollHeight: grid?.scrollHeight ?? null,
        gridClientWidth: grid?.clientWidth ?? null,
        gridScrollWidth: grid?.scrollWidth ?? null,
        gridScrollTop: grid?.scrollTop ?? null,
        gridScrollLeft: grid?.scrollLeft ?? null,
        gridOverflowY: gridStyle?.overflowY ?? null,
        gridOverflowX: gridStyle?.overflowX ?? null,
        footerBottom: footerRect?.bottom ?? null,
        tabsTop: tabsRect?.top ?? null,
        tabsBottom: tabsRect?.bottom ?? null,
        statusTop: statusRect?.top ?? null,
        statusBottom: statusRect?.bottom ?? null,
        noticesTop: noticesRect?.top ?? null,
        noticesBottom: noticesRect?.bottom ?? null,
      };
    });
    const label = `${width}x${height} tall-grid layout-only stress`;
    evidence(layout.pageWidth <= width, `${label} has no horizontal document overflow`, layout);
    evidence(layout.gridBottom <= layout.panelBottom + 1, `${label} grid stays within the actual panel boundary`, layout);
    evidence(layout.panelScrollHeight <= layout.panelClientHeight + 1, `${label} avoids nested panel scrolling`, layout);
    evidence(layout.gridOverflowY === "auto" && layout.gridScrollHeight > layout.gridClientHeight && layout.gridScrollTop > 0,
      `${label} reaches the grid's own vertical scrollbar`, layout);
    evidence(layout.gridHeight >= Math.min(168, layout.panelBottom - layout.gridTop),
      `${label} keeps the 168px grid floor when available space permits`, layout);
    evidence(layout.tabsTop >= 0 && layout.tabsBottom <= height && layout.statusTop >= 0 && layout.statusBottom <= height,
      `${label} keeps Views and status visible`, layout);
    evidence(layout.tabsTop >= layout.panelBottom - 1 && layout.statusTop >= layout.tabsBottom - 1 && layout.noticesTop >= layout.footerBottom - 1,
      `${label} keeps the panel, Views, status, and legal notices in a non-overlapping sequence`, layout);
    evidence(layout.noticesTop >= 0 && layout.noticesBottom <= height,
      `${label} keeps legal notices visible`, layout);
    if (width === 320) {
      evidence(layout.gridOverflowX === "auto" && layout.gridScrollWidth > layout.gridClientWidth && layout.gridScrollLeft > 0,
        `${label} reaches the grid's own horizontal scrollbar`, layout);
    }
    observations.push({ tallGridLayoutOnly: label, ...layout });
  }

  await page.setViewportSize({ width: 1512, height: 982 });
  await page.evaluate(() => {
    const panel = document.querySelector(".ts-panel");
    if (panel) panel.style.flex = "0 0 300px";
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const resizedPanel = await page.evaluate(() => {
    const panel = document.querySelector(".ts-panel");
    const grid = document.querySelector(".ts-grid-scroll");
    return {
      panelHeight: panel?.getBoundingClientRect().height ?? null,
      gridBottom: grid?.getBoundingClientRect().bottom ?? null,
      panelBottom: panel?.getBoundingClientRect().bottom ?? null,
      availableHeight: Number.parseFloat(grid?.style.getPropertyValue("--ts-grid-available-height") ?? "NaN"),
    };
  });
  evidence(resizedPanel.panelHeight === 300 && resizedPanel.gridBottom <= resizedPanel.panelBottom + 1 && resizedPanel.availableHeight <= 300,
    "panel ResizeObserver updates the grid cap when the panel changes size without a viewport resize", resizedPanel);
  observations.push({ tallGridPanelResize: resizedPanel });
  await page.evaluate(() => {
    document.querySelector(".ts-panel")?.style.removeProperty("flex");
    document.querySelectorAll("[data-layout-stress-row]").forEach((row) => row.remove());
  });
}

async function auditHomeViewportBounds(page) {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Viewport home probe");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a copy" }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const savedCopy = page.getByRole("button", { name: "Open saved Viewport home probe", exact: true });
  const homePresentation = await page.evaluate(() => ({
    sections: [...document.querySelectorAll(".ts-home > .ts-home-section")].map((section) => section.getAttribute("aria-label")),
    homeCards: document.querySelectorAll(".ts-home > .ts-card").length,
    appearance: document.querySelectorAll(".ts-home-head .ts-appearance-selector").length,
    openLabel: document.querySelector(".ts-home-open-actions .ts-home-file-action")?.textContent?.trim(),
    importLabel: document.querySelector(".ts-home-import-action")?.textContent?.trim(),
    savedTimestamp: document.querySelector(".ts-copy-meta")?.textContent?.trim(),
  }));
  assert.deepEqual(homePresentation.sections, ["Open project", "Import spreadsheet", "Saved copies"]);
  assert.equal(homePresentation.homeCards, 0, "Home tasks use the approved divider hierarchy without elevated cards");
  assert.equal(homePresentation.appearance, 1, "Home keeps Appearance available");
  assert.equal(homePresentation.openLabel, "Open project folder");
  assert.equal(homePresentation.importLabel, "Choose CSV or XLSX");
  assert.match(homePresentation.savedTimestamp, /^Saved \d+ /);
  const folderInput = page.getByTestId("open-project");
  await page.getByRole("button", { name: "Appearance", exact: true }).focus();
  await page.keyboard.press("Tab");
  const folderFocus = await folderInput.evaluate((input) => ({
    active: document.activeElement === input,
    focusVisible: input.matches(":focus-visible"),
    outlineStyle: getComputedStyle(input.parentElement).outlineStyle,
    outlineWidth: getComputedStyle(input.parentElement).outlineWidth,
  }));
  assert.equal(folderFocus.active, true, "Tab reaches the real folder input after Appearance");
  assert.equal(folderFocus.focusVisible, true, "the real folder input remains keyboard focusable");
  assert.equal(folderFocus.outlineStyle, "solid", "the visible folder action shows keyboard focus");
  assert.equal(folderFocus.outlineWidth, "3px");
  for (const [width, height] of [[320, 640], [1512, 982]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const layout = await page.evaluate(() => {
      const root = document.querySelector(".ts-app-root");
      const app = document.querySelector('.ts-app[data-view="home"]');
      const home = document.querySelector(".ts-home");
      const notices = document.querySelector(".ts-notices");
      const rootRect = root?.getBoundingClientRect();
      const appRect = app?.getBoundingClientRect();
      const noticesRect = notices?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        appHeight: app?.getBoundingClientRect().height ?? null,
        homeHeight: home?.scrollHeight ?? null,
        rootHeight: rootRect?.height ?? null,
        rootHeightStyle: root ? getComputedStyle(root).height : null,
        rootMinHeightStyle: root ? getComputedStyle(root).minHeight : null,
        appBottom: appRect?.bottom ?? null,
        noticesTop: noticesRect?.top ?? null,
        noticesBottom: noticesRect?.bottom ?? null,
      };
    });
    evidence(layout.pageWidth <= width, `${width}x${height} Home with a saved copy has no horizontal overflow`, layout);
    evidence(layout.pageHeight >= height, `${width}x${height} Home retains natural document height`, layout);
    evidence(layout.rootHeight >= layout.appHeight && layout.rootMinHeightStyle !== "0px",
      `${width}x${height} Home root expands with its content`, layout);
    if (layout.appBottom !== null && layout.noticesTop !== null) {
      evidence(layout.noticesTop >= layout.appBottom - 1 && layout.noticesBottom <= layout.pageHeight + 1,
        `${width}x${height} legal notices follow Home content without overlap or clipping`, layout);
    }
    await savedCopy.scrollIntoViewIfNeeded();
    const copyRect = await savedCopy.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
    });
    evidence(copyRect.top >= 0 && copyRect.bottom <= height,
      `${width}x${height} saved copy action can be reached by scrolling Home`, { ...layout, copyRect });
    observations.push({ homeViewport: `${width}x${height}`, ...layout, copyRect });
  }
}

async function auditFirstEntryStates(browser, dist) {
  const sizes = [[320, 640], [1512, 982]];
  const pendingContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
  await installDistRoutes(pendingContext, dist);
  let releaseManifest;
  let markManifestRequested;
  const manifestGate = new Promise((resolve) => { releaseManifest = resolve; });
  const manifestRequested = new Promise((resolve) => { markManifestRequested = resolve; });
  const pendingPage = await pendingContext.newPage();
  await pendingPage.route("**/examples/release-plan/manifest.json", async (route) => {
    markManifestRequested();
    await manifestGate;
    const manifest = await readFile(path.join(dist, "examples/release-plan/manifest.json"));
    await route.fulfill({ status: 200, contentType: "application/json", body: manifest });
  });
  await pendingPage.goto(LOCAL_ORIGIN, { waitUntil: "domcontentloaded" });
  await pendingPage.getByTestId("initial-launch").waitFor();
  await manifestRequested;
  for (const [width, height] of sizes) {
    await pendingPage.setViewportSize({ width, height });
    const layout = await pendingPage.evaluate(() => {
      const root = document.querySelector(".ts-app-root");
      const content = document.querySelector('[data-testid="initial-launch"]');
      const rootRect = root?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        rootBottom: rootRect?.bottom ?? null,
        contentLeft: contentRect?.left ?? null,
        contentRight: contentRect?.right ?? null,
        contentTop: contentRect?.top ?? null,
        contentBottom: contentRect?.bottom ?? null,
        notices: document.querySelector(".ts-notices")?.getBoundingClientRect().toJSON() ?? null,
      };
    });
    evidence(layout.pageWidth <= width, `${width}x${height} first-entry loading has no horizontal overflow`, layout);
    evidence(layout.contentLeft >= 0 && layout.contentRight <= width && layout.contentTop >= 0 && layout.contentBottom <= layout.rootBottom,
      `${width}x${height} first-entry loading content fits its natural root`, layout);
    if (layout.notices) evidence(layout.notices.top >= layout.contentBottom - 1 && layout.notices.bottom <= layout.pageHeight + 1,
      `${width}x${height} first-entry loading legal notice follows content without clipping`, layout);
    observations.push({ firstEntry: `loading ${width}x${height}`, ...layout });
  }
  releaseManifest();
  await pendingPage.getByTestId("project-ready").waitFor();
  await pendingContext.close();

  const failureContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
  await installDistRoutes(failureContext, dist);
  const failurePage = await failureContext.newPage();
  await failurePage.route("**/examples/release-plan/manifest.json", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "controlled initial-open failure" }));
  await failurePage.goto(LOCAL_ORIGIN, { waitUntil: "domcontentloaded" });
  const alert = failurePage.getByRole("alert").filter({ hasText: "example file manifest.json is unavailable (503)" });
  await alert.waitFor();
  for (const [width, height] of sizes) {
    await failurePage.setViewportSize({ width, height });
    const layout = await failurePage.evaluate(() => {
      const root = document.querySelector(".ts-app-root");
      const app = document.querySelector('.ts-app[data-view="home"]');
      const alert = document.querySelector(".ts-error");
      const rootRect = root?.getBoundingClientRect();
      const appRect = app?.getBoundingClientRect();
      const alertRect = alert?.getBoundingClientRect();
      const noticesRect = document.querySelector(".ts-notices")?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        rootBottom: rootRect?.bottom ?? null,
        appBottom: appRect?.bottom ?? null,
        alertLeft: alertRect?.left ?? null,
        alertRight: alertRect?.right ?? null,
        alertTop: alertRect?.top ?? null,
        alertBottom: alertRect?.bottom ?? null,
        noticesTop: noticesRect?.top ?? null,
      };
    });
    evidence(layout.pageWidth <= width, `${width}x${height} first-entry error has no horizontal overflow`, layout);
    evidence(layout.alertLeft >= 0 && layout.alertRight <= width && layout.alertTop >= 0 && layout.alertBottom <= layout.appBottom,
      `${width}x${height} first-entry error remains within Home content`, layout);
    if (layout.noticesTop !== null) evidence(layout.noticesTop >= layout.appBottom - 1,
      `${width}x${height} first-entry error legal notice does not overlap Home`, layout);
    observations.push({ firstEntry: `error ${width}x${height}`, ...layout });
  }
  await failureContext.close();
}

async function focusAudit(page, tag) {
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    const option = active?.closest(".ts-appearance-profile-option, .ts-appearance-density-option");
    const style = option ? getComputedStyle(option) : getComputedStyle(active);
    return {
      focused: Boolean(active && active !== document.body),
      activeTag: active?.tagName ?? null,
      activeClass: typeof active?.className === "string" ? active.className : "",
      activeRole: active?.getAttribute("role") ?? null,
      activeType: active?.getAttribute("type") ?? null,
      focusContainer: option?.className ?? null,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      outlineColor: style.outlineColor,
      rect: option ? (() => {
        const rect = option.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })() : null,
      expanded: document.querySelector(".ts-appearance-trigger")?.getAttribute("aria-expanded"),
    };
  });
  evidence(focus.focused && focus.expanded === "true" && focus.outlineWidth === "3px" && focus.outlineOffset === "2px",
    `${tag} keyboard-focused radio has 3px outline and 2px clearance`, focus);
  let focusContrast = null;
  if (focus.rect && focus.outlineWidth === "3px" && focus.outlineOffset === "2px") {
    const centerX = focus.rect.x + focus.rect.width / 2;
    const outlineWidth = Number.parseFloat(focus.outlineWidth);
    const outlineOffset = Number.parseFloat(focus.outlineOffset);
    const outerBackground = await screenshotPixel(page, centerX, focus.rect.y - outlineOffset - outlineWidth - 1);
    const innerBackground = await screenshotPixel(page, centerX, focus.rect.y - outlineOffset + 1);
    const paintedOutline = await screenshotPixel(page, centerX, focus.rect.y - outlineOffset - outlineWidth / 2);
    const outerRatio = contrast(rgb(paintedOutline), rgb(outerBackground));
    const innerRatio = contrast(rgb(paintedOutline), rgb(innerBackground));
    focusContrast = { paintedOutline, outerBackground, innerBackground, outerRatio, innerRatio };
    evidence(outerRatio !== null && outerRatio >= 3 && innerRatio !== null && innerRatio >= 3,
      `${tag} keyboard focus paint contrasts at least 3:1 against both adjacent surfaces`, focusContrast);
  } else {
    evidence(false, `${tag} keyboard focus outline can be sampled`, focus);
  }
  observations.push({ keyboardFocusGeometry: focus, keyboardFocusContrast: focusContrast, focusTag: tag });
  await page.keyboard.press("Escape");
  evidence(await trigger.evaluate((button) => document.activeElement === button && button.getAttribute("aria-expanded") === "false"),
    `${tag} Escape closes popover and returns focus`, null);
}

async function auditFocusedControlBoundary(page, tag) {
  const samples = await paintedSamples(page, [["focused selected cell", ".ts-cell--focused"]]);
  const sample = samples[0];
  if (!sample || sample.missing || sample.hidden) {
    evidence(false, `${tag} focused grid cell is rendered`, sample);
    return;
  }
  const score = contrast(rgb(sample.outline), rgb(sample.background));
  const indicator = { tagName: sample.tagName, className: sample.className, role: sample.role, outline: sample.outline, paintedBackground: sample.background, ratio: score, width: sample.outlineWidth, offset: sample.outlineOffset };
  evidence(sample.outlineWidth === "2px" && sample.outlineOffset === "-2px" && score !== null && score >= 3,
    `${tag} existing active-cell selection indicator remains 2px and at least 3:1`, indicator);
  observations.push({ cellSelectionIndicator: tag, ...indicator });
}

async function auditFocusModes(context, page) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
    await openApp(context, page);
    await openCanary(context, page);
    const signatures = [];
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(page, profile.id, density.id);
        const tag = `forced-colors ${scheme} ${profile.id}/${density.id}`;
        await menuViewportAndOpen(page, tag);
        const values = await page.evaluate(() => {
          const button = document.querySelector(".ts-button--primary");
          const selected = document.querySelector(".ts-appearance-profile-option--selected");
          const density = document.querySelector(".ts-appearance-density-option--selected");
          return {
            primaryBg: getComputedStyle(button).backgroundColor,
            primaryFg: getComputedStyle(button).color,
            selectedBg: getComputedStyle(selected).backgroundColor,
            selectedFg: getComputedStyle(selected).color,
            densityBg: getComputedStyle(density).backgroundColor,
            densityFg: getComputedStyle(density).color,
          };
        });
        signatures.push({ ...values, profile: profile.id, density: density.id });
        await auditSelectedProfileRadioPaint(page, tag);
        const selectedSamples = await auditContrast(page, [
          ["primary command", ".ts-header-actions .ts-button--primary"],
          ["selected profile radio label", ".ts-appearance-profile-option--selected"],
          ["selected density radio label", ".ts-appearance-density-option--selected"],
        ], tag);
        observations.push({ forcedColors: scheme, profile: profile.id, density: density.id, values, sampleCount: selectedSamples.length });
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await focusAudit(page, `forced-colors ${scheme} ${profile.id}/${density.id}`);
      }
    }
    const first = signatures[0];
    for (const signature of signatures) {
      evidence(signature.primaryBg === first.primaryBg && signature.primaryFg === first.primaryFg && signature.selectedBg === first.selectedBg && signature.selectedFg === first.selectedFg && signature.densityBg === first.densityBg && signature.densityFg === first.densityFg,
        `forced-colors ${scheme} overrides remain product-owned under ${signature.profile}/${signature.density}`, { reference: first, actual: signature });
    }
    await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  }
}

async function auditNotice(context, profile) {
  const page = await context.newPage();
  await page.addInitScript(({ storageKey, selected }) => {
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 2, kind: "built-in", profileId: selected, density: "compact" }));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === storageKey) throw new Error("blocked appearance write for visual audit");
      return original.call(this, itemKey, value);
    };
  }, { storageKey: key, selected: profile.id });
  await openApp(context, page);
  await openCanary(context, page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(".ts-appearance-density-option").filter({ hasText: "Comfortable" }).click();
  const notice = page.getByText("Appearance changed for this session, but could not be saved.", { exact: true });
  await notice.waitFor();
  const samples = await auditContrast(page, [["write-failure notice", ".ts-appearance-notice"]], `notice-${profile.id}`);
  const sample = samples[0];
  if (sample && !sample.missing && !sample.hidden) {
    const noticeRole = await notice.getAttribute("role");
    const textRatio = contrast(rgb(sample.foreground), rgb(sample.background));
    const borderRatio = contrast(rgb(sample.border), rgb(sample.background));
    evidence(noticeRole === "status" && textRatio !== null && textRatio >= 4.5,
      `notice-${profile.id} keeps its visible 4.5:1 status-text cue`, { role: noticeRole, foreground: sample.foreground, paintedBackground: sample.background, ratio: textRatio });
    observations.push({
      noticeBorder: profile.id,
      role: noticeRole,
      textRatio,
      borderRatio,
      boundaryClassification: "noninteractive status-only border; recorded as an observation because the live status text is independently legible",
    });
  }
  observations.push({ noticeProfile: profile.id, sample });
  await page.close();
}

async function main() {
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await openApp(context, page);
    await page.getByTestId("project-ready").waitFor();
    await focusAudit(page, "Appearance selector");
    await openCanary(context, page);
    await page.locator(".ts-workbook-head > .ts-appearance-selector").waitFor();
    await auditTallGridLayoutOnly(page);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const profile of profiles) {
        for (const density of densities) {
          await choose(page, profile.id, density.id);
          const combo = { profile: profile.id, density: density.id, pitch: density.pitch };
          const menuBounds = await menuViewportAndOpen(page, `${width}px ${profile.id}/${density.id}`);
          const visibleColorTargets = width === 320
            ? colorTargets.filter(([label]) => label !== "workbook wordmark")
            : colorTargets;
          await auditContrast(page, visibleColorTargets, `${width}px ${profile.id}/${density.id}`);
          const geometryState = await geometry(page, width, combo);
          observations.push({ width, ...combo, menuBounds, ...geometryState });
          await page.getByRole("button", { name: "Close", exact: true }).click();
          if (profile.id === "tachiko") {
            await auditAppearanceTriggerBoundary(page, width);
          }
          if (width === 1024) await focusAudit(page, `keyboard focus ${profile.id}/${density.id}`);
          await auditFocusedControlBoundary(page, `${width}px ${profile.id}/${density.id}`);
        }
      }
    }

    const signatures = new Map();
    for (const entry of observations.filter((item) => item.width === 1024)) {
      signatures.set(entry.profile, `${entry.headerBackground}|${entry.titleFont}|${entry.titleRadius}`);
    }
    evidence(signatures.size === 3 && new Set(signatures.values()).size === 3, "all three built-ins produce distinct rendered header/typography/chrome", Object.fromEntries(signatures));

    await page.setViewportSize({ width: 512, height: 900 });
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(page, profile.id, density.id);
        const label = `200% effective-width proxy (512 CSS px) ${profile.id}/${density.id}`;
        const popover = await menuViewportAndOpen(page, label);
        const layout = await page.evaluate(() => {
          const root = document.documentElement;
          const rows = [...document.querySelectorAll(".ts-grid tbody tr")].slice(0, 2).map((row) => row.getBoundingClientRect().top);
          const grid = document.querySelector(".ts-grid-scroll");
          const command = document.querySelector(".ts-appearance-trigger");
          const commandStyle = getComputedStyle(command);
          const profilePitch = Number.parseFloat(getComputedStyle(root).getPropertyValue("--ts-profile-grid-row-pitch"));
          const densityTarget = Number.parseFloat(getComputedStyle(root).getPropertyValue("--ts-profile-command-target-min-height"));
          return {
            pageWidth: root.scrollWidth,
            viewportWidth: innerWidth,
            gridClientHeight: grid.clientHeight,
            gridPaintedHeight: grid.getBoundingClientRect().height,
            rowPitch: rows.length === 2 ? rows[1] - rows[0] : null,
            configuredPitch: profilePitch,
            commandTarget: Number.parseFloat(commandStyle.minHeight),
            configuredTarget: densityTarget,
            commandPaintedHeight: command.getBoundingClientRect().height,
          };
        });
        evidence(layout.viewportWidth === 512, `${label} uses a 512 CSS px effective viewport`, layout);
        evidence(layout.pageWidth <= layout.viewportWidth, `${label} has no horizontal page overflow`, layout);
        evidence(layout.gridClientHeight >= 168, `${label} keeps the 168px grid floor`, layout);
        evidence(layout.configuredPitch === density.pitch && layout.rowPitch === density.pitch,
          `${label} preserves ${density.pitch}px CSS row pitch`, layout);
        const expectedCommand = density.id === "compact" ? 32 : 36;
        evidence(layout.commandTarget >= expectedCommand && layout.commandPaintedHeight >= expectedCommand,
          `${label} preserves ${expectedCommand}px CSS command target`, layout);
        observations.push({ enlargedWidthProxy: label, popover, ...layout });
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
    }

    await page.setViewportSize({ width: 512, height: 450 });
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(page, profile.id, density.id);
        const combo = { profile: profile.id, density: density.id, pitch: density.pitch };
        const label = `512x450 short viewport ${profile.id}/${density.id}`;
        const menuBounds = await menuViewportAndOpen(page, label);
        const geometryState = await geometry(page, 512, combo);
        const scrollState = await page.locator(".ts-appearance-content").evaluate((content) => ({
          overflowY: getComputedStyle(content).overflowY,
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
        }));
        evidence((scrollState.overflowY === "auto" || scrollState.overflowY === "scroll") && scrollState.scrollHeight > scrollState.clientHeight,
          `${label} keeps long menu contents internally scrollable`, scrollState);
        const command = await page.locator(".ts-appearance-trigger").evaluate((button) => ({
          minHeight: Number.parseFloat(getComputedStyle(button).minHeight),
          paintedHeight: button.getBoundingClientRect().height,
        }));
        const targetFloor = density.id === "compact" ? 32 : 36;
        evidence(command.minHeight >= targetFloor && command.paintedHeight >= targetFloor,
          `${label} preserves the ${targetFloor}px command target`, command);
        observations.push({ shortViewportCase: label, ...combo, menuBounds, ...geometryState, command, scrollState });
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
    }

    for (const profile of profiles) {
      await choose(page, profile.id, "comfortable");
      await auditWorkbookViewportBounds(page, 320, 640, profile.id);
      await auditWorkbookViewportBounds(page, 1512, 982, profile.id);
    }

    await page.setViewportSize({ width: 320, height: 900 });
    const titleState = await page.evaluate(() => {
      const title = document.querySelector(".ts-title");
      title.textContent = "漢字表計算書式編集支援".repeat(16);
      const style = getComputedStyle(title);
      return { clientWidth: title.clientWidth, scrollWidth: title.scrollWidth, overflow: style.overflow, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    evidence(titleState.clientWidth < titleState.scrollWidth && titleState.overflow === "hidden" && titleState.whiteSpace === "nowrap" && titleState.textOverflow === "ellipsis",
      "long CJK workbook title clips with visible ellipsis instead of widening header", titleState);
    evidence(titleState.pageWidth <= titleState.viewportWidth, "long CJK title does not cause horizontal page overflow", titleState);

    // Separate layout stress for enlarged painted text. This is not a claim
    // about browser zoom, OS text scaling, or assistive technology.
    const textEnlargementProxy = await page.evaluate(() => {
      document.documentElement.style.zoom = "1.5";
      const dimensions = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: rect.x,
          width: rect.width,
          scrollWidth: element.scrollWidth,
          minWidth: style.minWidth,
          flexBasis: style.flexBasis,
          gridColumn: style.gridColumn,
          display: style.display,
        };
      };
      const overflowSources = [...document.querySelectorAll("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { tag: element.tagName, className: typeof element.className === "string" ? element.className : "", right: rect.right, width: rect.width, overflowX: style.overflowX, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, text: element.childElementCount === 0 ? element.textContent?.trim().slice(0, 45) : "" };
        })
        .filter((item) => item.right > innerWidth + 1 && item.right < 1000)
        .sort((a, b) => b.right - a.right)
        .slice(0, 20);
      return {
        label: "CSS zoom 150% painted-layout proxy",
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        titleClientWidth: document.querySelector(".ts-title").clientWidth,
        header: dimensions(".ts-workbook-head"),
        identity: dimensions(".ts-document-identity"),
        titleBlock: dimensions(".ts-title-block"),
        title: dimensions(".ts-title"),
        appearance: dimensions(".ts-workbook-head > .ts-appearance-selector"),
        commands: dimensions(".ts-header-commands"),
        actions: dimensions(".ts-header-actions"),
        saveStatus: dimensions(".ts-save-status"),
        overflow: dimensions(".ts-command-overflow"),
        overflowSources,
        pageBoxes: ["html", "body", ".ts-app", ".ts-workbook", ".ts-workbook-head", ".ts-grid-scroll"].map((selector) => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return { selector, x: rect?.x, right: rect?.right, width: rect?.width, scrollWidth: element?.scrollWidth, clientWidth: element?.clientWidth, overflowX: element && getComputedStyle(element).overflowX };
        }),
      };
    });
    evidence(textEnlargementProxy.pageWidth <= textEnlargementProxy.viewportWidth,
      "150% painted-layout proxy keeps the page within its viewport", textEnlargementProxy);
    evidence(textEnlargementProxy.titleClientWidth >= 48,
      "150% painted-layout proxy keeps a meaningful workbook title width", textEnlargementProxy);
    observations.push({ textEnlargementProxy });

    for (const profile of profiles) await auditNotice(context, profile);
    await auditFocusModes(context, page);
    await auditHomeViewportBounds(page);
    await auditFirstEntryStates(browser, dist);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    case: "rendered appearance visual/accessibility matrix",
    status: failures.length === 0 ? "PASS" : "FAIL",
    combinations: widths.length * profiles.length * densities.length,
    geometryCases: observations.filter((item) => typeof item.width === "number").length,
    noticeProfiles: profiles.length,
    forcedColorModes: ["light", "dark"],
    contrastBackgrounds: "computed browser backgrounds composited over ancestors; screenshot fallback for gradients; text foreground from computed styles",
    effective200PercentProxy: {
      label: "512 CSS px effective-width proxy for 200% zoom; CSS sizes remain unchanged; not actual browser zoom or OS text scaling",
      combinations: observations.filter((item) => item.enlargedWidthProxy).length,
    },
    shortViewport: {
      label: "512x450 CSS px viewport; no actual zoom claim",
      combinations: observations.filter((item) => item.shortViewportCase).length,
      cases: observations.filter((item) => item.shortViewportCase).map(({ shortViewportCase, menuBounds, pageWidth, viewportWidth, gridHeight, rowPitch, command, scrollState }) => ({
        shortViewportCase,
        menuBounds,
        pageWidth,
        viewportWidth,
        gridHeight,
        rowPitch,
        command,
        scrollState,
      })),
    },
    workbookViewportAudit: observations.filter((item) => item.workbookViewport),
    tallGridLayoutOnlyAudit: observations.filter((item) => item.tallGridLayoutOnly || item.tallGridPanelResize),
    homeViewportAudit: observations.filter((item) => item.homeViewport),
    firstEntryViewportAudit: observations.filter((item) => item.firstEntry),
    textEnlargementProxy: observations.find((item) => item.textEnlargementProxy)?.textEnlargementProxy ?? null,
    physicalAtOrImeClaim: false,
    forcedColorSelectedProfileRadioPaint: observations
      .filter((item) => item.selectedProfileRadioPaint)
      .map(({ selectedProfileRadioPaint, accentColor, forcedColorAdjust, labelForeground, labelBackground, markerPaint, adjacentPaint, markerContrast }) => ({
        tag: selectedProfileRadioPaint,
        accentColor,
        forcedColorAdjust,
        labelForeground,
        labelBackground,
        markerPaint,
        adjacentPaint,
        markerContrast,
      })),
    focusGeometry: {
      keyboardAppearanceRadio: observations.find((item) => item.keyboardFocusGeometry)?.keyboardFocusGeometry ?? null,
      keyboardAuditCases: observations.filter((item) => item.focusTag).map(({ focusTag, keyboardFocusGeometry, keyboardFocusContrast }) => ({ focusTag, keyboardFocusGeometry, keyboardFocusContrast })),
      forcedColorsAuditCases: observations.filter((item) => item.focusTag?.startsWith("forced-colors")).length,
      activeCellSelectionIndicators: observations.filter((item) => item.cellSelectionIndicator),
    },
    statusBorderObservations: observations.filter((item) => item.noticeBorder),
    appearanceTriggerBoundaries: observations
      .filter((item) => item.appearanceTriggerBoundary)
      .map(({ appearanceTriggerBoundary, top, left }) => ({
        width: appearanceTriggerBoundary,
        topContrast: top.contrast,
        leftContrast: left.contrast,
      })),
    failures,
  }));
  assert.equal(failures.length, 0, `${failures.length} rendered visual/accessibility finding(s)`);
}

await main();

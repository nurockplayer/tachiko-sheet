// Rendered #69 visual/accessibility probe. Contrast backgrounds are composited
// from computed browser styles, with a screenshot fallback for gradients.
// This is a proxy, not physical AT or browser zoom.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const key = "tachiko-sheet:appearance-preference:v1";
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
    await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).waitFor({ state: "visible" });
  }
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
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
    await locator.scrollIntoViewIfNeeded();
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

async function geometry(page, width, combo) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const rows = [...document.querySelectorAll(".ts-grid tbody tr")].slice(0, 2).map((row) => row.getBoundingClientRect().top);
    const grid = document.querySelector(".ts-grid-scroll");
    const head = document.querySelector(".ts-workbook-head");
    const title = document.querySelector(".ts-title");
    const app = document.querySelector(".ts-app");
    return {
      pageWidth: root.scrollWidth,
      viewportWidth: innerWidth,
      appWidth: app?.getBoundingClientRect().width ?? 0,
      gridHeight: grid?.clientHeight ?? 0,
      rowPitch: rows.length === 2 ? rows[1] - rows[0] : null,
      headerBackground: head ? getComputedStyle(head).backgroundImage : "missing",
      titleFont: title ? getComputedStyle(title).fontFamily : "missing",
      titleRadius: head ? getComputedStyle(head).borderRadius : "missing",
    };
  });
  evidence(result.pageWidth <= width, `${width}px page has no horizontal overflow`, { ...result, combo });
  evidence(result.gridHeight >= 168, `${width}px grid retains 168px usable minimum`, { ...result, combo });
  evidence(result.rowPitch === combo.pitch, `${width}px rendered row pitch equals ${combo.pitch}px`, { ...result, combo });
  return result;
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
      expanded: document.querySelector(".ts-appearance-trigger")?.getAttribute("aria-expanded"),
    };
  });
  evidence(focus.focused && focus.expanded === "true" && focus.outlineWidth === "3px" && focus.outlineOffset === "2px",
    `${tag} keyboard-focused radio has 3px outline and 2px clearance`, focus);
  observations.push({ keyboardFocusGeometry: focus });
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
      await choose(page, profile.id, "compact");
      await menuViewportAndOpen(page, `forced-colors ${scheme} ${profile.id}`);
      const values = await page.evaluate(() => {
        const button = document.querySelector(".ts-button--primary");
        const selected = document.querySelector(".ts-appearance-profile-option--selected");
        const notice = document.querySelector(".ts-appearance-notice");
        return {
          primaryBg: getComputedStyle(button).backgroundColor,
          primaryFg: getComputedStyle(button).color,
          selectedBg: getComputedStyle(selected).backgroundColor,
          selectedFg: getComputedStyle(selected).color,
          noticeBg: notice ? getComputedStyle(notice).backgroundColor : null,
        };
      });
      signatures.push(values);
      const selectedSamples = await auditContrast(page, [
        ["primary command", ".ts-header-actions .ts-button--primary"],
        ["selected profile radio label", ".ts-appearance-profile-option--selected"],
      ], `forced-colors-${scheme}-${profile.id}`);
      observations.push({ forcedColors: scheme, profile: profile.id, values, sampleCount: selectedSamples.length });
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    const first = signatures[0];
    for (const [index, signature] of signatures.entries()) {
      evidence(signature.primaryBg === first.primaryBg && signature.primaryFg === first.primaryFg && signature.selectedBg === first.selectedBg && signature.selectedFg === first.selectedFg,
        `forced-colors ${scheme} overrides remain product-owned under ${profiles[index].id}`, { reference: first, actual: signature });
    }
    await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  }
}

async function auditNotice(context, profile) {
  const page = await context.newPage();
  await page.addInitScript(({ storageKey, selected }) => {
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, profileId: selected, density: "compact" }));
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

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const profile of profiles) {
        for (const density of densities) {
          await choose(page, profile.id, density.id);
          const combo = { profile: profile.id, density: density.id, pitch: density.pitch };
          const menuBounds = await menuViewportAndOpen(page, `${width}px ${profile.id}/${density.id}`);
          await auditContrast(page, colorTargets, `${width}px ${profile.id}/${density.id}`);
          const geometryState = await geometry(page, width, combo);
          observations.push({ width, ...combo, menuBounds, ...geometryState });
          await page.getByRole("button", { name: "Close", exact: true }).click();
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
      return { label: "CSS zoom 150% painted-layout proxy", pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, titleClientWidth: document.querySelector(".ts-title").clientWidth };
    });
    evidence(textEnlargementProxy.pageWidth <= textEnlargementProxy.viewportWidth,
      "150% painted-layout proxy keeps the page within its viewport", textEnlargementProxy);
    observations.push({ textEnlargementProxy });

    for (const profile of profiles) await auditNotice(context, profile);
    await auditFocusModes(context, page);
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
    textEnlargementProxy: "CSS zoom 150% painted-layout proxy only; not actual browser zoom or OS text scaling",
    physicalAtOrImeClaim: false,
    focusGeometry: {
      keyboardAppearanceRadio: observations.find((item) => item.keyboardFocusGeometry)?.keyboardFocusGeometry ?? null,
      activeCellSelectionIndicators: observations.filter((item) => item.cellSelectionIndicator),
    },
    statusBorderObservations: observations.filter((item) => item.noticeBorder),
    failures,
  }));
  assert.equal(failures.length, 0, `${failures.length} rendered visual/accessibility finding(s)`);
}

await main();

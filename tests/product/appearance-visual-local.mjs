// Rendered shared-control and visual/accessibility probe. Contrast backgrounds are composited
// from computed browser styles, with a screenshot fallback for gradients.
// This is a proxy, not physical AT or browser zoom.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
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
const safeImportedGhostPreference = JSON.stringify({
  schemaVersion: 2,
  kind: "imported",
  profile: {
    schemaVersion: 1,
    name: "Equal Colors Probe",
    colorScheme: "light",
    typography: "tachiko-local",
    density: "compact",
    chrome: "structured",
    colors: {
      ...Object.fromEntries(JSON.parse(await readFile(path.join(root, "docs/design/interface-profile-v1-mapping.json"), "utf8"))
        .roles.map(({ role, value }) => [role, value])),
      "surface.inset": "#ECEEF4",
      "action.primary.hover": "#5541C2",
      "action.primary.pressed": "#5541C2",
    },
  },
});
const safeImportedManifestBytes = Buffer.from(`${JSON.stringify(JSON.parse(safeImportedGhostPreference).profile, null, 2)}\n`, "utf8");
const failures = [];
const observations = [];
const interopPreviewTrimCases = [];
const legalNoticeAuditCases = [];
const evidence = (condition, label, details = null) => {
  if (!condition) failures.push({ label, details });
};

async function captureHeldControl(page, filename) {
  const directory = process.env.SHEET_CONTROL_ARTIFACT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, filename) });
}

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
      await page.locator(".ts-command-overflow").getByRole("button", { name: "Close project", exact: true }).click();
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

async function waitForAppearancePanelToSettle(page, selector = ".ts-home .ts-appearance-popover") {
  return page.evaluate(async (panelSelector) => {
    const closeEnough = (a, b) => Math.abs(a - b) <= 0.1;
    let previous = null;
    let identicalFrames = 0;
    let last = null;
    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const panel = document.querySelector(panelSelector);
      if (!panel || panel.hidden) throw new Error(`Appearance panel is not open: ${panelSelector}`);
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      last = {
        x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
        maxWidth: style.maxWidth, maxHeight: style.maxHeight,
      };
      const keys = ["x", "y", "right", "bottom", "width", "height"];
      identicalFrames = previous && keys.every((key) => closeEnough(previous[key], last[key])) &&
        previous.maxWidth === last.maxWidth && previous.maxHeight === last.maxHeight
        ? identicalFrames + 1
        : 1;
      if (identicalFrames >= 3) return last;
      previous = last;
    }
    throw new Error(`Appearance panel did not settle within 30 frames: ${JSON.stringify(last)}`);
  }, selector);
}

async function savedCopyAccessibilityNode(page, exactButtonText) {
  const rowIndex = await page.locator(".ts-copy-item").evaluateAll((rows, name) =>
    rows.findIndex((row) => row.querySelector(".ts-home-saved-action")?.textContent === name), exactButtonText);
  assert.ok(rowIndex >= 0, `Home contains the exact saved action ${JSON.stringify(exactButtonText)}`);
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await client.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `.ts-copy-item:nth-child(${rowIndex + 1}) .ts-home-saved-action`,
    });
    assert.ok(nodeId, `Chromium can resolve the exact saved action ${JSON.stringify(exactButtonText)}`);
    const { node } = await client.send("DOM.describeNode", { nodeId });
    const { nodes } = await client.send("Accessibility.getPartialAXTree", {
      backendNodeId: node.backendNodeId,
      fetchRelatives: false,
    });
    const accessibleNode = nodes.find((candidate) => candidate.role?.value === "button") ?? nodes[0];
    return {
      role: accessibleNode?.role?.value ?? null,
      name: accessibleNode?.name?.value ?? null,
      description: accessibleNode?.description?.value ?? null,
    };
  } finally {
    await client.detach();
  }
}

async function clickSavedCopyByLiteralName(page, name) {
  const buttonText = `Open saved ${name}`;
  const index = await page.locator(".ts-home-saved-action").evaluateAll((buttons, exactText) =>
    buttons.findIndex((button) => button.textContent === exactText), buttonText);
  assert.ok(index >= 0, `Home contains the literal saved-copy action ${JSON.stringify(buttonText)}`);
  const button = page.locator(".ts-home-saved-action").nth(index);
  assert.equal(await button.textContent(), buttonText, "saved-copy action retains its literal stored name");
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

async function editFirstCellForSavedCopy(page, value) {
  await page.locator(".ts-grid tbody tr").first().locator("td").first().dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill(value);
  await editor.press("Enter");
  await page.waitForFunction((expected) =>
    [...document.querySelectorAll(".ts-grid tbody tr:first-child .ts-cell-value")]
      .some((cell) => cell.textContent === expected), value);
}

async function saveCopyByName(page, name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a copy" }).waitFor({ state: "detached" });
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

async function auditNarrowedAppearanceContent(page, context) {
  await page.setViewportSize({ width: 320, height: 800 });
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator(".ts-home .ts-appearance-popover");
  await panel.waitFor({ state: "visible" });
  await waitForAppearancePanelToSettle(page);
  const scaleOneGeometry = await page.evaluate(() => {
    const panel = document.querySelector(".ts-home .ts-appearance-popover");
    const content = panel.querySelector(".ts-appearance-content");
    const header = panel.querySelector(".ts-appearance-popover__header");
    return {
      panel: panel.getBoundingClientRect().toJSON(),
      content: content.getBoundingClientRect().toJSON(),
      header: {
        rect: header.getBoundingClientRect().toJSON(),
        title: header.querySelector("h2").getBoundingClientRect().toJSON(),
        close: header.querySelector(".ts-appearance-close").getBoundingClientRect().toJSON(),
      },
      density: [...panel.querySelectorAll(".ts-appearance-density-option")].map((label) => ({
        control: label.getBoundingClientRect().toJSON(),
        text: (() => { const range = document.createRange(); range.selectNodeContents(label.querySelector("span")); return range.getBoundingClientRect().toJSON(); })(),
      })),
    };
  });
  evidence(scaleOneGeometry.header.title.right <= scaleOneGeometry.header.close.left + 1 &&
    Math.abs((scaleOneGeometry.header.title.top + scaleOneGeometry.header.title.height / 2) -
      (scaleOneGeometry.header.close.top + scaleOneGeometry.header.close.height / 2)) <= 4,
  "ordinary 320px Appearance header retains the same-row title and Close arrangement", scaleOneGeometry.header);
  const session = await context.newCDPSession(page);
  let narrowed;
  let focusPaint = [];
  let actions = {};
  try {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
    await waitForAppearancePanelToSettle(page);
    narrowed = await page.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const content = panel.querySelector(".ts-appearance-content");
      const header = panel.querySelector(".ts-appearance-popover__header");
      const heading = header.querySelector("h2");
      const close = header.querySelector(".ts-appearance-close");
      const rangeBounds = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().toJSON(); };
      const density = [...panel.querySelectorAll(".ts-appearance-density-option")];
      const viewport = visualViewport;
      return {
        layout: { width: innerWidth, height: innerHeight },
        viewport: { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight, scale: viewport?.scale ?? 1 },
        pageWidth: document.documentElement.scrollWidth,
        panel: panel.getBoundingClientRect().toJSON(),
        header: { rect: header.getBoundingClientRect().toJSON(), title: heading.getBoundingClientRect().toJSON(), titleText: rangeBounds(heading), close: close.getBoundingClientRect().toJSON() },
        content: { rect: content.getBoundingClientRect().toJSON(), clientWidth: content.clientWidth, scrollWidth: content.scrollWidth, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
        density: density.map((label) => ({
          text: label.querySelector("span").textContent,
          control: label.getBoundingClientRect().toJSON(), textBounds: rangeBounds(label.querySelector("span")),
          height: label.getBoundingClientRect().height,
        })),
        profiles: [...panel.querySelectorAll(".ts-appearance-profile-option")].map((label) => ({
          text: label.querySelector("span").textContent.trim(),
          control: label.getBoundingClientRect().toJSON(), textBounds: rangeBounds(label.querySelector("span")),
          height: label.getBoundingClientRect().height,
        })),
      };
    });
    const tag = "320x800 Home Appearance with browser-emulated visualViewport scale 1.5";
    evidence(narrowed.viewport.width < narrowed.layout.width && narrowed.pageWidth <= narrowed.layout.width &&
      narrowed.panel.left >= narrowed.viewport.left - 0.5 && narrowed.panel.right <= narrowed.viewport.left + narrowed.viewport.width + 0.5,
    `${tag} narrows the panel without page or visual viewport overflow`, narrowed);
    const title = narrowed.header.title;
    const close = narrowed.header.close;
    evidence(title.right <= close.left + 1 || close.right <= title.left + 1 ||
      title.bottom <= close.top + 1 || close.bottom <= title.top + 1,
    `${tag} wraps Appearance and Close without overlap`, narrowed.header);
    evidence(narrowed.density.length === 2 &&
      Math.abs(narrowed.density[0].control.width - narrowed.density[1].control.width) <= 1 &&
      narrowed.density.every((item) => item.textBounds.left >= item.control.left &&
        item.textBounds.right <= item.control.right + 0.5 && item.textBounds.bottom <= item.control.bottom + 0.5 && item.height >= 36),
    `${tag} keeps equal Density columns and complete naturally wrapped labels`, narrowed.density);
    evidence(narrowed.profiles.length === 3 && narrowed.profiles.every((profile) =>
      profile.textBounds.left >= profile.control.left && profile.textBounds.right <= profile.control.right + 0.5 &&
      profile.textBounds.bottom <= profile.control.bottom + 0.5 && profile.height >= 40),
    `${tag} wraps each of the three complete profile labels inside its control`, narrowed.profiles);

    const readFocusPaint = async (name, advance = true) => {
      if (advance) await page.keyboard.press("Tab");
      const observed = await page.evaluate(() => {
        const active = document.activeElement;
        const target = active.closest(".ts-appearance-profile-option, .ts-appearance-density-option, button") ?? active;
        const panel = document.querySelector(".ts-home .ts-appearance-popover");
        const content = target.closest(".ts-appearance-popover__header")
          ? panel
          : panel.querySelector(".ts-appearance-content");
        const control = target.getBoundingClientRect();
        const clip = content.getBoundingClientRect();
        const style = getComputedStyle(target);
        const gutter = (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0);
        return {
          tag: active.tagName, className: active.className, value: active.value ?? null,
          targetTag: target.tagName, targetClassName: target.className,
          text: target.textContent?.trim() ?? "",
          focusVisible: active.matches(":focus-visible") || target.matches(":focus-within, :focus-visible"),
          outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset,
          paint: { left: control.left - gutter, top: control.top - gutter, right: control.right + gutter, bottom: control.bottom + gutter },
          clip: { left: clip.left, top: clip.top, right: clip.right, bottom: clip.bottom },
          control: control.toJSON(),
        };
      });
      const reachesExpectedControl = {
        Close: (control) => control.targetClassName.includes("ts-appearance-close"),
        "profile choice": (control) => control.tag === "INPUT" && control.value === "tachiko" && control.targetClassName.includes("ts-appearance-profile-option"),
        "Familiar Spreadsheet profile": (control) => control.tag === "INPUT" && control.value === "familiar-spreadsheet" && control.targetClassName.includes("ts-appearance-profile-option"),
        "Minimal-Focus profile": (control) => control.tag === "INPUT" && control.value === "minimal-focus" && control.targetClassName.includes("ts-appearance-profile-option"),
        "Import action": (control) => control.tag === "BUTTON" && control.text.includes("Import profile"),
        "Export action": (control) => control.tag === "BUTTON" && control.text.includes("Export selected profile"),
        "Compact density": (control) => control.tag === "INPUT" && control.value === "compact" && control.targetClassName.includes("ts-appearance-density-option"),
        "Comfortable density": (control) => control.tag === "INPUT" && control.value === "comfortable" && control.targetClassName.includes("ts-appearance-density-option"),
        "Apply profile": (control) => control.tag === "BUTTON" && control.text.includes("Apply profile"),
        Cancel: (control) => control.tag === "BUTTON" && control.text === "Cancel",
      }[name](observed);
      const inside = observed.paint.left >= observed.clip.left - 1 && observed.paint.right <= observed.clip.right + 1 &&
        observed.paint.top >= observed.clip.top - 1 && observed.paint.bottom <= observed.clip.bottom + 1;
      evidence(reachesExpectedControl && observed.focusVisible && observed.outlineWidth === "3px" && observed.outlineOffset === "2px" && inside,
        `${tag} preserves ${name} keyboard focus paint inside the scrollport`, observed);
      focusPaint.push({ name, ...observed });
      return observed;
    };
    await readFocusPaint("Close");
    await readFocusPaint("profile choice");
    await page.keyboard.press("ArrowDown");
    await readFocusPaint("Familiar Spreadsheet profile", false);
    await page.keyboard.press("ArrowDown");
    await readFocusPaint("Minimal-Focus profile", false);
    await readFocusPaint("Import action");
    await readFocusPaint("Export action");
    await readFocusPaint("Compact density");
    await page.keyboard.press("ArrowRight");
    await readFocusPaint("Comfortable density", false);

    const readButtonText = async (button, name) => {
      await button.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "nearest" }));
      await button.focus();
      const measured = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const content = document.querySelector(".ts-home .ts-appearance-content").getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        return { control: rect.toJSON(), text: range.getBoundingClientRect().toJSON(), content: content.toJSON() };
      });
      evidence(measured.control.left >= measured.content.left - 1 && measured.control.right <= measured.content.right + 1 &&
        measured.text.left >= measured.control.left && measured.text.right <= measured.control.right + 0.5 && measured.text.height > 0,
      `${tag} keeps ${name} text within its action`, measured);
      return measured;
    };
    const importExport = page.locator(".ts-appearance-custom-actions button");
    actions.import = await readButtonText(importExport.nth(0), "Import");
    actions.export = await readButtonText(importExport.nth(1), "Export");
    const artifactDir = process.env.SHEET_CONTROL_ARTIFACT_DIR;
    if (artifactDir) await page.screenshot({ path: path.join(artifactDir, "appearance-visual-viewport-scale-1.5.png") });

    await page.locator(".ts-appearance-file-input").setInputFiles({
      name: "narrow-visual-profile.tachiko-profile.json",
      mimeType: "application/json",
      buffer: safeImportedManifestBytes,
    });
    const candidateActions = page.locator(".ts-appearance-candidate__actions button");
    await candidateActions.first().waitFor({ state: "visible" });
    await waitForAppearancePanelToSettle(page);
    await readFocusPaint("Apply profile");
    await readFocusPaint("Cancel");
    actions.apply = await readButtonText(candidateActions.nth(0), "Apply profile");
    actions.cancel = await readButtonText(candidateActions.nth(1), "Cancel");
    await candidateActions.nth(1).click();
    await page.locator(".ts-appearance-candidate").waitFor({ state: "detached" });
    await waitForAppearancePanelToSettle(page);
  } finally {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await waitForAppearancePanelToSettle(page);
    const restored = await page.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const density = [...panel.querySelectorAll(".ts-appearance-density-option")].map((label) => label.getBoundingClientRect().toJSON());
      return { viewportWidth: visualViewport?.width ?? innerWidth, scale: visualViewport?.scale ?? 1, density };
    });
    const expectedWidths = scaleOneGeometry.density.map(({ control }) => control.width);
    evidence(Math.abs(restored.viewportWidth - 320) <= 0.5 && Math.abs(restored.scale - 1) <= 0.01 &&
      restored.density.every((item, index) => Math.abs(item.width - expectedWidths[index]) <= 0.5) &&
      Math.abs(restored.density[0].width - restored.density[1].width) <= 1,
    "Home Appearance restores scale-1 equal Density geometry after visual viewport widening", { scaleOneGeometry, restored });
    observations.push({ homeAppearanceNarrowVisualViewport: { scaleOneGeometry, narrowed, focusPaint, actions, restored } });
    await session.detach();
  }

  await page.setViewportSize({ width: 600, height: 800 });
  await waitForAppearancePanelToSettle(page);
  const widerSession = await context.newCDPSession(page);
  try {
    await widerSession.send("Emulation.setPageScaleFactor", { pageScaleFactor: 3 });
    await waitForAppearancePanelToSettle(page);
    const widerNarrowed = await page.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const content = panel.querySelector(".ts-appearance-content");
      const header = panel.querySelector(".ts-appearance-popover__header");
      const title = header.querySelector("h2").getBoundingClientRect();
      const close = header.querySelector(".ts-appearance-close").getBoundingClientRect();
      const labels = [...panel.querySelectorAll(".ts-appearance-density-option")];
      const rangeBounds = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().toJSON(); };
      const viewport = visualViewport;
      return {
        layout: { width: innerWidth, height: innerHeight },
        viewport: { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight, scale: viewport?.scale ?? 1 },
        pageWidth: document.documentElement.scrollWidth,
        panel: panel.getBoundingClientRect().toJSON(), content: content.getBoundingClientRect().toJSON(),
        header: { title: title.toJSON(), close: close.toJSON() },
        density: labels.map((label) => ({ control: label.getBoundingClientRect().toJSON(), text: rangeBounds(label.querySelector("span")), height: label.getBoundingClientRect().height })),
      };
    });
    const label = "600px Home layout narrowed by browser-emulated visualViewport scale 3";
    evidence(widerNarrowed.layout.width === 600 && widerNarrowed.viewport.width < widerNarrowed.layout.width &&
      widerNarrowed.panel.left >= widerNarrowed.viewport.left - 0.5 &&
      widerNarrowed.panel.right <= widerNarrowed.viewport.left + widerNarrowed.viewport.width + 0.5 &&
      widerNarrowed.pageWidth <= widerNarrowed.layout.width,
    `${label} remains horizontally contained`, widerNarrowed);
    evidence(widerNarrowed.header.title.right <= widerNarrowed.header.close.left + 1 ||
      widerNarrowed.header.title.bottom <= widerNarrowed.header.close.top + 1 ||
      widerNarrowed.header.close.bottom <= widerNarrowed.header.title.top + 1,
    `${label} keeps the header title and Close separate`, widerNarrowed.header);
    evidence(widerNarrowed.density.length === 2 &&
      Math.abs(widerNarrowed.density[0].control.width - widerNarrowed.density[1].control.width) <= 1 &&
      widerNarrowed.density.every((item) => item.text.left >= item.control.left && item.text.right <= item.control.right + 0.5 && item.height >= 36),
    `${label} retains equal columns and wrapped Density text`, widerNarrowed.density);
    observations.push({ homeAppearanceWiderVisualViewport: widerNarrowed });
  } finally {
    await widerSession.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await waitForAppearancePanelToSettle(page);
    await widerSession.detach();
  }
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
  // Profile attributes can update before the observer-derived grid height; let its two-frame measurement settle before sampling.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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

async function auditWorkbookViewportBounds(page, width, height, profile, expectInteropPreview = false) {
  await page.setViewportSize({ width, height });
  for (const viewName of ["Table", "Cross-table summary", "Report", "Brief", "Import & export"]) {
    await page.getByRole("tab", { name: viewName, exact: true }).click();
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      const footer = document.querySelector(".ts-workspace-footer");
      const grid = document.querySelector(".ts-grid-scroll");
      const panelRect = panel?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const panelStyle = panel ? getComputedStyle(panel) : null;
      const interop = panel?.matches(".ts-interop") ? panel : null;
      const interopSpacing = interop ? (() => {
        const ledger = interop.querySelector('[aria-label="Source fidelity ledger"]');
        const cleanup = interop.querySelector('[aria-label="Cleanup preview"]');
        const download = interop.querySelector('[aria-label="Download spreadsheet"]');
        const preview = cleanup?.querySelector(":scope > .ts-preview");
        const count = preview?.querySelector(":scope > p");
        const targetTable = preview?.querySelector(":scope > .ts-interop-targets");
        const previewActions = preview?.querySelector(":scope > .ts-row-actions");
        const box = (element) => element?.getBoundingClientRect() ?? null;
        const distance = (upper, lower) => {
          const upperRect = box(upper);
          const lowerRect = box(lower);
          return upperRect && lowerRect ? lowerRect.top - upperRect.bottom : null;
        };
        const style = (element) => element ? getComputedStyle(element) : null;
        const title = interop.querySelector(":scope > .ts-content-heading");
        const ledgerHeading = ledger?.querySelector(":scope > .ts-content-heading");
        const cleanupHeading = cleanup?.querySelector(":scope > .ts-content-heading");
        const cleanupHelper = cleanup?.querySelector(":scope > .ts-subtle");
        const cleanupActions = cleanup?.querySelector(":scope > .ts-row-actions");
        const downloadHeading = download?.querySelector(":scope > .ts-content-heading");
        const downloadHelper = download?.querySelector(":scope > .ts-subtle");
        const downloadActions = download?.querySelector(":scope > .ts-row-actions");
        const countStyle = style(count);
        const previewStyle = style(preview);
        const actionsStyle = style(cleanupActions);
        return {
          previewPresent: Boolean(preview),
          background: style(interop)?.backgroundColor ?? null,
          titleToLedgerHeading: distance(title, ledgerHeading),
          cleanupHeadingToHelper: distance(cleanupHeading, cleanupHelper),
          cleanupHelperToActions: distance(cleanupHelper, cleanupActions),
          generationActionsToCount: distance(cleanupActions, preview),
          countToTable: distance(count, targetTable),
          tableToActions: distance(targetTable, previewActions),
          downloadHeadingToHelper: distance(downloadHeading, downloadHelper),
          downloadHelperToActions: distance(downloadHelper, downloadActions),
          actionsGap: actionsStyle?.gap ?? null,
          previewBorderTopWidth: previewStyle?.borderTopWidth ?? null,
          previewPaddingTop: previewStyle?.paddingTop ?? null,
          countMarginTop: countStyle?.marginTop ?? null,
          countMarginBottom: countStyle?.marginBottom ?? null,
          countFontSize: countStyle?.fontSize ?? null,
          countLineHeight: countStyle?.lineHeight ?? null,
          countFontWeight: countStyle?.fontWeight ?? null,
        };
      })() : null;
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
        panelClientWidth: panel?.clientWidth ?? null,
        panelScrollWidth: panel?.scrollWidth ?? null,
        panelBackground: panelStyle?.backgroundColor ?? null,
        gridClientWidth: grid?.clientWidth ?? null,
        gridScrollWidth: grid?.scrollWidth ?? null,
        gridOverflowX: grid ? getComputedStyle(grid).overflowX : null,
        footerTop: footerRect?.top ?? null,
        footerBottom: footerRect?.bottom ?? null,
        interopHeadings: Array.from(document.querySelectorAll(
          ".ts-interop > .ts-content-heading, .ts-interop-section > .ts-content-heading",
        )).map((heading) => {
          const style = getComputedStyle(heading);
          const rect = heading.getBoundingClientRect();
          return { text: heading.textContent?.trim() ?? "", fontSize: style.fontSize,
            lineHeight: style.lineHeight, fontWeight: style.fontWeight, height: rect.height };
        }),
        interopSpacing,
      };
    });
    const label = `${width}x${height} ${profile} ${viewName}`;
    const appearance = page.locator(".ts-workbook-head .ts-appearance-trigger");
    const heldAppearance = await sampleButtonStates(page, appearance, `${label} appearance command`);
    observations.push({ viewHeldControl: label, states: heldAppearance });
    evidence(layout.panelOverflowY === "auto", `${label} panel can scroll its own long content`, layout);
    evidence(layout.panelBottom <= layout.footerTop + 1, `${label} panel ends before the Views/status footer`, layout);
    evidence(layout.footerBottom <= height + 1, `${label} keeps the complete Views/status footer in the viewport`, layout);
    evidence(layout.pageHeight <= height + 1 && layout.scrollY === 0, `${label} does not push the document beyond the viewport`, layout);
    if (viewName !== "Table") evidence(layout.panelScrollWidth <= layout.panelClientWidth + 1,
      `${label} keeps the view panel within the viewport width`, layout);
    if (width === 320 && viewName === "Brief") {
      evidence(layout.panelScrollHeight > layout.panelClientHeight,
        `${label} scrolls the long Brief content inside its panel`, layout);
    }
    if (viewName === "Import & export") {
      const legalNotice = await page.evaluate(() => {
        const root = document.querySelector(".ts-app-root");
        const app = root?.querySelector(":scope > .ts-app");
        const footer = root?.querySelector(":scope > .ts-notices");
        const status = document.querySelector(".ts-workspace-footer");
        const intro = footer?.querySelector(":scope > span:first-child");
        const links = [...(footer?.querySelectorAll(":scope > a") ?? [])];
        const rect = (element) => {
          const box = element?.getBoundingClientRect();
          return box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
        };
        const style = (element) => element ? getComputedStyle(element) : null;
        const footerStyle = style(footer);
        const statusStyle = style(status);
        const introStyle = style(intro);
        const firstLinkStyle = style(links[0]);
        return {
          view: app?.getAttribute("data-view") ?? null,
          density: document.documentElement.getAttribute("data-ts-profile-density"),
          profileChrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
          directSibling: Boolean(footer && footer.parentElement === root && app?.parentElement === root),
          text: intro?.textContent ?? null,
          introDisplay: introStyle?.display ?? null,
          introHeight: rect(intro)?.height ?? null,
          links: links.map((link) => ({ text: link.textContent?.trim() ?? "", href: link.getAttribute("href"), rect: rect(link) })),
          footer: rect(footer),
          status: rect(status),
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          footerScrollHeight: footer?.scrollHeight ?? null,
          footerClientHeight: footer?.clientHeight ?? null,
          footerScrollWidth: footer?.scrollWidth ?? null,
          footerClientWidth: footer?.clientWidth ?? null,
          fontFamily: footerStyle?.fontFamily ?? null,
          appFontFamily: style(app)?.fontFamily ?? null,
          fontSize: footerStyle?.fontSize ?? null,
          lineHeight: footerStyle?.lineHeight ?? null,
          fontWeight: footerStyle?.fontWeight ?? null,
          boxSizing: footerStyle?.boxSizing ?? null,
          width: footerStyle?.width ?? null,
          maxWidth: footerStyle?.maxWidth ?? null,
          marginLeft: footerStyle?.marginLeft ?? null,
          marginRight: footerStyle?.marginRight ?? null,
          paddingTop: footerStyle?.paddingTop ?? null,
          paddingRight: footerStyle?.paddingRight ?? null,
          paddingBottom: footerStyle?.paddingBottom ?? null,
          background: footerStyle?.backgroundColor ?? null,
          color: footerStyle?.color ?? null,
          statusBackground: statusStyle?.backgroundColor ?? null,
          statusColor: statusStyle?.color ?? null,
          linkColor: firstLinkStyle?.color ?? null,
          overflowX: footerStyle?.overflowX ?? null,
          overflowY: footerStyle?.overflowY ?? null,
          flexShrink: footerStyle?.flexShrink ?? null,
        };
      });
      const compact = width <= 599;
      const legalLabel = `${width}x${height} ${profile}/${legalNotice.density} legal footer`;
      const expectedLinks = [
        { text: "third-party licenses", href: "/core-kit/notices/THIRD_PARTY_LICENSES.md" },
        { text: "MIT", href: "/core-kit/notices/LICENSE-MIT" },
        { text: "Apache-2.0", href: "/core-kit/notices/LICENSE-APACHE" },
      ];
      evidence(legalNotice.view === "workbook" && legalNotice.directSibling,
        `${legalLabel} remains a sibling after the workbook shell`, legalNotice);
      evidence(legalNotice.text === "Tachiko Sheet · experimental core kit notices: ",
        `${legalLabel} preserves the exact notice copy`, legalNotice);
      evidence(JSON.stringify(legalNotice.links.map(({ text, href }) => ({ text, href }))) === JSON.stringify(expectedLinks),
        `${legalLabel} preserves all three notice destinations and labels in order`, legalNotice);
      evidence(legalNotice.fontSize === "11px" && legalNotice.lineHeight === "16px" && legalNotice.fontWeight === "400" && legalNotice.boxSizing === "border-box",
        `${legalLabel} uses the approved global legal-notice type recipe`, legalNotice);
      evidence(legalNotice.fontFamily === legalNotice.appFontFamily,
        `${legalLabel} follows the active profile font family`, legalNotice);
      evidence(legalNotice.width === `${width}px` && legalNotice.maxWidth === "none" && legalNotice.marginLeft === "0px" && legalNotice.marginRight === "0px" && legalNotice.flexShrink === "0",
        `${legalLabel} keeps the workbook footer full-width and in natural flow`, legalNotice);
      evidence(legalNotice.paddingTop === "2px" && legalNotice.paddingBottom === "6px" && legalNotice.background === legalNotice.statusBackground,
        `${legalLabel} shares the workbook chrome surface and approved vertical padding`, legalNotice);
      const expectedHorizontalPadding = `${Math.min(40, Math.max(16, width * 0.03))}px`;
      evidence(legalNotice.paddingRight === expectedHorizontalPadding,
        `${legalLabel} uses the approved responsive workbook footer inset`, { ...legalNotice, expectedHorizontalPadding });
      evidence(legalNotice.introDisplay === (compact ? "block" : "inline") && (!compact || legalNotice.introHeight >= 16),
        `${legalLabel} uses natural notice flow at the established compact breakpoint`, legalNotice);
      evidence(legalNotice.footerScrollHeight <= legalNotice.footerClientHeight && legalNotice.footerScrollWidth <= legalNotice.footerClientWidth && legalNotice.pageWidth <= width,
        `${legalLabel} contains the complete notice copy without clipping or page overflow`, legalNotice);
      evidence(legalNotice.links.every((link) => link.rect && link.rect.x >= 0 && link.rect.right <= width + 1 && link.rect.y >= 0 && link.rect.bottom <= height + 1),
        `${legalLabel} keeps every notice link within the viewport`, legalNotice);
      const entry = { case: legalLabel, ...legalNotice, outcome: "rendered and contained" };
      legalNoticeAuditCases.push(entry);
      observations.push({ legalNoticeAuditCase: legalLabel, ...entry });

      evidence(layout.interopHeadings.length === 4 && layout.interopHeadings.every((heading) =>
        heading.fontSize === "20px" && heading.lineHeight === "28px" && heading.fontWeight === "600" && heading.height === 28),
      `${label} uses the approved 20/28 weight-600 view and section heading recipe`, layout.interopHeadings);
      const phone = width <= 600;
      const spacing = layout.interopSpacing;
      const expectedCountFont = phone ? "14px" : "12px";
      const expectedCountWeight = phone ? "400" : "500";
      evidence(spacing?.background !== "rgba(0, 0, 0, 0)" && spacing?.background !== "transparent",
        `${label} paints the Interop content surface`, spacing);
      evidence(spacing?.titleToLedgerHeading === (phone ? 16 : 32),
        `${label} keeps the approved title-to-ledger heading rhythm`, spacing);
      evidence(spacing?.cleanupHeadingToHelper === 16 && spacing?.downloadHeadingToHelper === 16,
        `${label} keeps 16px heading-to-helper spacing`, spacing);
      evidence(spacing?.cleanupHelperToActions === 28 && spacing?.downloadHelperToActions === 28,
        `${label} keeps 28px helper-to-actions spacing`, spacing);
      evidence(spacing?.actionsGap === (phone ? "16px" : "12px"),
        `${label} keeps the approved spacing inside every action group`, spacing);
      if (expectInteropPreview) evidence(spacing?.previewPresent === true,
        `${label} requires an actual cleanup preview for the preview-layout assertions`, spacing);
      if (spacing?.previewPresent) {
        evidence(spacing.generationActionsToCount === 32,
          `${label} keeps 32px spacing from preview generation actions to the result count`, spacing);
        evidence(spacing.countToTable === (phone ? 16 : 20) && spacing.tableToActions === 24,
          `${label} keeps the approved count, target table, and preview-action spacing`, spacing);
        evidence(spacing.previewBorderTopWidth === "0px" && spacing.previewPaddingTop === "0px" &&
          spacing.countMarginTop === "0px" && spacing.countMarginBottom === "0px" &&
          spacing.countFontSize === expectedCountFont && spacing.countLineHeight === "20px" &&
          spacing.countFontWeight === expectedCountWeight,
        `${label} renders the result count with the approved reset and typography`, spacing);
      }
    }
    if (width === 320 && viewName === "Table") {
      evidence(layout.gridOverflowX === "auto" && layout.gridScrollWidth > layout.gridClientWidth,
        `${label} preserves the Table's own horizontal grid scroller`, layout);
    }
    observations.push({ workbookViewport: label, ...layout });
  }
}

async function auditInteropPreviewTrimCases(browser) {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await openApp(context, page);
    await page.getByTestId("project-ready").waitFor();
    await openCanary(context, page);

    const salesPen = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first();
    await salesPen.locator("td").first().dblclick();
    const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
    await editor.fill(" PEN ");
    await editor.press("Enter");
    await page.waitForFunction(() => /\sPEN\s/.test(
      [...document.querySelectorAll('table[aria-label="Table"] tbody tr')]
        .map((row) => row.textContent ?? "").join(" "),
    ));

    for (const profile of profiles) {
      for (const density of densities) {
        for (const viewport of [{ width: 1512, height: 982 }, { width: 320, height: 640 }]) {
          const label = `${viewport.width}px ${profile.id}/${density.id} Preview trim`;
          await page.setViewportSize(viewport);
          await choose(page, profile.id, density.id);
          await page.keyboard.press("Escape");
          await page.getByRole("tab", { name: "Import & export", exact: true }).click();
          await page.getByRole("button", { name: "Preview trim", exact: true }).click();
          const preview = page.getByTestId("cleanup-preview");
          await preview.waitFor();
          const summary = (await preview.locator(":scope > p").textContent())?.trim() ?? "";
          assert.match(summary, /^[1-9]\d* cell changes and \d+ rows would change\.$/,
            `${label} produces a nonempty real trim preview`);
          const targets = page.getByRole("table", { name: "Cleanup targets", exact: true });
          await targets.waitFor();
          assert.deepEqual((await targets.locator("thead th").allTextContents()).map((item) => item.trim()), ["Target"],
            `${label} keeps the approved cleanup target heading`);
          const targetCount = await targets.locator("tbody tr").count();
          assert.ok(targetCount > 0, `${label} exposes at least one real cleanup target`);

          await auditWorkbookViewportBounds(page, viewport.width, viewport.height, profile.id, true);
          if (profile.id === "tachiko" && density.id === "compact" && viewport.width === 1512) {
            await auditLegalNoticeKeyboard(page);
          }
          await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
          await preview.waitFor({ state: "detached" });
          assert.equal(await page.getByTestId("cleanup-preview").count(), 0,
            `${label} cancels normally before the next isolated appearance observation`);
          const entry = { case: label, density: density.id, targetCount, previewSummary: summary, outcome: "previewed and cancelled" };
          interopPreviewTrimCases.push(entry);
          observations.push({ interopPreviewTrimCase: label, ...entry });
        }
      }
    }
    assert.equal(interopPreviewTrimCases.length, 12, "all three profiles, both densities, and both preview widths execute");
  } finally {
    await context.close();
  }
}

async function auditLegalNoticeKeyboard(page) {
  const links = page.locator(".ts-notices > a");
  await page.locator(".ts-appearance-trigger").focus();
  let reachedFirstLink = false;
  for (let step = 0; step < 80; step += 1) {
    if (await links.nth(0).evaluate((element) => document.activeElement === element)) {
      reachedFirstLink = true;
      break;
    }
    await page.keyboard.press("Tab");
  }
  assert.equal(reachedFirstLink, true, "keyboard tab order reaches the first legal notice link");

  const linkFocus = [];
  for (let index = 0; index < 3; index += 1) {
    const link = links.nth(index);
    const state = await link.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const focusClearance = 5;
      const outlineBox = {
        x: rect.x - focusClearance,
        y: rect.y - focusClearance,
        right: rect.right + focusClearance,
        bottom: rect.bottom + focusClearance,
      };
      const clippingAncestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        if (["hidden", "clip", "auto", "scroll"].includes(parentStyle.overflowX) || ["hidden", "clip", "auto", "scroll"].includes(parentStyle.overflowY)) {
          clippingAncestors.push({
            className: typeof parent.className === "string" ? parent.className : parent.tagName,
            x: parentRect.x,
            y: parentRect.y,
            right: parentRect.right,
            bottom: parentRect.bottom,
            overflowX: parentStyle.overflowX,
            overflowY: parentStyle.overflowY,
            containsOutline: outlineBox.x >= parentRect.x - 1 && outlineBox.right <= parentRect.right + 1 && outlineBox.y >= parentRect.y - 1 && outlineBox.bottom <= parentRect.bottom + 1,
          });
        }
      }
      return {
        active: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
        outlineBox,
        clippingAncestors,
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    evidence(state.active && state.focusVisible, `legal notice link ${index + 1} receives visible keyboard focus`, state);
    evidence(state.outlineStyle !== "none" && state.outlineWidth === "3px" && state.outlineOffset === "2px",
      `legal notice link ${index + 1} keeps the shared 3px focus outline and 2px offset`, state);
    evidence(state.rect.x >= 0 && state.rect.y >= 0 && state.rect.right <= state.viewport.width + 1 && state.rect.bottom <= state.viewport.height + 1,
      `legal notice link ${index + 1} remains visible in the viewport`, state);
    evidence(state.outlineBox.x >= 0 && state.outlineBox.y >= 0 && state.outlineBox.right <= state.viewport.width + 1 && state.outlineBox.bottom <= state.viewport.height + 1 && state.clippingAncestors.every((ancestor) => ancestor.containsOutline),
      `legal notice link ${index + 1} focus paint clears the viewport and clipping ancestors`, state);
    linkFocus.push(state);
    if (index < 2) await page.keyboard.press("Tab");
  }

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await links.nth(0).evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "Highlight";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const outlineBox = { x: rect.x - 5, y: rect.y - 5, right: rect.right + 5, bottom: rect.bottom + 5 };
    const clippingAncestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      const parentRect = parent.getBoundingClientRect();
      if (["hidden", "clip", "auto", "scroll"].includes(parentStyle.overflowX) || ["hidden", "clip", "auto", "scroll"].includes(parentStyle.overflowY)) {
        clippingAncestors.push({
          containsOutline: outlineBox.x >= parentRect.x - 1 && outlineBox.right <= parentRect.right + 1 && outlineBox.y >= parentRect.y - 1 && outlineBox.bottom <= parentRect.bottom + 1,
        });
      }
    }
    const result = {
      active: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      outlineColor: style.outlineColor,
      expectedHighlight: expected,
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
      outlineBox,
      clippingAncestors,
      viewport: { width: innerWidth, height: innerHeight },
    };
    probe.remove();
    return result;
  });
  evidence(forced.active && forced.focusVisible && forced.outlineColor === forced.expectedHighlight,
    "legal notice keyboard focus uses the forced-colors system highlight", forced);
  evidence(forced.rect.x >= 0 && forced.rect.y >= 0 && forced.rect.right <= forced.viewport.width + 1 && forced.rect.bottom <= forced.viewport.height + 1,
    "forced-colors legal notice focus remains in the viewport", forced);
  evidence(forced.outlineBox.x >= 0 && forced.outlineBox.y >= 0 && forced.outlineBox.right <= forced.viewport.width + 1 && forced.outlineBox.bottom <= forced.viewport.height + 1 && forced.clippingAncestors.every((ancestor) => ancestor.containsOutline),
    "forced-colors legal notice focus paint clears the viewport and clipping ancestors", forced);
  await page.emulateMedia({ forcedColors: "none" });
  observations.push({ legalNoticeKeyboard: { linkFocus, forcedColorsEmulation: forced, physicalAtOrImeClaim: false } });
}

async function waitForLegalLayout(page) {
  return page.evaluate(async () => {
    const close = (left, right) => Math.abs(left - right) < 0.1;
    let previous = null;
    let stable = 0;
    let last = null;
    for (let frame = 0; frame < 40; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const footer = document.querySelector(".ts-notices");
      const panel = document.querySelector(".ts-panel");
      const grid = document.querySelector(".ts-grid-scroll");
      const footerRect = footer?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      if (!footerRect || !panelRect || !gridRect) throw new Error("Workbook legal-notice resize targets disappeared");
      last = {
        width: innerWidth,
        height: innerHeight,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        footerHeight: footerRect.height,
        footerScrollHeight: footer.scrollHeight,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        gridTop: gridRect.top,
        gridHeight: grid.clientHeight,
        gridAvailableHeight: Number.parseFloat(grid.style.getPropertyValue("--ts-grid-available-height")) || 0,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
      };
      const keys = Object.keys(last);
      stable = previous && keys.every((key) => close(previous[key], last[key])) ? stable + 1 : 0;
      if (stable >= 2) return last;
      previous = last;
    }
    throw new Error(`Workbook legal-notice layout did not settle within 40 frames: ${JSON.stringify(last)}`);
  });
}

async function auditLegalNoticeResize(page) {
  await choose(page, "tachiko", "compact");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const desktop = await waitForLegalLayout(page);
  await page.setViewportSize({ width: 320, height: 480 });
  const compact = await waitForLegalLayout(page);
  await page.setViewportSize({ width: 1512, height: 982 });
  const restored = await waitForLegalLayout(page);
  evidence(desktop.footerHeight < compact.footerHeight,
    "compact notice wrapping grows the footer naturally after a viewport resize", { desktop, compact });
  evidence(restored.footerHeight === desktop.footerHeight,
    "restoring the wide viewport restores the natural notice footer height", { desktop, restored });
  for (const [label, layout] of [["desktop", desktop], ["compact", compact], ["restored", restored]]) {
    evidence(layout.footerScrollHeight <= layout.footerHeight + 1 && layout.pageWidth <= layout.width && layout.pageHeight <= layout.height + 1,
      `${label} notice resize state contains the footer and page`, layout);
    const actualAvailable = Math.max(0, Math.floor(layout.panelBottom - layout.gridTop));
    evidence(Math.abs(layout.gridAvailableHeight - actualAvailable) <= 1 && layout.gridHeight + 1 >= Math.min(168, actualAvailable),
      `${label} notice resize recomputes the grid space from the resized panel`, { ...layout, actualAvailable });
  }
  observations.push({ legalNoticeWrapResize: { desktop, compact, restored, caseCount: 3, outcome: "wrapped, grew, and restored" } });
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

async function auditHomeViewportBounds(page, browser) {
  const emptyContext = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
  try {
    const emptyPage = await emptyContext.newPage();
    await openApp(emptyContext, emptyPage);
    await emptyPage.getByTestId("project-ready").waitFor();
    await emptyPage.getByRole("button", { name: "Close project", exact: true }).click();
    await emptyPage.locator('.ts-app[data-view="home"]').waitFor();
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(emptyPage, profile.id, density.id);
        await emptyPage.keyboard.press("Escape");
        for (const [width, height] of [[1512, 982], [768, 640], [600, 640], [320, 640]]) {
          await emptyPage.setViewportSize({ width, height });
          const layout = await emptyPage.evaluate(() => {
            const home = document.querySelector(".ts-home");
            const homeRect = home.getBoundingClientRect();
            const headerRect = document.querySelector(".ts-home-head").getBoundingClientRect();
            const visibleIntro = [...document.querySelectorAll(".ts-home-intro")].find((node) => getComputedStyle(node).display !== "none");
            const introRect = visibleIntro.getBoundingClientRect();
            const actions = [...document.querySelectorAll(".ts-home-open-actions > .ts-home-file-action, .ts-home-open-actions > button")]
              .map((node) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height }; });
            const importAction = document.querySelector(".ts-home-import-action").getBoundingClientRect();
            const importDesktop = document.querySelector(".ts-home-import-desktop-help");
            const importCompact = document.querySelector(".ts-home-import-compact-help");
            const openDesktop = document.querySelector(".ts-home-open-desktop-help");
            const openCompact = document.querySelector(".ts-home-open-compact-help");
            const isVisible = (node) => getComputedStyle(node).display !== "none";
            const help = isVisible(importCompact) ? importCompact : importDesktop;
            const helpRect = help.getBoundingClientRect();
            const actionRect = document.querySelector(".ts-home-import-action").getBoundingClientRect();
            return {
              pageWidth: document.documentElement.scrollWidth,
              empty: document.querySelectorAll(".ts-copy-item").length === 0,
              savedMessage: document.querySelector(".ts-empty")?.textContent?.trim() ?? null,
              home: { x: homeRect.x, y: homeRect.y, width: homeRect.width, height: homeRect.height },
              header: { x: headerRect.x, contentX: document.querySelector(".ts-brand").getBoundingClientRect().x, y: headerRect.y },
              intro: { x: introRect.x, contentX: introRect.x + Number.parseFloat(getComputedStyle(visibleIntro).paddingLeft), y: introRect.y, width: introRect.width, right: introRect.right },
              introText: [...document.querySelectorAll(".ts-home-intro")]
                .filter(isVisible).map((node) => node.textContent.trim()),
              openBorderTop: getComputedStyle(document.querySelector('[aria-label="Open project"]')).borderTopStyle,
              openActionGap: Number.parseFloat(getComputedStyle(document.querySelector(".ts-home-open-actions")).rowGap),
              actions,
              openHelper: [openDesktop, openCompact].find(isVisible)?.textContent?.trim() ?? null,
              visibleOpenHelpers: Number(isVisible(openDesktop)) + Number(isVisible(openCompact)),
              importAction: { x: importAction.x, y: importAction.y, right: importAction.right, width: importAction.width, height: importAction.height },
              importHelper: { text: help.textContent.trim(), y: helpRect.y, visibleCopies: Number(isVisible(importDesktop)) + Number(isVisible(importCompact)) },
              importHeadingGap: actionRect.top - document.querySelector('[aria-label="Import spreadsheet"] .ts-h2').getBoundingClientRect().bottom,
              importChooserBeforeHelper: actionRect.bottom <= helpRect.y + 1,
              imports: document.querySelectorAll(".ts-home-import-action input[type=file]").length,
              folders: document.querySelectorAll(".ts-home-open-actions input[type=file]").length,
              appearance: document.querySelectorAll(".ts-home-head .ts-appearance-trigger").length,
            };
          });
          assert.equal(layout.empty, true, `${width}px ${profile.id}/${density.id} observes empty Home`);
          assert.equal(layout.savedMessage, "No saved copies yet.");
          assert.ok(layout.pageWidth <= width, `${width}px ${profile.id}/${density.id} empty Home has no horizontal overflow: ${JSON.stringify(layout)}`);
          assert.equal(layout.visibleOpenHelpers, 1, "one responsive Open helper is visible and exposed at a time");
          assert.equal(layout.introText.length, 1, "one responsive Home intro is visible and exposed at a time");
          if (width < 600) {
            assert.deepEqual(layout.introText, ["Open a local project or a saved copy."]);
            assert.equal(layout.openHelper, "The source folder stays unchanged.");
          } else {
            assert.deepEqual(layout.introText, ["Open a project folder, or reopen a copy saved in this browser profile."]);
            assert.equal(layout.openHelper, "Choose a local project folder. Its source stays unchanged.");
          }
          assert.equal(layout.importHelper.text, "Review the source and column types before importing.");
          assert.equal(layout.importHelper.visibleCopies, 1, "one responsive Import helper is visible and exposed at a time");
          assert.equal(layout.imports, 1, "empty Home retains one real single-file import input");
          assert.equal(layout.folders, 1, "empty Home retains one real directory input");
          assert.equal(layout.appearance, 1, "empty Home keeps Appearance available");
          assert.ok(layout.actions.every((action) => action.x >= 0 && action.right <= width + 1),
            `${width}px ${profile.id}/${density.id} Open actions remain inside the viewport`, layout);
          assert.ok(layout.importAction.x >= 0 && layout.importAction.right <= width + 1,
            `${width}px ${profile.id}/${density.id} Import action remains inside the viewport`, layout);
          if (width < 600) {
            assert.ok(Math.abs(layout.home.y - 28) <= 1, "compact Home keeps its 28px top origin", layout);
            assert.equal(layout.header.contentX, 32, "compact Home header content uses the 16px inner inset");
            assert.equal(layout.intro.contentX, 32, "compact Home intro content uses the 16px inner inset");
            assert.equal(layout.openBorderTop, "none", "only compact Open loses its top separator");
            assert.equal(layout.openActionGap, 16, "compact Home Open action row has the approved 16px gap");
            for (let index = 1; index < layout.actions.length; index += 1) {
              assert.equal(layout.actions[index].y - layout.actions[index - 1].y - layout.actions[index - 1].height, 16,
                "adjacent compact Open actions are separated by 16px");
            }
            assert.ok(layout.actions.every((action) => Math.abs(action.width - layout.home.width) <= 1),
              "compact Open actions fill the Home content width", layout);
            assert.equal(layout.importChooserBeforeHelper, true, "compact Import chooser precedes helper in visual and DOM order");
            assert.equal(layout.importHeadingGap, 20, "compact Import chooser follows its heading with the approved gap");
            assert.ok(layout.importHelper.y >= layout.importAction.y + layout.importAction.height + 15,
              "compact Import helper follows the chooser with the approved gap", layout);
            if (density.id === "comfortable") assert.ok(layout.actions.every(({ height }) => height >= 36));
          } else {
            assert.equal(layout.openBorderTop, "solid", "desktop retains the approved Open divider");
            assert.equal(layout.openActionGap, 12, "desktop retains its 12px Open action gap");
            assert.ok(layout.importHelper.y < layout.importAction.y,
              "desktop retains its approved helper-before-chooser presentation order", layout);
          }
          let appearancePopover = null;
          if (width === 320) {
            await emptyPage.getByRole("button", { name: "Appearance", exact: true }).click();
            appearancePopover = await emptyPage.evaluate(() => {
              const panel = document.querySelector(".ts-home .ts-appearance-popover");
              const rect = panel.getBoundingClientRect();
              return { x: rect.x, right: rect.right, width: rect.width, pageWidth: document.documentElement.scrollWidth,
                clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth };
            });
            assert.ok(appearancePopover.x >= 0 && appearancePopover.right <= width + 1 && appearancePopover.pageWidth <= width,
              `320px ${profile.id}/${density.id} Home Appearance popover remains inside the viewport`, appearancePopover);
            assert.ok(appearancePopover.scrollWidth <= appearancePopover.clientWidth + 1,
              `320px ${profile.id}/${density.id} Home Appearance content remains usable within its panel`, appearancePopover);
            await emptyPage.keyboard.press("Escape");
          }
          observations.push({ homeEmptyViewport: `${width}x${height} ${profile.id}/${density.id}`, ...layout, ...(appearancePopover ? { appearancePopover } : {}) });
        }
      }
    }

    const popoverWidths = [320, 360, 375, 380, 381, 383, 384, 390, 414, 480, 599];
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(emptyPage, profile.id, density.id);
        for (const width of popoverWidths) {
          for (const height of [640, 450]) {
            await emptyPage.setViewportSize({ width, height });
            const trigger = emptyPage.getByRole("button", { name: "Appearance", exact: true });
            if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
            const panel = emptyPage.locator(".ts-home .ts-appearance-popover");
            await panel.waitFor({ state: "visible" });
            await waitForAppearancePanelToSettle(emptyPage);
            const geometry = await emptyPage.evaluate(() => {
              const homeHead = document.querySelector(".ts-home-head");
              const panel = document.querySelector(".ts-home .ts-appearance-popover");
              const content = panel.querySelector(".ts-appearance-content");
              const headRect = homeHead.getBoundingClientRect();
              const rect = panel.getBoundingClientRect();
              const style = getComputedStyle(panel);
              return {
                viewportWidth: innerWidth,
                viewportHeight: innerHeight,
                pageWidth: document.documentElement.scrollWidth,
                panel: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
                header: { x: headRect.x, y: headRect.y, right: headRect.right, bottom: headRect.bottom },
                maxHeight: style.maxHeight,
                clientWidth: panel.clientWidth,
                scrollWidth: panel.scrollWidth,
                contentClientHeight: content.clientHeight,
                contentScrollHeight: content.scrollHeight,
                contentOverflowY: getComputedStyle(content).overflowY,
              };
            });
            const label = `${width}x${height} Home Appearance ${profile.id}/${density.id}`;
            evidence(geometry.pageWidth <= width && geometry.panel.x >= 0 && geometry.panel.right <= width + 1,
              `${label} has no horizontal page or panel overflow`, geometry);
            evidence(geometry.panel.y >= geometry.header.bottom && geometry.panel.bottom <= height + 1,
              `${label} opens below the full Home header and stays within the viewport`, geometry);
            if (width === 390) {
              evidence(Math.abs(geometry.panel.x - geometry.header.x - 16) <= 1,
                `${label} uses the compact Home header left edge plus the approved 16px inset`, geometry);
            }
            evidence(geometry.scrollWidth <= geometry.clientWidth + 1,
              `${label} keeps all panel content within its available width`, geometry);
            evidence((geometry.contentOverflowY === "auto" || geometry.contentOverflowY === "scroll") &&
              geometry.contentScrollHeight > geometry.contentClientHeight,
            `${label} keeps Appearance content internally scrollable`, geometry);

            const reachableControls = await emptyPage.evaluate(() => {
              const panel = document.querySelector(".ts-home .ts-appearance-popover");
              const content = panel.querySelector(".ts-appearance-content");
              const targets = [
                ["density", ".ts-appearance-density-option"],
                ["import", ".ts-appearance-custom-actions button:first-child"],
                ["export", ".ts-appearance-custom-actions button:last-child"],
              ];
              const reachable = targets.map(([name, selector]) => {
                const target = content.querySelector(selector);
                target.scrollIntoView({ block: "nearest", inline: "nearest" });
                const targetRect = target.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                return { name, top: targetRect.top, bottom: targetRect.bottom, contentTop: contentRect.top, contentBottom: contentRect.bottom,
                  inside: targetRect.bottom > contentRect.top && targetRect.top < contentRect.bottom };
              });
              const close = panel.querySelector(".ts-appearance-close").getBoundingClientRect();
              const panelRect = panel.getBoundingClientRect();
              return {
                reachable,
                closeInside: close.top >= panelRect.top && close.bottom <= panelRect.bottom,
                scrollTop: content.scrollTop,
              };
            });
            evidence(reachableControls.reachable.every(({ inside }) => inside) && reachableControls.closeInside,
              `${label} can reach Density, Import, Export and Close controls`, reachableControls);
            await emptyPage.keyboard.press("Escape");
            await emptyPage.waitForFunction(() => document.querySelector(".ts-home .ts-appearance-trigger")?.getAttribute("aria-expanded") === "false");
            const focusReturned = await trigger.evaluate((button) => document.activeElement === button && button.getAttribute("aria-expanded") === "false");
            evidence(focusReturned, `${label} Escape closes and returns focus to Appearance`);
            observations.push({ homeAppearancePopover: label, ...geometry, reachableControls });
          }
        }
      }
    }

    await choose(emptyPage, "tachiko", "compact");
    await emptyPage.keyboard.press("Escape");
    await auditNarrowedAppearanceContent(emptyPage, emptyContext);
    await emptyPage.setViewportSize({ width: 320, height: 200 });
    const shortTrigger = emptyPage.getByRole("button", { name: "Appearance", exact: true });
    if (await shortTrigger.getAttribute("aria-expanded") !== "true") await shortTrigger.click();
    const shortPanel = emptyPage.locator(".ts-home .ts-appearance-popover");
    await shortPanel.waitFor({ state: "visible" });
    await waitForAppearancePanelToSettle(emptyPage);
    const shortAppearanceGeometry = await emptyPage.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const content = panel.querySelector(".ts-appearance-content");
      const header = document.querySelector(".ts-home-head");
      const panelRect = panel.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const firstOption = panel.querySelector(".ts-appearance-profile-option");
      const firstOptionRect = firstOption.getBoundingClientRect();
      const appearanceTriggerRect = panel.parentElement.querySelector(".ts-appearance-trigger").getBoundingClientRect();
      const panelStyle = getComputedStyle(panel);
      const selectorStyle = getComputedStyle(panel.parentElement);
      const px = (value) => Number.parseFloat(value) || 0;
      const measuredChrome = panel.querySelector(".ts-appearance-popover__header").getBoundingClientRect().height +
        px(panelStyle.paddingTop) + px(panelStyle.paddingBottom) + px(panelStyle.borderTopWidth) +
        px(panelStyle.borderBottomWidth) + px(panelStyle.rowGap);
      const interactiveHeight = firstOptionRect.height;
      const focusClearance = 2 * (px(selectorStyle.getPropertyValue("--ts-appearance-focus-width")) +
        px(selectorStyle.getPropertyValue("--ts-appearance-focus-offset")));
      const viewport = window.visualViewport;
      const preferredBelow = headerRect.bottom + 8;
      const usableTop = (viewport?.offsetTop ?? 0) + 12;
      const usableBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 12;
      const belowHeight = Math.max(0, usableBottom - preferredBelow);
      const aboveHeight = Math.max(0, appearanceTriggerRect.top - 8 - usableTop);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        visualViewport: { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight },
        page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        panel: { x: panelRect.x, y: panelRect.y, right: panelRect.right, bottom: panelRect.bottom, width: panelRect.width, height: panelRect.height, clientHeight: panel.clientHeight },
        header: { bottom: headerRect.bottom },
        usableMinimum: { chrome: measuredChrome, interactiveControl: interactiveHeight, focusClearance,
          total: measuredChrome + interactiveHeight + focusClearance, belowSide: belowHeight, aboveSide: aboveHeight },
        content: { top: contentRect.top, bottom: contentRect.bottom, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, overflowY: getComputedStyle(content).overflowY },
      };
    });
    evidence(shortAppearanceGeometry.page.width <= 320 && shortAppearanceGeometry.panel.x >= 0 &&
      shortAppearanceGeometry.panel.right <= 321 && shortAppearanceGeometry.panel.y >= 0 &&
      shortAppearanceGeometry.panel.bottom <= 201,
    "320x200 Home Appearance uses the contained short-viewport fallback", shortAppearanceGeometry);
    evidence(shortAppearanceGeometry.content.scrollHeight > shortAppearanceGeometry.content.clientHeight &&
      ["auto", "scroll"].includes(shortAppearanceGeometry.content.overflowY),
    "320x200 Home Appearance preserves internal scrolling for short-viewport content", shortAppearanceGeometry);
    evidence(shortAppearanceGeometry.usableMinimum.belowSide < shortAppearanceGeometry.usableMinimum.total &&
      shortAppearanceGeometry.usableMinimum.aboveSide < shortAppearanceGeometry.usableMinimum.total &&
      shortAppearanceGeometry.panel.y === shortAppearanceGeometry.visualViewport.top + 12 &&
      shortAppearanceGeometry.panel.height <= shortAppearanceGeometry.visualViewport.height - 24,
    "320x200 Home Appearance clamps to the inset visual viewport when neither side fits measured usable height",
    shortAppearanceGeometry);
    const shortReachability = await emptyPage.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const content = panel.querySelector(".ts-appearance-content");
      const names = [".ts-appearance-density-option", ".ts-appearance-custom-actions button:first-child", ".ts-appearance-custom-actions button:last-child"];
      const controls = names.map((selector) => {
        const target = content.querySelector(selector);
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rect = target.getBoundingClientRect();
        const visible = content.getBoundingClientRect();
        return { selector, top: rect.top, bottom: rect.bottom, contentTop: visible.top, contentBottom: visible.bottom,
          reachable: rect.bottom > visible.top && rect.top < visible.bottom };
      });
      const close = panel.querySelector(".ts-appearance-close").getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return { controls, closeReachable: close.top >= panelRect.top && close.bottom <= panelRect.bottom };
    });
    evidence(shortReachability.controls.every(({ reachable }) => reachable) && shortReachability.closeReachable,
      "320x200 Home Appearance keeps Density, Import, Export and Close reachable", shortReachability);
    await emptyPage.keyboard.press("Escape");
    await emptyPage.waitForFunction(() => document.querySelector(".ts-home .ts-appearance-trigger")?.getAttribute("aria-expanded") === "false");
    observations.push({ homeAppearanceShortViewport: { geometry: shortAppearanceGeometry, reachability: shortReachability } });

    await emptyPage.setViewportSize({ width: 320, height: 450 });
    const reactivityTrigger = emptyPage.getByRole("button", { name: "Appearance", exact: true });
    await reactivityTrigger.click();
    const measurePopover = () => emptyPage.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const content = panel.querySelector(".ts-appearance-content");
      const rect = panel.getBoundingClientRect();
      return {
        x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
        naturalContentHeight: content.scrollHeight,
        contentHeight: content.clientHeight,
        contentScrollTop: content.scrollTop,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    const naturalBeforeImport = await measurePopover();
    await emptyPage.locator(".ts-appearance-file-input").setInputFiles({
      name: "placement-growth.tachiko-profile.json",
      mimeType: "application/json",
      buffer: safeImportedManifestBytes,
    });
    await emptyPage.locator(".ts-appearance-candidate").getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await waitForAppearancePanelToSettle(emptyPage);
    const naturalAfterImport = await measurePopover();
    evidence(naturalAfterImport.naturalContentHeight > naturalBeforeImport.naturalContentHeight &&
      naturalAfterImport.x >= 0 && naturalAfterImport.right <= 320 && naturalAfterImport.y >= 0 && naturalAfterImport.bottom <= 450,
    "Home Appearance placement remeasures actual imported-profile content growth while remaining reachable", {
      before: naturalBeforeImport, after: naturalAfterImport,
    });
    await emptyPage.locator(".ts-appearance-candidate").getByRole("button", { name: "Cancel", exact: true }).click();
    await emptyPage.locator(".ts-appearance-candidate").waitFor({ state: "detached" });
    await waitForAppearancePanelToSettle(emptyPage);
    const naturalAfterCancel = await measurePopover();
    evidence(naturalAfterCancel.naturalContentHeight <= naturalAfterImport.naturalContentHeight &&
      naturalAfterCancel.x >= 0 && naturalAfterCancel.right <= 320 && naturalAfterCancel.bottom <= 450,
    "Home Appearance placement releases the added content height after candidate cancellation", naturalAfterCancel);

    await emptyPage.locator(".ts-appearance-file-input").setInputFiles({
      name: "rejected-profile.json",
      mimeType: "application/json",
      buffer: Buffer.from("{ invalid JSON", "utf8"),
    });
    await emptyPage.locator('.ts-appearance-notice--rejected[role="alert"]').waitFor();
    await waitForAppearancePanelToSettle(emptyPage);
    const rejectedPlacement = await measurePopover();
    evidence(rejectedPlacement.x >= 0 && rejectedPlacement.right <= 320 && rejectedPlacement.y >= 0 && rejectedPlacement.bottom <= 450,
      "Home Appearance stays within the viewport after real profile-file rejection status grows", rejectedPlacement);
    await emptyPage.getByRole("button", { name: "Export selected profile…", exact: true }).click();
    await emptyPage.getByText(/^Download requested:/).waitFor();
    await waitForAppearancePanelToSettle(emptyPage);
    const exportFeedbackPlacement = await measurePopover();
    evidence(exportFeedbackPlacement.x >= 0 && exportFeedbackPlacement.right <= 320 &&
      exportFeedbackPlacement.y >= 0 && exportFeedbackPlacement.bottom <= 450,
    "Home Appearance remains contained after actual export feedback is added", exportFeedbackPlacement);
    await emptyPage.keyboard.press("Escape");
    observations.push({ homeAppearanceReactivity: {
      naturalBeforeImport, naturalAfterImport, naturalAfterCancel, rejectedPlacement, exportFeedbackPlacement,
    } });
  } finally {
    await emptyContext.close();
  }

  await choose(page, "tachiko", "compact");
  await page.setViewportSize({ width: 1512, height: 982 });
  const canaryRowsBeforeSave = await page.locator(".ts-grid tbody").innerText();
  const unbrokenName = "home-unbroken-" + "x".repeat(112);
  const cjkName = "Home 中文名稱保存測試" + "界".repeat(72);
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("Viewport home probe");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a copy" }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const ordinaryHomeGeometry = await page.evaluate(() => ({
    surface: getComputedStyle(document.querySelector('.ts-app[data-view="home"]')).backgroundColor,
    actions: [...document.querySelectorAll(".ts-home-open-actions > .ts-home-file-action, .ts-home-open-actions > button")].map((action) => {
      const rect = action.getBoundingClientRect();
      return [rect.x, rect.y, rect.width];
    }),
    lines: [...document.querySelectorAll(".ts-home > .ts-home-section")].map((section) => ({
      top: section.getBoundingClientRect().top,
      bottom: section.getBoundingClientRect().bottom,
    })),
    import: (() => {
      const rect = document.querySelector(".ts-home-import-action").getBoundingClientRect();
      return [rect.x, rect.y, rect.width];
    })(),
    saved: (() => {
      const rect = document.querySelector(".ts-copy-item .ts-button").getBoundingClientRect();
      return [rect.x, rect.y, rect.width];
    })(),
    metadataX: document.querySelector(".ts-copy-meta").getBoundingClientRect().x,
  }));
  assert.equal(ordinaryHomeGeometry.surface, "rgb(255, 255, 255)", "Tachiko Home uses its approved white app surface");
  assert.deepEqual(ordinaryHomeGeometry.actions, [[32, 220, 184], [228, 220, 128], [368, 220, 224]]);
  assert.deepEqual(ordinaryHomeGeometry.lines.map(({ top }) => top), [144, 344, 552]);
  assert.deepEqual(ordinaryHomeGeometry.import, [32, 468, 196]);
  assert.deepEqual(ordinaryHomeGeometry.saved, [32, 684, 288]);
  assert.equal(ordinaryHomeGeometry.metadataX, 352);
  assert.equal(ordinaryHomeGeometry.lines.at(-1).bottom - 1, 732,
    "the single ordinary saved-copy specimen ends at the approved y=732 divider");
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
  const folderChooserReady = page.waitForEvent("filechooser");
  await page.locator(".ts-home-open-actions .ts-home-file-action").click();
  const folderChooser = await folderChooserReady;
  assert.equal(folderChooser.isMultiple(), true, "the visible folder action opens the existing directory picker");
  const importChooserReady = page.waitForEvent("filechooser");
  await page.locator(".ts-home-import-action").click();
  const importChooser = await importChooserReady;
  assert.equal(importChooser.isMultiple(), false, "the visible import action opens the existing single-file picker");
  const disabledReference = await page.evaluate(() => {
    const home = document.querySelector(".ts-home");
    const reference = document.createElement("button");
    reference.className = "ts-button";
    reference.disabled = true;
    home.append(reference);
    const style = getComputedStyle(reference);
    const paint = { color: style.color, background: style.backgroundColor, border: style.borderTopColor, cursor: style.cursor };
    reference.remove();
    for (const label of document.querySelectorAll(".ts-home-file-action")) {
      label.classList.add("ts-home-file-action--disabled");
      label.setAttribute("aria-disabled", "true");
      label.querySelector('input[type="file"]').disabled = true;
    }
    return paint;
  });
  for (const selector of [".ts-home-open-actions .ts-home-file-action", ".ts-home-import-action"]) {
    const label = page.locator(selector);
    const rect = await label.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const paint = await label.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, border: style.borderTopColor, cursor: style.cursor };
    });
    assert.deepEqual(paint, disabledReference, `${selector} keeps disabled paint while hovered`);
  }
  await page.evaluate(() => {
    for (const label of document.querySelectorAll(".ts-home-file-action")) {
      label.classList.remove("ts-home-file-action--disabled");
      label.setAttribute("aria-disabled", "false");
      label.querySelector('input[type="file"]').disabled = false;
    }
  });
  await page.getByRole("button", { name: "Open saved Viewport home probe", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), canaryRowsBeforeSave,
    "opening the ordinary saved copy retains the original visible rows and values");
  for (const name of [unbrokenName, cjkName]) {
    await page.getByRole("button", { name: "Save a copy", exact: true }).click();
    await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create copy", exact: true }).click();
    await page.getByRole("dialog", { name: "Save a copy" }).waitFor({ state: "detached" });
  }
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
  const savedNames = ["Viewport home probe", unbrokenName, cjkName];
  for (const name of savedNames) {
    const savedCopy = page.getByRole("button", { name: `Open saved ${name}`, exact: true });
    await savedCopy.waitFor();
    await savedCopy.click();
    await page.getByTestId("project-ready").waitFor();
    assert.equal(await page.locator(".ts-grid tbody").innerText(), canaryRowsBeforeSave,
      `reopening saved copy ${name} retains the original visible rows and values`);
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await page.locator('.ts-app[data-view="home"]').waitFor();
  }

  const singleSpaceName = "Plan review";
  const doubledSpaceName = "Plan  review";
  await clickSavedCopyByLiteralName(page, "Viewport home probe");
  await page.getByTestId("project-ready").waitFor();
  await editFirstCellForSavedCopy(page, "Whitespace identity first value");
  const singleSpaceRows = await page.locator(".ts-grid tbody").innerText();
  await saveCopyByName(page, singleSpaceName);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  await clickSavedCopyByLiteralName(page, singleSpaceName);
  await page.getByTestId("project-ready").waitFor();
  await editFirstCellForSavedCopy(page, "Whitespace identity second value");
  const doubledSpaceRows = await page.locator(".ts-grid tbody").innerText();
  assert.notEqual(doubledSpaceRows, singleSpaceRows, "distinct saved-name targets carry different actual workbook values");
  await saveCopyByName(page, doubledSpaceName);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const zeroWidthName = "Plan\u200breview";
  await clickSavedCopyByLiteralName(page, singleSpaceName);
  await page.getByTestId("project-ready").waitFor();
  await editFirstCellForSavedCopy(page, "Whitespace identity zero-width value");
  const zeroWidthRows = await page.locator(".ts-grid tbody").innerText();
  assert.notEqual(zeroWidthRows, singleSpaceRows, "the zero-width saved-name target carries a distinct actual workbook value");
  await saveCopyByName(page, zeroWidthName);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const noWhitespaceName = "Planreview";
  await clickSavedCopyByLiteralName(page, "Viewport home probe");
  await page.getByTestId("project-ready").waitFor();
  await editFirstCellForSavedCopy(page, "No whitespace identity value");
  const noWhitespaceRows = await page.locator(".ts-grid tbody").innerText();
  assert.notEqual(noWhitespaceRows, zeroWidthRows,
    "the no-whitespace and zero-width saved-name targets carry distinct actual workbook values");
  await saveCopyByName(page, noWhitespaceName);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const whitespaceIdentity = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".ts-home-saved-action")];
    const read = (name) => {
      const button = buttons.find((candidate) => candidate.textContent === `Open saved ${name}`);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      const text = button.firstChild;
      const value = text?.textContent ?? "";
      const offset = value.indexOf(name) + "Plan".length;
      const rangeWidth = (count) => {
        const range = document.createRange();
        range.setStart(text, offset);
        range.setEnd(text, offset + count);
        return range.getBoundingClientRect().width;
      };
      const computed = getComputedStyle(button);
      return {
        text: value,
        whiteSpace: computed.whiteSpace,
        rect: { x: rect.x, right: rect.right, width: rect.width, height: rect.height },
        oneSpaceAdvance: rangeWidth(1),
        twoSpaceAdvance: rangeWidth(2),
      };
    };
    return {
      single: read("Plan review"),
      doubled: read("Plan  review"),
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  assert.ok(whitespaceIdentity.single && whitespaceIdentity.doubled, "Home renders both whitespace-distinct saved copies");
  assert.equal(whitespaceIdentity.single.text, "Open saved Plan review");
  assert.equal(whitespaceIdentity.doubled.text, "Open saved Plan  review");
  assert.equal(whitespaceIdentity.doubled.whiteSpace, "break-spaces");
  assert.ok(whitespaceIdentity.doubled.twoSpaceAdvance >= whitespaceIdentity.doubled.oneSpaceAdvance * 1.75,
    "two contained name spaces retain two rendered character advances", whitespaceIdentity);
  assert.ok(whitespaceIdentity.single.rect.x >= 0 && whitespaceIdentity.doubled.rect.right <= whitespaceIdentity.viewportWidth &&
    whitespaceIdentity.pageWidth <= whitespaceIdentity.viewportWidth,
  "whitespace-distinct saved names stay contained on Home", whitespaceIdentity);
  const singleSpaceAX = await savedCopyAccessibilityNode(page, "Open saved Plan review");
  const doubledSpaceAX = await savedCopyAccessibilityNode(page, "Open saved Plan  review");
  const noWhitespaceAX = await savedCopyAccessibilityNode(page, `Open saved ${noWhitespaceName}`);
  const zeroWidthAX = await savedCopyAccessibilityNode(page, `Open saved ${zeroWidthName}`);
  assert.equal(singleSpaceAX.role, "button");
  assert.equal(doubledSpaceAX.role, "button");
  assert.equal(singleSpaceAX.name, "Open saved Plan review");
  assert.equal(doubledSpaceAX.name, "Open saved Plan review",
    "the original accessible action name remains unchanged; the supplementary description distinguishes collapsed whitespace");
  assert.ok(!singleSpaceAX.description, "ordinary single ASCII spaces add no accessible description");
  assert.equal(doubledSpaceAX.description, "Name contains 2 consecutive spaces starting at character 5.");
  assert.equal(zeroWidthAX.role, "button");
  assert.equal(noWhitespaceAX.name, "Open saved Planreview");
  assert.ok(!noWhitespaceAX.description,
    "the visually indistinguishable name without U+200B has no supplementary description");
  assert.equal(zeroWidthAX.description,
    "Name contains a zero-width space (U+200B, format character) at character 5.");
  assert.ok(!zeroWidthAX.description.includes("\u200b"), "the supplementary description never emits the raw zero-width character");
  observations.push({ homeSavedWhitespaceIdentity: whitespaceIdentity, singleSpaceAX, doubledSpaceAX,
    noWhitespaceAX, zeroWidthAX, singleSpaceRows, doubledSpaceRows, noWhitespaceRows, zeroWidthRows });

  await clickSavedCopyByLiteralName(page, singleSpaceName);
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), singleSpaceRows,
    "opening the single-space saved name targets its exact stored workbook");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await clickSavedCopyByLiteralName(page, doubledSpaceName);
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), doubledSpaceRows,
    "opening the double-space saved name targets its different exact stored workbook");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await clickSavedCopyByLiteralName(page, zeroWidthName);
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), zeroWidthRows,
    "opening the zero-width saved name targets its exact distinct stored workbook");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await clickSavedCopyByLiteralName(page, noWhitespaceName);
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), noWhitespaceRows,
    "opening the no-whitespace saved name targets its exact distinct stored workbook");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  const emojiName = "Emoji 👩‍💻 ✈️";
  await clickSavedCopyByLiteralName(page, "Viewport home probe");
  await page.getByTestId("project-ready").waitFor();
  await editFirstCellForSavedCopy(page, "Joined emoji identity value");
  const emojiRows = await page.locator(".ts-grid tbody").innerText();
  await saveCopyByName(page, emojiName);
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
  await clickSavedCopyByLiteralName(page, emojiName);
  await page.getByTestId("project-ready").waitFor();
  assert.equal(await page.locator(".ts-grid tbody").innerText(), emojiRows,
    "the joined emoji and variation-selector name remains the exact reopen target");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();

  for (const profile of profiles) {
    for (const density of densities) {
      await choose(page, profile.id, density.id);
      await page.keyboard.press("Escape");
      for (const [width, height] of [[1512, 982], [768, 640], [600, 640], [320, 640]]) {
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
        pageSurface: getComputedStyle(app).backgroundColor,
        openActionsWidth: document.querySelector(".ts-home-open-actions")?.getBoundingClientRect().width ?? null,
        openActions: [...document.querySelectorAll(".ts-home-open-actions > .ts-home-file-action, .ts-home-open-actions > button")].map((action) => {
          const rect = action.getBoundingClientRect();
          return { label: action.textContent.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
        importAction: (() => {
          const rect = document.querySelector(".ts-home-import-action")?.getBoundingClientRect();
          return rect ? { x: rect.x, y: rect.y, width: rect.width } : null;
        })(),
        sectionLines: [...document.querySelectorAll(".ts-home > .ts-home-section")].map((section) => ({
          label: section.getAttribute("aria-label"),
          top: section.getBoundingClientRect().top,
          bottom: section.getBoundingClientRect().bottom,
        })),
        savedAction: (() => {
          const action = document.querySelector(".ts-copy-item .ts-button");
          const rect = action?.getBoundingClientRect();
          return rect ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            borderColor: getComputedStyle(action).borderTopColor,
          } : null;
        })(),
        savedMetadataX: document.querySelector(".ts-copy-meta")?.getBoundingClientRect().x ?? null,
        savedRows: [...document.querySelectorAll(".ts-copy-item")].map((row) => {
          const rowRect = row.getBoundingClientRect();
          const action = row.querySelector(".ts-button");
          const actionRect = action?.getBoundingClientRect();
          const metadataRect = row.querySelector(".ts-copy-meta")?.getBoundingClientRect();
          return {
            name: action?.textContent?.trim() ?? null,
            row: { x: rowRect.x, y: rowRect.y, width: rowRect.width, height: rowRect.height, right: rowRect.right, bottom: rowRect.bottom },
            action: actionRect ? { x: actionRect.x, y: actionRect.y, width: actionRect.width, height: actionRect.height, right: actionRect.right, bottom: actionRect.bottom } : null,
            metadata: metadataRect ? { x: metadataRect.x, y: metadataRect.y, width: metadataRect.width, height: metadataRect.height, right: metadataRect.right, bottom: metadataRect.bottom } : null,
          };
        }),
        strongBorderColor: (() => {
          const probe = document.createElement("span");
          probe.style.borderTop = "1px solid var(--ts-line-strong)";
          document.body.append(probe);
          const color = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return color;
        })(),
      };
    });
    evidence(layout.pageWidth <= width, `${width}x${height} Home with a saved copy has no horizontal overflow`, layout);
    evidence(layout.pageHeight >= height, `${width}x${height} Home retains natural document height`, layout);
    evidence(layout.rootHeight >= layout.appHeight && layout.rootMinHeightStyle !== "0px",
      `${width}x${height} Home root expands with its content`, layout);
    if (width === 1512 && profile.id === "tachiko" && density.id === "compact") {
      assert.equal(layout.pageSurface, "rgb(255, 255, 255)", "Tachiko Home uses its approved white app surface");
      assert.deepEqual(layout.openActions.map(({ x, y, width: actionWidth }) => [x, y, actionWidth]), [
        [32, 220, 184], [228, 220, 128], [368, 220, 224],
      ], "desktop Open actions match the approved positions and widths");
      assert.deepEqual(layout.sectionLines.map(({ top }) => top), [144, 344, 552]);
      assert.deepEqual(layout.importAction && [layout.importAction.x, layout.importAction.y, layout.importAction.width], [32, 468, 196]);
      assert.deepEqual(layout.savedAction && [layout.savedAction.x, layout.savedAction.y, layout.savedAction.width], [32, 684, 288]);
      assert.equal(layout.savedAction?.borderColor, "rgba(0, 0, 0, 0)",
        "the saved-copy ghost action keeps its approved transparent border");
      assert.equal(layout.savedMetadataX, 352);
    }
    if (width === 320) {
      assert.ok(layout.openActions.every(({ width }) => width === layout.openActionsWidth),
        "all three Open actions use the full available width at 320px");
      assert.equal(layout.savedAction?.x, 16);
      assert.equal(layout.savedAction?.width, layout.openActionsWidth,
        "the 320px saved-copy action uses the full available width");
      if (density.id === "comfortable") {
        assert.ok(layout.openActions.every(({ height }) => height >= 36),
          "Comfortable density keeps all three 320px Open actions at least 36px tall");
        assert.ok(layout.savedAction.height >= 36,
          "the 320px saved-copy action retains the Comfortable target height");
      }
      assert.equal(layout.savedAction?.borderColor, layout.strongBorderColor,
        "the 320px saved-copy action uses the profile's shared secondary border");
    }
    for (const [index, saved] of layout.savedRows.entries()) {
      assert.ok(saved.action && saved.metadata, "every accepted saved name and timestamp has a visible Home box");
      assert.ok(saved.action.x >= 0 && saved.action.right <= width + 1 && saved.metadata.x >= 0 && saved.metadata.right <= width + 1,
        `${width}px ${profile.id}/${density.id} saved name and timestamp stay inside the viewport`, saved);
      if (width >= 600) {
        assert.ok(saved.metadata.x >= saved.action.right + 31,
          `${width}px ${profile.id}/${density.id} desktop metadata keeps the 32px gap`, saved);
      } else {
        assert.ok(saved.metadata.y >= saved.action.bottom + 3,
          `${width}px ${profile.id}/${density.id} compact metadata sits below the saved action`, saved);
      }
      if (index > 0) assert.ok(layout.savedRows[index - 1].row.bottom <= saved.row.y + 1,
        `${width}px ${profile.id}/${density.id} saved rows do not overlap`);
    }
    if (layout.appBottom !== null && layout.noticesTop !== null) {
      evidence(layout.noticesTop >= layout.appBottom - 1 && layout.noticesBottom <= layout.pageHeight + 1,
        `${width}x${height} legal notices follow Home content without overlap or clipping`, layout);
    }
    const savedCopy = page.getByRole("button", { name: `Open saved ${unbrokenName}`, exact: true });
    await savedCopy.scrollIntoViewIfNeeded();
    const homeHeld = await sampleButtonStates(page, savedCopy,
      `${width}x${height} ${profile.id}/${density.id} Home saved-copy command`);
    if (width < 600) {
      const sharedSunken = await page.evaluate(() => {
        const probe = document.createElement("button");
        probe.className = "ts-button";
        probe.style.background = "var(--ts-surface-sunken)";
        document.querySelector(".ts-home").append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      assert.equal(homeHeld.hover.background, sharedSunken,
        `${width}px ${profile.id}/${density.id} saved-copy hover uses the shared sunken surface`);
    }
    const copyRect = await savedCopy.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
    });
    evidence(copyRect.top >= 0 && copyRect.bottom <= height,
      `${width}x${height} saved copy action can be reached by scrolling Home`, { ...layout, copyRect });
        observations.push({ homeViewport: `${width}x${height} ${profile.id}/${density.id}`, ...layout, copyRect, heldControl: homeHeld });
      }
    }
  }
  await choose(page, "tachiko", "compact");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ forcedColors: "active" });
  const systemPaint = await page.evaluate(() => {
    const reference = document.createElement("button");
    reference.className = "ts-button";
    document.querySelector(".ts-home").append(reference);
    const expected = getComputedStyle(reference);
    const action = document.querySelector(".ts-home-saved-action");
    const actual = getComputedStyle(action);
    const result = {
      expected: { color: expected.color, background: expected.backgroundColor, border: expected.borderTopColor },
      actual: { color: actual.color, background: actual.backgroundColor, border: actual.borderTopColor },
    };
    reference.remove();
    return result;
  });
  assert.deepEqual(systemPaint.actual, systemPaint.expected,
    "the saved action uses shared system foreground, surface and border roles in forced colors");
  await page.emulateMedia({ forcedColors: "none" });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 450 });
  await page.evaluate(() => window.__tachikoAcceptance.loseNextOpenReply());
  await page.getByRole("button", { name: "Try sales example", exact: true }).click();
  await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
  assert.equal(await page.getByTestId("open-project").isDisabled(), true,
    "a real unknown-open recovery state disables the folder input");
  assert.equal(await page.locator(".ts-home-file-action").first().getAttribute("aria-disabled"), "true",
    "a real unknown-open recovery state exposes the folder label as unavailable");
  assert.equal(await page.getByRole("button", { name: `Open saved ${unbrokenName}`, exact: true }).isDisabled(), true,
    "a real unknown-open recovery state disables the saved-copy action");
  const recoveryAppearance = page.getByRole("button", { name: "Appearance", exact: true });
  if (await recoveryAppearance.isVisible()) {
    await recoveryAppearance.click();
    await waitForAppearancePanelToSettle(page);
    const recoveryPanel = await page.evaluate(() => {
      const panel = document.querySelector(".ts-home .ts-appearance-popover");
      const rect = panel.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth };
    });
    evidence(recoveryPanel.x >= 0 && recoveryPanel.right <= 320 && recoveryPanel.y >= 0 && recoveryPanel.bottom <= 450 && recoveryPanel.pageWidth <= 320,
      "actual unknown-open Recovery keeps the Appearance panel within the compact viewport", recoveryPanel);
    observations.push({ unknownOpenRecoveryAppearance: recoveryPanel });
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Close and abandon recovery", exact: true }).click();
  await page.locator('.ts-app[data-view="home"]').waitFor();
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

async function sampleButtonStates(page, button, tag, captureName = null) {
  await page.mouse.move(1, 1);
  const read = () => button.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderTopColor,
    foreground: getComputedStyle(element).color,
    active: element.matches(":active"),
    held: element.hasAttribute("data-ts-held"),
    contour: (() => {
      const target = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const mark = getComputedStyle(element, "::after");
      const text = document.createRange();
      text.selectNodeContents(element);
      const content = text.getBoundingClientRect();
      return {
        content: mark.content,
        insetTop: mark.top,
        insetRight: mark.right,
        insetBottom: mark.bottom,
        insetLeft: mark.left,
        borderTop: mark.borderTopWidth,
        borderLeft: mark.borderLeftWidth,
        borderColor: mark.borderTopColor,
        radius: mark.borderTopLeftRadius,
        targetRadius: style.borderTopLeftRadius,
        targetWidth: target.width,
        targetHeight: target.height,
        outerTop: Number.parseFloat(style.borderTopWidth) + Number.parseFloat(mark.top),
        outerLeft: Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(mark.left),
        contourWidth: target.width - 2 * (Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(mark.left)),
        contourHeight: target.height - 2 * (Number.parseFloat(style.borderTopWidth) + Number.parseFloat(mark.top)),
        contentTopClearance: content.top - target.top - 4,
        contentLeftClearance: content.left - target.left - 4,
      };
    })(),
  }));
  const rest = await read();
  await button.hover();
  const hover = await read();
  const bounds = await button.boundingBox();
  assert.ok(bounds, `${tag} button has a rendered box`);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  const pressed = await read();
  if (captureName) await captureHeldControl(page, captureName);
  evidence(pressed.active, `${tag} sample reaches the real pressed state`, pressed);
  evidence(pressed.held && pressed.contour.content === '""' && pressed.contour.insetTop === "1px" &&
    pressed.contour.insetRight === "1px" && pressed.contour.insetBottom === "1px" && pressed.contour.insetLeft === "1px" &&
    pressed.contour.borderTop === "2px" && pressed.contour.borderColor === pressed.foreground,
  `${tag} held input paints a 2px contour in the control foreground`, pressed);
  evidence(pressed.contour.outerTop === 2 && pressed.contour.outerLeft === 2 &&
    pressed.contour.contourWidth === pressed.contour.targetWidth - 4 &&
    pressed.contour.contourHeight === pressed.contour.targetHeight - 4,
  `${tag} contour outer edge is 2px in with target size minus 4px`, pressed.contour);
  evidence(pressed.contour.contentTopClearance >= 2 && pressed.contour.contentLeftClearance >= 2,
    `${tag} keeps at least 2px between text and the inner contour edge`, pressed.contour);
  evidence(pressed.contour.targetWidth === hover.contour.targetWidth && pressed.contour.targetHeight === hover.contour.targetHeight,
    `${tag} held input keeps target geometry fixed`, { hover: hover.contour, pressed: pressed.contour });
  // Release outside the button so this state probe does not invoke its command.
  await page.mouse.move(1, 1);
  const outside = await read();
  evidence(!outside.held, `${tag} pointer exit clears the held cue before pointer release`, outside);
  await page.mouse.up();
  return { rest, hover, pressed, pointerExit: outside };
}

async function auditPointerHeldLifecycle(page, tag) {
  const button = page.locator(".ts-workbook-head .ts-appearance-trigger");
  const unrelated = page.getByRole("button", { name: "Save a copy", exact: true });
  await button.evaluate((element) => {
    element.dataset.pointerClicks = "0";
    element.dataset.pointerTrace = "[]";
    for (const type of ["pointerdown", "pointerout", "pointerover", "pointerup", "click"]) {
      element.addEventListener(type, (event) => {
        element.dataset.pointerTrace = JSON.stringify([
          ...JSON.parse(element.dataset.pointerTrace),
          { type, pointerId: event.pointerId ?? null, buttons: event.buttons ?? null, held: element.hasAttribute("data-ts-held") },
        ]);
        if (type === "click") element.dataset.pointerClicks = String(Number(element.dataset.pointerClicks) + 1);
      });
    }
  });
  const bounds = await button.boundingBox();
  assert.ok(bounds, `${tag} real Appearance control has pointer bounds`);
  const buttonPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const clickCount = () => button.evaluate((element) => Number(element.dataset.pointerClicks));
  const read = (locator) => locator.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    contour: getComputedStyle(element, "::after").borderTopWidth,
    active: element.matches(":active"),
  }));

  await page.mouse.move(buttonPoint.x, buttonPoint.y);
  await page.mouse.down();
  const down = await read(button);
  await page.mouse.move(1, 1);
  const exited = await read(button);
  const unrelatedBounds = await unrelated.boundingBox();
  assert.ok(unrelatedBounds, `${tag} unrelated Save a copy control has pointer bounds`);
  await page.mouse.move(unrelatedBounds.x + unrelatedBounds.width / 2, unrelatedBounds.y + unrelatedBounds.height / 2);
  const unrelatedDuringOriginHold = await read(unrelated);
  const originStillHiddenOverUnrelated = await read(button);
  await page.mouse.move(buttonPoint.x, buttonPoint.y);
  const reentered = await read(button);
  evidence(down.held && down.active && down.contour === "2px", `${tag} primary pointerdown paints on its originating control`, down);
  evidence(!exited.held && unrelatedDuringOriginHold.held === false && !originStillHiddenOverUnrelated.held,
    `${tag} pointer exit hides the origin cue and never transfers it to another button`, { exited, unrelatedDuringOriginHold, originStillHiddenOverUnrelated });
  evidence(reentered.held && reentered.active && reentered.contour === "2px",
    `${tag} same primary pointer re-entry restores the cue on its original control`, reentered);
  if (tag === "shared control tachiko") await captureHeldControl(page, "pointer-reentry.png");
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".ts-workbook-head .ts-appearance-trigger")?.getAttribute("aria-expanded") === "true");
  const reentryActivation = await button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    clicks: Number(element.dataset.pointerClicks),
    trace: JSON.parse(element.dataset.pointerTrace),
    expanded: element.getAttribute("aria-expanded"),
  }));
  evidence(!reentryActivation.held && reentryActivation.clicks === 1 && reentryActivation.expanded === "true" &&
    reentryActivation.trace.filter((event) => event.type === "click").length === 1 &&
    reentryActivation.trace.find((event) => event.type === "click")?.held === false,
  `${tag} re-entry release clears the contour at exactly one native click`, reentryActivation);
  await page.keyboard.press("Escape");

  await page.mouse.move(buttonPoint.x, buttonPoint.y);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  const releasedOutside = await read(button);
  await page.mouse.up();
  const clicksAfterOutsideRelease = await clickCount();
  await page.mouse.move(buttonPoint.x, buttonPoint.y);
  const afterTerminationReentry = await read(button);
  const clicksAfterTerminationReentry = await clickCount();
  evidence(!releasedOutside.held && !afterTerminationReentry.held && clicksAfterOutsideRelease === 1 && clicksAfterTerminationReentry === 1,
    `${tag} release outside permanently ends ownership and prevents cue resurrection or activation`,
    { releasedOutside, afterTerminationReentry, clicksAfterOutsideRelease, clicksAfterTerminationReentry });
  await page.mouse.move(1, 1);
  observations.push({ pointerHeldLifecycle: tag, down, exited, unrelatedDuringOriginHold, originStillHiddenOverUnrelated,
    reentered, reentryActivation, releasedOutside, afterTerminationReentry, clicksAfterOutsideRelease, clicksAfterTerminationReentry });
}

async function auditKeyboardHeldControl(page, tag) {
  const button = page.locator(".ts-workbook-head .ts-appearance-trigger");
  await button.evaluate((element) => {
    element.dataset.keyboardClicks = "0";
    element.dataset.keyboardTrace = "[]";
    element.addEventListener("keydown", (event) => {
      element.dataset.keyboardTrace = JSON.stringify([
        ...JSON.parse(element.dataset.keyboardTrace),
        { type: "keydown", key: event.key, repeat: event.repeat, defaultPrevented: event.defaultPrevented, held: element.hasAttribute("data-ts-held") },
      ]);
    });
    element.addEventListener("keyup", (event) => {
      element.dataset.keyboardTrace = JSON.stringify([
        ...JSON.parse(element.dataset.keyboardTrace),
        { type: "keyup", key: event.key, defaultPrevented: event.defaultPrevented, held: element.hasAttribute("data-ts-held") },
      ]);
    });
    element.addEventListener("click", () => {
      element.dataset.keyboardClicks = String(Number(element.dataset.keyboardClicks) + 1);
      element.dataset.heldAtClick = String(element.hasAttribute("data-ts-held"));
      element.dataset.keyboardTrace = JSON.stringify([
        ...JSON.parse(element.dataset.keyboardTrace),
        { type: "click", held: element.hasAttribute("data-ts-held") },
      ]);
    });
  });
  const methodsBefore = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  await button.focus();
  await page.keyboard.down("Space");
  const spaceHeld = await button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    contour: getComputedStyle(element, "::after").borderTopWidth,
    focus: element.matches(":focus-visible"),
    focusOutline: getComputedStyle(element).outlineWidth,
    focusOffset: getComputedStyle(element).outlineOffset,
    pressedSemantics: element.getAttribute("aria-pressed"),
  }));
  evidence(spaceHeld.held && spaceHeld.contour === "2px" && spaceHeld.focus &&
    spaceHeld.focusOutline === "3px" && spaceHeld.focusOffset === "2px" && spaceHeld.pressedSemantics === null,
  `${tag} real Appearance control shows Space-held contour beside focus ring`, spaceHeld);
  if (tag === "shared control tachiko") await captureHeldControl(page, "ordinary-keyboard-space.png");
  await page.keyboard.up("Space");
  await page.waitForFunction(() => document.querySelector(".ts-workbook-head .ts-appearance-trigger")?.getAttribute("aria-expanded") === "true");
  const spaceReleased = await button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    clicks: Number(element.dataset.keyboardClicks),
    heldAtClick: element.dataset.heldAtClick,
    expanded: element.getAttribute("aria-expanded"),
  }));
  evidence(!spaceReleased.held && spaceReleased.clicks === 1 && spaceReleased.heldAtClick === "false" && spaceReleased.expanded === "true",
    `${tag} Space release clears the cue and preserves one native Appearance activation`, spaceReleased);
  await page.keyboard.press("Escape");

  await button.focus();
  await page.keyboard.down("Enter");
  const enterAfterActivation = await button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    clicks: Number(element.dataset.keyboardClicks),
    heldAtClick: element.dataset.heldAtClick,
    trace: JSON.parse(element.dataset.keyboardTrace),
    expanded: element.getAttribute("aria-expanded"),
  }));
  evidence(!enterAfterActivation.held && enterAfterActivation.clicks === 2 && enterAfterActivation.heldAtClick === "false" &&
    enterAfterActivation.expanded === "true",
  `${tag} Enter uses one immediate native activation and clears the cue at click`, enterAfterActivation);
  evidence(enterAfterActivation.trace.some((entry) => entry.type === "keydown" && entry.held) &&
    enterAfterActivation.trace.some((entry) => entry.type === "click" && !entry.held),
  `${tag} Enter held state precedes its native click cleanup`, enterAfterActivation.trace);
  await page.keyboard.up("Enter");
  await page.waitForFunction(() => document.querySelector(".ts-workbook-head .ts-appearance-trigger")?.getAttribute("aria-expanded") === "true");
  await page.keyboard.press("Escape");

  const clicksBeforeSpaceEscape = await button.evaluate((element) => Number(element.dataset.keyboardClicks));
  const traceBeforeSpaceEscape = await button.evaluate((element) => JSON.parse(element.dataset.keyboardTrace).length);
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const spaceEscapeArmed = await button.evaluate((element, traceStart) => ({
    held: element.hasAttribute("data-ts-held"),
    clicks: Number(element.dataset.keyboardClicks),
    contour: getComputedStyle(element, "::after").borderTopWidth,
    trace: JSON.parse(element.dataset.keyboardTrace).slice(traceStart),
  }), traceBeforeSpaceEscape);
  evidence(spaceEscapeArmed.held && spaceEscapeArmed.contour === "2px" && spaceEscapeArmed.clicks === clicksBeforeSpaceEscape,
    `${tag} Space-held cue remains through Escape down/up until native keyup`, spaceEscapeArmed);
  evidence(spaceEscapeArmed.trace.some((entry) => entry.type === "keydown" && entry.key === "Escape" && entry.held) &&
    spaceEscapeArmed.trace.some((entry) => entry.type === "keyup" && entry.key === "Escape" && entry.held),
  `${tag} both actual Escape key events observe the still-armed Space cue`, spaceEscapeArmed.trace);
  if (tag === "shared control tachiko") await captureHeldControl(page, "space-escape-armed.png");
  await page.keyboard.up("Space");
  await page.waitForFunction(() => document.querySelector(".ts-workbook-head .ts-appearance-trigger")?.getAttribute("aria-expanded") === "true");
  const spaceEscapeReleased = await button.evaluate((element, traceStart) => ({
    held: element.hasAttribute("data-ts-held"),
    clicks: Number(element.dataset.keyboardClicks),
    heldAtClick: element.dataset.heldAtClick,
    expanded: element.getAttribute("aria-expanded"),
    trace: JSON.parse(element.dataset.keyboardTrace).slice(traceStart),
  }), traceBeforeSpaceEscape);
  evidence(!spaceEscapeReleased.held && spaceEscapeReleased.clicks === clicksBeforeSpaceEscape + 1 &&
    spaceEscapeReleased.heldAtClick === "false" && spaceEscapeReleased.expanded === "true",
  `${tag} Space keyup after Escape produces exactly one native activation and clears the cue`, spaceEscapeReleased);
  evidence(spaceEscapeReleased.trace.some((entry) => entry.type === "keyup" && entry.key === " " && !entry.held) &&
    spaceEscapeReleased.trace.some((entry) => entry.type === "click" && !entry.held),
  `${tag} native Space keyup clears the cue before its single click`, spaceEscapeReleased.trace);
  await page.keyboard.press("Escape");

  const clicksBeforeFocusLoss = await button.evaluate((element) => Number(element.dataset.keyboardClicks));
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Tab");
  const focusLoss = await button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    focused: document.activeElement === element,
    clicks: Number(element.dataset.keyboardClicks),
  }));
  evidence(!focusLoss.held && !focusLoss.focused && focusLoss.clicks === clicksBeforeFocusLoss,
    `${tag} actual keyboard focus transfer clears held input without activating`, focusLoss);
  await page.keyboard.up("Tab");
  await page.keyboard.up("Space");

  const pointerCancellation = await button.evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, pointerId: 4, isPrimary: true }));
    const heldBeforeCancel = element.hasAttribute("data-ts-held");
    element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, button: 0, buttons: 0, pointerId: 4, isPrimary: true }));
    return { heldBeforeCancel, heldAfterCancel: element.hasAttribute("data-ts-held") };
  });
  evidence(pointerCancellation.heldBeforeCancel && !pointerCancellation.heldAfterCancel,
    `${tag} supplemental synthetic pointercancel clears its matching pointer ownership`, pointerCancellation);

  const busyGuard = await button.evaluate((element) => {
    element.setAttribute("aria-busy", "true");
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    const held = element.hasAttribute("data-ts-held");
    element.removeAttribute("aria-busy");
    return held;
  });
  evidence(!busyGuard, `${tag} supplemental synthetic aria-busy guard does not set held state`, null);

  const methodsAfter = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  evidence(JSON.stringify(methodsAfter) === JSON.stringify(methodsBefore), `${tag} local appearance activation dispatches no Work method`, { methodsBefore, methodsAfter });
  observations.push({ buttonHeldInput: tag, spaceHeld, spaceRelease: spaceReleased, enterActivation: enterAfterActivation,
    spaceEscapeArmed, spaceEscapeRelease: spaceEscapeReleased, focusLoss, pointerCancellation, supplementalBusyGuard: busyGuard,
    methodsBefore, methodsAfter });
  await page.keyboard.press("Escape");
}

async function auditDismissedSpaceGesture(page, tag) {
  const button = page.locator(".ts-workbook-head .ts-appearance-trigger");
  const methodsBefore = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  await button.evaluate((element) => {
    element.dataset.dismissalClicks = "0";
    element.dataset.dismissalTrace = "[]";
    for (const type of ["keydown", "keyup", "click"]) {
      element.addEventListener(type, (event) => {
        const trace = JSON.parse(element.dataset.dismissalTrace);
        trace.push({
          type,
          key: event.key ?? null,
          repeat: event.repeat ?? false,
          defaultPrevented: event.defaultPrevented ?? false,
          held: element.hasAttribute("data-ts-held"),
          expanded: element.getAttribute("aria-expanded"),
        });
        element.dataset.dismissalTrace = JSON.stringify(trace);
        if (type === "click") element.dataset.dismissalClicks = String(Number(element.dataset.dismissalClicks) + 1);
      });
    }
  });
  const read = () => button.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    expanded: element.getAttribute("aria-expanded"),
    clicks: Number(element.dataset.dismissalClicks),
    focused: document.activeElement === element,
    trace: JSON.parse(element.dataset.dismissalTrace),
  }));

  await button.click();
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const dismissedTrigger = await read();
  evidence(dismissedTrigger.expanded === "false" && !dismissedTrigger.held && dismissedTrigger.focused && dismissedTrigger.clicks === 1,
    tag + " accepted Escape dismissal of an expanded focused trigger clears cue, returns focus, and adds no click", dismissedTrigger);
  if (tag === "shared control tachiko") await captureHeldControl(page, "dismissed-space-trigger.png");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  const repeated = await read();
  evidence(repeated.expanded === "false" && !repeated.held &&
    repeated.trace.filter((event) => event.type === "keydown" && event.key === " " && event.repeat && event.defaultPrevented).length >= 2,
    tag + " actual repeated Space keydowns stay canceled at the restored trigger", repeated);
  if (tag === "shared control tachiko") await captureHeldControl(page, "dismissed-space-repeats.png");
  await page.keyboard.up("Space");
  const released = await read();
  evidence(released.expanded === "false" && !released.held && released.clicks === 1 &&
    released.trace.some((event) => event.type === "keyup" && event.key === " " && event.defaultPrevented),
    tag + " canceled trigger keyup clears bookkeeping with no native click", released);
  await page.keyboard.press("Space");
  const fresh = await read();
  evidence(fresh.expanded === "true" && fresh.clicks === 2,
    tag + " next fresh Space gesture opens once after cancellation cleanup", fresh);
  await page.keyboard.press("Escape");

  await button.click();
  await button.focus();
  await page.keyboard.down("Space");
  if (tag === "shared control tachiko") await captureHeldControl(page, "space-held-before-pointer-dismissal.png");
  const clicksBeforePointerDismissal = (await read()).clicks;
  await button.click();
  const pointerDismissal = await read();
  evidence(pointerDismissal.expanded === "false" && !pointerDismissal.held && pointerDismissal.focused &&
    pointerDismissal.clicks === clicksBeforePointerDismissal + 1,
  tag + " pointer click on expanded trigger dismisses while Space is held and clears cue", pointerDismissal);
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  const pointerDismissalRepeats = await read();
  await page.keyboard.up("Space");
  const pointerDismissalRelease = await read();
  evidence(pointerDismissalRepeats.expanded === "false" && !pointerDismissalRepeats.held &&
    pointerDismissalRepeats.trace.filter((event) => event.type === "keydown" && event.key === " " && event.repeat && event.defaultPrevented).length >= 1 &&
    pointerDismissalRelease.expanded === "false" && !pointerDismissalRelease.held &&
    pointerDismissalRelease.clicks === clicksBeforePointerDismissal + 1,
  tag + " pointer-dismissed Space repeats and release cannot resurrect or click trigger", { pointerDismissalRepeats, pointerDismissalRelease });
  await page.keyboard.press("Space");
  const afterPointerDismissalFresh = await read();
  evidence(afterPointerDismissalFresh.expanded === "true" && afterPointerDismissalFresh.clicks === clicksBeforePointerDismissal + 2,
    tag + " fresh Space press opens once after pointer dismissal cleanup", afterPointerDismissalFresh);
  await page.keyboard.press("Escape");

  await button.click();
  const clicksBeforeInteriorDismissal = (await read()).clicks;
  const closeButton = page.getByRole("button", { name: "Close", exact: true });
  await closeButton.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const interiorDismissal = await read();
  evidence(interiorDismissal.expanded === "false" && !interiorDismissal.held && interiorDismissal.focused && interiorDismissal.clicks === clicksBeforeInteriorDismissal,
    tag + " actual Escape dismissal from the interior control cancels its Space press", interiorDismissal);
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  const interiorRelease = await read();
  evidence(interiorRelease.expanded === "false" && interiorRelease.clicks === clicksBeforeInteriorDismissal,
    tag + " interior-dismissed Space release does not reactivate the trigger", interiorRelease);
  await page.keyboard.press("Space");
  const afterInteriorFresh = await read();
  evidence(afterInteriorFresh.expanded === "true" && afterInteriorFresh.clicks === clicksBeforeInteriorDismissal + 1,
    tag + " fresh Space after interior dismissal activates once", afterInteriorFresh);
  await page.keyboard.press("Escape");

  await button.click();
  const clicksBeforeTabTest = (await read()).clicks;
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const tabReturned = await read();
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  const tabReleased = await read();
  evidence(tabReturned.focused && tabReleased.expanded === "false" && tabReleased.clicks === clicksBeforeTabTest,
    tag + " Tab away/back during a canceled Space press cannot re-arm it", { tabReturned, tabReleased });
  await page.keyboard.press("Space");
  const tabFresh = await read();
  evidence(tabFresh.expanded === "true" && tabFresh.clicks === clicksBeforeTabTest + 1,
    tag + " fresh activation works after Tab-return cancellation release", tabFresh);
  await page.keyboard.press("Escape");

  await button.click();
  const clicksBeforeElsewhereTest = (await read()).clicks;
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const saveButton = page.getByRole("button", { name: "Save a copy", exact: true });
  await saveButton.focus();
  await page.keyboard.up("Space");
  const keyupElsewhere = await read();
  evidence(keyupElsewhere.expanded === "false" && keyupElsewhere.clicks === clicksBeforeElsewhereTest && !keyupElsewhere.held,
    tag + " canceled Space keyup anywhere clears ownership without activation", keyupElsewhere);
  await button.focus();
  await page.keyboard.press("Space");
  const afterElsewhereFresh = await read();
  evidence(afterElsewhereFresh.expanded === "true" && afterElsewhereFresh.clicks === clicksBeforeElsewhereTest + 1,
    tag + " fresh activation works after keyup elsewhere", afterElsewhereFresh);
  await page.keyboard.press("Escape");

  await button.click();
  const clicksBeforeWindowBlur = (await read()).clicks;
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const windowEventsBefore = await page.evaluate(() => {
    window.__appearanceWindowEvents = [];
    window.addEventListener("blur", () => window.__appearanceWindowEvents.push("blur"));
    window.addEventListener("focus", () => window.__appearanceWindowEvents.push("focus"));
    return window.__appearanceWindowEvents.length;
  });
  const backgroundPage = await page.context().newPage();
  await backgroundPage.bringToFront();
  await page.bringToFront();
  const syntheticWindowFocusEvents = await page.evaluate(() => ({
    blurDispatched: window.dispatchEvent(new Event("blur")),
    focusDispatched: window.dispatchEvent(new Event("focus")),
  }));
  const windowEventsAfter = await page.evaluate(() => [...window.__appearanceWindowEvents]);
  await page.keyboard.down("Space");
  const afterWindowBlurRepeat = await read();
  await page.keyboard.up("Space");
  const afterWindowBlurRelease = await read();
  evidence(syntheticWindowFocusEvents.blurDispatched && syntheticWindowFocusEvents.focusDispatched &&
    windowEventsAfter.includes("blur") && windowEventsAfter.includes("focus") &&
    afterWindowBlurRepeat.expanded === "false" &&
    afterWindowBlurRepeat.trace.some((event) => event.type === "keydown" && event.key === " " && event.repeat && event.defaultPrevented),
  tag + " supplemental window blur/focus events preserve canceled Space and prevent its repeat", {
    classification: "browser page switching did not emit DOM window blur/focus in this headless run; dispatched events directly to exercise product handlers",
    syntheticWindowFocusEvents, windowEventsBefore, windowEventsAfter, afterWindowBlurRepeat,
  });
  evidence(afterWindowBlurRelease.expanded === "false" && afterWindowBlurRelease.clicks === clicksBeforeWindowBlur,
    tag + " actual post-blur release does not reactivate Appearance", afterWindowBlurRelease);
  await backgroundPage.close();
  await page.keyboard.press("Space");
  const afterBlurFresh = await read();
  evidence(afterBlurFresh.expanded === "true" && afterBlurFresh.clicks === clicksBeforeWindowBlur + 1,
    tag + " fresh Space activates once after window-blur cancellation cleanup", afterBlurFresh);
  await page.keyboard.press("Escape");

  await button.click();
  const clicksBeforeMissedRelease = (await read()).clicks;
  await button.focus();
  await page.keyboard.down("Space");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  const missedReleaseBackground = await page.context().newPage();
  await missedReleaseBackground.bringToFront();
  await page.bringToFront();
  const supplementalRecovery = await button.evaluate((element) => {
    const down = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, repeat: false });
    const downDispatched = element.dispatchEvent(down);
    const downPrevented = down.defaultPrevented;
    const up = new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true });
    const upDispatched = element.dispatchEvent(up);
    return {
      downDispatched,
      downPrevented,
      upDispatched,
      upPrevented: up.defaultPrevented,
      held: element.hasAttribute("data-ts-held"),
      expanded: element.getAttribute("aria-expanded"),
      clicks: Number(element.dataset.dismissalClicks),
    };
  });
  await page.keyboard.up("Space");
  await missedReleaseBackground.close();
  evidence(supplementalRecovery.downDispatched && !supplementalRecovery.downPrevented &&
    supplementalRecovery.upDispatched && !supplementalRecovery.upPrevented && !supplementalRecovery.held &&
    supplementalRecovery.expanded === "false" && supplementalRecovery.clicks === clicksBeforeMissedRelease,
  tag + " supplemental missed-keyup recovery accepts fresh nonrepeat Space and clears stale cancellation", {
    classification: "synthetic KeyboardEvent supplemental recovery probe; does not claim physical OS key-loss evidence",
    supplementalRecovery,
  });
  await page.keyboard.press("Space");
  const afterMissedReleaseFresh = await read();
  evidence(afterMissedReleaseFresh.expanded === "true" && afterMissedReleaseFresh.clicks === clicksBeforeMissedRelease + 1,
    tag + " actual fresh press activates once after missed-release recovery probe", afterMissedReleaseFresh);
  await page.keyboard.press("Escape");

  const methodsAfter = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  evidence(JSON.stringify(methodsAfter) === JSON.stringify(methodsBefore),
    tag + " dismissed and fresh Appearance keyboard gestures dispatch no Work method", { methodsBefore, methodsAfter });
  observations.push({ dismissedPhysicalSpaceGesture: tag, dismissedTrigger, repeated, released, fresh, interiorDismissal, interiorRelease,
    afterInteriorFresh, tabReturned, tabReleased, tabFresh, keyupElsewhere, afterElsewhereFresh,
    syntheticWindowFocusEvents, windowEventsAfter, afterWindowBlurRepeat, afterWindowBlurRelease, afterBlurFresh,
    pointerDismissal, pointerDismissalRepeats, pointerDismissalRelease, afterPointerDismissalFresh,
    missedReleaseRecovery: supplementalRecovery, afterMissedReleaseFresh, methodsBefore, methodsAfter });
}

async function auditAppearanceVariantKeyboard(page) {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(".ts-appearance-file-input").setInputFiles({
    name: "equal-colors.tachiko-profile.json",
    mimeType: "application/json",
    buffer: safeImportedManifestBytes,
  });
  const candidate = page.locator(".ts-appearance-candidate");
  await candidate.getByRole("button", { name: "Apply profile", exact: true }).waitFor();
  const apply = candidate.getByRole("button", { name: "Apply profile", exact: true });
  await apply.evaluate((element) => {
    window.__keyboardAuditEvents = [];
    element.addEventListener("keydown", () => window.__keyboardAuditEvents.push({ type: "keydown", held: element.hasAttribute("data-ts-held") }));
    element.addEventListener("click", () => window.__keyboardAuditEvents.push({ type: "click", held: element.hasAttribute("data-ts-held") }));
  });
  const methodsBefore = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());

  await apply.focus();
  await page.keyboard.down("Space");
  const primaryHeld = await apply.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    contour: getComputedStyle(element, "::after").borderTopColor,
    foreground: getComputedStyle(element).color,
    focus: element.matches(":focus-visible"),
  }));
  evidence(primaryHeld.held && primaryHeld.contour === primaryHeld.foreground && primaryHeld.focus,
    "equal custom primary Apply profile button paints its foreground contour while Space is held", primaryHeld);
  await captureHeldControl(page, "primary-keyboard-space-equal-color.png");
  await candidate.getByRole("button", { name: "Cancel", exact: true }).focus();
  const primaryBlurred = await apply.evaluate((element) => element.hasAttribute("data-ts-held"));
  await page.keyboard.up("Space");
  const primarySpaceEvents = await page.evaluate(() => window.__keyboardAuditEvents);
  evidence(!primaryBlurred && primarySpaceEvents.every((event) => event.type !== "click"),
    "focus transfer clears the primary Space cue and prevents activation on release", { primaryBlurred, primarySpaceEvents });

  const primaryBeforeEnter = await page.evaluate(() => window.__keyboardAuditEvents.length);
  await apply.focus();
  await page.keyboard.down("Enter");
  const primaryEnterEvents = await page.evaluate((start) => window.__keyboardAuditEvents.slice(start), primaryBeforeEnter);
  evidence(primaryEnterEvents.length === 2 && primaryEnterEvents[0].type === "keydown" && primaryEnterEvents[0].held &&
    primaryEnterEvents[1].type === "click" && !primaryEnterEvents[1].held,
  "equal custom primary Enter preserves its immediate native Apply activation and clears the cue at click", primaryEnterEvents);
  await page.keyboard.up("Enter");
  await page.getByRole("radio", { name: "Imported Equal Colors Probe", exact: true }).waitFor();
  const methodsAfter = await page.evaluate(() => window.__tachikoAcceptance.workMethodCounts());
  evidence(JSON.stringify(methodsAfter) === JSON.stringify(methodsBefore),
    "applying an appearance profile still dispatches no Work method", { methodsBefore, methodsAfter });

  const appearanceTrigger = page.getByRole("button", { name: "Appearance", exact: true });
  if (await appearanceTrigger.getAttribute("aria-expanded") !== "true") await appearanceTrigger.click();
  const close = page.locator(".ts-appearance-close.ts-button--ghost");
  await close.waitFor({ state: "visible" });
  await close.evaluate((element) => {
    window.__ghostKeyboardEvents = [];
    element.addEventListener("keydown", () => window.__ghostKeyboardEvents.push({ type: "keydown", held: element.hasAttribute("data-ts-held") }));
    element.addEventListener("click", () => window.__ghostKeyboardEvents.push({ type: "click", held: element.hasAttribute("data-ts-held") }));
  });
  await close.focus();
  await page.keyboard.down("Space");
  const ghostHeld = await close.evaluate((element) => ({
    held: element.hasAttribute("data-ts-held"),
    contour: getComputedStyle(element, "::after").borderTopColor,
    foreground: getComputedStyle(element).color,
    focus: element.matches(":focus-visible"),
  }));
  evidence(ghostHeld.held && ghostHeld.contour === ghostHeld.foreground && ghostHeld.focus,
    "real appearance ghost Close control paints its foreground contour while Space is held", ghostHeld);
  await captureHeldControl(page, "ghost-keyboard-space-equal-color.png");
  await page.getByRole("button", { name: "Appearance", exact: true }).focus();
  const ghostBlurred = await close.evaluate((element) => element.hasAttribute("data-ts-held"));
  await page.keyboard.up("Space");
  const ghostSpaceEvents = await page.evaluate(() => window.__ghostKeyboardEvents);
  evidence(!ghostBlurred && ghostSpaceEvents.every((event) => event.type !== "click"),
    "focus transfer clears the ghost Space cue and prevents activation on release", { ghostBlurred, ghostSpaceEvents });
  const ghostBeforeEnter = await page.evaluate(() => window.__ghostKeyboardEvents.length);
  await close.focus();
  await page.keyboard.down("Enter");
  const ghostEnterEvents = await page.evaluate((start) => window.__ghostKeyboardEvents.slice(start), ghostBeforeEnter);
  evidence(ghostEnterEvents.length === 2 && ghostEnterEvents[0].type === "keydown" && ghostEnterEvents[0].held &&
    ghostEnterEvents[1].type === "click" && !ghostEnterEvents[1].held,
  "real appearance ghost Enter preserves immediate native close activation", ghostEnterEvents);
  await page.keyboard.up("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const createCopy = page.getByRole("button", { name: "Create copy", exact: true });
  const disabledCopy = await createCopy.evaluate((element) => ({
    disabled: element.disabled,
    held: element.hasAttribute("data-ts-held"),
    ariaPressed: element.getAttribute("aria-pressed"),
  }));
  evidence(disabledCopy.disabled && !disabledCopy.held && disabledCopy.ariaPressed === null,
    "actual disabled Create copy control stays truthful and has no held or toggle state", disabledCopy);
  observations.push({ disabledSharedControl: "Save a copy / Create copy", ...disabledCopy });
  await page.keyboard.press("Escape");
  observations.push({ appearanceVariantKeyboard: { primaryHeld, primarySpaceEvents, primaryEnterEvents,
    ghostHeld, ghostSpaceEvents, ghostEnterEvents, methodsBefore, methodsAfter } });
}

async function forcedSystemColor(page, systemColor) {
  return page.evaluate((colorName) => {
    const probe = document.createElement("span");
    probe.style.color = colorName;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, systemColor);
}

async function computedControlTokens(page, tokens) {
  return page.evaluate((entries) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const result = Object.fromEntries(entries.map(([key, property, token]) => {
      probe.style[property] = `var(${token})`;
      return [key, getComputedStyle(probe)[property]];
    }));
    probe.remove();
    return result;
  }, tokens);
}

async function auditGhostInteractionStates(page, profileLabel) {
  const overflow = page.locator('.ts-command-overflow > summary[aria-label="More document commands"]');
  await overflow.click();
  const ghost = page.locator(".ts-command-overflow").getByRole("button", { name: "Close project", exact: true });
  await ghost.waitFor({ state: "visible" });
  const ghostStatesByMode = {};
  for (const { forcedColors, colorScheme } of [
    { forcedColors: "none", colorScheme: "light" },
    { forcedColors: "active", colorScheme: "light" },
    { forcedColors: "active", colorScheme: "dark" },
  ]) {
    await page.emulateMedia({ forcedColors, colorScheme });
    const modeLabel = forcedColors === "none" ? "normal" : `forced-${colorScheme}`;
    const states = await sampleButtonStates(page, ghost, `ghost ${profileLabel} ${modeLabel}`,
      profileLabel === "safe imported equal-color" && forcedColors === "none" ? "ghost-pointer-equal-color.png" : null);
    if (forcedColors === "active") {
      const systemCanvas = await forcedSystemColor(page, "Canvas");
      const systemText = await forcedSystemColor(page, "ButtonText");
      const systemForeground = await forcedSystemColor(page, "CanvasText");
      evidence(Object.values(states).every(({ background, border, foreground }) =>
        background === systemCanvas && border === systemText && foreground === systemForeground),
      `ghost ${profileLabel} ${modeLabel} retains Canvas, ButtonText, and CanvasText`, { states, systemCanvas, systemText, systemForeground });
    } else {
      const surfaces = await computedControlTokens(page, [
        ["hover", "backgroundColor", "--ts-surface-sunken"],
        ["pressed", "backgroundColor", "--ts-surface-head"],
        ["strongBorder", "borderColor", "--ts-line-strong"],
      ]);
      const transparentBackground = (rgb(states.rest.background)?.[3] ?? 1) === 0;
      const transparentRestBorder = (rgb(states.rest.border)?.[3] ?? 1) === 0;
      const fillsDiffer = states.hover.background !== states.pressed.background;
      const heldContourDistinguishes = states.pressed.held && states.pressed.contour.outerTop === 2 &&
        states.pressed.contour.borderColor === states.pressed.foreground &&
        contrast(rgb(states.pressed.contour.borderColor), rgb(states.pressed.background)) >= 3;
      evidence(transparentBackground && transparentRestBorder &&
        states.hover.background === surfaces.hover && states.pressed.background === surfaces.pressed &&
        (fillsDiffer || heldContourDistinguishes) &&
        states.hover.border === surfaces.strongBorder && states.pressed.border === surfaces.strongBorder,
      `ghost ${profileLabel} uses a visible held contour when admitted hover and pressed fills coincide`, { states, surfaces });
      evidence([states.hover, states.pressed].every((state) => contrast(rgb(state.foreground), rgb(state.background)) >= 4.5),
        `ghost ${profileLabel} text remains at least 4.5:1 on hover and pressed surfaces`, states);
    }
    ghostStatesByMode[forcedColors === "none" ? "normal" : `forced-${colorScheme}`] = states;
  }
  observations.push({ buttonVariantState: "ghost", profile: profileLabel, states: ghostStatesByMode });

  await page.keyboard.press("Escape");
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
  const primary = page.locator(".ts-button--primary:visible").first();
  if (await primary.count()) {
    const states = await sampleButtonStates(page, primary, `primary ${profileLabel} normal`,
      profileLabel === "safe imported equal-color" ? "primary-pointer-equal-color.png" : null);
    if (profileLabel === "safe imported equal-color") {
      evidence(states.hover.background === "rgb(85, 65, 194)" && states.pressed.background === states.hover.background,
        "positive equal-color profile keeps primary hover and pressed fills equal", states);
      evidence(states.pressed.contour.borderColor === states.pressed.foreground,
        "positive equal-color primary pressed state uses its admitted foreground contour", states.pressed.contour);
    }
    observations.push({ buttonVariantState: "primary", profile: profileLabel, states });
  } else {
    evidence(false, `primary ${profileLabel} renders a shared primary control`, null);
  }
}

async function auditButtonVariantBoundaries(browser) {
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await installDistRoutes(context, dist);
    const page = await context.newPage();
    await openApp(context, page);
    await openCanary(context, page);
    const targetRadiusByProfile = { tachiko: 7, "familiar-spreadsheet": 2, "minimal-focus": 4 };
    for (const density of densities) {
      await choose(page, profile.id, density.id);
      await page.keyboard.press("Escape");
      const densityButton = page.getByRole("button", { name: "Refresh", exact: true });
      const geometry = await sampleButtonStates(page, densityButton, `ordinary ${profile.id}/${density.id}`,
        profile.id === "tachiko" && density.id === "compact" ? "ordinary-pointer.png" : null);
      observations.push({ controlDensityGeometry: `${profile.id}/${density.id}`, states: geometry });
      const expectedRadius = targetRadiusByProfile[profile.id];
      const expectedHeight = density.id === "compact" ? 32 : 36;
      const minimumClearance = density.id === "compact" ? 2 : 4;
      evidence(geometry.pressed.contour.targetRadius === `${expectedRadius}px` &&
        geometry.pressed.contour.radius === `${Math.max(expectedRadius - 2, 0)}px`,
      `${profile.id}/${density.id} uses the approved target and inner contour radii`, geometry.pressed.contour);
      evidence(geometry.pressed.contour.targetHeight >= expectedHeight &&
        geometry.pressed.contour.contentTopClearance >= minimumClearance,
      `${profile.id}/${density.id} preserves its ${expectedHeight}px target and ${minimumClearance}px text clearance`, geometry.pressed.contour);
    }
    await choose(page, profile.id, "compact");
    await page.keyboard.press("Escape");

    const ordinary = page.getByRole("button", { name: "Refresh", exact: true });
    const ordinaryStatesByMode = {};
    for (const forcedColors of ["none", "active"]) {
      await page.emulateMedia({ forcedColors, colorScheme: "light" });
      const states = await sampleButtonStates(page, ordinary, `ordinary ${profile.id} ${forcedColors}`);
      if (forcedColors === "active") {
        const systemCanvas = await forcedSystemColor(page, "Canvas");
        const systemText = await forcedSystemColor(page, "ButtonText");
        const systemForeground = await forcedSystemColor(page, "CanvasText");
        evidence(Object.values(states).every(({ background, border, foreground }) =>
          background === systemCanvas && border === systemText && foreground === systemForeground),
          `ordinary ${profile.id} forced-colors states retain Canvas and ButtonText`, { states, systemCanvas, systemText });
      } else {
        const surfaces = await computedControlTokens(page, [
          ["rest", "backgroundColor", "--ts-surface"],
          ["hover", "backgroundColor", "--ts-surface-sunken"],
          ["pressed", "backgroundColor", "--ts-surface-head"],
        ]);
        evidence(states.rest.background === surfaces.rest && states.hover.background === surfaces.hover && states.pressed.background === surfaces.pressed &&
          states.rest.background !== states.hover.background && states.hover.background !== states.pressed.background,
        `ordinary ${profile.id} has distinct approved rest, hover, and pressed surfaces`, { states, surfaces });
        evidence(Object.values(states).every((state) => contrast(rgb(state.foreground), rgb(state.background)) >= 4.5),
          `ordinary ${profile.id} text remains at least 4.5:1 across interaction states`, states);
      }
      ordinaryStatesByMode[forcedColors] = states;
    }
    observations.push({ buttonVariantState: "ordinary", profile: profile.id, states: ordinaryStatesByMode });
    await auditKeyboardHeldControl(page, `shared control ${profile.id}`);
    await auditDismissedSpaceGesture(page, `shared control ${profile.id}`);
    await auditPointerHeldLifecycle(page, `shared control ${profile.id}`);

    // A dirty edit exposes the real destructive and neutral modal actions.
    await page.locator(".ts-grid tbody tr").first().locator("td").first().dblclick();
    const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
    await editor.fill(`Danger pressed probe ${profile.id}`);
    await editor.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true");
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    await dialog.waitFor();
    const keepEditing = dialog.getByRole("button", { name: "Keep editing", exact: true });
    const danger = dialog.getByRole("button", { name: "Close without saving", exact: true });
    const dangerStatesByMode = {};
    for (const forcedColors of ["none", "active"]) {
      await page.emulateMedia({ forcedColors, colorScheme: "light" });
      const neutral = await sampleButtonStates(page, keepEditing, `ordinary modal ${profile.id} ${forcedColors}`);
      const states = await sampleButtonStates(page, danger, `danger ${profile.id} ${forcedColors}`);
      if (forcedColors === "active") {
        const systemCanvas = await forcedSystemColor(page, "Canvas");
        const systemText = await forcedSystemColor(page, "ButtonText");
        const systemForeground = await forcedSystemColor(page, "CanvasText");
        evidence(Object.values(states).every(({ background, border, foreground }) =>
          background === systemCanvas && border === systemText && foreground === systemForeground) &&
          Object.values(neutral).every(({ background, border, foreground }) =>
            background === systemCanvas && border === systemText && foreground === systemForeground),
        `danger and neutral ${profile.id} forced-colors states retain system boundaries`, { states, neutral, systemCanvas, systemText });
      } else {
        const surfaces = await computedControlTokens(page, [
          ["rest", "backgroundColor", "--ts-protected-surface"],
          ["hover", "backgroundColor", "--ts-protected-surface-inset"],
          ["pressed", "backgroundColor", "--ts-protected-destructive-pressed"],
          ["border", "borderColor", "--ts-protected-destructive-border"],
        ]);
        evidence(states.rest.background === surfaces.rest && states.hover.background === surfaces.hover && states.pressed.background === surfaces.pressed &&
          states.rest.background !== states.hover.background && states.hover.background !== states.pressed.background &&
          Object.values(states).every((state) => state.border === surfaces.border),
        `danger ${profile.id} keeps its destructive border and distinct approved pressed surface`, { states, surfaces });
        evidence(neutral.hover.background !== neutral.pressed.background,
          `ordinary modal ${profile.id} has distinct hover and pressed surfaces`, { neutral });
        evidence(Object.values(states).every((state) => contrast(rgb(state.foreground), rgb(state.background)) >= 4.5) &&
          Object.values(neutral).every((state) => contrast(rgb(state.foreground), rgb(state.background)) >= 4.5),
        `danger and neutral ${profile.id} text remain at least 4.5:1 across interaction states`, { states, neutral });
      }
      dangerStatesByMode[forcedColors] = states;
    }
    observations.push({ buttonVariantState: "danger", profile: profile.id, states: dangerStatesByMode });
    await context.close();

    const ghostContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
    await installDistRoutes(ghostContext, dist);
    const ghostPage = await ghostContext.newPage();
    await openApp(ghostContext, ghostPage);
    await openCanary(ghostContext, ghostPage);
    await choose(ghostPage, profile.id, "compact");
    await ghostPage.keyboard.press("Escape");
    await auditGhostInteractionStates(ghostPage, profile.id);
    await ghostContext.close();
  }

  const importedContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
  await installDistRoutes(importedContext, dist);
  await importedContext.addInitScript(({ storageKey, rawPreference }) => {
    localStorage.setItem(storageKey, rawPreference);
  }, { storageKey: key, rawPreference: safeImportedGhostPreference });
  const importedPage = await importedContext.newPage();
  await openApp(importedContext, importedPage);
  await importedPage.getByRole("button", { name: "Appearance", exact: true }).click();
  const importedRadio = importedPage.getByRole("radio", { name: "Imported Equal Colors Probe", exact: true });
  evidence(await importedRadio.isChecked(), "safe imported appearance loads for the ghost control probe", null);
  await importedPage.keyboard.press("Escape");
  await openCanary(importedContext, importedPage);
  await importedPage.keyboard.press("Escape");
  await auditGhostInteractionStates(importedPage, "safe imported equal-color");
  await auditKeyboardHeldControl(importedPage, "safe imported equal-color");
  await auditDismissedSpaceGesture(importedPage, "safe imported equal-color");
  await auditPointerHeldLifecycle(importedPage, "safe imported equal-color");
  await auditAppearanceVariantKeyboard(importedPage);
  await importedContext.close();
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
      await page.keyboard.press("Escape");
      await auditWorkbookViewportBounds(page, 320, 640, profile.id);
      await auditWorkbookViewportBounds(page, 1512, 982, profile.id);
    }

    await auditInteropPreviewTrimCases(browser);

    const legalShortViewportCases = [];
    for (const profile of profiles) {
      for (const density of densities) {
        await choose(page, profile.id, density.id);
        await page.keyboard.press("Escape");
        await auditWorkbookViewportBounds(page, 320, 480, profile.id);
        legalShortViewportCases.push(`${profile.id}/${density.id}`);
      }
    }
    assert.equal(legalShortViewportCases.length, 6, "all six profile/density combinations exercise legal notices in a short phone viewport");
    observations.push({ legalNoticeShortViewport: { completedCases: legalShortViewportCases.length, requiredCases: 6, viewport: "320x480", cases: legalShortViewportCases } });
    await auditLegalNoticeResize(page);

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
    await auditButtonVariantBoundaries(browser);
    await auditHomeViewportBounds(page, browser);
    await auditFirstEntryStates(browser, dist);
  } finally {
    await browser.close();
  }

  evidence(legalNoticeAuditCases.length === 24,
    "legal notice audit completes all six comfortable idle, twelve nonempty preview, and six short-viewport cases",
    { completedCases: legalNoticeAuditCases.length, requiredCases: 24 });
  evidence(observations.some((item) => item.legalNoticeWrapResize?.caseCount === 3),
    "legal notice audit completes the desktop-wrap-restore resize sequence");
  evidence(observations.some((item) => item.legalNoticeKeyboard?.linkFocus?.length === 3),
    "legal notice audit completes the keyboard sequence through all three links");

  console.log(JSON.stringify({
    case: "rendered appearance visual/accessibility matrix",
    status: failures.length === 0 ? "PASS" : "FAIL",
    combinations: widths.length * profiles.length * densities.length,
    geometryCases: observations.filter((item) => typeof item.width === "number").length,
    noticeProfiles: profiles.length,
    forcedColorModes: ["light", "dark"],
    buttonVariantStates: observations.filter((item) => item.buttonVariantState),
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
    interopPreviewTrim: {
      completedCases: interopPreviewTrimCases.length,
      requiredCases: 12,
      outcomes: interopPreviewTrimCases,
    },
    legalNoticeAudit: {
      completedCases: legalNoticeAuditCases.length,
      requiredCases: 24,
      coverage: {
        comfortableIdleProfileWidthCases: 6,
        nonemptyPreviewProfileDensityWidthCases: interopPreviewTrimCases.length,
        shortViewportProfileDensityCases: observations.find((item) => item.legalNoticeShortViewport)?.legalNoticeShortViewport?.completedCases ?? 0,
        wrapResizeStates: observations.find((item) => item.legalNoticeWrapResize)?.legalNoticeWrapResize?.caseCount ?? 0,
        keyboardLinkSequence: observations.some((item) => item.legalNoticeKeyboard) ? 1 : 0,
      },
      outcomes: legalNoticeAuditCases,
      wrapResize: observations.find((item) => item.legalNoticeWrapResize)?.legalNoticeWrapResize ?? null,
      keyboard: observations.find((item) => item.legalNoticeKeyboard)?.legalNoticeKeyboard ?? null,
    },
    workbookViewportAudit: observations.filter((item) => item.workbookViewport),
    viewHeldControls: observations.filter((item) => item.viewHeldControl),
    controlDensityGeometry: observations.filter((item) => item.controlDensityGeometry),
    buttonHeldInputs: observations.filter((item) => item.buttonHeldInput),
    dismissedPhysicalSpaceGestures: observations.filter((item) => item.dismissedPhysicalSpaceGesture),
    pointerHeldLifecycles: observations.filter((item) => item.pointerHeldLifecycle),
    disabledSharedControls: observations.filter((item) => item.disabledSharedControl),
    appearanceVariantKeyboard: observations.find((item) => item.appearanceVariantKeyboard)?.appearanceVariantKeyboard ?? null,
    tallGridLayoutOnlyAudit: observations.filter((item) => item.tallGridLayoutOnly || item.tallGridPanelResize),
    homeViewportAudit: observations.filter((item) => item.homeViewport),
    homeEmptyViewportAudit: observations.filter((item) => item.homeEmptyViewport),
    homeAppearancePopoverAudit: observations.filter((item) => item.homeAppearancePopover),
    homeAppearanceReactivity: observations.find((item) => item.homeAppearanceReactivity)?.homeAppearanceReactivity ?? null,
    homeAppearanceShortViewport: observations.find((item) => item.homeAppearanceShortViewport)?.homeAppearanceShortViewport ?? null,
    homeAppearanceNarrowVisualViewport: observations.find((item) => item.homeAppearanceNarrowVisualViewport)?.homeAppearanceNarrowVisualViewport ?? null,
    homeAppearanceWiderVisualViewport: observations.find((item) => item.homeAppearanceWiderVisualViewport)?.homeAppearanceWiderVisualViewport ?? null,
    unknownOpenRecoveryAppearance: observations.find((item) => item.unknownOpenRecoveryAppearance)?.unknownOpenRecoveryAppearance ?? null,
    homeSavedWhitespaceIdentity: observations.find((item) => item.homeSavedWhitespaceIdentity) ?? null,
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

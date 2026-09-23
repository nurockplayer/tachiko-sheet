// #70 real-entry interchange probe: browser file selection, explicit Apply, and actual downloads.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const profileDir = await mkdtemp(path.join(tmpdir(), "tachiko-interchange-product-"));
const key = "tachiko-sheet:appearance-preference:v2";
const filename = "appearance.tachiko-profile.json";
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
let context;

function contrastRgb(first, second) {
  const luminance = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => {
    const normalized = Number(channel) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function downloadProfile(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected profile…" }).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  const bytes = await readFile(await download.path());
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 32768);
  await page.getByText(`Download requested: ${filename}. Browser save completion is not reported.`, { exact: true }).waitFor();
  return bytes;
}

async function uploadProfile(page, bytes) {
  await page.locator(".ts-appearance-file-input").setInputFiles({ name: filename, mimeType: "application/json", buffer: bytes });
}

async function appearanceState(page) {
  return page.evaluate((storageKey) => ({
    chrome: document.documentElement.getAttribute("data-ts-profile-chrome"),
    density: document.documentElement.getAttribute("data-ts-profile-density"),
    raw: localStorage.getItem(storageKey),
    methods: window.__tachikoAcceptance.workMethodCounts(),
    writes: window.__tachikoAcceptance.copyWriteDispatchCounts(),
    save: window.__tachikoAcceptance.saveObservation(),
  }), key);
}

async function reportPng(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current PNG", exact: true }).click();
  return readFile(await (await pending).path());
}

async function headerFocusPaint(page, target) {
  await page.keyboard.press("Tab");
  await target.focus();
  const geometry = await target.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y,
      visible: node.matches(":focus-visible"),
      color: style.outlineColor,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      expanded: node.getAttribute("aria-expanded"),
    };
  });
  assert.equal(geometry.visible, true, "keyboard focus is visible on the closed header control");
  assert.equal(geometry.width, "3px");
  assert.equal(geometry.offset, "2px");
  const pngData = (await page.screenshot({ animations: "disabled" })).toString("base64");
  const pixels = await page.evaluate(async ({ encoded, x, y }) => {
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
    const sample = (sampleY) => {
      const value = context.getImageData(Math.round(x * scaleX), Math.round(sampleY * scaleY), 1, 1).data;
      return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
    };
    return { ring: sample(y - 3), adjacent: sample(y - 8) };
  }, { encoded: pngData, x: geometry.x, y: geometry.y });
  const contrast = contrastRgb(pixels.ring, pixels.adjacent);
  assert.equal(pixels.ring, geometry.color, "screenshot samples the rendered 3px focus outline");
  assert.ok(contrast >= 3, `header focus outline contrasts with adjacent rendered gradient: ${JSON.stringify({ ...geometry, ...pixels, contrast })}`);
  return { ...geometry, ...pixels, contrast };
}

async function bindReport(page) {
  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  for (const [label, value] of [
    ["Orders table", "sales"], ["Order lookup key", "product_code"], ["Order quantity", "quantity"],
    ["Products table", "catalog"], ["Product key", "code"], ["Product category", "category"], ["Product price", "price"],
  ]) await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Profile interchange boundary");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.locator('.ts-report-canvas[data-report-ready="true"]').waitFor();
}

try {
  context = await chromium.launchPersistentContext(profileDir, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const network = [];
  page.on("request", (request) => network.push(request.url()));
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByRole("button", { name: "Try Catalog/Sales canary", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  await bindReport(page);
  const pngBefore = await reportPng(page);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("navigation", { name: "Workbook actions", exact: true }).getByLabel("Table", { exact: true }).selectOption("catalog");
  await page.getByRole("columnheader", { name: "price", exact: true }).waitFor();
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.filter((header) => header !== "Row").indexOf("price");
  assert.ok(priceIndex >= 0);
  const cell = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex);
  await cell.focus();
  await cell.press("Enter");
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill("not a number");
  await editor.evaluate((input) => input.setSelectionRange(3, 7));
  await editor.press("Enter");
  await page.getByText("The work did not accept this value. The draft was kept so you can correct it.", { exact: true }).waitFor();
  const shellHandle = await page.locator(".ts-app").elementHandle();
  const editorHandle = await editor.elementHandle();
  const cellHandle = await page.locator(".ts-cell--focused").elementHandle();
  assert.ok(shellHandle && editorHandle && cellHandle);
  const draftBefore = await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd]);
  assert.deepEqual(draftBefore, ["not a number", 3, 7]);
  const runtimeBefore = await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot());
  const before = await appearanceState(page);
  const networkBefore = network.length;
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const builtInBytes = await downloadProfile(page);
  const builtIn = JSON.parse(builtInBytes.toString("utf8"));
  assert.equal(builtIn.name, "Tachiko");
  assert.equal(builtIn.schemaVersion, 1);
  assert.equal(builtIn.colors["surface.chrome"].startsWith("#"), true);
  assert.deepEqual(await downloadProfile(page), builtInBytes, "active built-in export is deterministic");

  const imported = { ...builtIn, name: "My Local Profile", density: "comfortable" };
  const importBytes = Buffer.from(`${JSON.stringify(imported, null, 2)}\n`, "utf8");
  await uploadProfile(page, importBytes);
  const candidate = page.locator(".ts-appearance-candidate");
  await candidate.locator(".ts-appearance-candidate__name bdi").getByText("My Local Profile", { exact: true }).waitFor();
  assert.equal(await candidate.evaluate((node) => document.activeElement === node), true, "staged candidate receives review focus");
  const desktopLayout = await page.locator(".ts-appearance-popover").evaluate((node) => {
    const content = node.querySelector(".ts-appearance-content");
    const density = node.querySelector(".ts-appearance-group--density").getBoundingClientRect();
    const footnote = node.querySelector(".ts-appearance-footnote").getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    return { scroll: content.scrollHeight > content.clientHeight, densityVisible: density.bottom <= bounds.bottom,
      footnoteVisible: footnote.bottom <= bounds.bottom };
  });
  assert.deepEqual(desktopLayout, { scroll: false, densityVisible: true, footnoteVisible: true },
    "desktop staged panel shows Density and footnote without inner scroll");
  assert.deepEqual(await appearanceState(page), before, "staging has no appearance, preference, Work, copy, or Save effect");
  assert.deepEqual(await downloadProfile(page), builtInBytes, "export during staging uses the active profile");
  await candidate.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await candidate.count(), 0);
  assert.deepEqual(await appearanceState(page), before, "Cancel leaves active state unchanged");

  await uploadProfile(page, importBytes);
  await candidate.getByRole("button", { name: "Apply profile", exact: true }).click();
  await page.getByRole("radio", { name: /Imported My Local Profile/ }).waitFor();
  assert.equal(await page.getByRole("radio", { name: /Imported My Local Profile/ }).isChecked(), true);
  const applied = await appearanceState(page);
  assert.equal(applied.chrome, "porcelain");
  assert.equal(applied.density, "comfortable");
  assert.deepEqual(JSON.parse(applied.raw), { schemaVersion: 2, kind: "imported", profile: imported });
  assert.deepEqual({ methods: applied.methods, writes: applied.writes, save: applied.save },
    { methods: before.methods, writes: before.writes, save: before.save },
    "Apply changes only local appearance preference");
  const exported = await downloadProfile(page);
  assert.deepEqual(exported, importBytes, "normalized imported export round-trips deterministically");
  await editor.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await page.locator(".ts-appearance-profile-option").filter({ hasText: "Familiar Spreadsheet" }).click();
  await page.getByRole("button", { name: "Export active profile…" }).waitFor();
  await page.getByText("The queued choice applies after editing; export uses the active profile.", { exact: true }).waitFor();
  const pendingExport = await (async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export active profile…" }).click();
    return readFile(await (await pending).path());
  })();
  assert.deepEqual(pendingExport, exported, "queued IME choice does not alter active export bytes");
  await page.locator(".ts-appearance-profile-option--imported").click();
  await editor.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: input.value })));
  assert.equal(await page.getByRole("radio", { name: /Imported My Local Profile/ }).isChecked(), true);
  assert.deepEqual(await appearanceState(page), applied, "cancelled IME queue leaves imported active and persisted");
  await uploadProfile(page, exported);
  await candidate.locator(".ts-appearance-candidate__name bdi").getByText("My Local Profile", { exact: true }).waitFor();
  const candidateSurface = await candidate.evaluate((node) => ({
    painted: getComputedStyle(node).backgroundColor,
    admitted: getComputedStyle(node.closest(".ts-appearance-popover")).backgroundColor,
  }));
  assert.equal(candidateSurface.painted, candidateSurface.admitted,
    "second import paints candidate text and focus against the admitted active-profile content surface");
  await candidate.getByRole("button", { name: "Cancel", exact: true }).click();

  const nonwhite = { ...imported, name: "Nonwhite Local Profile", colors: { ...imported.colors, "surface.content": "#F8FAFF" } };
  await uploadProfile(page, Buffer.from(JSON.stringify(nonwhite), "utf8"));
  await candidate.getByRole("button", { name: "Apply profile", exact: true }).click();
  await page.getByRole("radio", { name: /Imported Nonwhite Local Profile/ }).waitFor();
  await uploadProfile(page, importBytes);
  await candidate.waitFor();
  const candidateBoundary = await candidate.evaluate((node) => {
    const paint = getComputedStyle(node);
    const rgb = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => Number(channel));
    const luminance = (value) => rgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(paint.borderColor);
    const background = luminance(paint.backgroundColor);
    return { background: paint.backgroundColor, borderContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
  });
  assert.equal(candidateBoundary.background, "rgb(248, 250, 255)", "candidate follows nonwhite admitted profile surface");
  assert.ok(candidateBoundary.borderContrast >= 3, `candidate boundary stays visible on admitted nonwhite surface: ${JSON.stringify(candidateBoundary)}`);
  await candidate.getByRole("button", { name: "Cancel", exact: true }).click();

  const rejected = [
    ["oversize", Buffer.alloc(32769, 0x20)],
    ["invalid-utf8", Buffer.from([0xc3, 0x28])],
    ["malformed-json", Buffer.from("{bad", "utf8")],
    ["duplicate-key", Buffer.from(importBytes.toString("utf8").replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'), "utf8")],
    ["unknown-field", Buffer.from(JSON.stringify({ ...imported, extra: "no" }), "utf8")],
    ["missing-field", Buffer.from(JSON.stringify((({ density, ...rest }) => rest)(imported)), "utf8")],
    ["unsupported-version", Buffer.from(JSON.stringify({ ...imported, schemaVersion: 2 }), "utf8")],
    ["invalid-enum", Buffer.from(JSON.stringify({ ...imported, chrome: "remote" }), "utf8")],
    ["invalid-name", Buffer.from(JSON.stringify({ ...imported, name: "bad\nname" }), "utf8")],
    ["invalid-color", Buffer.from(JSON.stringify({ ...imported, colors: { ...imported.colors, "text.primary": "url(https://example.invalid/x)" } }), "utf8")],
    ["unsafe-contrast", Buffer.from(JSON.stringify({ ...imported, colors: { ...imported.colors, "text.primary": imported.colors["surface.app"] } }), "utf8")],
    ["unsafe-primary-boundary", Buffer.from(JSON.stringify({ ...imported, name: "Unsafe Primary Boundary", colors: {
      ...imported.colors,
      "surface.content": "#FFFFFF", "surface.chrome": "#FFFFFF", "surface.chrome.tint": "#FFFFFF", "surface.inset": "#FFFFFF",
      "grid.canvas": "#FFFFFF", "grid.header.background": "#FFFFFF", "selection.row.background": "#FFFFFF",
      "selection.active.background": "#FFFFFF",
      "text.primary": "#767676", "text.secondary": "#767676", "text.onTint": "#767676",
      "text.link": "#767676", "text.reference": "#767676", "accent.foreground": "#767676",
      "grid.header.foreground": "#767676", "selection.header.foreground": "#767676",
      "border.control": "#767676", "selection.active.border": "#767676", "focus.ring": "#767676",
      "accent.background": "#000000", "selection.header.background": "#000000",
      "action.primary.background": "#FFFFFF", "action.primary.hover": "#FFFFFF", "action.primary.pressed": "#FFFFFF",
      "action.primary.foreground": "#767676",
    } }), "utf8")],
    ["unsafe-computed-indicator", Buffer.from(JSON.stringify({ ...imported, name: "Unsafe Computed Indicator", colors: {
      ...imported.colors,
      "selection.active.background": "#D5D5D5",
      "text.secondary": "#3F3F3F",
      "text.reference": "#333333",
      "border.control": "#818798",
    } }), "utf8")],
    ["unsafe-header-focus", Buffer.from(JSON.stringify({ ...imported, name: "Unsafe Header Focus", colors: {
      ...imported.colors,
      "surface.chrome.tint": "#949494", "surface.chrome": "#FFFFFF", "focus.ring": "#949494",
      "surface.app": "#FFFFFF", "surface.content": "#FFFFFF", "surface.inset": "#FFFFFF",
      "grid.canvas": "#FFFFFF", "grid.header.background": "#FFFFFF", "selection.row.background": "#FFFFFF",
      "selection.active.background": "#FFFFFF", "selection.header.background": "#FFFFFF",
      "accent.background": "#FFFFFF", "action.primary.background": "#000000",
      "action.primary.hover": "#000000", "action.primary.pressed": "#000000",
      "text.primary": "#000000", "text.secondary": "#000000", "text.onTint": "#000000",
      "text.link": "#000000", "text.reference": "#000000", "accent.foreground": "#000000",
      "grid.header.foreground": "#000000", "selection.header.foreground": "#000000",
      "action.primary.foreground": "#FFFFFF", "border.control": "#000000",
      "selection.active.border": "#000000",
    } }), "utf8")],
    ["executable", Buffer.from(JSON.stringify({ ...imported, script: "alert(1)", colors: { ...imported.colors, "surface.app": "#FFFFFF" } }), "utf8")],
  ];
  const rejectionState = await appearanceState(page);
  for (const [name, bytes] of rejected) {
    await uploadProfile(page, bytes);
    const alert = page.locator(".ts-appearance-notice--rejected");
    await alert.getByText("Profile not imported", { exact: true }).waitFor();
    assert.equal(await alert.evaluate((node) => document.activeElement === node), true, `${name}: rejection receives focus`);
    assert.equal(await candidate.count(), 0, `${name}: no candidate is staged`);
    assert.deepEqual(await appearanceState(page), rejectionState, `${name}: rejection preserves active profile and product state`);
    if (name === "unsafe-primary-boundary") {
      assert.match(await alert.innerText(), /action\.primary\.background primary control boundary on content surface/,
        "the Oracle-style previously admitted profile is rejected by the new actual-use boundary rule");
    }
    if (name === "unsafe-computed-indicator") {
      assert.match(await alert.innerText(), /computed-cell dotted state indicator against selected active cell/,
        "the previously admitted focused computed-cell counterexample is rejected by its actual-use rule");
    }
    if (name === "unsafe-header-focus") {
      assert.match(await alert.innerText(), /header keyboard focus indicator/,
        "Oracle's formerly admitted Porcelain tint/focus counterexample is rejected");
    }
    if (name === "malformed-json") {
      const rejectionPaint = await alert.evaluate((node) => {
        const style = getComputedStyle(node);
        return { color: style.color, background: style.backgroundColor, borderLeftWidth: style.borderLeftWidth };
      });
      assert.equal(rejectionPaint.background, "rgb(255, 244, 241)", "rejection uses approved red-tinted panel");
      assert.equal(rejectionPaint.color, "rgb(115, 48, 38)", "rejection uses approved red text");
      assert.equal(rejectionPaint.borderLeftWidth, "4px", "rejection keeps its red left rule");
    }
  }
  assert.equal(await shellHandle.evaluate((node) => node.isConnected && node === document.querySelector(".ts-app")), true);
  assert.equal(await editorHandle.evaluate((node) => node.isConnected && node === document.querySelector('[aria-label="Edit cell"]')), true);
  assert.equal(await cellHandle.evaluate((node) => node.isConnected && node.classList.contains("ts-cell--focused")), true);
  assert.deepEqual(await editor.evaluate((input) => [input.value, input.selectionStart, input.selectionEnd]), draftBefore);
  assert.deepEqual(network.slice(networkBefore), [], "profile actions issue no network requests");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()), runtimeBefore,
    "profile actions leave runtime revision and opaque bytes unchanged");

  await page.setViewportSize({ width: 320, height: 600 });
  await uploadProfile(page, importBytes);
  await candidate.waitFor();
  const narrow = await page.locator(".ts-appearance-popover").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const content = node.querySelector(".ts-appearance-content");
    const [apply, cancel] = node.querySelectorAll(".ts-appearance-candidate__actions button");
    const applyBounds = apply.getBoundingClientRect();
    const cancelBounds = cancel.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, width: bounds.width, contentScroll: content.scrollHeight > content.clientHeight,
      candidateActionsSameRow: Math.abs(applyBounds.top - cancelBounds.top) < 1 };
  });
  assert.ok(narrow.left >= 0 && narrow.right <= 320 && narrow.bottom <= 600 && narrow.width >= 280 && narrow.contentScroll && narrow.candidateActionsSameRow,
    "320px staged view fits, scrolls internally, and keeps Apply/Cancel together");
  await page.setViewportSize({ width: 320, height: 640 });
  const narrowTall = await page.locator(".ts-appearance-popover").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  });
  assert.ok(narrowTall.top >= 0 && narrowTall.bottom <= 640,
    `320×640 staged panel stays reachable: ${JSON.stringify(narrowTall)}`);
  await page.setViewportSize({ width: 320, height: 480 });
  const narrowShort = await page.locator(".ts-appearance-popover").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const content = node.querySelector(".ts-appearance-content");
    return { top: bounds.top, bottom: bounds.bottom, contentScroll: content.scrollHeight > content.clientHeight };
  });
  assert.ok(narrowShort.top >= 0 && narrowShort.bottom <= 480 && narrowShort.contentScroll,
    `320×480 staged panel stays reachable: ${JSON.stringify(narrowShort)}`);
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ forcedColors: "active", colorScheme });
    const paint = await candidate.evaluate((node) => {
      const style = getComputedStyle(node);
      return { border: style.borderColor, background: style.backgroundColor, color: style.color };
    });
    assert.notEqual(paint.border, paint.background, `${colorScheme} forced colors retain candidate boundary`);
    assert.notEqual(paint.color, paint.background, `${colorScheme} forced colors retain text contrast`);
  }
  await page.emulateMedia({ forcedColors: "none" });
  await candidate.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 450 });
  await uploadProfile(page, importBytes);
  await candidate.waitFor();
  const shortView = await page.locator(".ts-appearance-popover").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const content = node.querySelector(".ts-appearance-content");
    return { top: bounds.top, bottom: bounds.bottom, contentScroll: content.scrollHeight > content.clientHeight };
  });
  assert.ok(shortView.bottom <= 450 && shortView.contentScroll,
    `short viewport keeps the staged panel reachable: ${JSON.stringify(shortView)}`);
  await candidate.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await editor.press("Escape");
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const pngAfter = await reportPng(page);
  assert.deepEqual(pngAfter, pngBefore, "report PNG bytes remain unchanged after import, export, apply, and rejection");

  const midtone = { ...builtIn, name: "Midtone Local Profile", colors: { ...builtIn.colors,
    "surface.content": "#B5B5B5", "text.secondary": "#3F3F3F", "text.onTint": "#333333",
    "text.link": "#333333", "text.reference": "#333333", "accent.foreground": "#333333", "focus.ring": "#4936AB",
    "border.control": "#555555", "selection.active.border": "#4936AB",
    "action.primary.background": "#4936AB", "action.primary.hover": "#3E2F98", "action.primary.pressed": "#352780" } };
  const midtoneBefore = await appearanceState(page);
  const midtoneNetworkBefore = network.length;
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(".ts-appearance-popover").waitFor({ state: "visible" });
  await uploadProfile(page, Buffer.from(JSON.stringify(midtone), "utf8"));
  await page.locator(".ts-appearance-candidate, .ts-appearance-notice--rejected").waitFor();
  assert.equal(await page.locator(".ts-appearance-notice--rejected").count(), 0,
    `midtone profile import is admitted: ${await page.locator(".ts-appearance-notice--rejected").innerText().catch(() => "no rejection text")}`);
  await page.locator(".ts-appearance-candidate").getByRole("button", { name: "Apply profile", exact: true }).click();
  await page.getByRole("radio", { name: /Imported Midtone Local Profile/ }).waitFor();
  const primary = page.getByRole("button", { name: "Save a copy", exact: true });
  const primaryPaint = [];
  await page.mouse.move(1, 1);
  primaryPaint.push(await primary.evaluate((node) => {
    const style = getComputedStyle(node);
    const chrome = getComputedStyle(document.documentElement).getPropertyValue("--ts-surface-chrome").trim();
    const channels = chrome.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)?.slice(1).map((part) => Number.parseInt(part, 16));
    return { state: "normal", fill: style.backgroundColor, border: style.borderColor,
      adjacent: channels ? `rgb(${channels.join(", ")})` : chrome };
  }));
  await primary.hover();
  primaryPaint.push(await primary.evaluate((node) => {
    const style = getComputedStyle(node);
    const chrome = getComputedStyle(document.documentElement).getPropertyValue("--ts-surface-chrome").trim();
    const channels = chrome.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)?.slice(1).map((part) => Number.parseInt(part, 16));
    return { state: "hover", fill: style.backgroundColor, border: style.borderColor,
      adjacent: channels ? `rgb(${channels.join(", ")})` : chrome };
  }));
  await page.mouse.down();
  primaryPaint.push(await primary.evaluate((node) => {
    const style = getComputedStyle(node);
    const chrome = getComputedStyle(document.documentElement).getPropertyValue("--ts-surface-chrome").trim();
    const channels = chrome.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)?.slice(1).map((part) => Number.parseInt(part, 16));
    return { state: "pressed", fill: style.backgroundColor, border: style.borderColor,
      adjacent: channels ? `rgb(${channels.join(", ")})` : chrome };
  }));
  await page.mouse.up();
  const expectedPrimaryFills = [midtone.colors["action.primary.background"], midtone.colors["action.primary.hover"], midtone.colors["action.primary.pressed"]]
    .map((hex) => `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`);
  assert.deepEqual(primaryPaint.map((paint) => paint.fill), expectedPrimaryFills,
    "normal, hover, and pressed CSS states route to their respective imported primary roles");
  assert.equal(new Set(primaryPaint.map((paint) => paint.fill)).size, 3,
    "computed normal, hover, and pressed fills are distinct");
  const densityPaint = await page.evaluate(() => {
    const rgb = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => Number(channel));
    const luminance = (value) => rgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (first, second) => {
      const a = luminance(first); const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const density = document.querySelector(".ts-appearance-density-option--selected");
    if (!density) throw new Error("Expected rendered selected Density control");
    const densityPaint = getComputedStyle(density);
    const contentSurface = getComputedStyle(document.querySelector(".ts-appearance-popover")).backgroundColor;
    return { fill: densityPaint.backgroundColor, border: densityPaint.borderColor, surface: contentSurface,
      contrast: contrast(densityPaint.backgroundColor, contentSurface) };
  });
  for (const paint of primaryPaint) {
    const ratio = await page.evaluate(({ fill, adjacent }) => {
      const luminance = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => {
        const normalized = Number(channel) / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(fill); const b = luminance(adjacent);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, paint);
    assert.ok(ratio >= 3, `${paint.state} primary action boundary retains 3:1 contrast: ${JSON.stringify({ ...paint, ratio })}`);
  }
  assert.ok(densityPaint.contrast >= 3, `selected Density boundary retains 3:1: ${JSON.stringify(densityPaint)}`);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.locator(".ts-row-head").first().click();
  const rowHeaderPaint = await page.evaluate(() => {
    const rgb = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => Number(channel));
    const luminance = (value) => rgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const row = document.querySelector(".ts-row--selected .ts-row-head");
    const header = document.querySelector('table[aria-label="Table"] th[scope="col"]');
    if (!row || !header) throw new Error("Expected rendered selected row and column headers");
    const fill = getComputedStyle(row).backgroundColor;
    const gridHeader = getComputedStyle(header).backgroundColor;
    const a = luminance(fill); const b = luminance(gridHeader);
    return { fill, gridHeader, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  assert.ok(rowHeaderPaint.contrast >= 3,
    `selected row header state retains 3:1 against grid header: ${JSON.stringify(rowHeaderPaint)}`);
  const statusPaint = await page.evaluate(() => {
    const card = document.createElement("section");
    card.className = "ts-card";
    const status = document.createElement("span");
    status.className = "ts-status";
    status.setAttribute("role", "status");
    status.textContent = "Opening…";
    card.append(status);
    document.querySelector(".ts-app")?.append(card);
    const cardStyle = getComputedStyle(card);
    const statusStyle = getComputedStyle(status);
    const rgb = (value) => [...value.matchAll(/\d+/g)].slice(0, 3).map(([channel]) => Number(channel));
    const luminance = (value) => rgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(statusStyle.color);
    const background = luminance(statusStyle.backgroundColor);
    const bounds = status.getBoundingClientRect();
    const result = {
      cardBackground: cardStyle.backgroundColor,
      text: statusStyle.color,
      background: statusStyle.backgroundColor,
      border: statusStyle.borderColor,
      padding: statusStyle.padding,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      hasGeometry: bounds.width > 0 && bounds.height > 0,
    };
    card.remove();
    return result;
  });
  assert.equal(statusPaint.cardBackground, "rgb(181, 181, 181)", "midtone profile is active on the containing Home card");
  assert.equal(statusPaint.background, "rgb(255, 255, 255)", "protected status paints on its owned white surface");
  assert.ok(statusPaint.contrast >= 4.5, `protected status text retains ordinary text contrast: ${JSON.stringify(statusPaint)}`);
  assert.equal(statusPaint.hasGeometry, true, "protected status surface has painted geometry");
  const midtoneState = await appearanceState(page);
  assert.deepEqual({ methods: midtoneState.methods, writes: midtoneState.writes, save: midtoneState.save },
    { methods: midtoneBefore.methods, writes: midtoneBefore.writes, save: midtoneBefore.save },
    "midtone import and apply change only local appearance preference");
  assert.deepEqual(network.slice(midtoneNetworkBefore), [], "midtone import and apply issue no network requests");
  assert.deepEqual(await page.evaluate(() => window.__tachikoAcceptance.runtimeSnapshot()), runtimeBefore,
    "midtone import and apply leave runtime revision and opaque bytes unchanged");

  const computedPage = await context.newPage();
  await computedPage.goto(LOCAL_ORIGIN);
  await computedPage.getByTestId("project-ready").waitFor();
  await computedPage.getByRole("tab", { name: "Table", exact: true }).click();
  const formulaCell = computedPage.locator(".ts-cell--computed").first();
  await formulaCell.waitFor();
  const safeComputed = { ...imported, name: "Computed Contrast Safe", colors: {
    ...imported.colors, "selection.active.background": "#F5F5F5",
  } };
  await computedPage.getByRole("button", { name: "Appearance", exact: true }).click();
  await uploadProfile(computedPage, Buffer.from(JSON.stringify(safeComputed), "utf8"));
  await computedPage.locator(".ts-appearance-candidate").getByRole("button", { name: "Apply profile", exact: true }).click();
  await computedPage.getByRole("radio", { name: /Imported Computed Contrast Safe/ }).waitFor();
  await formulaCell.focus();
  await computedPage.locator(".ts-cell--computed.ts-cell--focused").waitFor();
  const computedPaint = await formulaCell.evaluate((cell) => {
    const cue = cell.querySelector(".ts-cell-value");
    if (!cue) throw new Error("Expected rendered computed-cell state indicator");
    const indicator = getComputedStyle(cue);
    return {
      selected: cell.parentElement?.classList.contains("ts-row--selected"),
      border: indicator.borderBottomColor,
      style: indicator.borderBottomStyle,
      width: indicator.borderBottomWidth,
      background: getComputedStyle(cell).backgroundColor,
    };
  });
  assert.equal(computedPaint.selected, true, "focused computed cell is in the selected row");
  assert.equal(computedPaint.style, "dotted", "formula result keeps its visible computed-state cue");
  assert.equal(computedPaint.width, "1px", "computed-state cue has its expected painted geometry");
  assert.equal(computedPaint.border, "rgb(129, 135, 152)", "computed-state cue uses imported border.control");
  assert.equal(computedPaint.background, "rgb(245, 245, 245)", "focused computed cell uses custom imported active background");
  const computedContrast = contrastRgb(computedPaint.border, computedPaint.background);
  assert.ok(computedContrast >= 3,
    `imported focused computed-state cue retains 3:1 against its painted background: ${JSON.stringify({ ...computedPaint, contrast: computedContrast })}`);
  await computedPage.close();

  const headerFocus = [];
  const focusPage = await context.newPage();
  await focusPage.goto(LOCAL_ORIGIN);
  await focusPage.getByTestId("project-ready").waitFor();
  for (const density of ["compact", "comfortable"]) {
    const safeHeader = { ...imported, name: `Safe Header ${density}`, density, colors: {
      ...imported.colors, "focus.ring": "#818798",
    } };
    await focusPage.getByRole("button", { name: "Appearance", exact: true }).click();
    await uploadProfile(focusPage, Buffer.from(JSON.stringify(safeHeader), "utf8"));
    await focusPage.locator(".ts-appearance-candidate").getByRole("button", { name: "Apply profile", exact: true }).click();
    await focusPage.getByRole("radio", { name: new RegExp(`Imported Safe Header ${density}`) }).waitFor();
    await focusPage.keyboard.press("Escape");
    for (const width of [320, 600, 1023, 1024]) {
      await focusPage.setViewportSize({ width, height: 900 });
      const appearance = focusPage.locator(".ts-appearance-trigger");
      const appearancePaint = await headerFocusPaint(focusPage, appearance);
      assert.equal(appearancePaint.expanded, "false", "Appearance remains closed for the header focus sample");
      const command = focusPage.getByRole("group", { name: "Document commands" }).getByRole("button", { name: "Refresh", exact: true });
      const commandPaint = await headerFocusPaint(focusPage, command);
      headerFocus.push({ density, width, appearance: appearancePaint.contrast, command: commandPaint.contrast });
    }
  }
  await focusPage.close();

  const corrupt = await context.newPage();
  await corrupt.addInitScript(({ storageKey, manifest }) => {
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 2, kind: "imported", profile: manifest }));
  }, { storageKey: key, manifest: { ...imported, colors: { ...imported.colors, "text.primary": imported.colors["surface.app"] } } });
  await corrupt.goto(LOCAL_ORIGIN);
  await corrupt.getByTestId("project-ready").waitFor();
  assert.equal(await corrupt.evaluate(() => document.documentElement.getAttribute("data-ts-profile-chrome")), "porcelain");
  assert.equal(await corrupt.evaluate(() => document.documentElement.getAttribute("data-ts-profile-density")), "compact");
  await corrupt.getByRole("button", { name: "Appearance", exact: true }).click();
  await corrupt.getByText("Saved appearance could not be loaded. Using Tachiko for this session.", { exact: true }).waitFor();

  console.log(JSON.stringify({ case: "#70 real-entry profile interchange", status: "PASS", rejected: rejected.map(([name]) => name),
    builtInBytes: builtInBytes.byteLength, importedBytes: exported.byteLength, reportPngSha256: createHash("sha256").update(pngAfter).digest("hex"),
    networkDelta: network.length - networkBefore, computedPaint: { ...computedPaint, contrast: computedContrast }, headerFocus,
    narrow, narrowTall, narrowShort, shortView }));
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
}

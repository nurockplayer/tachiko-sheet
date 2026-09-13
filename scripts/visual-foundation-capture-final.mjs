// Final production evidence capture. All states are reached through the
// normal Sheet UI and the real public runtime; no DOM/state injection.
import { chromium } from "playwright";

const url = process.env.WORK_CLIENT_URL;
if (!url) throw new Error("WORK_CLIENT_URL is required");
const fixture = "evidence/visual-foundation/fixture-50.roproj";
const target = "evidence/visual-foundation/targets";
const workspaces = [
  { id: "standard-1440", label: "standard", width: 1440, height: 900, zoom: 1, deviceScaleFactor: 1 },
  { id: "standard-1280", label: "standard", width: 1280, height: 800, zoom: 1, deviceScaleFactor: 1 },
  { id: "standard-1024", label: "standard", width: 1024, height: 768, zoom: 1, deviceScaleFactor: 1 },
  { id: "fhd", label: "FHD", width: 1920, height: 1080, zoom: 1, deviceScaleFactor: 1 },
  { id: "qhd", label: "QHD", width: 2560, height: 1440, zoom: 1, deviceScaleFactor: 1 },
  { id: "4k", label: "4K", width: 3840, height: 2160, zoom: 1, deviceScaleFactor: 1 },
  { id: "zoom-200", label: "200% zoom", width: 720, height: 450, zoom: 2, deviceScaleFactor: 1 },
];

async function openPage(workspace) {
  const page = await browser.newPage({
    viewport: { width: workspace.width, height: workspace.height },
    deviceScaleFactor: workspace.deviceScaleFactor,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (workspace.zoom !== 1) {
    await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, workspace.zoom);
  }
  return page;
}

function report(workspace, state, screenshot, details = {}) {
  console.log(JSON.stringify({
    workspace: workspace.label,
    css_viewport: `${workspace.width}x${workspace.height}`,
    device_scale_factor: workspace.deviceScaleFactor,
    document_zoom: workspace.zoom,
    state,
    screenshot,
    ...details,
  }));
}

function homeScreenshotName(workspace) {
  if (workspace.id === "standard-1440") return "home.png";
  if (workspace.id === "standard-1280") return "home-1280x800.png";
  if (workspace.id === "standard-1024") return "home-1024x768.png";
  if (workspace.id === "zoom-200") return "home-200-percent.png";
  return `home-${workspace.id}-${workspace.width}x${workspace.height}.png`;
}

function workbookScreenshotName(workspace) {
  if (workspace.id === "standard-1440") return "workbook-50rows-1440x900.png";
  if (workspace.id === "standard-1280") return "workbook-50rows-1280x800.png";
  if (workspace.id === "standard-1024") return "workbook-50rows-1024x768.png";
  if (workspace.id === "zoom-200") return "workbook-50rows-200-percent.png";
  return `workbook-50rows-${workspace.id}-${workspace.width}x${workspace.height}.png`;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const workspace of workspaces) {
    const page = await openPage(workspace);
    const name = homeScreenshotName(workspace);
    await page.screenshot({ path: `${target}/${name}`, fullPage: true });
    await page.close();
    report(workspace, "home", name);
  }

  for (const workspace of workspaces) {
    const page = await openPage(workspace);
    await page.getByTestId("open-project").setInputFiles(fixture);
    await page.getByTestId("project-ready").waitFor({ timeout: 15000 });
    const cjk = await page.getByText(/整理試玩回饋，確認負責人/).count();
    const mojibake = await page.getByText(/æ•´|çŽ©|å›ž/, { exact: false }).count();
    if (cjk === 0 || mojibake !== 0) throw new Error(`CJK render check failed at ${workspace.width}x${workspace.height}: ${cjk}/${mojibake}`);
    const longCell = page.locator('[data-testid^="cell:"][title]').first();
    const fullValue = await longCell.getAttribute("title");
    if (!fullValue || (await longCell.locator(".ts-cell-value").textContent())?.trim() !== fullValue) {
      throw new Error(`long-value access check failed at ${workspace.width}x${workspace.height}`);
    }
    if (workspace.id === "standard-1024") {
      const dimensions = await page.locator(".ts-grid-scroll").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      if (dimensions.scrollWidth <= dimensions.clientWidth) throw new Error("expected horizontal grid overflow at 1024px");
    }
    const name = workbookScreenshotName(workspace);
    await page.screenshot({ path: `${target}/${name}`, fullPage: true });
    if (workspace.id === "standard-1440") {
      await page.locator(".ts-cell").first().focus();
      await page.screenshot({ path: `${target}/workbook-50rows-selection.png`, fullPage: true });
      const editable = page.getByText(/整理試玩回饋，確認負責人/).first();
      await editable.dblclick();
      const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
      await input.fill("日本語の表示確認");
      if (await input.inputValue() !== "日本語の表示確認") throw new Error("Japanese glyph did not render in the active editor");
      await page.screenshot({ path: `${target}/workbook-50rows-japanese-edit.png`, fullPage: true });
      await input.press("Escape");
      await page.getByRole("button", { name: "Save a copy", exact: true }).click();
      await page.getByRole("dialog", { name: "Save a copy", exact: true }).waitFor();
      await page.screenshot({ path: `${target}/save-dialog-final.png`, fullPage: true });
    }
    await page.close();
    report(workspace, "populated-actual-core", name, { cjk_cells: cjk, mojibake_cells: mojibake });
  }
} finally {
  await browser.close();
}

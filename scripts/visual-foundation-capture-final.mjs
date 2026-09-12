// Final production evidence capture. All states are reached through the
// normal Sheet UI and the real public runtime; no DOM/state injection.
import { chromium } from "playwright";

const url = process.env.WORK_CLIENT_URL;
if (!url) throw new Error("WORK_CLIENT_URL is required");
const fixture = "evidence/visual-foundation/fixture-50.roproj";
const target = "evidence/visual-foundation/targets";
const browser = await chromium.launch({ headless: true });
try {
  const home = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await home.goto(url, { waitUntil: "domcontentloaded" });
  await home.screenshot({ path: `${target}/home.png`, fullPage: true });
  await home.close();

  for (const [width, height, name] of [[1280, 800, "home-1280x800.png"], [1024, 768, "home-1024x768.png"], [720, 450, "home-200-percent.png"]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (name.includes("200")) await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    await page.screenshot({ path: `${target}/${name}`, fullPage: true });
    await page.close();
  }

  for (const [width, height, name] of [[1440, 900, "workbook-50rows-1440x900.png"], [1280, 800, "workbook-50rows-1280x800.png"], [1024, 768, "workbook-50rows-1024x768.png"]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-project").setInputFiles(fixture);
    await page.getByTestId("project-ready").waitFor({ timeout: 15000 });
    const cjk = await page.getByText(/整理試玩回饋，確認負責人/).count();
    const mojibake = await page.getByText(/æ•´|çŽ©|å›ž/, { exact: false }).count();
    if (cjk === 0 || mojibake !== 0) throw new Error(`CJK render check failed at ${width}x${height}: ${cjk}/${mojibake}`);
    const longCell = page.locator('[data-testid^="cell:"][title]').first();
    const fullValue = await longCell.getAttribute("title");
    if (!fullValue || fullValue.length <= 40 || (await longCell.locator(".ts-cell-value").textContent())?.trim() !== fullValue) {
      throw new Error(`long-value access check failed at ${width}x${height}`);
    }
    if (width === 1024) {
      const dimensions = await page.locator(".ts-grid-scroll").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      if (dimensions.scrollWidth <= dimensions.clientWidth) throw new Error("expected horizontal grid overflow at 1024px");
    }
    await page.screenshot({ path: `${target}/${name}`, fullPage: true });
    if (width === 1440) {
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
    console.log(JSON.stringify({ viewport: `${width}x${height}`, cjk_cells: cjk, mojibake_cells: mojibake, screenshot: name }));
  }
} finally {
  await browser.close();
}
